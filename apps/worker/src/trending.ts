/**
 * 오늘의 인기 레시피: 유튜브 쇼츠 중 좋아요 1만 개가 넘는 요리 영상 (한국·미국·스페인·일본만).
 *
 * 무료 한도(하루 10,000 유닛) 안에서 돌도록:
 * - 검색(search.list)은 한 번에 100 유닛이라 나라마다 1번 (+ 냉장고 재료 1번)만 하고,
 *   좋아요·길이는 videos.list, 채널 나라는 channels.list(각 1 유닛)로 한꺼번에 확인한다 → 한 번 모으는 데 약 400~500 유닛
 * - 지역 검색(regionCode)은 "그 나라에서 볼 수 있는 영상"이라 다른 나라 영상도 섞여 나온다.
 *   그래서 채널에 적힌 나라(없으면 제목 글자·음성 언어)로 네 나라 영상인지 다시 확인한다
 * - 한국 날짜별로 기억해 두고 같은 날에는 다시 묻지 않는다 (결과는 메모리 + Cache API, 검색은 검색어별로 메모리 + KV, 화면도 하루 동안 기억한다)
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
  /** 어느 나라 영상인가 (채널 나라 → 제목 글자 → 음성 언어 순으로 정한다) */
  region: Country;
  /** 세로 영상인가 (알 수 없으면 null) */
  vertical: boolean | null;
  /** 냉장고 재료로 찾은 영상이면 그 재료 */
  ing?: string;
};

/** partial: 검색 일부나 채널 나라 확인이 실패해 일부만 모았다 (기기에 하루 동안 남기지 않는다) */
export type TrendingResponse = { day: string; minLikes: number; videos: TrendingVideo[]; partial?: boolean };

export type Country = "kr" | "us" | "es" | "jp";

export const MIN_LIKES = 10_000;
const MAX_SECONDS = 180;
const WINDOW_DAYS = 60;
const API = "https://www.googleapis.com/youtube/v3";

/** 나라별 검색: 그 나라 말로, 날마다 하나씩 돌아가며 쓰는 검색어 */
const SEARCHES: { country: Country; lang: string; queries: string[] }[] = [
  { country: "kr", lang: "ko", queries: ["레시피", "간단 요리 레시피", "집밥 레시피", "자취 요리", "반찬 레시피", "초간단 요리", "야식 레시피", "에어프라이어 요리", "한그릇 요리", "다이어트 레시피"] },
  { country: "us", lang: "en", queries: ["easy recipe", "quick dinner recipe", "healthy recipe", "pasta recipe", "chicken recipe", "breakfast recipe", "air fryer recipe", "dessert recipe", "one pot recipe", "high protein recipe"] },
  { country: "es", lang: "es", queries: ["receta fácil", "receta rápida", "recetas de cocina", "receta saludable", "receta de pasta", "receta de pollo", "postre fácil", "receta freidora de aire", "cena rápida", "receta casera"] },
  { country: "jp", lang: "ja", queries: ["簡単レシピ", "時短レシピ", "節約レシピ", "作り置き レシピ", "お弁当 レシピ", "ダイエットレシピ", "レンジ レシピ", "おつまみ レシピ", "パスタ レシピ", "スイーツ レシピ"] },
];
const COUNTRIES = new Set<string>(SEARCHES.map((s) => s.country));
/** 레시피가 아닌 영상 (먹방, 맛집 소개, 리뷰) */
const NOT_RECIPE = /먹방|mukbang|맛집|리뷰|review|eating show|asmr eating|モッパン|大食い|咀嚼音|reseña/i;
/** 네 나라에서 거의 쓰지 않는 글자 (인도 글자들, 아랍 글자): 제목에 있으면 뺀다 */
const OTHER_SCRIPT = /[\u0600-\u06FF\u0900-\u0DFF]/;

type SearchItem = { id?: { videoId?: string } };
type Thumb = { url?: string; width?: number; height?: number };
type VideoItem = {
  id?: string;
  snippet?: {
    title?: string; channelId?: string; channelTitle?: string; publishedAt?: string; liveBroadcastContent?: string;
    defaultLanguage?: string; defaultAudioLanguage?: string; thumbnails?: Record<string, Thumb>;
  };
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

async function search(f: typeof fetch, key: string, q: string, country: Country, lang: string, day: string): Promise<string[]> {
  const after = new Date(Date.parse(`${day}T00:00:00Z`) - WINDOW_DAYS * 86400_000).toISOString();
  const j = (await youtubeGet(f, "search", {
    part: "id", type: "video", q, maxResults: "50", order: "viewCount", videoDuration: "short",
    regionCode: country.toUpperCase(), relevanceLanguage: lang, safeSearch: "strict", publishedAfter: after,
  }, key)) as { items?: SearchItem[] };
  return (j.items ?? []).map((i) => i.id?.videoId).filter((v): v is string => !!v && /^[\w-]{11}$/.test(v));
}

/** ID 50개씩 나눠 묻기 (videos.list, channels.list 모두 한 번에 1 유닛) */
async function listByIds<T>(f: typeof fetch, key: string, path: string, part: string, ids: string[], extra: Record<string, string> = {}): Promise<T[]> {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 50) chunks.push(ids.slice(i, i + 50));
  // 나눠 묻는 것은 한꺼번에 (하나씩 기다리면 휴대폰 화면이 오래 빈 채로 있다)
  const pages = await Promise.all(chunks.map((c) => youtubeGet(f, path, { part, id: c.join(","), ...extra }, key) as Promise<{ items?: T[] }>));
  return pages.flatMap((j) => j.items ?? []);
}

/**
 * 어느 나라 영상인가: 채널에 나라가 적혀 있으면 그것만 본다 (네 나라가 아니면 뺀다).
 * 적혀 있지 않으면 제목의 한글·가나, 그다음 나라까지 적힌 음성 언어(en-US, es-ES)로 정한다.
 * 그래도 모르면 뺀다 (영어·스페인어만으로는 어느 나라인지 알 수 없다).
 */
export function countryOf(title: string, channelCountry?: string | null, lang?: string | null): Country | null {
  const c = (channelCountry ?? "").trim().toLowerCase();
  if (c) return COUNTRIES.has(c) ? (c as Country) : null;
  if (/[가-힣]/.test(title)) return "kr";
  if (/[\u3040-\u30ff]/.test(title)) return "jp";
  const l = (lang ?? "").trim().toLowerCase();
  if (l === "ko" || l.startsWith("ko-")) return "kr";
  if (l === "ja" || l.startsWith("ja-")) return "jp";
  if (l === "en-us") return "us";
  if (l === "es-es") return "es";
  return null;
}

/** 좋아요 1만 개 이상, 3분 이하, 공개, 레시피로 보이는 것 중 네 나라(한국·미국·스페인·일본) 영상만 */
export function toVideo(v: VideoItem, ing?: string, channelCountry?: string | null): TrendingVideo | null {
  const id = v.id ?? "";
  const sn = v.snippet;
  if (!/^[\w-]{11}$/.test(id) || !sn?.title) return null;
  if (sn.liveBroadcastContent && sn.liveBroadcastContent !== "none") return null;
  if (v.status?.privacyStatus && v.status.privacyStatus !== "public") return null;
  const likes = Number(v.statistics?.likeCount ?? NaN);
  if (!Number.isFinite(likes) || likes < MIN_LIKES) return null;   // 좋아요를 숨긴 영상도 뺀다
  const seconds = isoSeconds(v.contentDetails?.duration);
  if (seconds <= 0 || seconds > MAX_SECONDS) return null;
  if (NOT_RECIPE.test(sn.title) || OTHER_SCRIPT.test(sn.title)) return null;
  const region = countryOf(sn.title, channelCountry, sn.defaultAudioLanguage ?? sn.defaultLanguage);
  if (!region) return null;
  const w = Number(v.player?.embedWidth), h = Number(v.player?.embedHeight);
  return {
    id, url: `https://www.youtube.com/shorts/${id}`,
    title: sn.title.slice(0, 200), channel: (sn.channelTitle ?? "").slice(0, 100),
    likes, views: Number(v.statistics?.viewCount ?? 0) || 0,
    thumbnail: bestThumb(sn.thumbnails, id), publishedAt: sn.publishedAt ?? "", seconds,
    region,
    vertical: w > 0 && h > 0 ? h > w : null,
    ...(ing ? { ing } : {}),
  };
}

/** 같은 날·같은 재료는 다시 묻지 않는다 (이 서버 안에서) */
const memory = new Map<string, TrendingResponse>();
/** 검색(100 유닛) 결과는 검색어별로 기억한다: 나라별 검색 넷은 그날 모두에게 같으므로 재료가 바뀌어도 다시 하지 않는다.
 *  끝난 값만 나눠 쓴다 (Workers에서 다른 요청이 시작한 약속을 기다리면, 그 요청이 끊길 때 함께 멈출 수 있다) */
const searchMemo = new Map<string, string[]>();
/** 하루에 함께 찾아 줄 재료 수 (서버 하나에서). 넘으면 재료 검색 없이 나라별 결과만: 유튜브 하루 한도를 지킨다 */
const MAX_ING_PER_DAY = 30;
const ingSeen = new Map<string, Set<string>>();
export function resetTrendingCache() { memory.clear(); searchMemo.clear(); ingSeen.clear(); }

type TrendingEnv = { YOUTUBE_API_KEY?: string; USAGE?: KVNamespace };

/** 검색 한 번: 이 서버 메모리 → (있으면) KV → 유튜브. workers.dev 에서는 Cache API가 남지 않아 KV가 서버 사이 기억이 된다 */
async function cachedSearch(env: TrendingEnv, f: typeof fetch, key: string, q: string, country: Country, lang: string, day: string): Promise<string[]> {
  const k = `${day}|${country}|${q}`;
  const hit = searchMemo.get(k);
  if (hit) return hit;
  const kvKey = `yt:s:${day}:${country}:${encodeURIComponent(q)}`;
  const keep = (ids: string[]) => {
    searchMemo.set(k, ids);
    if (searchMemo.size > 200) searchMemo.delete(searchMemo.keys().next().value!);
    return ids;
  };
  try {
    const saved = await env.USAGE?.get(kvKey);
    if (saved) { const ids = JSON.parse(saved) as unknown; if (Array.isArray(ids)) return keep(ids.filter((x): x is string => typeof x === "string")); }
  } catch { /* KV 없이 진행 */ }
  const ids = await search(f, key, q, country, lang, day);
  try { await env.USAGE?.put(kvKey, JSON.stringify(ids), { expirationTtl: 60 * 60 * 36 }); } catch { /* 무시 */ }
  return keep(ids);
}

/** 오늘 처음 보는 재료가 너무 많으면 재료 검색은 건너뛴다 */
function allowIngredient(day: string, ing: string | null): string | null {
  if (!ing) return null;
  let seen = ingSeen.get(day);
  if (!seen) { ingSeen.clear(); seen = new Set(); ingSeen.set(day, seen); }
  if (seen.has(ing)) return ing;
  if (seen.size >= MAX_ING_PER_DAY) return null;
  seen.add(ing);
  return ing;
}

const cacheUrl = (day: string, ing: string | null) => `https://trending.cache.internal/v2/${day}/${encodeURIComponent(ing ?? "-")}`;
/** Cache API: workers.dev 주소에서는 저장되지 않을 수 있어 실패해도 넘어간다 */
const edgeCache = (): Cache | null => (typeof caches !== "undefined" ? (caches as unknown as { default?: Cache }).default ?? null : null);

export async function trendingRecipes(env: TrendingEnv, ingRaw?: string | null, now = Date.now(), f: typeof fetch = fetch): Promise<TrendingResponse> {
  const key = env.YOUTUBE_API_KEY?.trim();
  if (!key) throw new TrendingError(503, "인기 레시피를 보려면 YouTube API 키가 필요해요. 앱을 설치한 사람에게 알려 주세요", "youtube_not_configured");
  const day = kstDay(now);
  const ing = allowIngredient(day, cleanIngredient(ingRaw));
  const memKey = `${day}|${ing ?? ""}`;
  const hit = memory.get(memKey);
  if (hit) return hit;
  return collect(env, key, day, ing, memKey, f);
}

async function collect(env: TrendingEnv, key: string, day: string, ing: string | null, memKey: string, f: typeof fetch): Promise<TrendingResponse> {
  const cache = edgeCache();
  try {
    const cached = await cache?.match(cacheUrl(day, ing));
    if (cached) { const data = (await cached.json()) as TrendingResponse; memory.set(memKey, data); return data; }
  } catch { /* 캐시 없이 진행 */ }

  // 나라별·재료 검색을 함께. 하나가 실패해도 나머지로 보여 준다 (모두 실패하면 첫 오류를 알린다)
  const jobs: { q: string; country: Country; lang: string; ing?: string }[] = [
    ...SEARCHES.map((s) => ({ q: pickFor(s.queries, day), country: s.country, lang: s.lang })),
    ...(ing ? [{ q: `${ing} 레시피`, country: "kr" as const, lang: "ko", ing }] : []),
  ];
  const settled = await Promise.allSettled(jobs.map((j) => cachedSearch(env, f, key, j.q, j.country, j.lang, day)));
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
  const items = ids.length
    ? await listByIds<VideoItem>(f, key, "videos", "snippet,statistics,contentDetails,player,status", ids, { maxWidth: "360" })
    : [];
  // 채널에 적힌 나라: 못 가져오면 한글·가나 제목만 남는다 (그날은 기억하지 않고 다음에 다시 묻는다)
  const channelIds = [...new Set(items.map((v) => v.snippet?.channelId).filter((c): c is string => !!c))];
  let channelFailed = false;
  const countryOfChannel = new Map<string, string>();
  try {
    const channels = await listByIds<{ id?: string; snippet?: { country?: string } }>(f, key, "channels", "snippet", channelIds);
    for (const c of channels) if (c.id) countryOfChannel.set(c.id, c.snippet?.country ?? "");
  } catch { channelFailed = true; }
  const videos = items.map((v) => toVideo(v, ingOf.get(v.id ?? ""), countryOfChannel.get(v.snippet?.channelId ?? "")))
    .filter((v): v is TrendingVideo => !!v)
    .sort((a, b) => b.likes - a.likes);
  const data: TrendingResponse = { day, minLikes: MIN_LIKES, videos, ...(firstError || channelFailed ? { partial: true } : {}) };
  const byCountry = Object.fromEntries(SEARCHES.map((s) => [s.country, videos.filter((v) => v.region === s.country).length]));
  console.log(JSON.stringify({ route: "trending", day, ing, searched: ids.length, kept: videos.length, byCountry, failed: settled.filter((s) => s.status === "rejected").length, channelFailed }));

  // 일부 검색이 실패했으면 오래 기억하지 않는다 (다음 요청에서 다시 시도)
  if (!firstError && !channelFailed) {
    memory.set(memKey, data);
    if (memory.size > 50) memory.delete(memory.keys().next().value!);
    try { await cache?.put(cacheUrl(day, ing), new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json", "Cache-Control": "max-age=21600" } })); }
    catch { /* 무시 */ }
  }
  return data;
}
