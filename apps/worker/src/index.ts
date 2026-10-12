import { z } from "zod";
import { FamilyProfile, StorageLocation } from "@cook/shared";
import { verifyFirebaseIdToken, AuthError, type Verified } from "./auth";
import { selectProvider, describeAi, GenerationError, type AiEnv } from "./ai";
import { generateRecipe } from "./recipe";
import { scanReceipt } from "./receipt";
import { normalizeNames } from "./normalize";
import { importFromUrl, importFromText } from "./import";
import { suggestMenus } from "./suggest";
import { checkAllowed, chargeUsage, usageToday, allowList, GuardError, type GuardEnv } from "./guard";

export interface Env extends AiEnv, GuardEnv {
  FIREBASE_PROJECT_ID: string;
  ALLOWED_ORIGINS: string;   // 쉼표로 구분
  // ALLOWED_EMAILS: 쉼표로 구분한 가족 이메일. 비우면 아무도 못 쓴다 ("*"는 로그인한 모두)
  // AI 설정은 AiEnv 참고: AI_PROVIDER, ANTHROPIC_API_KEY(secret), CLAUDE_MODEL, GEMINI_API_KEY(secret), GEMINI_MODEL
  YOUTUBE_API_KEY?: string;  // 선택. 없으면 유튜브 페이지에서 설명란을 읽는다
}

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

function corsHeaders(env: Env, request: Request): Record<string, string> {
  const origin = request.headers.get("Origin") ?? "";
  const allowed = (env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const ok = allowed.includes(origin) || allowed.includes("*");
  return {
    "Access-Control-Allow-Origin": ok ? origin : (allowed[0] ?? ""),
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
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
  checkAllowed(env, user);
  return user;
}

/** 로그인 → 본문 검사 → 사용량 차감 순서. 잘못된 요청은 사용량을 쓰지 않는다 */
async function begin<T>(request: Request, env: Env, route: string, schema: z.ZodType<T>, maxBytes?: number): Promise<{ user: Verified; body: T }> {
  const user = await authenticate(request, env);
  const body = await readJson(request, schema, maxBytes);
  await chargeUsage(env, user.uid, route);
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
  if (!parsed.success) throw new HttpError(400, `요청 형식 오류: ${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}`);
  return parsed.data;
}

const RecipeRequest = z.object({
  dish: z.string().trim().min(1).max(100),
  servings: z.number().positive().max(50).default(2),
  profile: FamilyProfile.nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
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
});

const ImportUrlRequest = z.object({ url: z.string().trim().min(8).max(2000) });
const ImportTextRequest = z.object({
  text: z.string().max(8000).nullable().optional(),
  images: z.array(ImageInput).max(4, "사진은 4장까지 올릴 수 있습니다").optional(),
  url: z.string().max(2000).nullable().optional(),
}).refine((b) => (b.text?.trim().length ?? 0) > 0 || (b.images?.length ?? 0) > 0, "글이나 사진이 필요합니다");

const Name = z.string().trim().min(1).max(60);
const SuggestRequest = z.object({
  items: z.array(z.object({
    name: Name,
    qty: z.number().nonnegative().nullable().optional(),
    unit: z.string().max(10).optional(),
    daysLeft: z.number().int().min(-3650).max(3650).nullable().optional(),
    location: StorageLocation.optional(),
  })).max(200, "냉장고 품목은 200개까지 보낼 수 있습니다"),
  mustUse: z.array(Name).max(10).default([]),
  exclude: z.array(Name).max(30).default([]),
  mood: z.string().trim().max(100).nullable().optional(),
  servings: z.number().int().positive().max(20).default(2),
  profile: FamilyProfile.nullable().optional(),
  recent: z.array(z.string().trim().max(100)).max(30).default([]),
  avoid: z.array(z.string().trim().max(100)).max(30).default([]),
  count: z.number().int().min(1).max(8).default(5),
});

const NormalizeRequest = z.object({
  names: z.array(z.string().trim().min(1).max(60)).min(1).max(40, "한 번에 40개까지 정리할 수 있습니다"),
});

async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const cors = corsHeaders(env, request);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

  try {
    if (url.pathname === "/health" && request.method === "GET") {
      return json({
        ok: true, stage: 6, features: ["recipe", "pantry/receipt", "normalize", "import/url", "import/text", "suggest"],
        configured: { firebase: !!env.FIREBASE_PROJECT_ID, claude: !!env.ANTHROPIC_API_KEY, gemini: !!env.GEMINI_API_KEY },
        ai: describeAi(env),
        guard: { allowList: allowList(env).includes("*") ? "everyone" : allowList(env).length, perMinute: !!env.AI_LIMIT, daily: !!env.USAGE },
      }, 200, cors);
    }

    if (url.pathname === "/usage" && request.method === "GET") {
      const user = await authenticate(request, env);
      return json({ today: await usageToday(env, user.uid) }, 200, cors);
    }

    if (url.pathname === "/recipe" && request.method === "POST") {
      const { user, body } = await begin(request, env, "/recipe", RecipeRequest);
      const result = await generateRecipe(selectProvider(env), body);
      console.log(JSON.stringify({ route: "recipe", uid: user.uid, dish: body.dish, provider: result.provider, model: result.model, usage: result.usage }));
      return json(result, 200, cors);
    }

    if (url.pathname === "/pantry/receipt" && request.method === "POST") {
      const { user, body } = await begin(request, env, "/pantry/receipt", ReceiptRequest, 12_000_000);
      const result = await scanReceipt(selectProvider(env), body);
      console.log(JSON.stringify({ route: "pantry/receipt", uid: user.uid, images: body.images.length, items: result.scan.items.length, provider: result.provider, model: result.model, usage: result.usage }));
      return json(result, 200, cors);
    }

    if (url.pathname === "/normalize" && request.method === "POST") {
      const { user, body } = await begin(request, env, "/normalize", NormalizeRequest);
      const result = await normalizeNames(selectProvider(env), body.names);
      console.log(JSON.stringify({ route: "normalize", uid: user.uid, count: body.names.length, provider: result.provider, model: result.model }));
      return json(result, 200, cors);
    }

    if (url.pathname === "/import/url" && request.method === "POST") {
      const { user, body } = await begin(request, env, "/import/url", ImportUrlRequest);
      const r = await importFromUrl(env, body.url);
      console.log(JSON.stringify({ route: "import/url", uid: user.uid, via: r.via, hasRecipe: r.result.hasRecipe, provider: r.provider, model: r.model }));
      return json(r, 200, cors);
    }

    if (url.pathname === "/import/text" && request.method === "POST") {
      const { user, body } = await begin(request, env, "/import/text", ImportTextRequest, 12_000_000);
      const r = await importFromText(env, body);
      console.log(JSON.stringify({ route: "import/text", uid: user.uid, via: r.via, images: body.images?.length ?? 0, hasRecipe: r.result.hasRecipe, provider: r.provider }));
      return json(r, 200, cors);
    }

    if (url.pathname === "/suggest" && request.method === "POST") {
      const { user, body } = await begin(request, env, "/suggest", SuggestRequest);
      const r = await suggestMenus(selectProvider(env), body);
      console.log(JSON.stringify({ route: "suggest", uid: user.uid, items: body.items.length, got: r.suggestions.length, dropped: r.dropped, provider: r.provider, model: r.model, usage: r.usage }));
      return json(r, 200, cors);
    }

    throw new HttpError(404, "not found");
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status, cors);
    if (e instanceof GuardError) return json({ error: e.message, ...(e.code ? { code: e.code } : {}) }, e.status, cors);
    if (e instanceof GenerationError) return json({ error: e.message, ...(e.code ? { code: e.code } : {}) }, e.status, cors);
    console.error(e);
    return json({ error: "서버 오류" }, 500, cors);
  }
}

export default { fetch: handle } satisfies ExportedHandler<Env>;
