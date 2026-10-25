import { useEffect, useMemo, useState } from "react";
import { DoorClosed, DoorOpen, Snowflake } from "lucide-react";
import { CATEGORY_EMOJI, ZONE_LABEL, daysUntil, formatAmount, fridgeZone, guessFood, type FridgeZone } from "@cook/shared";
import type { FridgeDoc } from "./useFridge";
import { Button } from "../../components/ui/Button";

type Props = {
  items: FridgeDoc[];
  /** 방금 넣은 품목 id → 떨어지는 애니메이션 */
  recentIds: Set<string>;
  /** 검색어와 맞지 않는 품목은 흐리게 */
  dimmedIds?: Set<string>;
  onItemClick: (item: FridgeDoc) => void;
  /** 바깥에서 문을 열고 싶을 때 바꾼다 (영수증으로 넣은 직후) */
  openSignal?: number;
};

export function itemLook(it: FridgeDoc) {
  const guess = guessFood(it.name);
  const category = it.category ?? guess.category;
  return { category, emoji: it.emoji || (it.category ? (guess.category === it.category ? guess.emoji : CATEGORY_EMOJI[it.category]) : guess.emoji), zone: fridgeZone(it.location, category) };
}

/** 임박 표시 (D-7 이내만). 추정 기한은 "~"를 붙이고, 읽어 주는 이름에는 "추정"을 붙인다.
 *  tone 은 목록의 Badge 색, cls 는 냉장고 타일 배지 색 */
export function expiryInfo(expiresAt: string | null, estimated?: boolean) {
  const d = daysUntil(expiresAt);
  if (d === null) return null;
  const mark = estimated ? "~" : "";
  const say = estimated ? " 추정" : "";
  const danger = "bg-danger text-on-accent";
  if (d < 0) return { label: `${mark}지남`, spoken: `지남${say}`, cls: "bg-ink-3 text-surface", tone: "neutral" as const, d };
  if (d === 0) return { label: `${mark}오늘`, spoken: `오늘까지${say}`, cls: danger, tone: "danger" as const, d };
  if (d <= 3) return { label: `${mark}D-${d}`, spoken: `D-${d}${say}`, cls: danger, tone: "danger" as const, d };
  if (d <= 7) return { label: `${mark}D-${d}`, spoken: `D-${d}${say}`, cls: "bg-warning-soft text-warning ring-1 ring-inset ring-warning/25", tone: "warning" as const, d };
  return null;
}

/* 재질: 매트한 따뜻한 스테인리스 + 따뜻한 LED + 투명 유리 선반 + 하얀 도자기 타일 (명세 5.6.1) */
const GLASS = "mx-1 h-1.5 rounded-full bg-[linear-gradient(180deg,rgba(255,255,255,.95),rgba(225,228,226,.9))] shadow-[0_1px_0_rgba(28,26,23,.10),0_6px_10px_-6px_rgba(28,26,23,.25)]";
const PANTRY_SHELF = "mx-1 h-1.5 rounded-full bg-[linear-gradient(180deg,#E3D6C3,#CDBDA6)] shadow-[0_1px_0_rgba(28,26,23,.10),0_6px_10px_-6px_rgba(80,55,20,.30)]";
const DOOR = "fridge-door absolute inset-0 z-10 bg-[linear-gradient(135deg,#F6F5F2_0%,#E7E6E2_40%,#D9D8D3_100%)] shadow-[inset_0_1px_0_#fff,inset_0_-3px_8px_rgba(28,26,23,.10)]";
const HANDLE = "absolute rounded-full bg-[linear-gradient(180deg,#D6D4CF,#A9A6A0)] shadow-[0_1px_2px_rgba(28,26,23,.25)]";
const DOOR_INSIDE = "fridge-door-inner absolute right-0 top-0 flex h-full w-[86px] flex-col bg-[linear-gradient(180deg,#EEEDEA,#E2E1DD)] shadow-[inset_0_2px_6px_rgba(28,26,23,.08)]";
const ROOM_SHADOW = "shadow-[inset_0_6px_16px_rgba(28,26,23,.10),inset_0_0_0_1px_rgba(28,26,23,.04)]";
const MAGNET = "relative rounded-[4px] px-2.5 py-2 text-caption shadow-[0_1px_2px_rgba(28,26,23,.12),0_4px_8px_-4px_rgba(28,26,23,.18)]";

/** 문을 열면 켜지는 조명 + 윗면 LED 줄 */
function Light() {
  return (
    <div aria-hidden className="fridge-light pointer-events-none absolute inset-0 bg-[radial-gradient(90%_55%_at_50%_0%,rgba(255,250,235,.9),rgba(255,250,235,0)_70%)]">
      <div className="mx-8 mt-1 h-0.5 rounded-full bg-[#FFF8E6] shadow-[0_0_12px_2px_rgba(255,236,190,.8)]" />
    </div>
  );
}

/** 스테인리스 헤어라인 결 */
function Grain() {
  return <span aria-hidden className="pointer-events-none absolute inset-0 rounded-[inherit] bg-[repeating-linear-gradient(90deg,rgba(255,255,255,.035)_0_1px,transparent_1px_3px)]" />;
}

function Magnet({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`${MAGNET} ${className}`}>
      <span aria-hidden className="absolute -top-1 left-1/2 size-2.5 -translate-x-1/2 rounded-full bg-accent shadow-[0_1px_1px_rgba(0,0,0,.3)]" />
      {children}
    </span>
  );
}

function Tile({ it, isNew, delay, dim, size, onClick }: { it: FridgeDoc; isNew: boolean; delay: number; dim: boolean; size: "md" | "sm"; onClick: () => void }) {
  const { emoji, zone } = itemLook(it);
  const exp = expiryInfo(it.expiresAt, it.expiresEstimated);
  const amount = formatAmount({ qty: it.qty, unit: it.unit });
  const md = size === "md";
  const fade = dim ? "opacity-25 saturate-0" : exp && exp.d < 0 ? "opacity-60" : "";
  return (
    <button type="button" onClick={onClick} data-testid="fridge-item" data-zone={zone} data-new={isNew ? "true" : undefined}
      aria-label={`${it.name}${amount ? ` ${amount}` : ""}${exp ? ` ${exp.spoken}` : ""}`}
      title={`${it.name}${amount ? ` · ${amount}` : ""}${it.expiresAt ? ` · ${it.expiresEstimated ? "약 " : ""}${it.expiresAt}까지` : ""}`}
      className={`relative flex flex-col items-center rounded-[12px] bg-surface/90 px-0.5 ring-1 ring-black/[.04] shadow-[0_1px_2px_rgba(28,26,23,.10)] transition active:scale-95 ${md ? "w-[58px] pb-1 pt-1.5" : "w-[46px] pb-1 pt-1"} ${fade} ${isNew ? "item-new" : ""}`}
      style={isNew ? ({ "--delay": `${delay}ms` } as React.CSSProperties) : undefined}>
      <span aria-hidden className={`food-emoji ${md ? "text-[26px]" : "text-[20px]"}`}>{emoji}</span>
      <span className={`mt-1 w-full truncate text-center text-ink ${md ? "text-micro" : "text-[11px] font-semibold leading-[14px]"}`}>{it.name}</span>
      {/* 얼마 남았는지 한눈에 (문 칸 작은 타일은 이름에 쓰인 aria-label 로만) */}
      {md && amount && <span className="w-full truncate text-center text-[11px] leading-[14px] text-ink-3 tabular-nums">{amount}</span>}
      {exp && <span aria-hidden className={`absolute -right-1 -top-1.5 h-[18px] rounded-full px-1.5 text-[11px] font-bold leading-[18px] tabular-nums ${exp.cls}`}>{exp.label}</span>}
    </button>
  );
}

function Shelf({ zone, items, ctx, glass = true, emptyLabel = true, className = "", shelfClass = GLASS }: { zone: FridgeZone; items: FridgeDoc[]; ctx: TileCtx; glass?: boolean; emptyLabel?: boolean; className?: string; shelfClass?: string }) {
  return (
    <div data-testid={`zone-${zone}`} className={`relative ${className}`}>
      <div className="flex min-h-[64px] flex-wrap content-end items-end gap-1.5 px-2 pb-1 pt-3">
        {items.map((it) => <Tile key={it.id} it={it} size="md" {...ctx.props(it)} />)}
      </div>
      {items.length === 0 && emptyLabel && <span className="pointer-events-none absolute left-2 top-1 text-[11px] font-medium text-ink-3/80">{ZONE_LABEL[zone]}</span>}
      {glass && <div className={shelfClass} />}
    </div>
  );
}

type TileCtx = { props: (it: FridgeDoc) => { isNew: boolean; delay: number; dim: boolean; onClick: () => void } };

export function FridgeVisual({ items, recentIds, dimmedIds, onItemClick, openSignal = 0 }: Props) {
  const [open, setOpen] = useState(false);

  // 화면에 들어오면 문이 열린다. 영수증으로 넣은 직후에도 다시 연다.
  useEffect(() => {
    if (openSignal > 0) setOpen(false); // 넣을 때는 문을 한 번 닫았다가 연다
    const t = setTimeout(() => setOpen(true), openSignal > 0 ? 600 : 250);
    return () => clearTimeout(t);
  }, [openSignal]);

  const byZone = useMemo(() => {
    const z: Record<FridgeZone, FridgeDoc[]> = { freezer: [], top: [], middle: [], bottom: [], crisper: [], door: [], pantry: [] };
    for (const it of items) z[itemLook(it).zone].push(it);
    for (const k of Object.keys(z) as FridgeZone[]) z[k].sort((a, b) => (daysUntil(a.expiresAt) ?? 9999) - (daysUntil(b.expiresAt) ?? 9999));
    return z;
  }, [items]);

  // 새 품목이 위에서부터 차례로 떨어지도록 순서대로 지연을 준다
  const order = useMemo(() => {
    const m = new Map<string, number>();
    let i = 0;
    for (const k of ["freezer", "top", "middle", "bottom", "crisper", "door", "pantry"] as FridgeZone[]) for (const it of byZone[k]) if (recentIds.has(it.id)) m.set(it.id, i++);
    return m;
  }, [byZone, recentIds]);

  const ctx: TileCtx = {
    props: (it) => ({ isNew: recentIds.has(it.id), delay: 700 + (order.get(it.id) ?? 0) * 140, dim: dimmedIds?.has(it.id) ?? false, onClick: () => onItemClick(it) }),
  };

  const soon = items.filter((it) => { const d = daysUntil(it.expiresAt); return d !== null && d <= 3; })
    .sort((a, b) => (daysUntil(a.expiresAt) ?? 0) - (daysUntil(b.expiresAt) ?? 0));
  const fridgeCount = items.length - byZone.pantry.length;

  return (
    // 열린 문이 회전하며 화면 밖으로 나가 가로 스크롤이 생기지 않도록 잘라낸다
    <div className="-mx-1 flex flex-col items-center gap-3 overflow-hidden px-1 pb-1 pt-2">
      <div className="fridge theme-light relative w-full max-w-[400px] text-ink" data-open={open ? "true" : "false"} data-testid="fridge">
        {/* 몸체 */}
        <div className="rounded-[28px] bg-[linear-gradient(160deg,#F2F1EE_0%,#E4E3DF_55%,#D7D6D1_100%)] p-2 shadow-[inset_0_1px_0_rgba(255,255,255,.8),inset_0_-1px_0_rgba(28,26,23,.06),0_28px_40px_-28px_rgba(28,26,23,.45)]">
          {/* 냉동실 */}
          <section className="fridge-section relative">
            <div className={`relative mr-[92px] overflow-hidden rounded-b-md rounded-t-[20px] bg-[linear-gradient(180deg,#F5F8FA,#E9EEF1)] ${ROOM_SHADOW}`}>
              <Light />
              <div className="pointer-events-none absolute right-2 top-2 flex items-center gap-1 text-[11px] font-semibold text-ink-3">
                <Snowflake size={12} aria-hidden />냉동실 <span className="tabular-nums">{byZone.freezer.length}</span>
              </div>
              <Shelf zone="freezer" items={byZone.freezer} ctx={ctx} glass={false} emptyLabel={false} className="min-h-[96px]" />
              <div className="mx-2 mb-2 h-1.5 rounded-full bg-[linear-gradient(180deg,rgba(255,255,255,.9),rgba(214,222,228,.9))] shadow-[0_1px_0_rgba(28,26,23,.08)]" />
            </div>
            {/* 냉동실 문 안쪽 (얼음 칸) */}
            <div className={`${DOOR_INSIDE} justify-end gap-1 rounded-l-md rounded-r-[20px] p-1.5`}>
              <div className="grid grid-cols-3 gap-0.5 rounded-md bg-[#E3E9EC] p-1">
                {Array.from({ length: 6 }).map((_, i) => <span key={i} className="h-2.5 rounded-sm bg-[rgba(255,255,255,.9)] shadow-[inset_0_-1px_1px_rgba(28,26,23,.06)]" />)}
              </div>
              <span className="text-center text-[11px] leading-[14px] text-ink-3/80">얼음</span>
            </div>
            {/* 냉동실 문 (닫힘) */}
            <button type="button" onClick={() => setOpen(true)} aria-label="냉동실 문 열기" tabIndex={open ? -1 : 0}
              className={`${DOOR} rounded-b-md rounded-t-[20px]`}>
              <Grain />
              <span className={`${HANDLE} bottom-3 left-4 h-1.5 w-16`} />
            </button>
          </section>

          <div className="h-2" />

          {/* 냉장실 */}
          <section className="fridge-section relative">
            <div className={`relative mr-[92px] overflow-hidden rounded-b-[20px] rounded-t-md bg-[linear-gradient(180deg,#FDFDFB_0%,#F4F5F3_60%,#ECEEEC_100%)] ${ROOM_SHADOW}`}>
              <Light />
              <div className="pointer-events-none absolute right-2 top-2 text-[11px] font-semibold text-ink-3">냉장실</div>
              <Shelf zone="top" items={byZone.top} ctx={ctx} />
              <Shelf zone="middle" items={byZone.middle} ctx={ctx} />
              <Shelf zone="bottom" items={byZone.bottom} ctx={ctx} />
              {/* 야채칸 서랍 */}
              <div className="m-1.5 mt-2 rounded-[14px] border border-[rgba(255,255,255,.9)] bg-[linear-gradient(180deg,rgba(240,244,239,.85),rgba(228,235,226,.9))] shadow-[inset_0_2px_6px_rgba(28,26,23,.08)]">
                <Shelf zone="crisper" items={byZone.crisper} ctx={ctx} glass={false} className="min-h-[70px]" />
                <div className="mx-auto mb-1.5 h-1.5 w-14 rounded-full bg-[#CBD5C8]" />
              </div>
            </div>
            {/* 냉장실 문 안쪽 (문 칸) */}
            <div className={`${DOOR_INSIDE} rounded-l-md rounded-r-[20px] p-1`} data-testid="zone-door">
              <div className="flex flex-1 flex-col justify-around">
                {[0, 1, 2].map((row) => {
                  const slice = byZone.door.filter((_, i) => i % 3 === row);
                  return (
                    <div key={row} className="flex min-h-[54px] flex-col justify-end">
                      <div className="flex flex-wrap items-end justify-center gap-1 px-0.5">
                        {slice.map((it) => <Tile key={it.id} it={it} size="sm" {...ctx.props(it)} />)}
                      </div>
                      <div className="mt-0.5 h-3 rounded-b-md border-x border-b border-[rgba(255,255,255,.8)] bg-[rgba(255,255,255,.5)] shadow-[inset_0_-2px_3px_rgba(28,26,23,.06)]" />
                    </div>
                  );
                })}
              </div>
              {byZone.door.length === 0 && <span className="pointer-events-none absolute inset-x-0 top-2 text-center text-[11px] leading-[14px] text-ink-3/80">문 칸<br />음료·소스</span>}
            </div>
            {/* 냉장실 문 (닫힘) + 자석 메모 */}
            <button type="button" onClick={() => setOpen(true)} aria-label="냉장실 문 열기" tabIndex={open ? -1 : 0}
              className={`${DOOR} rounded-b-[20px] rounded-t-md text-left`}>
              <Grain />
              <span className={`${HANDLE} left-4 top-4 h-24 w-1.5`} />
              <div className="absolute right-5 top-6 flex w-36 flex-col gap-2.5">
                {soon.slice(0, 3).map((it, i) => (
                  <Magnet key={it.id} className={`bg-[#FFFDF6] font-medium text-ink ring-1 ring-[#EFE8D6] ${i % 2 ? "rotate-1" : "-rotate-[1.5deg]"}`}>
                    {it.name}{" "}<span className="font-semibold text-danger tabular-nums">{expiryInfo(it.expiresAt, it.expiresEstimated)?.label ?? ""}</span>
                  </Magnet>
                ))}
                {fridgeCount > 0 && <Magnet className="bg-surface text-ink-2 ring-1 ring-line"><span className="tabular-nums">{fridgeCount}</span>개 보관 중</Magnet>}
              </div>
              <span className="absolute inset-x-0 bottom-6 text-center text-caption text-ink-3">눌러서 문 열기</span>
            </button>
          </section>
        </div>
        {/* 발 */}
        <div className="flex justify-between px-6"><span className="h-2 w-6 rounded-b-md bg-[#BDBAB4]" /><span className="h-2 w-6 rounded-b-md bg-[#BDBAB4]" /></div>
      </div>

      {/* 실온 보관장 (냉장고처럼 다크 모드에서도 밝은 색 토큰을 쓴다) */}
      <div className="pantry theme-light w-full max-w-[400px] rounded-[20px] bg-[linear-gradient(180deg,#EFE8DD,#E6DCCD)] p-1.5 shadow-[0_10px_20px_-14px_rgba(80,55,20,.45)]">
        <p className="px-2 pb-1 text-micro text-ink-2">실온 <span className="tabular-nums">{byZone.pantry.length}</span></p>
        <div className="rounded-[14px] bg-[#F7F2EA]">
          <Shelf zone="pantry" items={byZone.pantry} ctx={ctx} emptyLabel={false} shelfClass={PANTRY_SHELF} />
        </div>
      </div>

      <Button variant="ghost" size="md" data-testid="fridge-toggle" onClick={() => setOpen((o) => !o)}
        icon={open ? <DoorClosed size={20} aria-hidden /> : <DoorOpen size={20} aria-hidden />}>
        {open ? "문 닫기" : "문 열기"}
      </Button>
    </div>
  );
}
