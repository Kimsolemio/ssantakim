import { z } from "zod";
import { FamilyProfile, StorageLocation } from "@cook/shared";
import { verifyFirebaseIdToken, AuthError, type Verified } from "./auth";
import { selectProvider, describeAi, GenerationError, type AiEnv } from "./ai";
import { generateRecipe } from "./recipe";
import { scanReceipt } from "./receipt";
import { normalizeNames } from "./normalize";
import { importFromUrl, importFromText, precheckImportUrl } from "./import";
import { suggestMenus } from "./suggest";
import { adaptRecipe, askChef, suggestSubstitutes } from "./assist";
import { checkAllowed, chargeUsage, refundUsage, usageToday, allowList, GuardError, type GuardEnv } from "./guard";
import { trendingRecipes, TrendingError } from "./trending";

export interface Env extends AiEnv, GuardEnv {
  FIREBASE_PROJECT_ID: string;
  ALLOWED_ORIGINS: string;   // 쉼표로 구분
  // ALLOWED_EMAILS: 쉼표로 구분한 가족 이메일. 비우면 아무도 못 쓴다 ("*"는 로그인한 모두)
  // AI 설정은 AiEnv 참고: AI_PROVIDER, ANTHROPIC_API_KEY(secret), CLAUDE_MODEL, GEMINI_API_KEY(secret), GEMINI_MODEL
  YOUTUBE_API_KEY?: string;  // 선택. 없으면 유튜브 페이지에서 설명란을 읽는다
}

class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string) { super(message); }
}

function corsHeaders(env: Env, request: Request): Record<string, string> {
  const origin = request.headers.get("Origin") ?? "";
  const allowed = (env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const ok = allowed.includes(origin) || allowed.includes("*");
  return {
    "Access-Control-Allow-Origin": ok ? origin : (allowed[0] ?? ""),
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Family-Id",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function json(data: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...headers } });
}

async function authenticate(request: Request, env: Env): Promise<Verified> {
  const h = request.headers.get("Authorization") ?? "";
  const token = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
  if (!token) throw new HttpError(401, "로그인이 필요합니다");
  if (!env.FIREBASE_PROJECT_ID) throw new HttpError(500, "Worker에 FIREBASE_PROJECT_ID가 설정되지 않았습니다");
  let user: Verified;
  try { user = await verifyFirebaseIdToken(token, env.FIREBASE_PROJECT_ID); }
  catch (e) { throw new HttpError(401, e instanceof AuthError ? e.message : "토큰 검증 실패"); }
  // 허용 목록에 없으면, 앱이 알려 준 가족에 허용된 사람이 있는지 그 사람 권한으로 확인한다
  await checkAllowed(env, user, { projectId: env.FIREBASE_PROJECT_ID, idToken: token, familyId: request.headers.get("X-Family-Id") });
  return user;
}

/** 요청 하나의 상태: AI 호출이 실패하면 차감한 사용량을 돌려주기 위해 */
type Ctx = { refund: (() => Promise<void>) | null };

/**
 * 로그인 → 본문 검사 → 사용량 차감 순서. 잘못된 요청은 사용량을 쓰지 않고,
 * 차감한 뒤 실패하면(AI 오류, 인스타 링크, 페이지 못 읽음 등) handle 의 catch 가 돌려준다.
 */
async function begin<T>(ctx: Ctx, request: Request, env: Env, route: string, schema: z.ZodType<T>, maxBytes?: number, cost?: (body: T) => number, precheck?: (body: T) => void): Promise<{ user: Verified; body: T }> {
  const user = await authenticate(request, env);
  const body = await readJson(request, schema, maxBytes);
  // AI 없이 바로 끝나는 거절(인스타 링크, 열 수 없는 주소)은 사용량을 쓰기 전에
  precheck?.(body);
  const charged = await chargeUsage(env, user.uid, route, Date.now(), cost?.(body));
  ctx.refund = () => refundUsage(env, user.uid, charged);
  return { user, body };
}

async function readJson<T>(request: Request, schema: z.ZodType<T>, maxBytes = 1_000_000): Promise<T> {
  const len = Number(request.headers.get("Content-Length") ?? "0");
  if (len > maxBytes) throw new HttpError(413, "요청이 너무 큽니다");
  const text = await request.text();
  if (text.length > maxBytes) throw new HttpError(413, "요청이 너무 큽니다");
  let body: unknown;
  try { body = JSON.parse(text); } catch { throw new HttpError(400, "JSON 본문이 필요합니다"); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    if (i?.code === "too_big" && (i as { origin?: string }).origin === "string") throw new HttpError(400, `입력이 너무 길어요 (${i.path.join(".")}). 줄여서 다시 보내 주세요`, "too_long");
    throw new HttpError(400, `요청 형식 오류: ${i?.path.join(".")} ${i?.message}`);
  }
  return parsed.data;
}

const RecipeRequest = z.object({
  dish: z.string().trim().min(1).max(100),
  servings: z.number().positive().max(50).default(2),
  profile: FamilyProfile.transform((p) => ({ ...p, dislikes: p.dislikes.slice(0, 30), staples: p.staples.slice(0, 40) })).nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
  /** 웹에서 인기 레시피를 찾아보고 만들기 (Claude 웹 검색) */
  research: z.boolean().default(false),
});

/** 사진 한 장: base64 (data: 접두사 없이). Claude는 장당 5MB까지 받는다 */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ImageInput = z.object({
  mediaType: z.enum(["image/jpeg", "image/png", "image/webp", "image/gif"]),
  // 큰 문자열 전체에 정규식을 돌리면 무료 요금제 CPU 한도(10ms)를 쓰므로 앞부분만 검사한다
  data: z.string().min(100)
    .refine((d) => /^[A-Za-z0-9+/]{64}/.test(d.slice(0, 64)), "base64 형식이 아닙니다 (data: 접두사 없이 보내야 합니다)")
    .refine((d) => Math.floor((d.length * 3) / 4) <= MAX_IMAGE_BYTES, "사진 한 장이 너무 큽니다 (5MB 이하)"),
});
const ReceiptRequest = z.object({
  images: z.array(ImageInput).min(1, "사진이 필요합니다").max(4, "사진은 4장까지 올릴 수 있습니다"),
  today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** receipt: 영수증·주문내역, photo: 식재료를 찍은 사진 (냉장고 안, 장본 것) */
  mode: z.enum(["receipt", "photo"]).default("receipt"),
});

const ImportUrlRequest = z.object({ url: z.string().trim().min(8).max(2000) });
const ImportTextRequest = z.object({
  text: z.string().max(8000).nullable().optional(),
  images: z.array(ImageInput).max(4, "사진은 4장까지 올릴 수 있습니다").optional(),
  url: z.string().max(2000).nullable().optional(),
}).refine((b) => (b.text?.trim().length ?? 0) > 0 || (b.images?.length ?? 0) > 0, "글이나 사진이 필요합니다");

/**
 * 추천 요청은 냉장고 한 줄이 이상하다고 가족 모두의 추천이 막히면 안 되므로, 거절하지 않고 잘라서 받는다.
 * 줄바꿈은 프롬프트 구조를 바꿀 수 있어 공백으로 바꾼다.
 */
const oneLine = (max: number) => z.string().transform((s) => s.replace(/[\r\n\t]+/g, " ").trim().slice(0, max));
const Name = oneLine(60).pipe(z.string().min(1));
const names = (n: number, max = 60) => z.array(oneLine(max)).transform((a) => a.filter(Boolean).slice(0, n));
/** 가족 설정의 목록도 길이를 제한해서 보낸다 (아주 긴 목록이 그대로 AI 입력이 되지 않게) */
const ProfileIn = FamilyProfile.transform((p) => ({
  ...p,
  dislikes: p.dislikes.slice(0, 30).map((s) => s.slice(0, 30)),
  staples: p.staples.slice(0, 40).map((s) => s.slice(0, 30)),
}));
const SuggestRequest = z.object({
  items: z.array(z.object({
    name: Name,
    qty: z.number().nonnegative().nullable().optional(),
    unit: z.string().max(10).optional(),
    daysLeft: z.number().int().nullable().optional().transform((d) => (d == null ? d : Math.max(-3650, Math.min(3650, d)))),
    /** 기한이 포장 표시가 아니라 추정값인가 */
    estimated: z.boolean().optional(),
    location: StorageLocation.optional(),
  })).transform((a) => a.slice(0, 200)),
  mustUse: names(10).default([]),
  exclude: names(30).default([]),
  mood: oneLine(100).nullable().optional(),
  servings: z.number().int().positive().max(20).default(2),
  profile: ProfileIn.nullable().optional(),
  recent: names(30, 100).default([]),
  avoid: names(30, 100).default([]),
  count: z.number().int().min(1).max(8).default(5),
});

/** 레시피를 AI에 다시 보낼 때 (물어보기·바꾸기) 크기를 제한한 모양 */
const RecipeIn = z.object({
  title: oneLine(100),
  servingsBase: z.number().positive().max(50),
  ingredients: z.array(z.object({
    name: oneLine(60), key: z.string().max(80).default(""), qty: z.number().nonnegative().nullable(), unit: z.string().max(10),
    note: z.string().max(200).optional(), group: z.string().max(10).optional(), optional: z.boolean().optional(), scalable: z.boolean().optional(),
  })).max(60),
  steps: z.array(z.object({ order: z.number().int(), text: z.string().max(1000), minutes: z.number().nullable().default(null), ingredientKeys: z.array(z.string().max(80)).max(30).default([]) })).max(40),
  timeMinutes: z.number().nullable().optional(),
  difficulty: z.string().max(10).optional(),
  tags: z.array(z.string().max(30)).max(10).default([]),
  tips: z.array(z.string().max(300)).max(10).default([]),
});
const AskRequest = z.object({
  recipe: RecipeIn,
  servings: z.number().positive().max(50),
  step: z.number().int().positive().max(40).nullable().optional(),
  question: oneLine(300).pipe(z.string().min(1, "질문을 적어 주세요")),
  history: z.array(z.object({ q: oneLine(300), a: z.string().max(1500) })).transform((h) => h.slice(-6)).default([]),
  fridge: names(150).default([]),
});
const AdaptRequest = z.object({
  recipe: RecipeIn,
  instruction: oneLine(200).pipe(z.string().min(1, "어떻게 바꿀지 적어 주세요")),
  servings: z.number().int().positive().max(20),
  fridge: names(150).default([]),
  profile: ProfileIn.nullable().optional(),
});
const SubstituteRequest = z.object({
  title: oneLine(100),
  all: names(60),
  missing: z.array(z.object({ name: Name, qty: z.number().nonnegative().nullable(), unit: z.string().max(10) })).min(1).transform((a) => a.slice(0, 8)),
  fridge: names(150).default([]),
  staples: names(40, 30).default([]),
});

const NormalizeRequest = z.object({
  names: z.array(z.string().trim().min(1).max(60)).min(1).max(40, "한 번에 40개까지 정리할 수 있습니다"),
});

async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const cors = corsHeaders(env, request);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  const ctx: Ctx = { refund: null };

  try {
    if (url.pathname === "/health" && request.method === "GET") {
      return json({
        ok: true, stage: 6, features: ["recipe", "pantry/receipt", "pantry/photo", "normalize", "import/url", "import/text", "suggest", "ask", "adapt", "substitute", "trending"],
        configured: { firebase: !!env.FIREBASE_PROJECT_ID, claude: !!env.ANTHROPIC_API_KEY, gemini: !!env.GEMINI_API_KEY, youtube: !!env.YOUTUBE_API_KEY },
        ai: describeAi(env),
        guard: { allowList: allowList(env).includes("*") ? "everyone" : allowList(env).length, perMinute: !!env.AI_LIMIT, daily: !!env.USAGE },
        // 요청이 들어온 Cloudflare 위치 (HKG 등이면 AI 업체가 막는 지역이라 placement 로 미국에서 돌린다)
        colo: (request as { cf?: { colo?: string } }).cf?.colo ?? null,
      }, 200, cors);
    }

    if (url.pathname === "/usage" && request.method === "GET") {
      const user = await authenticate(request, env);
      return json({ today: await usageToday(env, user.uid) }, 200, cors);
    }

    // 오늘의 인기 레시피 (유튜브). AI를 쓰지 않아 하루 사용량에서 빼지 않는다. ing = 냉장고에서 고른 재료 하나
    if (url.pathname === "/trending" && request.method === "GET") {
      const user = await authenticate(request, env);
      // AI는 아니지만 유튜브 한도를 쓰므로 1분 한도는 함께 건다 (하루 사용량에서는 빼지 않는다)
      if (env.AI_LIMIT && !(await env.AI_LIMIT.limit({ key: user.uid })).success) throw new HttpError(429, "너무 자주 요청했어요. 1분 뒤에 다시 해 주세요", "rate_limited");
      const r = await trendingRecipes(env, url.searchParams.get("ing"));
      console.log(JSON.stringify({ route: "trending", uid: user.uid, videos: r.videos.length }));
      return json(r, 200, cors);
    }

    if (url.pathname === "/recipe" && request.method === "POST") {
      // 웹 검색까지 하면 두 번 부르므로 2
      const { user, body } = await begin(ctx, request, env, "/recipe", RecipeRequest, undefined, (b) => (b.research ? 2 : 1));
      const result = await generateRecipe(selectProvider(env), body);
      console.log(JSON.stringify({ route: "recipe", uid: user.uid, dish: body.dish, research: body.research, refs: result.recipe.source.refs?.length ?? 0, provider: result.provider, model: result.model, usage: result.usage }));
      return json(result, 200, cors);
    }

    if (url.pathname === "/pantry/receipt" && request.method === "POST") {
      const { user, body } = await begin(ctx, request, env, "/pantry/receipt", ReceiptRequest, 12_000_000);
      const result = await scanReceipt(selectProvider(env), body);
      console.log(JSON.stringify({ route: "pantry/receipt", uid: user.uid, mode: body.mode, images: body.images.length, items: result.scan.items.length, provider: result.provider, model: result.model, usage: result.usage }));
      return json(result, 200, cors);
    }

    if (url.pathname === "/normalize" && request.method === "POST") {
      const { user, body } = await begin(ctx, request, env, "/normalize", NormalizeRequest);
      const result = await normalizeNames(selectProvider(env, undefined, "fast"), body.names);
      console.log(JSON.stringify({ route: "normalize", uid: user.uid, count: body.names.length, provider: result.provider, model: result.model }));
      return json(result, 200, cors);
    }

    if (url.pathname === "/import/url" && request.method === "POST") {
      const { user, body } = await begin(ctx, request, env, "/import/url", ImportUrlRequest, undefined, undefined, (b) => precheckImportUrl(b.url));
      const r = await importFromUrl(env, body.url);
      console.log(JSON.stringify({ route: "import/url", uid: user.uid, via: r.via, hasRecipe: r.result.hasRecipe, provider: r.provider, model: r.model }));
      return json(r, 200, cors);
    }

    if (url.pathname === "/import/text" && request.method === "POST") {
      // 사진이 있으면 영수증처럼 더 무겁다
      const { user, body } = await begin(ctx, request, env, "/import/text", ImportTextRequest, 12_000_000, (b) => ((b.images?.length ?? 0) > 0 ? 2 : 1));
      const r = await importFromText(env, body);
      console.log(JSON.stringify({ route: "import/text", uid: user.uid, via: r.via, images: body.images?.length ?? 0, hasRecipe: r.result.hasRecipe, provider: r.provider }));
      return json(r, 200, cors);
    }

    if (url.pathname === "/ask" && request.method === "POST") {
      const { user, body } = await begin(ctx, request, env, "/ask", AskRequest);
      const r = await askChef(selectProvider(env, undefined, "fast"), body);
      console.log(JSON.stringify({ route: "ask", uid: user.uid, provider: r.provider, model: r.model, usage: r.usage }));
      return json(r, 200, cors);
    }

    if (url.pathname === "/adapt" && request.method === "POST") {
      const { user, body } = await begin(ctx, request, env, "/adapt", AdaptRequest);
      const r = await adaptRecipe(selectProvider(env), body);
      console.log(JSON.stringify({ route: "adapt", uid: user.uid, provider: r.provider, model: r.model, usage: r.usage }));
      return json(r, 200, cors);
    }

    if (url.pathname === "/substitute" && request.method === "POST") {
      const { user, body } = await begin(ctx, request, env, "/substitute", SubstituteRequest);
      const r = await suggestSubstitutes(selectProvider(env, undefined, "fast"), body);
      console.log(JSON.stringify({ route: "substitute", uid: user.uid, provider: r.provider, model: r.model, usage: r.usage }));
      return json(r, 200, cors);
    }

    if (url.pathname === "/suggest" && request.method === "POST") {
      const { user, body } = await begin(ctx, request, env, "/suggest", SuggestRequest);
      const r = await suggestMenus(selectProvider(env), body);
      console.log(JSON.stringify({ route: "suggest", uid: user.uid, items: body.items.length, got: r.suggestions.length, dropped: r.dropped, provider: r.provider, model: r.model, usage: r.usage }));
      return json(r, 200, cors);
    }

    throw new HttpError(404, "not found");
  } catch (e) {
    // 사용량을 차감한 뒤 실패했으면 돌려준다. 단 AI가 이미 답을 만들어 요금이 나간 실패(잘림·거절·형식 오류)는 돌려주지 않는다
    // (일부러 실패시켜 하루 한도를 피하는 것을 막는다)
    const billed = e instanceof GenerationError && e.billed;
    if (ctx.refund && !(e instanceof GuardError) && !billed) await ctx.refund().catch((err) => console.warn("refund failed", err));
    if (e instanceof HttpError) return json({ error: e.message, ...(e.code ? { code: e.code } : {}) }, e.status, cors);
    if (e instanceof GuardError) return json({ error: e.message, ...(e.code ? { code: e.code } : {}) }, e.status, cors);
    if (e instanceof GenerationError) return json({ error: e.message, ...(e.code ? { code: e.code } : {}) }, e.status, cors);
    if (e instanceof TrendingError) return json({ error: e.message, ...(e.code ? { code: e.code } : {}) }, e.status, cors);
    console.error(e);
    return json({ error: "서버 오류" }, 500, cors);
  }
}

export default { fetch: handle } satisfies ExportedHandler<Env>;
