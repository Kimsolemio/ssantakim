import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { DEFAULT_STAPLES, daysUntil, type FridgeItem } from "@cook/shared";
import { ApiError, getWorker, isDemo, workerConfigured } from "../../lib/api";
import { useFamily } from "../../lib/family";
import { useFridge } from "../fridge/useFridge";

/** 서버(apps/worker/src/trending.ts)가 돌려주는 영상 */
export type TrendingVideo = {
  id: string;
  url: string;
  title: string;
  channel: string;
  likes: number;
  views: number;
  thumbnail: string;
  publishedAt: string;
  seconds: number;
  region: "kr" | "us" | "es" | "jp";
  vertical: boolean | null;
  ing?: string;
};
type TrendingResponse = { day: string; minLikes: number; videos: TrendingVideo[]; partial?: boolean };

/** 화면에 보일 영상 + 냉장고에 있는 재료 중 제목에 나온 것 */
export type TrendingPick = TrendingVideo & { matched: string[] };

export const PICK_COUNT = 5;
/** 한 나라에서 고를 수 있는 수: 한국은 셋, 다른 나라는 둘까지 */
const perRegion = (region: string) => (region === "kr" ? 3 : 2);

/** 서버와 같은 한국 날짜로 하루를 나눈다 */
const kstDay = (now = Date.now()) => new Date(now + 9 * 3600_000).toISOString().slice(0, 10);

// ---------- 하루 동안 기억 (유튜브 무료 한도를 아끼려고 기기마다 하루 한 번만 묻는다) ----------
const STORE = "trending:v2";
type Saved = { day: string; data: TrendingResponse };
let mem: Saved | null = null;
let inflight: { day: string; p: Promise<TrendingResponse> } | null = null;

function readSaved(day: string): TrendingResponse | null {
  if (mem?.day === day) return mem.data;
  try {
    const s = JSON.parse(localStorage.getItem(STORE) ?? "null") as Saved | null;
    if (s?.day === day && Array.isArray(s.data?.videos)) { mem = s; return s.data; }
  } catch { /* 저장소를 못 써도 괜찮다 */ }
  return null;
}

function fetchToday(day: string, ing: string | null): Promise<TrendingResponse> {
  const saved = readSaved(day);
  if (saved) return Promise.resolve(saved);
  if (inflight?.day === day) return inflight.p;
  const p = getWorker<TrendingResponse>(`/trending${ing ? `?ing=${encodeURIComponent(ing)}` : ""}`, 25_000)
    .catch((e: unknown) => { throw e instanceof ApiError ? e : new ApiError("서버에 연결할 수 없어요", 0); })
    .then((data) => {
      mem = { day, data };
      // 일부만 받아 온 날(검색·채널 확인 하나가 실패)은 기기에 남기지 않아 다음에 다시 묻는다
      if (data.videos.length >= PICK_COUNT && !data.partial) {
        try { localStorage.setItem(STORE, JSON.stringify(mem)); } catch { /* 무시 */ }
      }
      return data;
    })
    .finally(() => { if (inflight?.p === p) inflight = null; });
  inflight = { day, p };
  return p;
}

// ---------- 냉장고 재료로 고르기 ----------
/** 제목에서 같은 재료로 볼 다른 이름 */
const ALIASES: Record<string, string[]> = {
  계란: ["달걀"], 달걀: ["계란"], 소고기: ["쇠고기", "불고기"], 쇠고기: ["소고기"], 닭고기: ["닭"], 돼지고기: ["돼지", "제육"],
  대파: ["파채"], 애호박: ["호박"], 스파게티면: ["파스타", "스파게티"], 파스타면: ["파스타"],
};
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
type Term = { label: string; re: RegExp };

/** 냉장고 재료 → 제목에서 찾을 말 (한 글자 이름은 다른 말 속에 너무 자주 들어 있어 뺀다: 무침의 '무') */
export function fridgeTerms(items: Pick<FridgeItem, "name" | "key">[], staples: readonly string[]): Term[] {
  const out = new Map<string, Term>();
  for (const f of items) {
    const name = f.name.trim();
    if (!name || out.has(name) || staples.includes(name)) continue;
    const words = [...(ALIASES[name] ?? [])].map(esc);
    if ([...name].length >= 2) words.unshift(esc(name));
    // 영문 재료 키(green_onion)는 해외 영상 제목에서 낱말로 찾는다 (eggs 같은 복수형도)
    if (/^[a-z]+(_[a-z]+)*$/.test(f.key) && f.key.length >= 3) words.push(`\\b${esc(f.key.replace(/_/g, " "))}(?:e?s)?\\b`);
    if (words.length) out.set(name, { label: name, re: new RegExp(words.join("|"), "i") });
  }
  return [...out.values()];
}

/** 오늘 서버에 함께 찾아 달라고 할 재료: 가장 급한 임박 재료, 없으면 날마다 바뀌는 재료 하나 */
export function pickIngredient(items: Pick<FridgeItem, "name" | "expiresAt">[], staples: readonly string[], day: string): string | null {
  const usable = items.filter((f) => !staples.includes(f.name) && [...f.name.trim()].length >= 1);
  const withD = usable.map((f) => ({ name: f.name.trim(), d: daysUntil(f.expiresAt) })).filter((x) => x.d == null || x.d >= 0);
  const urgent = withD.filter((x) => x.d != null && x.d <= 3).sort((a, b) => (a.d ?? 0) - (b.d ?? 0) || a.name.localeCompare(b.name));
  if (urgent.length) return urgent[0].name;
  const names = [...new Set(withD.map((x) => x.name))].sort();
  if (!names.length) return null;
  const n = Math.floor(Date.parse(`${day}T00:00:00Z`) / 86400_000);
  return names[n % names.length];
}

/** 다섯 개 고르기: 앞에서부터 나라가 섞이게 한국은 셋, 다른 나라는 둘까지 */
function pickRound(scored: TrendingPick[], n: number): TrendingPick[] {
  const out: TrendingPick[] = [];
  const count = new Map<string, number>();
  for (const v of scored) {
    if (out.length >= n) break;
    const c = count.get(v.region) ?? 0;
    if (c >= perRegion(v.region)) continue;
    out.push(v);
    count.set(v.region, c + 1);
  }
  // 어느 나라가 모자라면 나머지로 채운다
  for (const v of scored) {
    if (out.length >= n) break;
    if (!out.includes(v)) out.push(v);
  }
  return out;
}

/** 받아 온 영상 전부를 보여 줄 순서로: 냉장고 재료가 나오는 것 먼저 (많이 겹칠수록), 그다음 좋아요 순.
 *  다섯 개씩 끊어 고르므로 어디까지 넘겨 봐도 나라가 섞인다 */
export function orderPicks(videos: TrendingVideo[], terms: Term[], n = PICK_COUNT): TrendingPick[] {
  let left: TrendingPick[] = videos.map((v) => {
    const matched = terms.filter((t) => t.re.test(v.title)).map((t) => t.label);
    if (v.ing && !matched.includes(v.ing)) matched.unshift(v.ing);
    return { ...v, matched };
  });
  left.sort((a, b) =>
    Math.min(b.matched.length, 1) - Math.min(a.matched.length, 1)
    || b.matched.length - a.matched.length
    || Number(a.vertical === false) - Number(b.vertical === false)
    || b.likes - a.likes);
  const out: TrendingPick[] = [];
  while (left.length) {
    const round = pickRound(left, n);
    out.push(...round);
    left = left.filter((v) => !round.includes(v));
  }
  return out;
}

// ---------- 훅 ----------
export type TrendingState =
  | { status: "off" }
  | { status: "loading" }
  | { status: "error"; message: string; code?: string; retry: () => void }
  | { status: "ready"; picks: TrendingPick[]; minLikes: number };

export function useTrending(): TrendingState {
  const off = isDemo || !workerConfigured;
  const { familyId, family } = useFamily();
  const { items: fridge, loading: fridgeLoading } = useFridge(familyId);
  const staples: readonly string[] = family?.profile?.staples ?? DEFAULT_STAPLES;
  const day = kstDay();
  const ing = useMemo(() => pickIngredient(fridge, staples, day), [fridge, staples, day]);
  const [data, setData] = useState<TrendingResponse | null>(() => readSaved(day));
  const [error, setError] = useState<ApiError | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    // 냉장고를 다 읽은 뒤에 묻는다 (재료 검색을 함께 하려고)
    if (off || fridgeLoading) return;
    let alive = true;
    setError(null);
    fetchToday(day, ing).then(
      (d) => { if (alive) setData(d); },
      (e: ApiError) => { if (alive) { setData(null); setError(e); } });
    return () => { alive = false; };
  }, [off, fridgeLoading, day, ing, attempt]);

  const terms = useMemo(() => fridgeTerms(fridge, staples), [fridge, staples]);
  const picks = useMemo(() => (data ? orderPicks(data.videos, terms) : null), [data, terms]);

  if (off) return { status: "off" };
  if (error) return { status: "error", message: error.message, code: error.code, retry: () => setAttempt((x) => x + 1) };
  if (!picks) return { status: "loading" };
  return { status: "ready", picks, minLikes: data?.minLikes ?? 10_000 };
}

/** 넓은 화면(PC)인가: 가운데 앱 옆에 인기 레시피 칸을 따로 둘 만큼 */
const WIDE = "(min-width: 1180px)";
export function useWide(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(WIDE);
      // 오래된 사파리(13 이하)는 addEventListener 가 없다
      if (m.addEventListener) { m.addEventListener("change", cb); return () => m.removeEventListener("change", cb); }
      m.addListener(cb);
      return () => m.removeListener(cb);
    },
    () => window.matchMedia(WIDE).matches,
    () => false,
  );
}
