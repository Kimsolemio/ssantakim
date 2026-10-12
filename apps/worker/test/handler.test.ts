import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import handler, { type Env } from "../src/index";
import { makeSigner, PROJECT, SAMPLE_RECIPE, jsonResponse, claudeMessage } from "./helpers";

type Captured = { url: string; headers: Headers; body: any };
let signer: Awaited<ReturnType<typeof makeSigner>>;
let goodToken: string;

/** Google JWKS 요청은 테스트 키로 응답하고, 나머지는 route 함수가 처리 */
function stubFetch(route: (c: Captured) => Response | Promise<Response>) {
  const calls: Captured[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    if (req.url.startsWith("https://www.googleapis.com/service_accounts/v1/jwk/")) {
      return jsonResponse({ keys: signer.jwks }, 200, { "cache-control": "max-age=3600" });
    }
    const text = await req.text();
    const c = { url: req.url, headers: req.headers, body: text ? JSON.parse(text) : null };
    calls.push(c);
    return route(c);
  });
  return calls;
}

const baseEnv: Env = { FIREBASE_PROJECT_ID: PROJECT, ALLOWED_ORIGINS: "http://localhost:5173,https://cook.example.com", ALLOWED_EMAILS: "*" };
const call = (env: Env, path: string, init: RequestInit & { headers?: Record<string, string> } = {}) =>
  handler.fetch!(new Request(`https://api.test${path}`, { ...init, headers: { Origin: "https://cook.example.com", ...(init.headers ?? {}) } }) as any, env, {} as any);
const recipeReq = (env: Env, body: unknown = { dish: "알리오올리오", servings: 2 }) =>
  call(env, "/recipe", { method: "POST", body: JSON.stringify(body), headers: { Authorization: `Bearer ${goodToken}`, "Content-Type": "application/json" } });

beforeAll(async () => { signer = await makeSigner(); goodToken = await signer.token(); });
afterEach(() => vi.unstubAllGlobals());

describe("basics", () => {
  it("health reports configuration without secrets", async () => {
    const r = await call({ ...baseEnv, ANTHROPIC_API_KEY: "k", GEMINI_API_KEY: "g" }, "/health");
    expect(r.status).toBe(200);
    expect(r.headers.get("Access-Control-Allow-Origin")).toBe("https://cook.example.com");
    const j = await r.json() as any;
    expect(j.configured).toEqual({ firebase: true, claude: true, gemini: true });
    expect(j.ai).toEqual({ provider: "claude", model: "claude-opus-5-5" });
    expect(JSON.stringify(j)).not.toContain('"k"');
  });
  it("health explains a missing AI key", async () => {
    const j = await (await call(baseEnv, "/health")).json() as any;
    expect(j.ai.provider).toBeNull();
    expect(j.ai.error).toMatch(/AI 키가 없습니다/);
  });
  it("does not echo unknown origins", async () => {
    const r = await handler.fetch!(new Request("https://api.test/health", { headers: { Origin: "https://evil.example" } }) as any, baseEnv, {} as any);
    expect(r.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:5173");
  });
  it("handles preflight and unknown routes", async () => {
    expect((await call(baseEnv, "/recipe", { method: "OPTIONS" })).status).toBe(204);
    expect((await call(baseEnv, "/nope")).status).toBe(404);
  });
});

describe("/recipe auth and validation", () => {
  it("requires a valid token", async () => {
    stubFetch(() => jsonResponse({}, 500));
    expect((await call(baseEnv, "/recipe", { method: "POST", body: "{}" })).status).toBe(401);
    expect((await call(baseEnv, "/recipe", { method: "POST", body: "{}", headers: { Authorization: "Bearer nope" } })).status).toBe(401);
  });
  it("enforces the email allow list", async () => {
    stubFetch(() => jsonResponse({}, 500));
    const r = await recipeReq({ ...baseEnv, ALLOWED_EMAILS: "mom@example.com, dad@example.com", ANTHROPIC_API_KEY: "k" });
    expect(r.status).toBe(403);
  });
  it("blocks everyone when the allow list is empty (fail closed)", async () => {
    const calls = stubFetch(() => jsonResponse({}, 500));
    const r = await recipeReq({ ...baseEnv, ALLOWED_EMAILS: "", ANTHROPIC_API_KEY: "k" });
    expect(r.status).toBe(403);
    expect(await r.json()).toMatchObject({ code: "not_configured" });
    expect(calls).toHaveLength(0);
  });
  it("matches the allow list only with a verified email", async () => {
    const calls = stubFetch(() => jsonResponse(claudeMessage(JSON.stringify(SAMPLE_RECIPE))));
    const env = { ...baseEnv, ALLOWED_EMAILS: "Me@Example.com", ANTHROPIC_API_KEY: "k" };
    const unverified = await signer.token({ email_verified: false });
    const r1 = await call(env, "/recipe", { method: "POST", body: JSON.stringify({ dish: "라면" }), headers: { Authorization: `Bearer ${unverified}` } });
    expect(r1.status).toBe(403);
    expect(calls).toHaveLength(0);
    expect((await recipeReq(env)).status).toBe(200);
  });
  it("rejects a bad body", async () => {
    stubFetch(() => jsonResponse({}, 500));
    const r = await recipeReq({ ...baseEnv, ANTHROPIC_API_KEY: "k" }, {});
    expect(r.status).toBe(400);
    expect((await r.json() as any).error).toMatch(/dish/);
  });
  it("explains a missing AI key", async () => {
    stubFetch(() => jsonResponse({}, 500));
    const r = await recipeReq(baseEnv);
    expect(r.status).toBe(500);
    expect((await r.json() as any).error).toMatch(/AI 키가 없습니다/);
  });
});

describe("/recipe with Claude", () => {
  const env: Env = { ...baseEnv, ANTHROPIC_API_KEY: "sk-ant-test", GEMINI_API_KEY: "also-set" };

  it("sends a structured-output request with fallbacks and parses the recipe", async () => {
    const calls = stubFetch(() => jsonResponse(claudeMessage(JSON.stringify(SAMPLE_RECIPE))));
    const r = await recipeReq(env, { dish: "알리오올리오", servings: 2, notes: "덜 맵게", profile: { members: 3, spicyLevel: "순한맛", allergies: ["새우"], dislikes: [], kidsFriendly: true, defaultServings: 2 } });
    expect(r.status).toBe(200);
    const j = await r.json() as any;
    expect(j.provider).toBe("claude");
    expect(j.recipe.title).toBe("알리오올리오");
    expect(j.usage).toEqual({ input: 1200, output: 2400 });

    expect(calls).toHaveLength(1);
    const c = calls[0];
    expect(c.url).toBe("https://api.anthropic.com/v1/messages?beta=true");
    expect(c.headers.get("x-api-key")).toBe("sk-ant-test");
    expect(c.headers.get("anthropic-beta")).toContain("server-side-fallback-2026-07-01");
    expect(c.body.model).toBe("claude-opus-5-5");
    expect(c.body.fallbacks).toBe("default");
    expect(c.body.thinking).toBeUndefined();
    expect(c.body.output_config.effort).toBe("medium");
    expect(c.body.output_config.format.type).toBe("json_schema");
    expect(c.body.output_config.format.schema.properties.ingredients).toBeTruthy();
    expect(c.body.messages[0].content[0].text).toContain("알레르기 [새우]");
    expect(c.body.messages[0].content[0].text).toContain("추가 요청: 덜 맵게");
  });

  it("uses CLAUDE_MODEL when set", async () => {
    const calls = stubFetch(() => jsonResponse(claudeMessage(JSON.stringify(SAMPLE_RECIPE))));
    await recipeReq({ ...env, CLAUDE_MODEL: "claude-sonnet-5-5" });
    expect(calls[0].body.model).toBe("claude-sonnet-5-5");
  });

  it("retries once without the fallback beta when the request is rejected", async () => {
    let n = 0;
    const calls = stubFetch(() => (++n === 1
      ? jsonResponse({ type: "error", error: { type: "invalid_request_error", message: "fallbacks: unsupported" } }, 400)
      : jsonResponse(claudeMessage(JSON.stringify(SAMPLE_RECIPE)))));
    const r = await recipeReq(env);
    expect(r.status).toBe(200);
    expect(calls).toHaveLength(2);
    expect(calls[1].body.fallbacks).toBeUndefined();
    expect(calls[1].headers.get("anthropic-beta") ?? "").not.toContain("server-side-fallback");
  });

  it("maps refusal, truncation, bad JSON and auth errors to friendly messages", async () => {
    const cases: [() => Response, number, RegExp][] = [
      [() => jsonResponse(claudeMessage("", { stop_reason: "refusal", content: [] })), 422, /응답할 수 없다/],
      [() => jsonResponse(claudeMessage("{\"title\":", { stop_reason: "max_tokens" })), 502, /잘렸습니다/],
      [() => jsonResponse(claudeMessage("not json")), 502, /JSON 오류/],
      [() => jsonResponse(claudeMessage(JSON.stringify({ ...SAMPLE_RECIPE, ingredients: [] }))), 502, /형식에 맞지 않습니다/],
      [() => jsonResponse({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }, 401), 502, /API 키가 올바르지 않습니다/],
    ];
    for (const [resp, status, msg] of cases) {
      stubFetch(resp);
      const r = await recipeReq(env);
      expect(r.status, String(msg)).toBe(status);
      expect((await r.json() as any).error).toMatch(msg);
      vi.unstubAllGlobals();
    }
  });
});

describe("/recipe with Gemini", () => {
  const env: Env = { ...baseEnv, GEMINI_API_KEY: "gem-key" };

  it("is used when only a Gemini key exists", async () => {
    const calls = stubFetch(() => jsonResponse({ candidates: [{ content: { parts: [{ text: JSON.stringify(SAMPLE_RECIPE) }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20 } }));
    const r = await recipeReq(env);
    expect(r.status).toBe(200);
    expect((await r.json() as any).provider).toBe("gemini");
    expect(calls[0].url).toContain("generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent");
    expect(calls[0].headers.get("x-goog-api-key")).toBe("gem-key");
    expect(calls[0].body.generationConfig.responseMimeType).toBe("application/json");
  });

  it("can be forced with AI_PROVIDER even when a Claude key exists", async () => {
    const calls = stubFetch(() => jsonResponse({ candidates: [{ content: { parts: [{ text: JSON.stringify(SAMPLE_RECIPE) }] }, finishReason: "STOP" }] }));
    const r = await recipeReq({ ...env, ANTHROPIC_API_KEY: "k", AI_PROVIDER: "gemini" });
    expect((await r.json() as any).provider).toBe("gemini");
    expect(calls[0].url).toContain("generativelanguage");
  });

  it("reports the free-tier limit", async () => {
    stubFetch(() => jsonResponse({ error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "quota" } }, 429));
    const r = await recipeReq(env);
    expect(r.status).toBe(429);
    expect((await r.json() as any).error).toMatch(/무료 사용량 한도/);
  });
});

describe("usage limits", () => {
  /** 메모리로 흉내 낸 KV */
  function fakeKv() {
    const m = new Map<string, string>();
    return { m, kv: { get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => { m.set(k, v); } } as unknown as KVNamespace };
  }
  const ok = () => jsonResponse(claudeMessage(JSON.stringify(SAMPLE_RECIPE)));

  it("stops a user at the daily limit without calling the AI", async () => {
    const calls = stubFetch(ok);
    const { kv, m } = fakeKv();
    const env: Env = { ...baseEnv, ANTHROPIC_API_KEY: "k", USAGE: kv, DAILY_LIMIT_PER_USER: "2" };
    expect((await recipeReq(env)).status).toBe(200);
    expect((await recipeReq(env)).status).toBe(200);
    const r = await recipeReq(env);
    expect(r.status).toBe(429);
    expect(await r.json()).toMatchObject({ code: "daily_user" });
    expect(calls).toHaveLength(2);
    expect([...m.keys()].some((k) => k.startsWith("u:") && k.endsWith(":uid-1"))).toBe(true);
  });
  it("has a family-wide daily limit", async () => {
    stubFetch(ok);
    const { kv } = fakeKv();
    const env: Env = { ...baseEnv, ANTHROPIC_API_KEY: "k", USAGE: kv, DAILY_LIMIT_TOTAL: "1" };
    expect((await recipeReq(env)).status).toBe(200);
    expect(await (await recipeReq(env)).json()).toMatchObject({ code: "daily_total" });
  });
  it("does not charge invalid requests", async () => {
    stubFetch(ok);
    const { kv, m } = fakeKv();
    const env: Env = { ...baseEnv, ANTHROPIC_API_KEY: "k", USAGE: kv };
    expect((await recipeReq(env, {})).status).toBe(400);
    expect(m.size).toBe(0);
  });
  it("honours the per-minute rate limit binding", async () => {
    const calls = stubFetch(ok);
    const keys: string[] = [];
    const env: Env = { ...baseEnv, ANTHROPIC_API_KEY: "k", AI_LIMIT: { limit: async ({ key }: { key: string }) => { keys.push(key); return { success: false }; } } as unknown as RateLimit };
    const r = await recipeReq(env);
    expect(r.status).toBe(429);
    expect(keys).toEqual(["uid-1"]);
    expect(calls).toHaveLength(0);
  });
  it("health shows which guards are on", async () => {
    const j = await (await call({ ...baseEnv, ALLOWED_EMAILS: "a@b.c,d@e.f" }, "/health")).json() as any;
    expect(j.guard).toEqual({ allowList: 2, perMinute: false, daily: false });
  });
});
