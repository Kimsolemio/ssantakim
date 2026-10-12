import { useMemo, useState } from "react";
import { formatAmount, planDeductions, roundQty, type IngredientMatch } from "@cook/shared";
import { Sheet } from "../../components/Sheet";
import type { FridgeDoc } from "../fridge/useFridge";
import { itemLook } from "../fridge/FridgeVisual";

type Row = {
  item: FridgeDoc;
  ingredientName: string;
  checked: boolean;
  /** 뺄 양 (품목 단위). 양을 모르는 품목은 쓰지 않는다 */
  use: number | null;
  /** 양을 모르는 품목: 다 썼으면 냉장고에서 뺀다 */
  usedUp: boolean;
  needsInput: boolean;
};

export type UseUpResult = {
  updates: { id: string; qty?: number | null; remove?: boolean }[];
  usedUp: FridgeDoc[];
  addUsedUpToShopping: boolean;
};

/** 요리를 마친 뒤: 쓴 재료를 냉장고에서 뺀다 (유통기한 빠른 것부터) */
export function UseUpSheet({ matches, servings, onClose, onApply, onSkip }: {
  matches: IngredientMatch<FridgeDoc>[];
  servings: number;
  onClose: () => void;
  onApply: (r: UseUpResult) => Promise<void>;
  onSkip: () => Promise<void>;
}) {
  const initial = useMemo<Row[]>(() => {
    const rows: Row[] = [];
    const seen = new Set<string>();
    for (const m of matches) {
      for (const d of planDeductions(m)) {
        if (seen.has(d.item.id)) continue; // 같은 품목이 두 재료에 걸리면 처음 것만
        seen.add(d.item.id);
        if (d.use === 0 && d.item.qty != null) continue; // 뺄 게 없는 품목은 숨긴다
        rows.push({
          item: d.item, ingredientName: m.ingredient.name,
          checked: (d.use ?? 0) > 0, use: d.use, usedUp: false,
          needsInput: d.use == null,
        });
      }
    }
    return rows;
  }, [matches]);
  const [rows, setRows] = useState<Row[]>(initial);
  const [toShopping, setToShopping] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (i: number, patch: Partial<Row>) => setRows((l) => l.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const result = (): UseUpResult => {
    const updates: UseUpResult["updates"] = [];
    const usedUp: FridgeDoc[] = [];
    for (const r of rows) {
      if (!r.checked) continue;
      if (r.item.qty == null) {
        if (r.usedUp) { updates.push({ id: r.item.id, remove: true }); usedUp.push(r.item); }
        continue;
      }
      const use = r.use ?? 0;
      if (use <= 0) continue;
      const left = roundQty(r.item.qty - use, r.item.unit);
      if (left <= 0) { updates.push({ id: r.item.id, remove: true }); usedUp.push(r.item); }
      else updates.push({ id: r.item.id, qty: left });
    }
    return { updates, usedUp, addUsedUpToShopping: toShopping };
  };
  const preview = result();

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setErr(null);
    try { await fn(); onClose(); } catch (e) { setErr(e instanceof Error ? e.message : "저장하지 못했습니다"); setBusy(false); }
  };

  return (
    <Sheet title={`맛있게 드셨나요? (${servings}인분)`} onClose={onClose}>
      <div className="flex max-h-[72vh] flex-col gap-2 overflow-y-auto" data-testid="useup-sheet">
        {rows.length === 0 ? (
          <p className="rounded-xl bg-white p-4 text-sm text-gray-600">냉장고에서 뺄 재료가 없어요. 요리 기록만 남길게요.</p>
        ) : (
          <p className="text-sm text-gray-600">쓴 만큼 냉장고에서 뺄게요. 유통기한이 빠른 것부터 썼다고 계산했어요.</p>
        )}
        <ul className="flex flex-col gap-1.5">
          {rows.map((r, i) => {
            const left = r.item.qty != null && r.use != null ? roundQty(r.item.qty - r.use, r.item.unit) : null;
            return (
              <li key={r.item.id} data-testid="useup-row" className={`rounded-xl bg-white px-3 py-2 ${r.checked ? "" : "opacity-50"}`}>
                <div className="flex items-center gap-2">
                  <input type="checkbox" className="h-5 w-5 accent-orange-500" aria-label={`${r.item.name} 빼기`} checked={r.checked} onChange={(e) => set(i, { checked: e.target.checked })} />
                  <span aria-hidden>{itemLook(r.item).emoji}</span>
                  <span className="min-w-0 flex-1 truncate font-medium">{r.item.name}<span className="ml-1 text-xs font-normal text-gray-500">{formatAmount({ qty: r.item.qty, unit: r.item.unit })} 있음</span></span>
                </div>
                <div className="mt-1.5 flex items-center gap-2 pl-7 text-sm">
                  {r.item.qty == null ? (
                    <label className="flex items-center gap-1.5"><input type="checkbox" checked={r.usedUp} onChange={(e) => set(i, { usedUp: e.target.checked, checked: true })} />다 썼어요</label>
                  ) : (
                    <>
                      <input type="number" inputMode="decimal" min={0} step="any" aria-label={`${r.item.name} 쓴 양`} value={r.use ?? ""}
                        placeholder={r.needsInput ? "얼마나?" : ""}
                        onChange={(e) => set(i, { use: e.target.value === "" ? null : Number(e.target.value), checked: e.target.value !== "" })}
                        className={`w-20 rounded-lg border px-2 py-1 ${r.needsInput && r.use == null ? "border-sky-300 bg-sky-50" : "border-orange-200"}`} />
                      <span className="text-gray-600">{r.item.unit === "기타" ? "" : r.item.unit} 사용</span>
                      <span className="ml-auto text-xs text-gray-500">{left == null ? "" : left <= 0 ? "다 씀 → 냉장고에서 빼기" : `남음 ${formatAmount({ qty: left, unit: r.item.unit })}`}</span>
                    </>
                  )}
                </div>
                {r.needsInput && <p className="mt-1 pl-7 text-[11px] text-sky-700">레시피는 "{r.ingredientName}" 단위가 달라 자동 계산을 못 했어요. 쓴 양을 적어 주세요.</p>}
              </li>
            );
          })}
        </ul>
        {preview.usedUp.length > 0 && (
          <label className="flex items-center gap-2 rounded-xl bg-orange-50 px-3 py-2 text-sm">
            <input type="checkbox" checked={toShopping} onChange={(e) => setToShopping(e.target.checked)} />
            다 쓴 재료 {preview.usedUp.length}개를 장보기에 담기
          </label>
        )}
        {err && <p className="text-sm text-red-600">{err}</p>}
        <button disabled={busy} onClick={() => run(() => onApply(result()))} className="rounded-xl bg-orange-500 py-3 font-semibold text-white disabled:opacity-40">
          {preview.updates.length > 0 ? `🧊 냉장고에서 빼고 기록 (${preview.updates.length}개)` : "요리 기록 남기기"}
        </button>
        {rows.length > 0 && <button disabled={busy} onClick={() => run(onSkip)} className="py-2 text-sm text-gray-500">빼지 않고 기록만</button>}
      </div>
    </Sheet>
  );
}
