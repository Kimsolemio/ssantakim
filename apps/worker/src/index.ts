import { z } from "zod";
import { FamilyProfile } from "@cook/shared";
import { verifyFirebaseIdToken, AuthError, type Verified } from "./auth";
import { selectProvider, describeAi, GenerationError, type AiEnv } from "./ai";
import { generateRecipe } from "./recipe";
import { scanReceipt } from "./receipt";
import { normalizeNames } from "./normalize";

export interface Env extends AiEnv {
  FIREBASE_PROJECT_ID: string;
  ALLOWED_ORIGINS: string;   // 쉼표로 구분
  ALLOWED_EMAILS?: string;   // 쉼표로 구분. 비우면 로그인한 모든 사용자 허용
  // AI 설정은 AiEnv 참고: AI_PROVIDER, ANTHROPIC_API_KEY(secret), CLAUDE_MODEL, GEMINI_API_KEY(secret), GEMINI_MODEL
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
  const allowed = (env.ALLOWED_EMAILS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (allowed.length > 0 && !(user.email && allowed.includes(user.email.toLowerCase()))) {
    throw new HttpError(403, "이 앱을 사용할 수 있는 계정이 아닙니다");
  }
  return user;
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
        ok: true, stage: 4, features: ["recipe", "pantry/receipt", "normalize"],
        configured: { firebase: !!env.FIREBASE_PROJECT_ID, claude: !!env.ANTHROPIC_API_KEY, gemini: !!env.GEMINI_API_KEY },
        ai: describeAi(env),
      }, 200, cors);
    }

    if (url.pathname === "/recipe" && request.method === "POST") {
      const user = await authenticate(request, env);
      const body = await readJson(request, RecipeRequest);
      const result = await generateRecipe(selectProvider(env), body);
      console.log(JSON.stringify({ route: "recipe", uid: user.uid, dish: body.dish, provider: result.provider, model: result.model, usage: result.usage }));
      return json(result, 200, cors);
    }

    if (url.pathname === "/pantry/receipt" && request.method === "POST") {
      const user = await authenticate(request, env);
      const body = await readJson(request, ReceiptRequest, 12_000_000);
      const result = await scanReceipt(selectProvider(env), body);
      console.log(JSON.stringify({ route: "pantry/receipt", uid: user.uid, images: body.images.length, items: result.scan.items.length, provider: result.provider, model: result.model, usage: result.usage }));
      return json(result, 200, cors);
    }

    if (url.pathname === "/normalize" && request.method === "POST") {
      const user = await authenticate(request, env);
      const body = await readJson(request, NormalizeRequest);
      const result = await normalizeNames(selectProvider(env), body.names);
      console.log(JSON.stringify({ route: "normalize", uid: user.uid, count: body.names.length, provider: result.provider, model: result.model }));
      return json(result, 200, cors);
    }

    // 5단계: /import/*, 6단계: /suggest
    throw new HttpError(404, "not found");
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status, cors);
    if (e instanceof GenerationError) return json({ error: e.message }, e.status, cors);
    console.error(e);
    return json({ error: "서버 오류" }, 500, cors);
  }
}

export default { fetch: handle } satisfies ExportedHandler<Env>;
