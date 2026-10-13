/**
 * 오늘의 인기 레시피: 유튜브 쇼츠 중 좋아요 1만 개가 넘는 요리 영상 (국내 + 해외).
 *
 * 무료 한도(하루 10,000 유닛) 안에서 돌도록:
 * - 검색(search.list)은 한 번에 100 유닛이라 국내 1번 + 해외 1번 (+ 냉장고 재료 1번)만 하고,
 *   좋아요·길이는 videos.list(1 유닛)로 한꺼번에 확인한다 → 한 번 모으는 데 약 200~300 유닛
 * - 한국 날짜별로 기억해 두고 같은 날에는 다시 묻지 않는다 (메모리 + Cache API, 화면도 하루 동안 기억한다)
 * 검색어는 날마다 바뀌어 매일 다른 영상이 올라온다.
 */
import { kstDay } from "./guard";

export class TrendingError extends Error {
  constructor(public status: number, message: string, public code?: string) { super(message); }
}

export type TrendingVideo = {
  id: string;
  url: string;
  title: string;
  channel: string;
  likes: number;
  views: number;
  /** 가장 큰 썸네일 (쇼츠는 가운데를 세로로 잘라 보여 준다) */
  thumbnail: string;
  publishedAt: string;
  seconds: number;
  /** 제목에 한글이 있으면 국내 */
  region: "kr" | "global";
  /** 세로 영상인가 (알 수 없으면 null) */
  vertical: boolean | null;
  /** 냉장고 재료로 찾은 영상이면 그 재료 */
  ing?: string;
};

export type TrendingResponse = { day: string; minLikes: number; videos: TrendingVideo[] };

export const MIN_LIKES = 10_000;
const MAX_SECONDS = 180;
const WINDOW_DAYS = 60;
const API = "https://www.googleapis.com/youtube/v3";

/** 날마다 하나씩 돌아가며 쓰는 검색어 */
const KR_QUERIES = ["레시피", "간단 요리 레시피", "집밥 레시피", "자취 요리", "반찬 레시피", "초간단 요리", "야식 레시피", "에어프라이어 요리", "한그릇 요리", "다이어트 레시피"];
const GLOBAL_QUERIES = ["easy recipe", "quick dinner recipe", "healthy recipe", "pasta recipe", "chicken recipe", "breakfast recipe", "air fryer recipe", "dessert recipe", "one pot recipe", "high protein recipe"];
/** 레시피가 아닌 영상 (먹방, 맛집 소개, 리뷰) */
const NOT_RECIPE = /먹방|mukbang|맛집|리뷰|review|eating show|asmr eating/i;

type SearchItem = { id?: { videoId?: string } };
type Thumb = { url?: string; width?: number; height?: number };
type VideoItem = {
  id?: string;
  snippet?: { title?: string; channelTitle?: string; publishedAt?: string; liveBroadcastContent?: string; thumbnails?: Record<string, Thumb> };
  statistics?: { likeCount?: string; viewCount?: string };
  contentDetails?: { duration?: string };
  player?: { embedWidth?: string | number; embedHeight?: string | number };
  status?: { embeddable?: boolean; privacyStatus?: string };
};

/** ISO 8601 길이 (PT1M5S) → 초 */
export function isoSeconds(d: string | undefined): number {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(d ?? "");
  if (!m) return 0;
  return Number(m[1] ?? 0) * 86400 + Number(m[2] ?? 0) * 3600 + Number(m[3] ?? 0) * 60 + Number(m[4] ?? 0);
}

const dayNumber = (day: string) => Math.floor(Date.parse(`${day}T00:00:00Z`) / 86400_000);
const pickFor = (list: string[], day: string) => list[((dayNumber(day) % list.length) + list.length) % list.length];

/** 큰 것부터: maxres(1280) > standard(640) > high(480) */
function bestThumb(t: Record<string, Thumb> | undefined, id: string): string {
  for (const k of ["maxres", "standard", "high", "medium", "default"]) if (t?.[k]?.url) return t[k].url!;
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}

/** 냉장고 재료 이름: 한두 단어만 (검색어가 되므로 이상한 글자는 뺀다) */
export function cleanIngredient(raw: string | null | undefined): string | null {
  const s = (raw ?? "").replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 20);
  return s.length >= 1 ? s : null;
}

async function youtubeGet(f: typeof fetch, path: string, params: Record<string, string>, key: string): Promise<any> {
  const qs = new URLSearchParams({ ...params, key });
  const r = await f(`${API}/${path}?${qs}`, { signal: AbortSignal.timeout(10_000) });
  if (r.ok) return r.json();
  const j = (await r.json().catch(() => null)) as { error?: { errors?: { reason?: string }[]; message?: string } } | null;
  const reason = j?.error?.errors?.[0]?.reason ?? "";
  // 키 값이 들어 있을 수 있는 원문 주소는 남기지 않는다
  console.warn(JSON.stringify({ route: "trending", youtube: path, status: r.status, reason }));
  if (r.status === 403 && /quota|dailyLimit|rateLimit/i.test(reason)) {
    throw new TrendingError(503, "오늘 유튜브 조회 한도를 다 썼어요. 내일 다시 볼 수 있어요", "youtube_quota");
  }
  if (r.status === 400 || r.status === 403) {
    throw new TrendingError(503, "유튜브 API 키가 맞지 않거나 YouTube Data API가 꺼져 있어요. 앱을 설치한 사람에게 알려 주세요", "youtube_key");
  }
  throw new TrendingError(502, "유튜브에서 인기 영상을 가져오지 못했어요. 잠시 뒤 다시 시도해 주세요", "youtube_error");
}

async function search(f: typeof fetch, key: string, q: string, region: "KR" | "US", day: string): Promise<string[]> {
  const after = new Date(Date.parse(`${day}T00:00:00Z`) - WINDOW_DAYS * 86400_000).toISOString();
  const j = (await youtubeGet(f, "search", {
    part: "id", type: "video", q, maxResults: "50", order: "viewCount", videoDuration: "short",
    regionCode: region, relevanceLanguage: region === "KR" ? "ko" : "en", safeSearch: "strict", publishedAfter: after,
  }, key)) as { items?: SearchItem[] };
  return (j.items ?? []).map((i) => i.id?.videoId).filter((v): v is string => !!v && /^[\w-]{11}$/.test(v));
}

async function details(f: typeof fetch, key: string, ids: string[]): Promise<VideoItem[]> {
  const out: VideoItem[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const j = (await youtubeGet(f, "videos", {
      part: "snippet,statistics,contentDetails,player,status", id: ids.slice(i, i + 50).join(","), maxWidth: "360",
    }, key)) as { items?: VideoItem[] };
    out.push(...(j.items ?? []));
  }
  return out;
}

/** 좋아요 1만 개 이상, 3분 이하, 공개, 레시피로 보이는 것만 */
export function toVideo(v: VideoItem, ing?: string): TrendingVideo | null {
  const id = v.id ?? "";
  const sn = v.snippet;
  if (!/^[\w-]{11}$/.test(id) || !sn?.title) return null;
  if (sn.liveBroadcastContent && sn.liveBroadcastContent !== "none") return null;
  if (v.status?.privacyStatus && v.status.privacyStatus !== "public") return null;
  const likes = Number(v.statistics?.likeCount ?? NaN);
  if (!Number.isFinite(likes) || likes < MIN_LIKES) return null;   // 좋아요를 숨긴 영상도 뺀다
  const seconds = isoSeconds(v.contentDetails?.duration);
  if (seconds <= 0 || seconds > MAX_SECONDS) return null;
  if (NOT_RECIPE.test(sn.title)) return null;
  const w = Number(v.player?.embedWidth), h = Number(v.player?.embedHeight);
  return {
    id, url: `https://www.youtube.com/shorts/${id}`,
    title: sn.title.slice(0, 200), channel: (sn.channelTitle ?? "").slice(0, 100),
    likes, views: Number(v.statistics?.viewCount ?? 0) || 0,
    thumbnail: bestThumb(sn.thumbnails, id), publishedAt: sn.publishedAt ?? "", seconds,
    region: /[가-힣]/.test(sn.title) ? "kr" : "global",
    vertical: w > 0 && h > 0 ? h > w : null,
    ...(ing ? { ing } : {}),
  };
}

/** 같은 날·같은 재료는 다시 묻지 않는다 (이 서버 안에서) */
const memory = new Map<string, TrendingResponse>();
export function resetTrendingCache() { memory.clear(); }

const cacheUrl = (day: string, ing: string | null) => `https://trending.cache.internal/v1/${day}/${encodeURIComponent(ing ?? "-")}`;
/** Cache API: workers.dev 주소에서는 저장되지 않을 수 있어 실패해도 넘어간다 */
const edgeCache = (): Cache | null => (typeof caches !== "undefined" ? (caches as unknown as { default?: Cache }).default ?? null : null);

export async function trendingRecipes(env: { YOUTUBE_API_KEY?: string }, ingRaw?: string | null, now = Date.now(), f: typeof fetch = fetch): Promise<TrendingResponse> {
  const key = env.YOUTUBE_API_KEY?.trim();
  if (!key) throw new TrendingError(503, "인기 레시피를 보려면 YouTube API 키가 필요해요. 앱을 설치한 사람에게 알려 주세요", "youtube_not_configured");
  const day = kstDay(now);
  const ing = cleanIngredient(ingRaw);
  const memKey = `${day}|${ing ?? ""}`;
  const hit = memory.get(memKey);
  if (hit) return hit;
  const cache = edgeCache();
  try {
    const cached = await cache?.match(cacheUrl(day, ing));
    if (cached) { const data = (await cached.json()) as TrendingResponse; memory.set(memKey, data); return data; }
  } catch { /* 캐시 없이 진행 */ }

  // 국내·해외·재료 검색을 함께. 하나가 실패해도 나머지로 보여 준다 (모두 실패하면 첫 오류를 알린다)
  const jobs: { q: string; region: "KR" | "US"; ing?: string }[] = [
    { q: pickFor(KR_QUERIES, day), region: "KR" },
    { q: pickFor(GLOBAL_QUERIES, day), region: "US" },
    ...(ing ? [{ q: `${ing} 레시피`, region: "KR" as const, ing }] : []),
  ];
  const settled = await Promise.allSettled(jobs.map((j) => search(f, key, j.q, j.region, day)));
  const firstError = settled.find((s): s is PromiseRejectedResult => s.status === "rejected")?.reason;
  if (settled.every((s) => s.status === "rejected")) throw firstError;
  const ingOf = new Map<string, string>();
  const ids: string[] = [];
  settled.forEach((s, i) => {
    if (s.status !== "fulfilled") return;
    for (const id of s.value) {
      if (!ids.includes(id)) ids.push(id);
      if (jobs[i].ing) ingOf.set(id, jobs[i].ing!);
    }
  });
  const items = ids.length ? await details(f, key, ids) : [];
  const videos = items.map((v) => toVideo(v, ingOf.get(v.id ?? ""))).filter((v): v is TrendingVideo => !!v)
    .sort((a, b) => b.likes - a.likes);
  const data: TrendingResponse = { day, minLikes: MIN_LIKES, videos };
  console.log(JSON.stringify({ route: "trending", day, ing, searched: ids.length, kept: videos.length, failed: settled.filter((s) => s.status === "rejected").length }));

  // 일부 검색이 실패했으면 오래 기억하지 않는다 (다음 요청에서 다시 시도)
  if (!firstError) {
    memory.set(memKey, data);
    if (memory.size > 50) memory.delete(memory.keys().next().value!);
    try { await cache?.put(cacheUrl(day, ing), new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json", "Cache-Control": "max-age=21600" } })); }
    catch { /* 무시 */ }
  }
  return data;
}
