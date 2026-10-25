import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import handler, { type Env } from "../src/index";
import { makeSigner, PROJECT, SAMPLE_RECIPE, FAKE_IMAGE, jsonResponse, claudeMessage } from "./helpers";
import { resetInstagramBlock } from "../src/instagram";

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

const env: Env = { FIREBASE_PROJECT_ID: PROJECT, ALLOWED_ORIGINS: "http://localhost:5173", ALLOWED_EMAILS: "me@example.com", ANTHROPIC_API_KEY: "sk-ant-test" };
const post = (path: string, body: unknown, e: Env = env) => handler.fetch!(new Request(`https://api.test${path}`, {
  method: "POST", body: JSON.stringify(body), headers: { Origin: "http://localhost:5173", Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
}) as any, e, {} as any);

beforeAll(async () => { signer = await makeSigner(); token = await signer.token(); });
afterEach(() => { vi.unstubAllGlobals(); resetInstagramBlock(); });

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
    expect(ai.body.system[0].text).toContain("지어내지 않습니다");
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

  it("keeps the description result when video analysis fails", async () => {
    stub([
      { match: (u) => u.startsWith("https://www.youtube.com/watch"), reply: () => html(`<meta property="og:title" content="브이로그"><script>{"shortDescription":"구독과 좋아요 부탁드려요! 오늘은 맛있는 파스타를 만들어 봤어요"}</script>`) },
      { match: isClaude, reply: () => jsonResponse(claudeMessage(notFound)) },
      { match: isGemini, reply: () => jsonResponse({ error: { code: 429, message: "quota", status: "RESOURCE_EXHAUSTED" } }, 429) },
    ]);
    const r = await post("/import/url", { url: "https://youtu.be/dQw4w9WgXcQ" }, { ...env, GEMINI_API_KEY: "g" });
    expect(r.status).toBe(200);
    expect((await r.json() as any).result).toMatchObject({ hasRecipe: false, dishName: "알리오올리오" });
  });

  it("ignores a malformed source url written by the AI", async () => {
    const bad = JSON.parse(found());
    bad.recipe.source = { type: "youtube", url: "not a url" };
    stub([
      { match: (u) => u.startsWith("https://www.youtube.com/watch"), reply: () => html(`<script>{"shortDescription":"재료: 스파게티 200g, 마늘 8쪽, 올리브오일 4큰술 1. 면을 삶는다"}</script>`) },
      { match: isClaude, reply: () => jsonResponse(claudeMessage(JSON.stringify(bad))) },
    ]);
    const j = await (await post("/import/url", { url: "https://youtu.be/dQw4w9WgXcQ" })).json() as any;
    expect(j.result.recipe.source.url).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
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

  // 퍼가기 페이지에 들어 있는 데이터 모양 (JSON 문자열을 한 번 더 감싼다)
  const embedWith = (caption: string, extra = "") => {
    const ctx = JSON.stringify({ context: { media: { owner: { username: "cook_mom" }, display_url: "https://scontent.cdninstagram.com/v/t51/abc.jpg?x=1", edge_media_to_caption: { edges: [{ node: { text: caption } }] } } } });
    return `<html><body>${extra}<script>window.x = {"contextJSON":${JSON.stringify(ctx)}}</script></body></html>`;
  };
  const isEmbed = (u: string) => u.startsWith("https://www.instagram.com/p/C1abcDEF/embed/captioned/");

  it("reads the caption of a public post from the embed page", async () => {
    const calls = stub([
      { match: isEmbed, reply: () => html(embedWith("떡볶이 황금레시피\n떡 300g, 고추장 2큰술, 설탕 1큰술\n1. 물을 끓인다 2. 떡을 넣는다")) },
      { match: isClaude, reply: () => jsonResponse(claudeMessage(found())) },
    ]);
    const r = await post("/import/url", { url: "https://www.instagram.com/reel/C1abcDEF/?igsh=x" });
    expect(r.status).toBe(200);
    const j = await r.json() as any;
    expect(j.via).toBe("instagram_caption");
    expect(j.result.recipe.source).toEqual({ type: "instagram", url: "https://www.instagram.com/reel/C1abcDEF/?igsh=x", channel: "cook_mom" });
    const ai = calls.find((c) => isClaude(c.url))!;
    expect(ai.body.messages[0].content.at(-1).text).toContain("떡 300g, 고추장 2큰술");
    expect(ai.body.messages[0].content.at(-1).text).toContain("@cook_mom");
    // 캡션이 충분하면 표지 사진은 받지 않는다
    expect(calls.some((c) => c.url.includes("cdninstagram.com"))).toBe(false);
    // 틀(iframe)에 띄우는 요청이어야 인스타가 캡션이 담긴 화면을 준다
    expect(calls.find((c) => isEmbed(c.url))!.headers.get("sec-fetch-dest")).toBe("iframe");
  });

  it("adds the cover picture when the caption is too short to hold a recipe", async () => {
    const calls = stub([
      { match: isEmbed, reply: () => html(embedWith("오늘 저녁 🍝 저장해 두세요")) },
      { match: (u) => u.startsWith("https://scontent.cdninstagram.com/"), reply: () => new Response(new Uint8Array(2000), { headers: { "content-type": "image/jpeg" } }) },
      { match: isClaude, reply: () => jsonResponse(claudeMessage(found())) },
    ]);
    const j = await (await post("/import/url", { url: "https://www.instagram.com/p/C1abcDEF/" })).json() as any;
    expect(j.via).toBe("instagram_caption");
    const ai = calls.find((c) => isClaude(c.url))!;
    expect(ai.body.messages[0].content[0].type).toBe("image");
  });

  it("falls back to the drawn caption block and then the page preview text", async () => {
    stub([
      { match: isEmbed, reply: () => html(`<div class="Caption"><a class="CaptionUsername" href="#">cook_mom</a><br/>계란말이<br>계란 4개, 소금 약간<div class="CaptionComments"></div></div>`) },
      { match: isClaude, reply: () => jsonResponse(claudeMessage(found())) },
    ]);
    const j = await (await post("/import/url", { url: "https://www.instagram.com/p/C1abcDEF/" })).json() as any;
    expect(j.result.recipe.source.channel).toBe("cook_mom");
    const calls = stub([
      { match: isEmbed, reply: () => new Response("", { status: 302, headers: { location: "https://www.instagram.com/accounts/login/" } }) },
      { match: (u) => u === "https://www.instagram.com/p/C1abcDEF/", reply: () => html(`<meta property="og:description" content="좋아요 1.2만개, 댓글 30개 - cook_mom님, 2026년 10월 20일: &quot;계란말이 레시피 계란 4개 소금 약간 대파 조금&quot;">`) },
      { match: isClaude, reply: () => jsonResponse(claudeMessage(found())) },
    ]);
    const j2 = await (await post("/import/url", { url: "https://www.instagram.com/p/C1abcDEF/" })).json() as any;
    expect(j2.via).toBe("instagram_caption");
    expect(calls.find((c) => isClaude(c.url))!.body.messages[0].content.at(-1).text).toContain("계란 4개 소금 약간");
    // 본 페이지는 주소창에서 연 것처럼 열어야 미리보기 문구를 준다
    expect(calls.find((c) => c.url === "https://www.instagram.com/p/C1abcDEF/")!.headers.get("sec-fetch-dest")).toBe("document");
  });

  // 릴스: 퍼가기 페이지 데이터에 영상 주소가 함께 온다
  const VIDEO = "https://scontent-iad6-1.cdninstagram.com/o1/v/t2/f2/m86/reel.mp4?efg=x&oh=y";
  const reelEmbed = (caption: string, video = VIDEO) => {
    const ctx = JSON.stringify({ context: { media: { owner: { username: "bayashi_tv" }, is_video: true, video_url: video, display_url: "https://scontent.cdninstagram.com/v/t51/cover.jpg", edge_media_to_caption: { edges: [{ node: { text: caption } }] } } } });
    return `<html><body><script>window.x = {"contextJSON":${JSON.stringify(ctx)}}</script></body></html>`;
  };
  const mp4 = (bytes = 3000, extra: Record<string, string> = {}) => new Response(new Uint8Array(bytes), { headers: { "content-type": "video/mp4", "content-length": String(bytes), ...extra } });

  it("asks the app for video frames, without calling AI, when a reel's caption is too short", async () => {
    const calls = stub([
      { match: isEmbed, reply: () => html(reelEmbed("Salmon Sushi 🍣")) },
      { match: isClaude, reply: () => jsonResponse(claudeMessage(found())) },
    ]);
    const r = await post("/import/url", { url: "https://www.instagram.com/p/C1abcDEF/" });
    expect(r.status).toBe(200);
    const j = await r.json() as any;
    expect(j).toMatchObject({ via: "instagram_caption", model: "", video: { caption: "Salmon Sushi 🍣" }, result: { hasRecipe: false, recipe: null } });
    expect(calls.some((c) => isClaude(c.url))).toBe(false);
    // 표지 사진도 받지 않는다 (영상 장면이 대신한다)
    expect(calls.some((c) => c.url.includes("cdninstagram.com"))).toBe(false);
  });

  it("still reads a long reel caption, and tells the app it can look at the video", async () => {
    const calls = stub([
      { match: isEmbed, reply: () => html(reelEmbed("연어 초밥 만들기\n밥 300g, 식초 2큰술, 설탕 1큰술, 소금 1작은술\n1. 밥에 단촛물을 섞는다 2. 연어를 썬다")) },
      { match: isClaude, reply: () => jsonResponse(claudeMessage(notFound)) },
    ]);
    const j = await (await post("/import/url", { url: "https://www.instagram.com/reel/C1abcDEF/" })).json() as any;
    expect(calls.some((c) => isClaude(c.url))).toBe(true);
    expect(j.video.caption).toContain("연어 초밥");
  });

  it("streams the reel video it found itself, and only from Instagram's CDN", async () => {
    const calls = stub([
      { match: isEmbed, reply: () => html(reelEmbed("Salmon Sushi 🍣")) },
      { match: (u) => u.startsWith("https://scontent-iad6-1.cdninstagram.com/"), reply: () => mp4(3000) },
    ]);
    const r = await post("/import/instagram-video", { url: "https://www.instagram.com/reel/C1abcDEF/?igsh=x" });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("video/mp4");
    expect((await r.arrayBuffer()).byteLength).toBe(3000);
    expect(calls.find((c) => c.url === VIDEO)).toBeTruthy();
    // 인스타 게시물 주소가 아니면 받지 않는다
    expect((await post("/import/instagram-video", { url: "https://example.com/video.mp4" })).status).toBe(400);
  });

  it("refuses a video that is not on Instagram's CDN, not a video, or too big", async () => {
    const evil = stub([
      { match: isEmbed, reply: () => html(reelEmbed("Salmon Sushi 🍣", "https://evil.example.com/reel.mp4")) },
      { match: (u) => u.startsWith("https://evil.example.com/"), reply: () => mp4(3000) },
    ]);
    expect((await post("/import/instagram-video", { url: "https://www.instagram.com/p/C1abcDEF/" })).status).toBe(422);
    expect(evil.some((c) => c.url.includes("evil.example.com"))).toBe(false);
    stub([
      { match: isEmbed, reply: () => html(reelEmbed("Salmon Sushi 🍣")) },
      { match: (u) => u.startsWith("https://scontent-iad6-1.cdninstagram.com/"), reply: () => html("<html>login</html>") },
    ]);
    expect((await post("/import/instagram-video", { url: "https://www.instagram.com/p/C1abcDEF/" })).status).toBe(422);
    stub([
      { match: isEmbed, reply: () => html(reelEmbed("Salmon Sushi 🍣")) },
      { match: (u) => u.startsWith("https://scontent-iad6-1.cdninstagram.com/"), reply: () => mp4(10, { "content-length": "50000000" }) },
    ]);
    const r = await post("/import/instagram-video", { url: "https://www.instagram.com/p/C1abcDEF/" });
    expect(r.status).toBe(422);
    expect(await r.json()).toMatchObject({ code: "instagram" });
  });

  it("reuses the video address found by the link import, and keeps usage for the frames step", async () => {
    const m = new Map<string, string>();
    const USAGE = { get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => { m.set(k, v); }, delete: async (k: string) => { m.delete(k); } } as unknown as KVNamespace;
    const e = { ...env, USAGE } as Env;
    const usage = async () => (await (await handler.fetch!(new Request("https://api.test/usage", { headers: { Origin: "http://localhost:5173", Authorization: `Bearer ${token}` } }) as any, e, {} as any)).json() as any).today.used;
    const calls = stub([
      { match: isEmbed, reply: () => html(reelEmbed("Salmon Sushi 🍣")) },
      { match: (u) => u.startsWith("https://scontent-iad6-1.cdninstagram.com/"), reply: () => mp4(3000) },
    ]);
    expect((await (await post("/import/url", { url: "https://www.instagram.com/reel/C1abcDEF/" }, e)).json() as any).video).toBeTruthy();
    // AI를 부르지 않았으니 사용량은 그대로
    expect(await usage()).toBe(0);
    const r = await post("/import/instagram-video", { url: "https://www.instagram.com/reel/C1abcDEF/" }, e);
    expect(r.status).toBe(200);
    expect((await r.arrayBuffer()).byteLength).toBe(3000);
    // 퍼가기 페이지는 한 번만 열었다 (영상 받기는 기억한 주소로)
    expect(calls.filter((c) => isEmbed(c.url))).toHaveLength(1);
    // 영상 받기도 하루 사용량을 쓰지 않는다
    expect(await usage()).toBe(0);
  });

  it("needs a login for the video route", async () => {
    stub([]);
    const r = await handler.fetch!(new Request("https://api.test/import/instagram-video", {
      method: "POST", body: JSON.stringify({ url: "https://www.instagram.com/p/C1abcDEF/" }), headers: { Origin: "http://localhost:5173", "Content-Type": "application/json" },
    }) as any, env, {} as any);
    expect(r.status).toBe(401);
  });

  it("does not use the video route while Instagram is blocking the Worker", async () => {
    const calls = stub([{ match: (u) => u.startsWith("https://www.instagram.com/"), reply: () => new Response("", { status: 429 }) }]);
    expect((await post("/import/instagram-video", { url: "https://www.instagram.com/p/C1abcDEF/" })).status).toBe(422);
    const before = calls.length;
    expect((await post("/import/instagram-video", { url: "https://www.instagram.com/p/C1abcDEF/" })).status).toBe(422);
    expect(calls.length).toBe(before);
  });

  /** Claude 웹 읽기 응답: 실제로 읽은 주소가 있으면 web_fetch 결과 블록을 붙인다 */
  const fetched = (text: string, url?: string) => claudeMessage(text, url ? { content: [
    { type: "web_fetch_tool_result", tool_use_id: "srvtoolu_1", content: { type: "web_fetch_result", url, content: { type: "document", source: { type: "text", media_type: "text/plain", data: "..." } } } },
    { type: "text", text },
  ] } : {});

  it("asks Claude to read the embed page when the Worker is blocked, trusting it only if Instagram was really read", async () => {
    let n = 0;
    stub([
      { match: (u) => u.startsWith("https://www.instagram.com/"), reply: () => new Response("", { status: 429 }) },
      { match: isClaude, reply: () => jsonResponse(++n === 1 ? fetched("떡볶이 레시피: 떡 300g, 고추장 2큰술, 설탕 1큰술, 물 400ml. 물을 끓이고 떡을 넣는다.", "https://www.instagram.com/p/C1abcDEF/embed/captioned/") : claudeMessage(found())) },
    ]);
    const j = await (await post("/import/url", { url: "https://www.instagram.com/p/C1abcDEF/" })).json() as any;
    expect(j.via).toBe("instagram_caption");
  });

  it("does not believe an apology as a caption, and then stops asking for a while", async () => {
    const calls = stub([
      { match: (u) => u.startsWith("https://www.instagram.com/"), reply: () => new Response("", { status: 429 }) },
      { match: isClaude, reply: () => jsonResponse(fetched("죄송합니다. 인스타그램 페이지가 로그인을 요구해서 내용을 볼 수 없었어요. 캡션을 직접 붙여 주세요.")) },
    ]);
    const r = await post("/import/url", { url: "https://www.instagram.com/p/C1abcDEF/" });
    expect(r.status).toBe(422);
    expect(await r.json()).toMatchObject({ code: "instagram" });
    const before = calls.length;
    // 10분 동안은 인스타·Claude 어느 쪽도 다시 부르지 않고 바로 안내
    const r2 = await post("/import/url", { url: "https://www.instagram.com/p/C9zzzZZZ/" });
    expect(r2.status).toBe(422);
    expect(calls.length).toBe(before);
  });

  it("keeps using Claude's reading while only the Worker is blocked", async () => {
    let n = 0;
    const calls = stub([
      { match: (u) => u.startsWith("https://www.instagram.com/"), reply: () => new Response("", { status: 429 }) },
      { match: isClaude, reply: () => jsonResponse(n++ % 2 === 0 ? fetched("떡볶이 레시피: 떡 300g, 고추장 2큰술, 설탕 1큰술, 물 400ml. 물을 끓이고 떡을 넣는다.", "https://www.instagram.com/p/C1abcDEF/embed/captioned/") : claudeMessage(found())) },
    ]);
    expect((await (await post("/import/url", { url: "https://www.instagram.com/p/C1abcDEF/" })).json() as any).via).toBe("instagram_caption");
    const igCalls = calls.filter((c) => c.url.startsWith("https://www.instagram.com/")).length;
    // 두 번째: 서버 읽기는 건너뛰고(인스타를 다시 부르지 않음) Claude 웹 읽기는 그대로
    expect((await (await post("/import/url", { url: "https://www.instagram.com/p/C2abcDEF/" })).json() as any).via).toBe("instagram_caption");
    expect(calls.filter((c) => c.url.startsWith("https://www.instagram.com/")).length).toBe(igCalls);
  });

  it("does not treat a missing post (404) as Instagram blocking us, and does not pay Claude for it", async () => {
    const calls = stub([
      { match: (u) => u.startsWith("https://www.instagram.com/"), reply: () => new Response("", { status: 404 }) },
      { match: isClaude, reply: () => jsonResponse(fetched("레시피 없음")) },
    ]);
    const r = await post("/import/url", { url: "https://www.instagram.com/p/GONEpost/" });
    expect(r.status).toBe(422);
    expect((await r.json() as any).error).toContain("지워졌거나 비공개");
    expect(calls.some((c) => isClaude(c.url))).toBe(false);
    const before = calls.filter((c) => c.url.startsWith("https://www.instagram.com/")).length;
    await post("/import/url", { url: "https://www.instagram.com/p/OTHERpost/" });
    expect(calls.filter((c) => c.url.startsWith("https://www.instagram.com/")).length).toBeGreaterThan(before);
  });

  it("keeps reading on the Worker while only Claude's reading is failing", async () => {
    let embeds = 0;
    const calls = stub([
      // 처음엔 퍼가기 페이지가 비어 있고 (캡션 없음), 다음엔 캡션이 있다
      { match: isEmbed, reply: () => html(++embeds !== 2 ? "<html></html>" : embedWith("떡볶이 황금레시피\n떡 300g, 고추장 2큰술, 설탕 1큰술\n1. 물을 끓인다 2. 떡을 넣는다")) },
      { match: (u) => u.startsWith("https://www.instagram.com/"), reply: () => html("<html></html>") },
      { match: isClaude, reply: (c) => jsonResponse(JSON.stringify(c.body).includes("web_fetch") ? fetched("죄송합니다. 페이지를 읽지 못했어요.") : claudeMessage(found())) },
    ]);
    expect((await post("/import/url", { url: "https://www.instagram.com/p/C1abcDEF/" })).status).toBe(422);
    const claudeBefore = calls.filter((c) => isClaude(c.url)).length;
    const j = await (await post("/import/url", { url: "https://www.instagram.com/p/C1abcDEF/" })).json() as any;
    expect(j.via).toBe("instagram_caption");
    expect(embeds).toBe(2);
    // 두 번째는 캡션 정리 한 번만 (웹 읽기는 건너뜀)
    expect(calls.filter((c) => isClaude(c.url)).length).toBe(claudeBefore + 1);
    // 세 번째: 서버도 못 찾으면 돈 드는 웹 읽기 없이 바로 안내
    expect((await post("/import/url", { url: "https://www.instagram.com/p/C1abcDEF/" })).status).toBe(422);
    expect(embeds).toBe(3);
    expect(calls.filter((c) => isClaude(c.url)).length).toBe(claudeBefore + 1);
  });

  it("counts a login redirect on the main page as Instagram blocking the Worker, even when the embed page loads", async () => {
    let n = 0;
    const calls = stub([
      { match: isEmbed, reply: () => html("<html></html>") },
      { match: (u) => u.startsWith("https://www.instagram.com/"), reply: () => new Response("", { status: 302, headers: { location: "https://www.instagram.com/accounts/login/" } }) },
      { match: isClaude, reply: () => jsonResponse(n++ % 2 === 0 ? fetched("떡볶이 레시피: 떡 300g, 고추장 2큰술, 설탕 1큰술, 물 400ml. 물을 끓이고 떡을 넣는다.", "https://www.instagram.com/p/C1abcDEF/embed/captioned/") : claudeMessage(found())) },
    ]);
    expect((await (await post("/import/url", { url: "https://www.instagram.com/p/C1abcDEF/" })).json() as any).via).toBe("instagram_caption");
    const igCalls = calls.filter((c) => c.url.startsWith("https://www.instagram.com/")).length;
    await post("/import/url", { url: "https://www.instagram.com/p/C2abcDEF/" });
    expect(calls.filter((c) => c.url.startsWith("https://www.instagram.com/")).length).toBe(igCalls);
  });

  it("hands a share-button link to Claude as is while the Worker is blocked", async () => {
    let n = 0;
    const calls = stub([
      { match: (u) => u.startsWith("https://www.instagram.com/"), reply: () => new Response("", { status: 429 }) },
      { match: isClaude, reply: () => jsonResponse(n++ % 2 === 0 ? fetched("떡볶이 레시피: 떡 300g, 고추장 2큰술, 설탕 1큰술, 물 400ml. 물을 끓이고 떡을 넣는다.", "https://www.instagram.com/reel/C1abcDEF/") : claudeMessage(found())) },
    ]);
    await post("/import/url", { url: "https://www.instagram.com/p/C1abcDEF/" });
    const igCalls = calls.filter((c) => c.url.startsWith("https://www.instagram.com/")).length;
    const j = await (await post("/import/url", { url: "https://www.instagram.com/share/reel/BAxyz123/" })).json() as any;
    expect(j.via).toBe("instagram_caption");
    expect(j.result.recipe.source.url).toBe("https://www.instagram.com/share/reel/BAxyz123/");
    // 막힌 동안은 공유 주소 풀기도 하지 않고, Claude에게 공유 주소를 그대로 준다
    expect(calls.filter((c) => c.url.startsWith("https://www.instagram.com/")).length).toBe(igCalls);
    expect(JSON.stringify(calls.filter((c) => isClaude(c.url)).at(-2)!.body)).toContain("https://www.instagram.com/share/reel/BAxyz123/");
  });

  it("treats a share link that redirects to the login page as blocked, then lets Claude try it", async () => {
    let n = 0;
    const calls = stub([
      { match: (u) => u.startsWith("https://www.instagram.com/share/"), reply: () => new Response("", { status: 302, headers: { location: "https://www.instagram.com/accounts/login/?next=%2Fshare%2Freel%2FBAxyz123%2F" } }) },
      { match: isClaude, reply: () => jsonResponse(n++ % 2 === 0 ? fetched("떡볶이 레시피: 떡 300g, 고추장 2큰술, 설탕 1큰술, 물 400ml. 물을 끓이고 떡을 넣는다.", "https://www.instagram.com/reel/C1abcDEF/") : claudeMessage(found())) },
    ]);
    const j = await (await post("/import/url", { url: "https://www.instagram.com/share/reel/BAxyz123/" })).json() as any;
    expect(j.via).toBe("instagram_caption");
    expect(calls.some((c) => c.url.includes("/accounts/login"))).toBe(false);
    const igCalls = calls.filter((c) => c.url.startsWith("https://www.instagram.com/")).length;
    await post("/import/url", { url: "https://www.instagram.com/p/C2abcDEF/" });
    expect(calls.filter((c) => c.url.startsWith("https://www.instagram.com/")).length).toBe(igCalls);
  });

  it("follows the share-button link to the real post", async () => {
    const calls = stub([
      { match: (u) => u.startsWith("https://www.instagram.com/share/reel/"), reply: () => new Response("", { status: 301, headers: { location: "https://www.instagram.com/reel/C1abcDEF/?igsh=x" } }) },
      { match: isEmbed, reply: () => html(embedWith("떡볶이 황금레시피\n떡 300g, 고추장 2큰술, 설탕 1큰술\n1. 물을 끓인다 2. 떡을 넣는다")) },
      { match: isClaude, reply: () => jsonResponse(claudeMessage(found())) },
    ]);
    const j = await (await post("/import/url", { url: "https://www.instagram.com/share/reel/BAxyz123/" })).json() as any;
    expect(j.via).toBe("instagram_caption");
    expect(calls.some((c) => isEmbed(c.url))).toBe(true);
  });

  it("can be switched off", async () => {
    const calls = stub([]);
    const r = await post("/import/url", { url: "https://www.instagram.com/p/C1abcDEF/" }, { ...env, INSTAGRAM_EMBED: "off" } as Env);
    expect(r.status).toBe(422);
    expect(calls.filter((c) => !c.url.includes("googleapis"))).toHaveLength(0);
  });

  it("tells the AI that pictures are stills from a video, in order", async () => {
    const calls = stub([{ match: isClaude, reply: () => jsonResponse(claudeMessage(found())) }]);
    const images = Array.from({ length: 6 }, () => ({ mediaType: "image/jpeg", data: FAKE_IMAGE }));
    const r = await post("/import/text", { images, frames: true, url: "https://www.instagram.com/reel/C1abcDEF/" });
    expect(r.status).toBe(200);
    const content = calls.find((c) => isClaude(c.url))!.body.messages[0].content;
    expect(content.filter((x: any) => x.type === "image")).toHaveLength(6);
    expect(content.at(-1).text).toContain("요리 영상에서 일정한 간격으로 뽑은 장면");
    const tooMany = await post("/import/text", { images: [...images, ...images, images[0]], frames: true });
    expect(tooMany.status).toBe(400);
  });

  it("does not try profile pages", async () => {
    const calls = stub([]);
    const r = await post("/import/url", { url: "https://www.instagram.com/cook_mom/" });
    expect(r.status).toBe(422);
    expect(calls).toHaveLength(0);
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

describe("/import/url — Claude reads pages the Worker cannot", () => {
  it("falls back to Claude web_fetch, then structures the recipe", async () => {
    const calls = stub([
      { match: (u) => u.startsWith("https://blocked.example.com/"), reply: () => new Response("forbidden", { status: 403 }) },
      { match: isClaude, reply: (c) => c.body.tools
        ? jsonResponse(claudeMessage("김치볶음밥 2인분. 재료: 김치 200g, 밥 2공기, 대파 1대. 1. 대파를 볶는다 2. 김치를 볶는다 3. 밥을 넣는다", {
            content: [
              { type: "server_tool_use", id: "srvtoolu_1", name: "web_fetch", input: { url: "https://blocked.example.com/r/1" } },
              { type: "web_fetch_tool_result", tool_use_id: "srvtoolu_1", content: { type: "web_fetch_result", url: "https://blocked.example.com/r/1", content: { type: "document", source: { type: "text", media_type: "text/plain", data: "…" } } } },
              { type: "text", text: "김치볶음밥 2인분. 재료: 김치 200g, 밥 2공기, 대파 1대. 1. 대파를 볶는다 2. 김치를 볶는다 3. 밥을 넣는다" },
            ],
          }))
        : jsonResponse(claudeMessage(found())) },
    ]);
    const r = await post("/import/url", { url: "https://blocked.example.com/r/1" });
    expect(r.status).toBe(200);
    const j = await r.json() as any;
    expect(j.result.hasRecipe).toBe(true);
    expect(j.result.recipe.source).toMatchObject({ type: "web", url: "https://blocked.example.com/r/1" });
    const research = calls.find((c) => isClaude(c.url) && c.body.tools)!;
    expect(research.body.tools[0]).toMatchObject({ type: "web_fetch_20260318", name: "web_fetch", allowed_callers: ["direct"] });
    expect(research.body.output_config.format).toBeUndefined();
    expect(research.body.messages[0].content).toContain("https://blocked.example.com/r/1");
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
