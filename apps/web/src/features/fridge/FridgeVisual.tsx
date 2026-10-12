import { useEffect, useMemo, useState } from "react";
import { CATEGORY_EMOJI, ZONE_LABEL, daysUntil, formatAmount, fridgeZone, guessFood, type FridgeZone } from "@cook/shared";
import type { FridgeDoc } from "./useFridge";

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

function expiryInfo(expiresAt: string | null) {
  const d = daysUntil(expiresAt);
  if (d === null) return null;
  if (d < 0) return { label: "지남", cls: "bg-gray-500 text-white", d };
  if (d === 0) return { label: "오늘", cls: "bg-red-600 text-white", d };
  if (d <= 3) return { label: `D-${d}`, cls: "bg-red-500 text-white", d };
  if (d <= 7) return { label: `D-${d}`, cls: "bg-amber-400 text-amber-950", d };
  return null;
}

function Tile({ it, isNew, delay, dim, size, onClick }: { it: FridgeDoc; isNew: boolean; delay: number; dim: boolean; size: "md" | "sm"; onClick: () => void }) {
  const { emoji, zone } = itemLook(it);
  const exp = expiryInfo(it.expiresAt);
  const amount = formatAmount({ qty: it.qty, unit: it.unit });
  return (
    <button type="button" onClick={onClick} data-testid="fridge-item" data-zone={zone} data-new={isNew ? "true" : undefined}
      aria-label={`${it.name}${amount ? ` ${amount}` : ""}${exp ? ` ${exp.label}` : ""}`}
      title={`${it.name}${amount ? ` · ${amount}` : ""}${it.expiresAt ? ` · ~${it.expiresAt}` : ""}`}
      className={`relative flex flex-col items-center rounded-xl bg-white/70 shadow-sm ring-1 ring-black/5 transition active:scale-95 ${size === "md" ? "w-[52px] px-0.5 pb-0.5 pt-1" : "w-[38px] px-0.5 pb-0.5 pt-0.5"} ${dim ? "opacity-25" : ""} ${isNew ? "item-new" : ""}`}
      style={isNew ? ({ "--delay": `${delay}ms` } as React.CSSProperties) : undefined}>
      <span className={`${size === "md" ? "text-[26px]" : "text-[19px]"} leading-none drop-shadow-sm`} aria-hidden>{emoji}</span>
      <span className={`mt-0.5 w-full truncate text-center ${size === "md" ? "text-[10px]" : "text-[8.5px]"} font-medium leading-tight text-slate-700`}>{it.name}</span>
      {exp && <span className={`absolute -right-1 -top-1.5 rounded-full px-1 text-[8.5px] font-bold leading-[14px] ${exp.cls}`}>{exp.label}</span>}
      {isNew && <span className="absolute -left-1 -top-1.5 rounded-full bg-orange-500 px-1 text-[8px] font-bold leading-[14px] text-white">NEW</span>}
    </button>
  );
}

function Shelf({ zone, items, ctx, glass = true, emptyLabel = true, className = "" }: { zone: FridgeZone; items: FridgeDoc[]; ctx: TileCtx; glass?: boolean; emptyLabel?: boolean; className?: string }) {
  return (
    <div data-testid={`zone-${zone}`} className={`relative ${className}`}>
      <div className="flex min-h-[64px] flex-wrap content-end items-end gap-1.5 px-2 pb-1 pt-3">
        {items.map((it) => <Tile key={it.id} it={it} size="md" {...ctx.props(it)} />)}
      </div>
      {items.length === 0 && emptyLabel && <span className="pointer-events-none absolute left-2 top-1 text-[9px] font-medium text-slate-400/80">{ZONE_LABEL[zone]}</span>}
      {glass && <div className="mx-1 h-[5px] rounded-full bg-gradient-to-b from-white/90 to-sky-100/70 shadow-[0_2px_3px_rgba(15,23,42,.18)]" />}
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
      <div className="fridge relative w-full max-w-[400px]" data-open={open ? "true" : "false"} data-testid="fridge">
        {/* 몸체 */}
        <div className="rounded-[26px] bg-gradient-to-br from-slate-200 via-slate-100 to-slate-300 p-[7px] shadow-[0_18px_30px_-12px_rgba(15,23,42,.45),inset_0_1px_0_rgba(255,255,255,.9)]">
          {/* 냉동실 */}
          <section className="fridge-section relative">
            <div className="relative mr-[92px] overflow-hidden rounded-t-[20px] rounded-b-md bg-gradient-to-b from-sky-100 via-sky-50 to-white shadow-[inset_0_4px_12px_rgba(14,116,144,.18)]">
              <div className="fridge-light pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(255,255,255,.95),transparent_65%)]" />
              <div className="pointer-events-none absolute right-2 top-1.5 text-[9px] font-semibold tracking-wide text-sky-700/60">❄ 냉동실 {byZone.freezer.length}</div>
              <Shelf zone="freezer" items={byZone.freezer} ctx={ctx} glass={false} emptyLabel={false} className="min-h-[96px]" />
              <div className="mx-2 mb-2 h-2 rounded-full bg-sky-200/70" />
            </div>
            {/* 냉동실 문 안쪽 (얼음 칸) */}
            <div className="fridge-door-inner absolute right-0 top-0 flex h-full w-[86px] flex-col justify-end gap-1 rounded-r-[20px] rounded-l-md bg-gradient-to-b from-slate-100 to-slate-200 p-1.5 shadow-inner">
              <div className="grid grid-cols-3 gap-0.5 rounded-md bg-sky-100/80 p-1">{Array.from({ length: 6 }).map((_, i) => <span key={i} className="h-2.5 rounded-sm bg-white/90 shadow-inner" />)}</div>
              <span className="text-center text-[8px] text-slate-400">얼음</span>
            </div>
            {/* 냉동실 문 (닫힘) */}
            <button type="button" onClick={() => setOpen(true)} aria-label="냉동실 문 열기" tabIndex={open ? -1 : 0}
              className="fridge-door absolute inset-0 z-10 rounded-t-[20px] rounded-b-md bg-gradient-to-br from-slate-50 via-slate-200 to-slate-300 shadow-[inset_0_1px_0_white,inset_0_-2px_6px_rgba(15,23,42,.15)]">
              <span className="absolute bottom-3 left-4 h-2 w-16 rounded-full bg-gradient-to-b from-slate-300 to-slate-500 shadow" />
            </button>
          </section>

          <div className="h-[7px]" />

          {/* 냉장실 */}
          <section className="fridge-section relative">
            <div className="relative mr-[92px] overflow-hidden rounded-t-md rounded-b-[20px] bg-gradient-to-b from-white via-slate-50 to-sky-50 shadow-[inset_0_4px_14px_rgba(15,23,42,.16)]">
              <div className="fridge-light pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(255,251,235,.95),transparent_60%)]" />
              <div className="pointer-events-none absolute right-2 top-1.5 text-[9px] font-semibold tracking-wide text-slate-500/70">냉장실</div>
              <Shelf zone="top" items={byZone.top} ctx={ctx} />
              <Shelf zone="middle" items={byZone.middle} ctx={ctx} />
              <Shelf zone="bottom" items={byZone.bottom} ctx={ctx} />
              {/* 야채칸 서랍 */}
              <div className="m-1.5 mt-2 rounded-xl border border-white/80 bg-gradient-to-b from-emerald-50/80 to-lime-100/70 shadow-[inset_0_2px_6px_rgba(22,101,52,.12)]">
                <Shelf zone="crisper" items={byZone.crisper} ctx={ctx} glass={false} className="min-h-[70px]" />
                <div className="mx-auto mb-1.5 h-1.5 w-16 rounded-full bg-emerald-200" />
              </div>
            </div>
            {/* 냉장실 문 안쪽 (문 칸) */}
            <div className="fridge-door-inner absolute right-0 top-0 flex h-full w-[86px] flex-col rounded-l-md rounded-r-[20px] bg-gradient-to-b from-slate-100 to-slate-200 p-1 shadow-inner" data-testid="zone-door">
              <div className="flex flex-1 flex-col justify-around">
                {[0, 1, 2].map((row) => {
                  const slice = byZone.door.filter((_, i) => i % 3 === row);
                  return (
                    <div key={row} className="flex min-h-[54px] flex-col justify-end">
                      <div className="flex flex-wrap items-end justify-center gap-1 px-0.5">
                        {slice.map((it) => <Tile key={it.id} it={it} size="sm" {...ctx.props(it)} />)}
                      </div>
                      <div className="mt-0.5 h-3 rounded-b-md border-x border-b border-white/80 bg-white/45 shadow-[inset_0_-2px_3px_rgba(15,23,42,.08)]" />
                    </div>
                  );
                })}
              </div>
              {byZone.door.length === 0 && <span className="pointer-events-none absolute inset-x-0 top-2 text-center text-[8.5px] text-slate-400">문 칸<br />음료·소스</span>}
            </div>
            {/* 냉장실 문 (닫힘) + 자석 메모 */}
            <button type="button" onClick={() => setOpen(true)} aria-label="냉장실 문 열기" tabIndex={open ? -1 : 0}
              className="fridge-door absolute inset-0 z-10 rounded-t-md rounded-b-[20px] bg-gradient-to-br from-slate-50 via-slate-200 to-slate-300 text-left shadow-[inset_0_1px_0_white,inset_0_-2px_6px_rgba(15,23,42,.15)]">
              <span className="absolute left-4 top-4 h-24 w-2 rounded-full bg-gradient-to-r from-slate-300 to-slate-500 shadow" />
              <div className="absolute right-5 top-6 flex w-36 flex-col gap-2">
                {soon.slice(0, 3).map((it, i) => (
                  <span key={it.id} className={`rounded-sm bg-yellow-100 px-2 py-1.5 text-xs font-medium text-yellow-900 shadow ${i % 2 ? "rotate-2" : "-rotate-2"}`}>
                    📌 {it.name} {expiryInfo(it.expiresAt)?.label ?? ""}
                  </span>
                ))}
                <span className="rounded-sm bg-white/80 px-2 py-1.5 text-xs text-slate-600 shadow">🧊 {fridgeCount}개 보관 중</span>
              </div>
              <span className="absolute inset-x-0 bottom-6 text-center text-xs text-slate-500">눌러서 문 열기</span>
            </button>
          </section>
        </div>
        {/* 발 */}
        <div className="flex justify-between px-6"><span className="h-2 w-6 rounded-b-md bg-slate-400" /><span className="h-2 w-6 rounded-b-md bg-slate-400" /></div>
      </div>

      {/* 실온 보관장 */}
      <div className="w-full max-w-[400px] rounded-2xl bg-gradient-to-b from-amber-100 to-amber-200 p-1.5 shadow-[0_8px_16px_-10px_rgba(120,53,15,.5)]">
        <div className="flex items-center justify-between px-2 pt-1 text-[10px] font-semibold text-amber-900/70"><span>🧺 실온 보관장</span><span>{byZone.pantry.length}개</span></div>
        <div className="rounded-xl bg-amber-50/70">
          <Shelf zone="pantry" items={byZone.pantry} ctx={ctx} emptyLabel={false} className="[&>div:last-child]:from-amber-300 [&>div:last-child]:to-amber-400" />
        </div>
      </div>

      <button type="button" onClick={() => setOpen((o) => !o)} className="text-xs text-gray-500 underline" data-testid="fridge-toggle">
        {open ? "🚪 문 닫기 (임박 메모 보기)" : "🚪 문 열기"}
      </button>
    </div>
  );
}
