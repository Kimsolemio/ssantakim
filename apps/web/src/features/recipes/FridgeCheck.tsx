import { useMemo, useState, type ReactNode } from "react";
import { LoaderCircle, Refrigerator } from "lucide-react";
import { formatAmount, scaleIngredients, matchIngredients, type IngredientMatch, type MatchStatus, type Recipe, type Unit } from "@cook/shared";
import { Sheet } from "../../components/Sheet";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { FoodThumb } from "../../components/ui/FoodThumb";
import { SearchField, inputBase } from "../../components/ui/Field";
import { Checkbox } from "../../components/ui/Toggle";
import { rowLine } from "../../components/ui/Section";
import type { FridgeDoc } from "../fridge/useFridge";
import { itemLook } from "../fridge/FridgeVisual";

type JosaPair = "이/가" | "을/를" | "은/는" | "으로/로";
/** 받침에 맞는 조사만: particle("마늘", "이/가") → "이" (한글이 아니면 받침 없는 쪽) */
export function particle(word: string, pair: JosaPair): string {
  const ch = word.replace(/\([^)]*\)\s*$/, "").trim().slice(-1);
  const code = ch.charCodeAt(0) - 0xac00;
  const jong = code >= 0 && code < 11172 ? code % 28 : 0;
  const [a, b] = pair.split("/");
  if (pair === "으로/로") return jong === 0 || jong === 8 ? b : a;
  return jong ? a : b;
}
/** josa("마늘", "을/를") → "마늘을" */
export const josa = (word: string, pair: JosaPair) => `${word}${particle(word, pair)}`;

export function statusLabel(m: IngredientMatch<FridgeDoc>): string {
  const u = m.ingredient.unit;
  switch (m.status) {
    case "enough": return "있음";
    case "always": return "물";
    case "staple": return "늘 있음";
    case "unknown_amount": return "있음·양 확인";
    case "short": return `${formatAmount({ qty: m.shortBy, unit: u })} 부족`;
    case "missing": return m.similar.length ? "없음·비슷한 것?" : "없음";
  }
}

/** 현재 인분 기준으로 재료를 냉장고와 대조 (늘 있는 양념은 가족 설정에서) */
export function useRecipeMatches(recipe: Recipe, servings: number, fridge: FridgeDoc[], staples: readonly string[] | undefined) {
  return useMemo(() => matchIngredients(scaleIngredients(recipe.ingredients, recipe.servingsBase, servings), fridge, { staples }),
    [recipe, servings, fridge, staples]);
}

const lacking = (m: IngredientMatch<FridgeDoc>) => m.status === "missing" || m.status === "short";

/** 냉장고 대조 블록. 이 블록에는 주 버튼을 두지 않는다 (상세의 주 버튼은 "요리 시작") */
export function FridgeSummary({ matches, onAddToShopping, onSubstitute }: {
  matches: IngredientMatch<FridgeDoc>[]; onAddToShopping: () => void;
  /** 없거나 부족한 필수 재료를 냉장고 재료로 대신 찾기 (냉장고가 비어 있으면 넘기지 않는다) */
  onSubstitute?: () => void;
}) {
  const counted = matches.filter((m) => m.status !== "always" && m.status !== "staple");
  const have = counted.filter((m) => m.status === "enough" || m.status === "unknown_amount").length;
  const need = counted.filter((m) => lacking(m) && !m.ingredient.optional).length;
  const anyLacking = matches.some(lacking);
  const sub = onSubstitute && need > 0;
  return (
    <div className="mx-5 rounded-card bg-surface-2 p-4" data-testid="fridge-summary">
      <div className="flex items-center gap-3">
        <Refrigerator size={20} aria-hidden className="shrink-0 text-ink-2" />
        <div className="min-w-0 flex-1">
          <p className="text-callout font-semibold text-ink tabular-nums">냉장고에 {have}/{counted.length}개 있어요</p>
          <p className="text-caption text-ink-3 tabular-nums">{need > 0 ? `필수 재료 ${need}개가 없거나 부족해요` : "필수 재료는 다 있어요"}</p>
        </div>
      </div>
      {anyLacking && (
        <div className={`mt-3 grid gap-2 ${sub ? "grid-cols-2" : "grid-cols-1"}`}>
          <Button variant="secondary" size="md" onClick={onAddToShopping}>장보기에 담기</Button>
          {sub && <Button variant="secondary" size="md" ai onClick={onSubstitute}>대체 재료 찾기</Button>}
        </div>
      )}
    </div>
  );
}

/** 냉장고 확인 중 (대조 블록 자리) */
export function FridgeSummaryLoading() {
  return (
    <div className="mx-5 flex items-center gap-3 rounded-card bg-surface-2 p-4 text-callout text-ink-2" data-testid="fridge-summary-loading">
      <LoaderCircle size={20} aria-hidden className="shrink-0 animate-spin" />냉장고 확인 중…
    </div>
  );
}

type Pick = { checked: boolean; qty: number | null };

/** 없는·부족한 재료를 골라 장보기에 담는다 */
export function AddToShoppingSheet({ matches, onClose, onConfirm }: {
  matches: IngredientMatch<FridgeDoc>[];
  recipeTitle: string;
  onClose: () => void;
  onConfirm: (items: { name: string; key: string; qty: number | null; unit: Unit }[]) => Promise<void>;
}) {
  // 열려 있는 동안 냉장고가 바뀌어도 줄이 바뀌지 않게 처음 목록을 고정한다
  const [rows] = useState(() => matches.filter(lacking));
  const [picks, setPicks] = useState<Pick[]>(() => rows.map((m) => ({
    checked: !m.ingredient.optional,
    qty: m.status === "short" ? m.shortBy : m.ingredient.qty,
  })));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const chosen = rows.map((m, i) => ({ m, p: picks[i] })).filter((x) => x.p.checked);
  const set = (i: number, patch: Partial<Pick>) => setPicks((p) => p.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  return (
    <Sheet title="장보기에 담기" onClose={onClose} flush
      footer={<>
        {err && <p className="mb-2 text-caption text-danger">{err}</p>}
        <Button block disabled={chosen.length === 0} loading={busy}
          onClick={async () => {
            setBusy(true); setErr(null);
            try {
              await onConfirm(chosen.map(({ m, p }) => ({ name: m.ingredient.name, key: m.ingredient.key, qty: p.qty, unit: m.ingredient.unit })));
              onClose();
            } catch (e) { setErr(e instanceof Error ? e.message : "담지 못했어요"); setBusy(false); }
          }}>{chosen.length}개 담기</Button>
      </>}>
      <p className="px-5 pb-2 text-caption text-ink-3">없거나 부족한 재료예요</p>
      <ul>
        {rows.map((m, i) => (
          <li key={`${m.ingredient.key}-${i}`} className={`${rowLine} before:left-[68px] flex min-h-14 items-center gap-3 py-1.5 pl-3 pr-5`}>
            <label className="grid size-11 shrink-0 place-items-center">
              <Checkbox aria-label={`${m.ingredient.name} 담기`} checked={picks[i].checked} onChange={(e) => set(i, { checked: e.target.checked })} />
            </label>
            <span className={`min-w-0 flex-1 text-body ${picks[i].checked ? "text-ink" : "text-ink-3"}`}>
              {m.ingredient.name}{m.ingredient.optional && <Badge className="ml-1.5 align-[1px]">선택</Badge>}
            </span>
            <input type="number" inputMode="decimal" min={0} step="any" aria-label={`${m.ingredient.name} 수량`} value={picks[i].qty ?? ""}
              onChange={(e) => set(i, { qty: e.target.value === "" ? null : Number(e.target.value) })}
              className={`${inputBase} h-11 w-16 shrink-0 bg-surface-2 px-2 text-center tabular-nums`} />
            <span className="w-8 shrink-0 text-callout text-ink-2">{m.ingredient.unit === "기타" ? "" : m.ingredient.unit}</span>
            <span className={`w-8 shrink-0 text-right text-caption ${m.status === "short" ? "text-warning" : "text-ink-3"}`}>{m.status === "short" ? "부족" : "없음"}</span>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

/** 재료 시트: 없다고 나온 재료를 냉장고 품목과 직접 연결 (이름이 너무 달라 못 찾은 경우). 없을 때는 위에 대체 재료 찾기 */
export function LinkSheet({ match, fridge, onClose, onLink, extra }: {
  match: IngredientMatch<FridgeDoc>;
  fridge: FridgeDoc[];
  onClose: () => void;
  onLink: (item: FridgeDoc) => Promise<void>;
  /** 없는 재료일 때 맨 위에 붙이는 것 (AI 대체 재료 찾기) */
  extra?: ReactNode;
}) {
  const [q, setQ] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const status: MatchStatus = match.status;
  const name = match.ingredient.name;
  const similarIds = new Set(match.similar.map((f) => f.id));
  const list = fridge
    .filter((f) => !q.trim() || f.name.includes(q.trim()))
    .sort((a, b) => Number(similarIds.has(b.id)) - Number(similarIds.has(a.id)));
  const title = status === "missing" ? `‘${name}’${particle(name, "이/가")} 없어요`
    : status === "short" ? `‘${name}’${particle(name, "이/가")} 부족해요` : `${name} 연결`;
  const desc = status === "missing" ? "다른 이름으로 들어 있다면 아래에서 골라 주세요"
    : status === "staple" ? "늘 있는 양념이에요. 냉장고 품목과 연결할 수도 있어요"
      : `지금 맞춰진 품목: ${match.items.map((i) => i.name).join(", ")}`;
  return (
    <Sheet title={title} onClose={onClose} flush>
      <div className="px-5">
        <p className="text-callout text-ink-2">{desc}</p>
        {extra && <div className="mt-4">{extra}</div>}
      </div>
      {extra && <h3 className="px-5 pb-3 pt-6 text-headline text-ink">냉장고에서 직접 고르기</h3>}
      <div className={`px-5 ${extra ? "" : "pt-4"}`}>
        <SearchField value={q} onChange={setQ} placeholder="냉장고에서 찾기" label="냉장고에서 찾기" />
      </div>
      {err && <p className="px-5 pt-2 text-caption text-danger">{err}</p>}
      {list.length === 0 ? <p className="px-5 py-8 text-center text-caption text-ink-3">냉장고에 맞는 품목이 없어요</p> : (
        <ul className="pt-2">
          {list.map((f) => (
            <li key={f.id} className={`${rowLine} before:left-[72px]`}>
              <button type="button" onClick={async () => {
                setErr(null);
                try { await onLink(f); onClose(); } catch (e) { setErr(e instanceof Error ? e.message : "연결하지 못했어요"); }
              }} className="flex min-h-14 w-full items-center gap-3 px-5 py-2 text-left transition-colors active:bg-surface-2">
                <FoodThumb emoji={itemLook(f).emoji} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-body text-ink">{f.name}</span>
                    {similarIds.has(f.id) && <Badge>비슷한 이름</Badge>}
                  </span>
                  <span className="mt-0.5 block text-caption text-ink-3 tabular-nums">{[formatAmount({ qty: f.qty, unit: f.unit }), f.location].filter(Boolean).join(" · ")}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}
