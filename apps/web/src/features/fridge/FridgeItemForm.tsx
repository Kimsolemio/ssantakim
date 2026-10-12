import { useState, type FormEvent } from "react";
import { Unit, StorageLocation, FoodCategory, CATEGORY_EMOJI, guessFood, addDays as addDaysTo, localDate } from "@cook/shared";
import type { FridgeInput } from "./useFridge";
import { Sheet } from "../../components/Sheet";

type Props = {
  initial?: Partial<FridgeInput>;
  title: string;
  onSubmit: (v: FridgeInput) => Promise<void>;
  onDelete?: () => Promise<void>;
  /** 다 먹었어요: 냉장고에서 빼고, 원하면 장보기에 담는다 */
  onUsedUp?: (toShopping: boolean) => Promise<void>;
  onClose: () => void;
};

/** 오늘(현지 날짜) + n일. toISOString 은 UTC라 한국 새벽에 하루가 어긋난다 */
function addDays(n: number): string {
  return addDaysTo(localDate(), n);
}

export function FridgeItemForm({ initial, title, onSubmit, onDelete, onUsedUp, onClose }: Props) {
  const [name, setName] = useState(initial?.name ?? "");
  const [qty, setQty] = useState(initial?.qty != null ? String(initial.qty) : "");
  const [unit, setUnit] = useState<Unit>(initial?.unit ?? "개");
  const [location, setLocation] = useState<StorageLocation>(initial?.location ?? "냉장");
  const [expiresAt, setExpiresAt] = useState(initial?.expiresAt ?? "");
  const [memo, setMemo] = useState(initial?.memo ?? "");
  const [category, setCategory] = useState<FoodCategory | "auto">(initial?.category ?? "auto");
  const [busy, setBusy] = useState(false);
  const [rebuy, setRebuy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setErr("재료 이름을 입력하세요"); return; }
    setBusy(true); setErr(null);
    try {
      const n = name.trim();
      const guess = guessFood(n);
      const cat: FoodCategory = category === "auto" ? guess.category : category;
      // 이름·분류가 그대로면 기존 이모지(영수증에서 AI가 고른 것)를 유지한다
      const keepEmoji = initial?.emoji && initial.name === n && (category === "auto" || category === initial.category);
      const emoji = keepEmoji ? initial!.emoji! : guess.category === cat ? guess.emoji : CATEGORY_EMOJI[cat];
      await onSubmit({
        name: n,
        qty: qty.trim() === "" ? null : Number(qty),
        unit, location,
        expiresAt: expiresAt || null,
        // 날짜를 그대로 두면 추정 여부도 그대로, 사람이 고르면 추정이 아니다
        expiresEstimated: (expiresAt || null) === (initial?.expiresAt ?? null) ? (initial?.expiresEstimated ?? false) && !!expiresAt : false,
        memo: memo.trim(),
        category: cat,
        emoji,
        source: initial?.source ?? "manual",
        purchasedAt: initial?.purchasedAt ?? null,
      });
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "저장에 실패했습니다");
    } finally { setBusy(false); }
  };

  const usedUp = async (toShopping: boolean) => {
    if (!onUsedUp) return;
    setBusy(true); setErr(null);
    try { await onUsedUp(toShopping); onClose(); }
    catch (e) { setErr(e instanceof Error ? e.message : "저장에 실패했습니다"); setBusy(false); }
  };

  const field = "w-full rounded-xl border border-orange-200 bg-white px-3 py-3 text-base outline-none focus:border-orange-400";

  return (
    <Sheet title={title} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <input className={field} placeholder="재료 이름 (예: 대파)" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        <div className="flex gap-2">
          <input className={field} type="number" inputMode="decimal" min="0" step="any" placeholder="수량" value={qty} onChange={(e) => setQty(e.target.value)} />
          <select className={field} value={unit} onChange={(e) => setUnit(e.target.value as Unit)}>
            {Unit.options.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {StorageLocation.options.map((loc) => (
            <button type="button" key={loc} onClick={() => setLocation(loc)}
              className={`rounded-xl py-3 font-medium ${location === loc ? "bg-orange-500 text-white" : "bg-white border border-orange-200"}`}>
              {loc}
            </button>
          ))}
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-500">유통기한{initial?.expiresEstimated && expiresAt === (initial.expiresAt ?? "") ? " (보통 보관 기간으로 추정한 날짜예요. 포장에 적힌 날짜로 고쳐 주세요)" : ""}</label>
          <input className={field} type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} aria-label="유통기한" />
          <div className="mt-2 flex gap-2 text-sm">
            {[3, 7, 14, 30].map((n) => (
              <button type="button" key={n} onClick={() => setExpiresAt(addDays(n))} className="rounded-full bg-orange-100 px-3 py-1">+{n}일</button>
            ))}
            <button type="button" onClick={() => setExpiresAt("")} className="rounded-full bg-gray-100 px-3 py-1">없음</button>
          </div>
        </div>
        <select className={field} value={category} onChange={(e) => setCategory(e.target.value as FoodCategory | "auto")} aria-label="분류">
          <option value="auto">분류: 이름으로 자동 ({guessFood(name || " ").category})</option>
          {FoodCategory.options.map((c) => <option key={c} value={c}>{CATEGORY_EMOJI[c]} {c}</option>)}
        </select>
        <input className={field} placeholder="메모 (선택)" value={memo} onChange={(e) => setMemo(e.target.value)} />
        {err && <p className="text-sm text-red-600">{err}</p>}
        <button disabled={busy} className="rounded-xl bg-orange-500 py-3 font-semibold text-white disabled:opacity-50">
          {busy ? "저장 중…" : "저장"}
        </button>
        {onUsedUp && (
          <div className="flex items-center gap-2 rounded-xl bg-white p-2 ring-1 ring-orange-200">
            <button type="button" disabled={busy} onClick={() => usedUp(rebuy)} className="flex-1 rounded-lg bg-orange-100 py-2.5 font-semibold text-orange-900">🍽️ 다 먹었어요</button>
            <label className="flex shrink-0 items-center gap-1.5 pr-1 text-sm text-gray-700"><input type="checkbox" className="h-5 w-5 accent-orange-500" checked={rebuy} onChange={(e) => setRebuy(e.target.checked)} />장보기에 다시 담기</label>
          </div>
        )}
        {onDelete && (
          <button type="button" disabled={busy} onClick={async () => { if (confirm("잘못 넣은 품목인가요? 삭제할까요?")) { setBusy(true); await onDelete(); onClose(); } }}
            className="py-2 text-sm text-gray-500 underline">잘못 넣었어요 · 삭제</button>
        )}
      </form>
    </Sheet>
  );
}
