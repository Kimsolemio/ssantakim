import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import handler, { type Env } from "../src/index";
import { makeSigner, PROJECT, SAMPLE_RECIPE, jsonResponse, claudeMessage } from "./helpers";

let signer: Awaited<ReturnType<typeof makeSigner>>;
let token: string;
type Captured = { url: string; headers: Headers; body: any };

function stubFetch(route: (c: Captured) => Response) {
  const calls: Captured[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    if (req.url.startsWith("https://www.googleapis.com/service_accounts/v1/jwk/")) return jsonResponse({ keys: signer.jwks }, 200, { "cache-control": "max-age=3600" });
    const text = await req.text();
    const c = { url: req.url, headers: req.headers, body: text ? JSON.parse(text) : null };
    calls.push(c);
    return route(c);
  });
  return calls;
}

const env: Env = { FIREBASE_PROJECT_ID: PROJECT, ALLOWED_ORIGINS: "http://localhost:5173", ALLOWED_EMAILS: "me@example.com", ANTHROPIC_API_KEY: "sk-ant-test" };
const post = (path: string, body: unknown, e: Env = env) => handler.fetch!(new Request(`https://api.test${path}`, {
  method: "POST", body: JSON.stringify(body),
  headers: { Origin: "http://localhost:5173", Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
}) as any, e, {} as any);

beforeAll(async () => { signer = await makeSigner(); token = await signer.token(); });
afterEach(() => vi.unstubAllGlobals());

const recipe = { ...SAMPLE_RECIPE };

describe("/ask (AI 셰프에게 묻기)", () => {
  it("uses the fast model with a cached system prompt and sends the recipe, step, history and fridge", async () => {
    const calls = stubFetch(() => jsonResponse(claudeMessage(JSON.stringify({ answer: "약불에서 2분 더 볶으세요.", followups: ["면수는 얼마나?", "마늘이 탔어요", "소금은 언제?", "넷째"] }), { model: "claude-haiku-5-5" })));
    const r = await post("/ask", { recipe, servings: 3, step: 1, question: "면이 덜 익은 것 같아요", history: [{ q: "불은?", a: "중불" }], fridge: ["버터"] });
    expect(r.status).toBe(200);
    const j = await r.json() as any;
    expect(j.answer).toContain("약불");
    expect(j.followups).toHaveLength(3);
    const c = calls[0];
    expect(c.body.model).toBe("claude-haiku-5-5");
    expect(c.body.fallbacks).toBeUndefined();
    expect(c.headers.get("anthropic-beta") ?? "").not.toContain("server-side-fallback");
    expect(c.body.system[0].cache_control).toEqual({ type: "ephemeral" });
    const msg = c.body.messages[0].content[0].text as string;
    for (const t of ["지금 3인분", "지금 하고 있는 단계: 1단계", "Q: 불은?", "냉장고에 있는 것: 버터", "질문: 면이 덜 익은 것 같아요"]) expect(msg).toContain(t);
  });
  it("needs a question", async () => {
    stubFetch(() => jsonResponse({}, 500));
    expect((await post("/ask", { recipe, servings: 2, question: "   " })).status).toBe(400);
  });
});

describe("/adapt (레시피 바꾸기)", () => {
  it("returns a changed recipe marked as AI generated", async () => {
    const calls = stubFetch(() => jsonResponse(claudeMessage(JSON.stringify({ summary: "고춧가루를 줄였어요", recipe: { ...SAMPLE_RECIPE, title: "알리오올리오 (덜 맵게)", source: { type: "youtube", url: "nope" } } }))));
    const r = await post("/adapt", { recipe, instruction: "덜 맵게", servings: 2, fridge: ["두부"] });
    expect(r.status).toBe(200);
    const j = await r.json() as any;
    expect(j.recipe.title).toBe("알리오올리오 (덜 맵게)");
    expect(j.recipe.source).toEqual({ type: "generated" });
    expect(calls[0].body.model).toBe("claude-opus-5-5");
    expect(calls[0].body.messages[0].content[0].text).toContain("바꿀 점: 덜 맵게");
  });
});

describe("/substitute (대체 재료)", () => {
  it("only marks options as fromFridge when they are really in the fridge", async () => {
    stubFetch(() => jsonResponse(claudeMessage(JSON.stringify({ items: [{ ingredient: "버터", skippable: false, options: [
      { name: "식용유", fromFridge: true, amount: "1큰술", how: "고소함은 덜해요" },
      { name: "마가린", fromFridge: true, amount: "1큰술", how: "거의 같아요" },
    ] }] }))));
    const r = await post("/substitute", { title: "버터구이", all: ["버터", "감자"], missing: [{ name: "버터", qty: 10, unit: "g" }], fridge: ["카놀라유"], staples: ["소금"] });
    const j = await r.json() as any;
    expect(j.items[0].options.map((o: any) => [o.name, o.fromFridge])).toEqual([["식용유", true], ["마가린", false]]);
  });
});

describe("/recipe with web research", () => {
  it("searches the web first (Claude web_search), then writes the recipe with sources", async () => {
    const calls = stubFetch((c) => c.body.tools
      ? jsonResponse(claudeMessage("", { content: [
          { type: "server_tool_use", id: "srvtoolu_1", name: "web_search", input: { query: "알리오올리오 레시피" } },
          { type: "web_search_tool_result", tool_use_id: "srvtoolu_1", content: [{ type: "web_search_result", url: "https://www.10000recipe.com/recipe/1", title: "알리오올리오 황금레시피", page_age: null, encrypted_content: "x" }] },
          { type: "text", text: "면수를 넉넉히 쓰고 마늘은 약불에서 천천히.", citations: [{ type: "web_search_result_location", url: "https://www.10000recipe.com/recipe/1", title: "알리오올리오 황금레시피", cited_text: "면수", encrypted_index: "y" }] },
        ] }))
      : jsonResponse(claudeMessage(JSON.stringify(SAMPLE_RECIPE))));
    const m = new Map<string, string>();
    const kv = { get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => { m.set(k, v); } } as unknown as KVNamespace;
    const r = await post("/recipe", { dish: "알리오올리오", servings: 2, research: true }, { ...env, USAGE: kv });
    expect(r.status).toBe(200);
    const j = await r.json() as any;
    expect(j.recipe.source).toEqual({ type: "generated", refs: [{ url: "https://www.10000recipe.com/recipe/1", title: "알리오올리오 황금레시피" }] });
    const research = calls[0];
    expect(research.body.tools[0]).toMatchObject({ type: "web_search_20260318", name: "web_search", max_uses: 3, allowed_callers: ["direct"] });
    expect(research.body.output_config.format).toBeUndefined();
    expect(calls[1].body.messages[0].content[0].text).toContain("웹에서 찾은 인기 레시피 메모");
    expect(calls[1].body.output_config.format.type).toBe("json_schema");
    expect([...m.entries()].find(([k]) => k.startsWith("u:"))?.[1]).toBe("2"); // 검색 + 정리 = 2
  });
  it("continues after pause_turn", async () => {
    let n = 0;
    const calls = stubFetch((c) => {
      if (!c.body.tools) return jsonResponse(claudeMessage(JSON.stringify(SAMPLE_RECIPE)));
      n++;
      return n === 1
        ? jsonResponse(claudeMessage("", { stop_reason: "pause_turn", content: [{ type: "server_tool_use", id: "srvtoolu_1", name: "web_search", input: { query: "q" } }] }))
        : jsonResponse(claudeMessage("메모"));
    });
    expect((await post("/recipe", { dish: "라면", research: true })).status).toBe(200);
    const researchCalls = calls.filter((c) => c.body.tools);
    expect(researchCalls).toHaveLength(2);
    expect(researchCalls[1].body.messages[1].role).toBe("assistant");
  });
});
