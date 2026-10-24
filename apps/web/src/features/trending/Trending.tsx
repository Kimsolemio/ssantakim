import { useState } from "react";
import { ArrowUpRight, ChevronRight, Heart, Play } from "lucide-react";
import { Banner } from "../../components/ui/Banner";
import { Button } from "../../components/ui/Button";
import { SectionHeader } from "../../components/ui/Section";
import { useNav } from "../../lib/nav";
import { PICK_COUNT, useTrending, useWide, type TrendingPick, type TrendingState } from "./useTrending";

/** 처음에 보일 수, "더 보기"를 누를 때마다 늘어나는 수 (휴대폰 가로 줄 / PC 오른쪽 칸) */
const ROW_STEP = 10;
const GRID_STEP = 12;

/** 12,345 → 1.2만, 1,234,567 → 123만 */
export function likesText(n: number): string {
  const short = (x: number) => (x >= 100 ? String(Math.round(x)) : x.toFixed(1).replace(/\.0$/, ""));
  if (n >= 1e8) return `${short(n / 1e8)}억`;
  if (n >= 1e4) return `${short(n / 1e4)}만`;
  return n.toLocaleString("ko-KR");
}
const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const SUBTITLE = "유튜브 쇼츠 · 좋아요 1만 개 넘는 요리 · 한국·미국·스페인·일본";
const REGION: Record<string, string> = { kr: "한국", us: "미국", es: "스페인", jp: "일본" };

type Size = "sm" | "md" | "lg";

/** 영상 카드: 누르면 레시피로 가져오기, 아래 글자 버튼은 유튜브에서 보기 */
function TrendingCard({ v, size }: { v: TrendingPick; size: Size }) {
  const { openImport } = useNav();
  const likes = likesText(v.likes);
  const region = REGION[v.region] ?? "해외";
  return (
    <li data-testid="trending-card" className={size === "sm" ? "w-[148px] shrink-0" : "min-w-0"}>
      <button type="button" onClick={() => openImport({ url: v.url, text: null, title: v.title })}
        aria-label={`${v.title}, ${region}, 좋아요 ${likes}개. 눌러서 레시피로 가져오기`}
        className="group block w-full text-left active:opacity-80">
        <span className="relative block aspect-[9/16] overflow-hidden rounded-card bg-surface-2">
          <img src={v.thumbnail} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer"
            onError={(e) => {
              // 큰 썸네일이 없으면 한 번은 기본 썸네일로, 그것도 안 되면 숨긴다
              const img = e.currentTarget, fallback = `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`;
              if (img.src !== fallback) img.src = fallback; else img.style.visibility = "hidden";
            }}
            className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
          <span aria-hidden className="absolute left-2 top-2 inline-flex h-6 items-center rounded-badge bg-black/55 px-2 text-caption font-semibold text-white backdrop-blur-sm">{region}</span>
          <span aria-hidden className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-linear-to-t from-black/70 to-black/0 px-2.5 pb-2 pt-10 text-white">
            <span className={`inline-flex items-center gap-1 font-semibold tabular-nums ${size === "lg" ? "text-headline" : "text-callout"}`}>
              <Heart size={size === "lg" ? 18 : 15} fill="currentColor" strokeWidth={0} />{likes}
            </span>
            <span className="inline-flex items-center gap-0.5 text-caption tabular-nums opacity-90"><Play size={12} fill="currentColor" strokeWidth={0} />{clock(v.seconds)}</span>
          </span>
        </span>
        <span className={`mt-2 block line-clamp-2 font-semibold text-ink ${size === "lg" ? "text-title2" : size === "md" ? "text-headline" : "text-callout"}`}>{v.title}</span>
        <span className="mt-0.5 block truncate text-caption text-ink-3">{v.channel}</span>
        {v.matched.length > 0 && <span className="mt-1 block truncate text-caption font-semibold text-success">냉장고에 있어요: {v.matched.slice(0, 3).join(", ")}</span>}
      </button>
      <a href={v.url} target="_blank" rel="noopener noreferrer"
        className="-ml-1 inline-flex h-11 items-center gap-0.5 px-1 text-caption font-semibold text-ink-2 active:opacity-60 hover:text-accent">
        유튜브에서 보기<ArrowUpRight size={14} aria-hidden />
      </a>
    </li>
  );
}

function Skeleton({ className }: { className: string }) {
  return <div aria-hidden className={`animate-pulse rounded-card bg-surface ${className}`} />;
}

function Trouble({ s, className = "" }: { s: Extract<TrendingState, { status: "error" }>; className?: string }) {
  // 다시 눌러도 달라지지 않는 경우(한도·키·권한)에는 "다시"를 보이지 않는다
  // (not_allowed 는 설치한 사람이 앱을 열면 풀리므로 "다시"를 남긴다)
  const canRetry = !["youtube_quota", "youtube_not_configured", "youtube_key", "not_configured", "family_needs_daily_limit"].includes(s.code ?? "");
  return <Banner kind="info" onCanvas className={className} action={canRetry ? { label: "다시", onClick: s.retry } : undefined}>{s.message}</Banner>;
}

/** 휴대폰: "오늘 뭐 먹지" 탭 안 가로 줄 (넓은 화면에서는 옆 칸이 대신 보여 준다) */
export function TrendingSection() {
  const wide = useWide();
  return wide ? null : <TrendingRow />;
}

function TrendingRow() {
  const s = useTrending();
  const [shown, setShown] = useState(ROW_STEP);
  // 키를 아직 안 넣었으면 휴대폰에서는 조용히 숨긴다 (설치한 사람은 PC 화면·README에서 안내를 본다)
  if (s.status === "off" || (s.status === "error" && s.code === "youtube_not_configured")) return null;
  const more = s.status === "ready" ? s.picks.length - shown : 0;
  return (
    <section data-testid="trending" aria-busy={s.status === "loading"}>
      <SectionHeader title="오늘의 인기 레시피" count={s.status === "ready" && s.picks.length > 0 ? s.picks.length : undefined} />
      <p className="-mt-2 px-5 pb-3 text-caption text-ink-3">{SUBTITLE} · 누르면 레시피로 가져와요</p>
      {s.status === "loading" && (
        <div className="flex gap-3 overflow-hidden px-5">
          {Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="aspect-[9/16] w-[148px] shrink-0" />)}
        </div>
      )}
      {s.status === "error" && <Trouble s={s} className="mx-5" />}
      {s.status === "ready" && (s.picks.length === 0
        ? <p className="px-5 text-callout text-ink-3">오늘은 조건에 맞는 영상이 없어요. 내일 다시 볼게요</p>
        : (
          <ul className="flex gap-3 overflow-x-auto px-5 [scrollbar-width:none]">
            {s.picks.slice(0, shown).map((v) => <TrendingCard key={v.id} v={v} size="sm" />)}
            {more > 0 && (
              <li className="w-[148px] shrink-0">
                <button type="button" onClick={() => setShown((x) => x + ROW_STEP)}
                  className="flex aspect-[9/16] w-full flex-col items-center justify-center gap-1 rounded-card bg-surface text-accent active:bg-surface-2">
                  <ChevronRight size={28} aria-hidden />
                  <span className="text-callout font-semibold">더 보기</span>
                  <span className="text-caption text-ink-3 tabular-nums">{more}개 더 있어요</span>
                </button>
              </li>
            )}
          </ul>
        ))}
    </section>
  );
}

/** PC: 가운데 앱 양옆 빈 곳에 큰 카드 (왼쪽 첫 번째 추천, 오른쪽 나머지를 "더 보기"로 이어서) */
export function TrendingAside() {
  const wide = useWide();
  return wide ? <Asides /> : null;
}

// 가운데 앱(max-w-lg = 512px) 바깥, 아래 탭 막대 위
const side = { top: 0, bottom: "calc(56px + var(--safe-bottom))" } as const;
const sideClass = "fixed z-10 overflow-y-auto px-8 pb-10 pt-12 [scrollbar-width:thin]";

function Asides() {
  const s = useTrending();
  const [shown, setShown] = useState(GRID_STEP);
  if (s.status === "off") return null;
  const [first, ...rest] = s.status === "ready" ? s.picks : [];
  const more = rest.length - shown;
  return (
    <>
      <aside aria-label="오늘의 인기 레시피" data-testid="trending-aside" className={`${sideClass} left-0`} style={{ ...side, right: "calc(50% + 256px + 16px)" }}>
        <div className="ml-auto w-full max-w-[360px]">
          <h2 className="text-title1 text-ink">오늘의 인기 레시피</h2>
          <p className="mt-1 text-callout text-ink-3">{SUBTITLE}</p>
          <p className="mt-0.5 text-caption text-ink-3">카드를 누르면 가운데에서 레시피로 가져와요</p>
          <div className="mt-6">
            {s.status === "loading" && <Skeleton className="aspect-[9/16] w-full" />}
            {s.status === "error" && <Trouble s={s} />}
            {s.status === "ready" && !first && <p className="text-callout text-ink-3">오늘은 조건에 맞는 영상이 없어요. 내일 다시 볼게요</p>}
            {first && <ul><TrendingCard v={first} size="lg" /></ul>}
          </div>
        </div>
      </aside>
      {(s.status === "loading" || rest.length > 0) && (
        <aside aria-label="인기 레시피 더 보기" className={`${sideClass} right-0`} style={{ ...side, left: "calc(50% + 256px + 16px)" }}>
          <div className="w-full max-w-[440px]">
            <h2 className="text-title2 text-ink">이것도 인기예요{rest.length > 0 && <span className="ml-1.5 text-callout font-medium text-ink-3 tabular-nums">{rest.length}</span>}</h2>
            <ul className="mt-6 grid grid-cols-2 gap-x-4 gap-y-2">
              {s.status === "loading"
                ? Array.from({ length: PICK_COUNT - 1 }, (_, i) => <li key={i}><Skeleton className="aspect-[9/16] w-full" /></li>)
                : rest.slice(0, shown).map((v) => <TrendingCard key={v.id} v={v} size="md" />)}
            </ul>
            {more > 0 && (
              <Button variant="secondary" size="md" block className="mt-4" onClick={() => setShown((x) => x + GRID_STEP)}>
                더 보기 ({more}개 더)
              </Button>
            )}
          </div>
        </aside>
      )}
    </>
  );
}
