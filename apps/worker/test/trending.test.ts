import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import handler, { type Env } from "../src/index";
import { isoSeconds, resetTrendingCache, toVideo, trendingRecipes, TrendingError } from "../src/trending";
import { makeSigner, PROJECT, jsonResponse } from "./helpers";

let signer: Awaited<ReturnType<typeof makeSigner>>;
let goodToken: string;
beforeAll(async () => { signer = await makeSigner(); goodToken = await signer.token(); });
beforeEach(() => resetTrendingCache());
afterEach(() => vi.unstubAllGlobals());

const baseEnv: Env = { FIREBASE_PROJECT_ID: PROJECT, ALLOWED_ORIGINS: "https://cook.example.com", ALLOWED_EMAILS: "*" };
const NOW = Date.parse("2026-10-13T03:00:00Z");

/** 유튜브 영상 정보 (videos.list 한 항목) */
function video(id: string, title: string, likes: number | null, duration = "PT45S", extra: Record<string, unknown> = {}) {
  return {
    id,
    snippet: { title, channelTitle: "요리채널", publishedAt: "2026-10-01T00:00:00Z", liveBroadcastContent: "none",
      thumbnails: { high: { url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` }, maxres: { url: `https://i.ytimg.com/vi/${id}/maxresdefault.jpg` } } },
    statistics: { viewCount: "500000", ...(likes === null ? {} : { likeCount: String(likes) }) },
    contentDetails: { duration },
    player: { embedWidth: "203", embedHeight: "360" },
    status: { privacyStatus: "public", embeddable: true },
    ...extra,
  };
}
const id = (n: number) => `vid${String(n).padStart(8, "0")}`;

/** 검색은 지역별로 정해 둔 ID를 돌려주고, videos는 정해 둔 정보를 돌려준다 */
function youtubeStub(opts: { kr?: string[]; us?: string[]; ing?: string[]; videos: ReturnType<typeof video>[]; fail?: "KR" | "US" | "all" | "quota" }) {
  const calls: URL[] = [];
  const f = (async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    calls.push(url);
    if (url.pathname.endsWith("/search")) {
      const region = url.searchParams.get("regionCode");
      if (opts.fail === "quota") return jsonResponse({ error: { code: 403, errors: [{ reason: "quotaExceeded" }] } }, 403);
      if (opts.fail === "all" || opts.fail === region) return jsonResponse({ error: { code: 500 } }, 500);
      const isIng = (url.searchParams.get("q") ?? "").startsWith("감자");
      const ids = isIng ? opts.ing ?? [] : region === "KR" ? opts.kr ?? [] : opts.us ?? [];
      return jsonResponse({ items: ids.map((videoId) => ({ id: { kind: "youtube#video", videoId } })) });
    }
    if (url.pathname.endsWith("/videos")) {
      const want = new Set((url.searchParams.get("id") ?? "").split(","));
      return jsonResponse({ items: opts.videos.filter((v) => want.has(v.id)) });
    }
    return new Response("unexpected", { status: 500 });
  }) as typeof fetch;
  return { f, calls };
}

describe("trending helpers", () => {
  it("reads ISO durations", () => {
    expect(isoSeconds("PT45S")).toBe(45);
    expect(isoSeconds("PT1M5S")).toBe(65);
    expect(isoSeconds("PT1H")).toBe(3600);
    expect(isoSeconds("P0D")).toBe(0);
    expect(isoSeconds(undefined)).toBe(0);
  });
  it("keeps only liked, short, public recipe videos", () => {
    expect(toVideo(video(id(1), "초간단 계란볶음밥", 25_000))).toMatchObject({
      id: id(1), url: `https://www.youtube.com/shorts/${id(1)}`, likes: 25_000, seconds: 45, region: "kr", vertical: true,
      thumbnail: `https://i.ytimg.com/vi/${id(1)}/maxresdefault.jpg`,
    });
    expect(toVideo(video(id(2), "Easy garlic pasta", 12_000))?.region).toBe("global");
    expect(toVideo(video(id(3), "계란말이", 9_999))).toBeNull();               // 좋아요 부족
    expect(toVideo(video(id(4), "계란말이", null))).toBeNull();                // 좋아요 숨김
    expect(toVideo(video(id(5), "계란말이", 50_000, "PT4M"))).toBeNull();      // 너무 김
    expect(toVideo(video(id(6), "엽떡 먹방", 90_000))).toBeNull();            // 레시피가 아님
    expect(toVideo(video(id(7), "Burger MUKBANG", 90_000))).toBeNull();
    expect(toVideo(video(id(8), "계란말이", 50_000, "PT45S", { status: { privacyStatus: "unlisted" } }))).toBeNull();
    expect(toVideo(video("bad id", "계란말이", 50_000))).toBeNull();
  });
});

describe("trendingRecipes", () => {
  it("asks for the key when it is missing", async () => {
    await expect(trendingRecipes({}, null, NOW, (() => { throw new Error("no fetch"); }) as any)).rejects.toMatchObject({ status: 503, code: "youtube_not_configured" });
  });

  it("searches Korea and abroad, filters, sorts by likes and remembers the day", async () => {
    const { f, calls } = youtubeStub({
      kr: [id(1), id(2), id(3)], us: [id(4), id(1)],
      videos: [video(id(1), "초간단 계란볶음밥", 20_000), video(id(2), "떡볶이 먹방", 90_000), video(id(3), "두부조림", 5_000), video(id(4), "Creamy pasta", 80_000)],
    });
    const r = await trendingRecipes({ YOUTUBE_API_KEY: "yt" }, null, NOW, f);
    expect(r.day).toBe("2026-10-13");
    expect(r.minLikes).toBe(10_000);
    expect(r.videos.map((v) => v.id)).toEqual([id(4), id(1)]);
    expect(r.videos.map((v) => v.region)).toEqual(["global", "kr"]);

    const searches = calls.filter((u) => u.pathname.endsWith("/search"));
    expect(searches.map((u) => u.searchParams.get("regionCode")).sort()).toEqual(["KR", "US"]);
    for (const s of searches) {
      expect(s.searchParams.get("videoDuration")).toBe("short");
      expect(s.searchParams.get("order")).toBe("viewCount");
      expect(s.searchParams.get("key")).toBe("yt");
      expect(s.searchParams.get("publishedAfter")).toBe("2026-08-14T00:00:00.000Z");
    }
    // 중복 ID는 한 번만 묻는다
    const vids = calls.filter((u) => u.pathname.endsWith("/videos"));
    expect(vids).toHaveLength(1);
    expect(vids[0].searchParams.get("id")!.split(",").sort()).toEqual([id(1), id(2), id(3), id(4)]);

    // 같은 날은 다시 묻지 않는다
    const again = await trendingRecipes({ YOUTUBE_API_KEY: "yt" }, null, NOW + 3600_000, f);
    expect(again).toEqual(r);
    expect(calls).toHaveLength(3);
    // 다음 날은 새로 (검색어도 바뀐다)
    await trendingRecipes({ YOUTUBE_API_KEY: "yt" }, null, NOW + 86400_000, f);
    expect(calls).toHaveLength(6);
    expect(calls[3].searchParams.get("q")).not.toBe(calls[0].searchParams.get("q"));
  });

  it("adds a search for a fridge ingredient and tags those videos", async () => {
    const { f, calls } = youtubeStub({
      kr: [id(1)], us: [], ing: [id(2)],
      videos: [video(id(1), "집밥 반찬", 30_000), video(id(2), "감자조림 황금레시피", 15_000)],
    });
    const r = await trendingRecipes({ YOUTUBE_API_KEY: "yt" }, "감자!!<script>", NOW, f);
    expect(calls.filter((u) => u.pathname.endsWith("/search")).map((u) => u.searchParams.get("q"))).toContain("감자 script 레시피");
    expect(r.videos.find((v) => v.id === id(2))?.ing).toBe("감자 script");
    expect(r.videos.find((v) => v.id === id(1))?.ing).toBeUndefined();
  });

  it("still shows the other region when one search fails, and does not remember it", async () => {
    const { f, calls } = youtubeStub({ kr: [id(1)], videos: [video(id(1), "계란말이", 40_000)], fail: "US" });
    const r = await trendingRecipes({ YOUTUBE_API_KEY: "yt" }, null, NOW, f);
    expect(r.videos.map((v) => v.id)).toEqual([id(1)]);
    await trendingRecipes({ YOUTUBE_API_KEY: "yt" }, null, NOW, f);
    expect(calls.filter((u) => u.pathname.endsWith("/search"))).toHaveLength(4);
  });

  it("explains a used-up quota without leaking the key", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { f } = youtubeStub({ videos: [], fail: "quota" });
    const e = await trendingRecipes({ YOUTUBE_API_KEY: "secret-yt-key" }, null, NOW, f).catch((x) => x);
    expect(e).toBeInstanceOf(TrendingError);
    expect(e).toMatchObject({ status: 503, code: "youtube_quota" });
    expect(e.message).toMatch(/한도/);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("secret-yt-key");
    warn.mockRestore();
  });

  it("reports a broken search", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { f } = youtubeStub({ videos: [], fail: "all" });
    await expect(trendingRecipes({ YOUTUBE_API_KEY: "yt" }, null, NOW, f)).rejects.toMatchObject({ status: 502, code: "youtube_error" });
    vi.restoreAllMocks();
  });
});

describe("GET /trending", () => {
  const get = (env: Env, path = "/trending", token: string | null = goodToken) =>
    handler.fetch!(new Request(`https://api.test${path}`, { headers: { Origin: "https://cook.example.com", ...(token ? { Authorization: `Bearer ${token}` } : {}) } }) as any, env, {} as any);

  function stubGlobal(videos: ReturnType<typeof video>[], ids: string[]) {
    const seen: string[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      if (req.url.startsWith("https://www.googleapis.com/service_accounts/v1/jwk/")) {
        return jsonResponse({ keys: signer.jwks }, 200, { "cache-control": "max-age=3600" });
      }
      seen.push(req.url);
      const u = new URL(req.url);
      if (u.pathname.endsWith("/search")) return jsonResponse({ items: ids.map((videoId) => ({ id: { videoId } })) });
      return jsonResponse({ items: videos });
    });
    return seen;
  }

  it("needs a signed-in family member", async () => {
    stubGlobal([], []);
    expect((await get({ ...baseEnv, YOUTUBE_API_KEY: "yt" }, "/trending", null)).status).toBe(401);
    expect((await get({ ...baseEnv, YOUTUBE_API_KEY: "yt", ALLOWED_EMAILS: "someone@else.com" })).status).toBe(403);
  });

  it("says when the key is not set", async () => {
    stubGlobal([], []);
    const r = await get(baseEnv);
    expect(r.status).toBe(503);
    expect(await r.json()).toMatchObject({ code: "youtube_not_configured" });
  });

  it("returns today's videos", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const seen = stubGlobal([video(id(1), "계란볶음밥", 20_000)], [id(1)]);
    const r = await get({ ...baseEnv, YOUTUBE_API_KEY: "yt" }, "/trending?ing=%EA%B3%84%EB%9E%80");
    expect(r.status).toBe(200);
    const j = await r.json() as any;
    expect(j.videos).toHaveLength(1);
    expect(j.videos[0]).toMatchObject({ id: id(1), likes: 20_000 });
    // 국내 + 해외 + 재료 검색, 그리고 영상 정보 한 번
    expect(seen.filter((u) => u.includes("/search?"))).toHaveLength(3);
    expect(seen.filter((u) => u.includes("/videos?"))).toHaveLength(1);
    vi.restoreAllMocks();
  });
});
