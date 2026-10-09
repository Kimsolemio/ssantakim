import { z } from "zod";
import { FamilyProfile } from "@cook/shared";
import { verifyFirebaseIdToken, AuthError, type Verified } from "./auth";
import { generateRecipe, GenerationError, DEFAULT_MODEL } from "./ai";

export interface Env {
  FIREBASE_PROJECT_ID: string;
  ALLOWED_ORIGINS: string;   // 쉼표로 구분
  ALLOWED_EMAILS?: string;   // 쉼표로 구분. 비우면 로그인한 모든 사용자 허용
  GEMINI_API_KEY?: string;   // wrangler secret (Google AI Studio 무료 키)
  GEMINI_MODEL?: string;     // 기본 gemini-2.5-flash
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

async function readJson<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  const len = Number(request.headers.get("Content-Length") ?? "0");
  if (len > 1_000_000) throw new HttpError(413, "요청이 너무 큽니다");
  let body: unknown;
  try { body = await request.json(); } catch { throw new HttpError(400, "JSON 본문이 필요합니다"); }
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

async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const cors = corsHeaders(env, request);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

  try {
    if (url.pathname === "/health" && request.method === "GET") {
      return json({ ok: true, stage: 2, configured: { firebase: !!env.FIREBASE_PROJECT_ID, gemini: !!env.GEMINI_API_KEY }, model: env.GEMINI_MODEL || DEFAULT_MODEL }, 200, cors);
    }

    if (url.pathname === "/recipe" && request.method === "POST") {
      const user = await authenticate(request, env);
      const body = await readJson(request, RecipeRequest);
      if (!env.GEMINI_API_KEY) throw new HttpError(500, "Worker에 GEMINI_API_KEY가 설정되지 않았습니다");
      const result = await generateRecipe({ apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL || DEFAULT_MODEL }, body);
      console.log(JSON.stringify({ route: "recipe", uid: user.uid, dish: body.dish, model: result.model, usage: result.usage }));
      return json(result, 200, cors);
    }

    // 4단계: /normalize, 5단계: /import/*, 6단계: /pantry/photo, /suggest
    throw new HttpError(404, "not found");
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status, cors);
    if (e instanceof GenerationError) return json({ error: e.message }, e.status, cors);
    console.error(e);
    return json({ error: "서버 오류" }, 500, cors);
  }
}

export default { fetch: handle } satisfies ExportedHandler<Env>;
