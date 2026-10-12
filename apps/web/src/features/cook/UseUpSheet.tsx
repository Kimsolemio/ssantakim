import { useMemo, useState } from "react";
import { CircleAlert } from "lucide-react";
import { formatAmount, planDeductions, roundQty, type IngredientMatch } from "@cook/shared";
import { Sheet } from "../../components/Sheet";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { FoodThumb } from "../../components/ui/FoodThumb";
import { Checkbox, SwitchRow } from "../../components/ui/Toggle";
import { rowLine } from "../../components/ui/Section";
import type { FridgeDoc, FridgeUpdate } from "../fridge/useFridge";
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
  updates: FridgeUpdate[];
  usedUp: FridgeDoc[];
  addUsedUpToShopping: boolean;
};

/** 요리를 마친 뒤: 쓴 재료를 냉장고에서 뺀다 (유통기한 빠른 것부터) */
export function UseUpSheet({ matches, servings, onClose, onApply, onSkip, recipeTitle }: {
  matches: IngredientMatch<FridgeDoc>[];
  servings: number;
  onClose: () => void;
  onApply: (r: UseUpResult) => Promise<void>;
  onSkip: () => Promise<void>;
  /** 제목 아래 한 줄에 보일 요리 이름 (선택) */
  recipeTitle?: string;
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
  const [busy, setBusy] = useState<null | "apply" | "skip">(null);
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
      else updates.push({ id: r.item.id, use });
    }
    return { updates, usedUp, addUsedUpToShopping: toShopping };
  };
  const preview = result();

  const run = async (kind: "apply" | "skip", fn: () => Promise<void>) => {
    setBusy(kind); setErr(null);
    try { await fn(); onClose(); } catch (e) { setErr(e instanceof Error ? e.message : "저장하지 못했습니다"); setBusy(null); }
  };

  const meta = [recipeTitle, `${servings}인분`].filter(Boolean).join(" · ");
  const footer = (
    <>
      {err && <p role="alert" className="mb-3 flex items-start gap-1.5 text-caption text-danger"><CircleAlert size={14} aria-hidden className="mt-0.5 shrink-0" />{err}</p>}
      <Button block loading={busy === "apply"} disabled={busy !== null} onClick={() => run("apply", () => onApply(result()))}>
        {busy === "apply" ? "저장 중…" : preview.updates.length > 0 ? `${preview.updates.length}개 빼고 기록` : "요리 기록 남기기"}
      </Button>
      {rows.length > 0 && (
        <Button variant="ghost" size="md" block className="mt-1" loading={busy === "skip"} disabled={busy !== null} onClick={() => run("skip", onSkip)}>빼지 않고 기록만</Button>
      )}
    </>
  );

  return (
    <Sheet title="재료 정리" onClose={onClose} footer={footer} flush testId="useup-sheet">
      <p className="px-5 text-caption text-ink-3">{meta}{rows.length > 0 ? " · 쓴 만큼 빼 드릴게요" : ""}</p>
      {rows.length === 0 ? (
        <p className="px-5 pb-2 pt-6 text-callout text-ink-2">냉장고에서 뺄 재료가 없어요. 요리 기록만 남길게요.</p>
      ) : (
        <ul className="mt-2">
          {rows.map((r, i) => {
            const left = r.item.qty != null && r.use != null ? roundQty(r.item.qty - r.use, r.item.unit) : null;
            const have = formatAmount({ qty: r.item.qty, unit: r.item.unit });
            const dim = r.checked ? "" : "opacity-50";
            return (
              <li key={r.item.id} data-testid="useup-row" className={`${rowLine} px-5 py-3 before:left-[108px]`}>
                <div className="flex items-center gap-3">
                  <label className="-m-2.5 grid size-11 shrink-0 place-items-center">
                    <Checkbox aria-label={`${r.item.name} 빼기`} checked={r.checked} onChange={(e) => set(i, { checked: e.target.checked })} />
                  </label>
                  <FoodThumb emoji={itemLook(r.item).emoji} className={dim} />
                  <div className={`min-w-0 flex-1 ${dim}`}>
                    <p className="truncate text-body text-ink">{r.item.name}</p>
                    <p className="truncate text-caption text-ink-3 tabular-nums">{have ? `${have} 있음` : "양 모름"}</p>
                  </div>
                  {r.needsInput && <Badge tone="warning">양 확인</Badge>}
                </div>
                <div className={`mt-2 flex items-center gap-2 pl-[88px] ${dim}`}>
                  {r.item.qty == null ? (
                    <label className="flex min-h-11 items-center gap-3 text-callout text-ink-2">
                      <Checkbox checked={r.usedUp} onChange={(e) => set(i, { usedUp: e.target.checked, checked: true })} />다 썼어요
                    </label>
                  ) : (
                    <>
                      <input type="number" inputMode="decimal" min={0} step="any" aria-label={`${r.item.name} 쓴 양`} value={r.use ?? ""}
                        placeholder={r.needsInput ? "얼마나?" : ""}
                        onChange={(e) => set(i, { use: e.target.value === "" ? null : Number(e.target.value), checked: e.target.value !== "" })}
                        className={`h-11 w-20 shrink-0 rounded-control border bg-surface-2 px-3 text-right text-body text-ink tabular-nums placeholder:text-ink-3 outline-none transition focus:border-accent focus:bg-surface focus:ring-4 focus:ring-accent/15 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none ${r.needsInput && r.use == null ? "border-warning" : "border-transparent"}`} />
                      <span className="shrink-0 text-callout text-ink-2">{r.item.unit === "기타" ? "" : r.item.unit} 사용</span>
                      <span className="ml-auto truncate text-caption text-ink-3 tabular-nums">{left == null ? "" : left <= 0 ? "다 씀" : `남음 ${formatAmount({ qty: left, unit: r.item.unit })}`}</span>
                    </>
                  )}
                </div>
                {r.needsInput && <p className="mt-1.5 pl-[88px] text-caption text-ink-3">단위가 달라요. 쓴 양을 적어 주세요</p>}
              </li>
            );
          })}
        </ul>
      )}
      {preview.usedUp.length > 0 && (
        <div className="mx-5 mt-1 border-t border-line">
          <SwitchRow title={`다 쓴 ${preview.usedUp.length}개 장보기에 담기`} checked={toShopping} onChange={setToShopping} />
        </div>
      )}
    </Sheet>
  );
}
