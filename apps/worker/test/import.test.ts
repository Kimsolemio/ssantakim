import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import handler, { type Env } from "../src/index";
import { makeSigner, PROJECT, SAMPLE_RECIPE, FAKE_IMAGE, jsonResponse, claudeMessage } from "./helpers";

let signer: Awaited<ReturnType<typeof makeSigner>>;
let token: string;
type Call = { url: string; headers: Headers; body: any };

/** 외부 요청을 주소별로 가짜 응답 */
function stub(routes: { match: (u: string) => boolean; reply: (c: Call) => Response }[]) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    if (req.url.startsWith("https://www.googleapis.com/service_accounts/v1/jwk/")) return jsonResponse({ keys: signer.jwks }, 200, { "cache-control": "max-age=3600" });
    const text = req.method === "GET" ? "" : await req.text();
    let body: any = null; try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    const c = { url: req.url, headers: req.headers, body };
    calls.push(c);
    const r = routes.find((x) => x.match(req.url));
    return r ? r.reply(c) : new Response("not found", { status: 404 });
  });
  return calls;
}
const found = (extra = {}) => JSON.stringify({ hasRecipe: true, reason: "레시피 있음", dishName: "알리오올리오", recipe: { ...SAMPLE_RECIPE, source: { type: "text" } }, ...extra });
const notFound = JSON.stringify({ hasRecipe: false, reason: "설명란에 레시피가 없어요", dishName: "알리오올리오", recipe: null });
const isClaude = (u: string) => u.startsWith("https://api.anthropic.com/");
const isGemini = (u: string) => u.startsWith("https://generativelanguage.googleapis.com/");
const html = (s: string, ct = "text/html; charset=utf-8") => new Response(s, { headers: { "content-type": ct } });

const env: Env = { FIREBASE_PROJECT_ID: PROJECT, ALLOWED_ORIGINS: "http://localhost:5173", ANTHROPIC_API_KEY: "sk-ant-test" };
const post = (path: string, body: unknown, e: Env = env) => handler.fetch!(new Request(`https://api.test${path}`, {
  method: "POST", body: JSON.stringify(body), headers: { Origin: "http://localhost:5173", Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
}) as any, e, {} as any);

beforeAll(async () => { signer = await makeSigner(); token = await signer.token(); });
afterEach(() => vi.unstubAllGlobals());

describe("/import/url — YouTube", () => {
  it("uses the Data API description when a YouTube key is set", async () => {
    const calls = stub([
      { match: (u) => u.startsWith("https://www.googleapis.com/youtube/v3/videos"), reply: () => jsonResponse({ items: [{ snippet: { title: "10분 알리오올리오", channelTitle: "요리채널", description: "재료: 스파게티 200g, 마늘 8쪽, 올리브오일 4큰술\n1. 면을 삶는다 2. 마늘을 볶는다" } }] }) },
      { match: isClaude, reply: () => jsonResponse(claudeMessage(found())) },
    ]);
    const r = await post("/import/url", { url: "https://youtu.be/dQw4w9WgXcQ?si=abc" }, { ...env, YOUTUBE_API_KEY: "yt" });
    expect(r.status).toBe(200);
    const j = await r.json() as any;
    expect(j.via).toBe("youtube_description");
    expect(j.result.recipe.source).toEqual({ type: "youtube", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", channel: "요리채널", title: "10분 알리오올리오" });
    const ai = calls.find((c) => isClaude(c.url))!;
    expect(ai.body.system).toContain("지어내지 않습니다");
    expect(ai.body.messages[0].content[0].text).toContain("설명란:\n재료: 스파게티 200g");
    expect(calls.some((c) => c.url.includes("youtube.com/watch"))).toBe(false);
  });

  it("falls back to the watch page when there is no API key", async () => {
    const page = `<meta property="og:title" content="10분 알리오올리오"><script>{"videoDetails":{"author":"요리채널","shortDescription":"재료\\n스파게티 200g\\n마늘 8쪽\\n올리브오일 4큰술"}}</script>`;
    stub([
      { match: (u) => u.startsWith("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), reply: () => html(page) },
      { match: isClaude, reply: () => jsonResponse(claudeMessage(found())) },
    ]);
    const j = await (await post("/import/url", { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" })).json() as any;
    expect(j.result.hasRecipe).toBe(true);
    expect(j.result.recipe.source.channel).toBe("요리채널");
  });

  it("watches the video with Gemini when the description has no recipe", async () => {
    const calls = stub([
      { match: (u) => u.startsWith("https://www.youtube.com/watch"), reply: () => html(`<meta property="og:title" content="브이로그"><script>{"shortDescription":"구독과 좋아요 부탁드려요! 오늘은 맛있는 파스타를 만들어 봤어요"}</script>`) },
      { match: isClaude, reply: () => jsonResponse(claudeMessage(notFound)) },
      { match: isGemini, reply: () => jsonResponse({ candidates: [{ content: { parts: [{ text: found() }] }, finishReason: "STOP" }] }) },
    ]);
    const j = await (await post("/import/url", { url: "https://www.youtube.com/shorts/dQw4w9WgXcQ" }, { ...env, GEMINI_API_KEY: "g" })).json() as any;
    expect(j.via).toBe("youtube_video");
    expect(j.provider).toBe("gemini");
    expect(j.result.hasRecipe).toBe(true);
    const g = calls.find((c) => isGemini(c.url))!;
    expect(g.body.contents[0].parts[0]).toEqual({ fileData: { fileUri: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" } });
  });

  it("reports no recipe (with a dish name) when there is no Gemini key", async () => {
    stub([
      { match: (u) => u.startsWith("https://www.youtube.com/watch"), reply: () => html(`<script>{"shortDescription":"구독과 좋아요 부탁드려요! 오늘은 맛있는 파스타를 만들어 봤어요"}</script>`) },
      { match: isClaude, reply: () => jsonResponse(claudeMessage(notFound)) },
    ]);
    const j = await (await post("/import/url", { url: "https://youtu.be/dQw4w9WgXcQ" })).json() as any;
    expect(j.result).toMatchObject({ hasRecipe: false, dishName: "알리오올리오", recipe: null });
  });
});

describe("/import/url — Instagram and web", () => {
  it("tells the app to switch to caption input for Instagram", async () => {
    stub([]);
    const r = await post("/import/url", { url: "https://www.instagram.com/reel/C1abcDEF/?igsh=x" });
    expect(r.status).toBe(422);
    expect(await r.json()).toMatchObject({ code: "instagram" });
  });

  it("reads schema.org Recipe JSON-LD from a recipe site", async () => {
    const page = `<html><head><meta property="og:title" content="김치찌개 황금레시피"></head><body>광고<script type="application/ld+json">{"@type":"Recipe","name":"김치찌개","recipeIngredient":["김치 300g","돼지고기 200g"],"recipeInstructions":["고기를 볶는다","김치를 넣고 끓인다"]}</script></body></html>`;
    const calls = stub([
      { match: (u) => u.startsWith("https://recipe.example.com/"), reply: () => html(page) },
      { match: isClaude, reply: () => jsonResponse(claudeMessage(found())) },
    ]);
    const j = await (await post("/import/url", { url: "https://recipe.example.com/r/1" })).json() as any;
    expect(j.via).toBe("jsonld");
    expect(j.result.recipe.source).toEqual({ type: "web", url: "https://recipe.example.com/r/1", title: "김치찌개 황금레시피" });
    expect(calls.find((c) => isClaude(c.url))!.body.messages[0].content[0].text).toContain("구조화된 레시피 정보:\n요리 이름: 김치찌개");
  });

  it("reads Naver blogs through the mobile page and follows safe redirects", async () => {
    const body = `<html><body><div class="se-main-container"><p>재료: 김치 300g, 돼지고기 200g, 두부 반 모, 대파 1대</p><p>1. 돼지고기를 볶다가 김치를 넣고 5분 더 볶아요. 2. 물을 붓고 15분 끓여요.</p></div></body></html>`;
    const calls = stub([
      { match: (u) => u === "https://m.blog.naver.com/cook_mom/223456789012", reply: () => new Response(null, { status: 302, headers: { location: "/cook_mom/223456789012?view=1" } }) },
      { match: (u) => u.startsWith("https://m.blog.naver.com/cook_mom/223456789012?view=1"), reply: () => html(body) },
      { match: isClaude, reply: () => jsonResponse(claudeMessage(found())) },
    ]);
    const j = await (await post("/import/url", { url: "https://blog.naver.com/cook_mom/223456789012" })).json() as any;
    expect(j.via).toBe("page");
    expect(calls[0].url).toBe("https://m.blog.naver.com/cook_mom/223456789012");
    expect(calls.find((c) => isClaude(c.url))!.body.messages[0].content[0].text).toContain("돼지고기를 볶다가");
  });

  it("refuses private addresses and redirects into them", async () => {
    stub([{ match: (u) => u.startsWith("https://evil.example.com/"), reply: () => new Response(null, { status: 301, headers: { location: "http://169.254.169.254/latest/meta-data" } }) }]);
    expect((await post("/import/url", { url: "http://192.168.0.1/admin" })).status).toBe(400);
    expect((await post("/import/url", { url: "https://evil.example.com/x" })).status).toBe(400);
  });

  it("explains pages that cannot be read", async () => {
    stub([
      { match: (u) => u.startsWith("https://down.example.com/"), reply: () => new Response("x", { status: 503 }) },
      { match: (u) => u.startsWith("https://empty.example.com/"), reply: () => html("<html><body><div id=app></div></body></html>") },
      { match: (u) => u.startsWith("https://pdf.example.com/"), reply: () => html("%PDF", "application/pdf") },
    ]);
    const a = await post("/import/url", { url: "https://down.example.com/a" });
    expect(a.status).toBe(502); expect(await a.json()).toMatchObject({ code: "fetch_failed" });
    const b = await post("/import/url", { url: "https://empty.example.com/a" });
    expect(b.status).toBe(422); expect(await b.json()).toMatchObject({ code: "empty_page" });
    expect((await post("/import/url", { url: "https://pdf.example.com/a" })).status).toBe(422);
  });
});

describe("/import/text", () => {
  it("structures an Instagram caption plus screenshots", async () => {
    const calls = stub([{ match: isClaude, reply: () => jsonResponse(claudeMessage(found())) }]);
    const r = await post("/import/text", { text: "#떡볶이 레시피 떡 300g 고추장 2큰술", url: "https://www.instagram.com/p/Cabc/", images: [{ mediaType: "image/jpeg", data: FAKE_IMAGE }] });
    expect(r.status).toBe(200);
    const j = await r.json() as any;
    expect(j.result.recipe.source).toEqual({ type: "instagram", url: "https://www.instagram.com/p/Cabc/" });
    const content = calls[0].body.messages[0].content;
    expect(content[0].type).toBe("image");
    expect(content[1].text).toContain("인스타그램 게시물\n#떡볶이 레시피");
  });
  it("treats photos without text as a recipe photo", async () => {
    stub([{ match: isClaude, reply: () => jsonResponse(claudeMessage(found())) }]);
    const j = await (await post("/import/text", { images: [{ mediaType: "image/png", data: FAKE_IMAGE }] })).json() as any;
    expect(j.via).toBe("photo");
    expect(j.result.recipe.source.type).toBe("photo");
  });
  it("requires text or images", async () => {
    stub([]);
    expect((await post("/import/text", { text: "  " })).status).toBe(400);
  });
});
