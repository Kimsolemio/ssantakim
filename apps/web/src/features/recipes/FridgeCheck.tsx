import { useMemo, useState } from "react";
import { formatAmount, scaleIngredients, matchIngredients, type IngredientMatch, type MatchStatus, type Recipe, type Unit } from "@cook/shared";
import { Sheet } from "../../components/Sheet";
import type { FridgeDoc } from "../fridge/useFridge";
import { itemLook } from "../fridge/FridgeVisual";

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

export function FridgeSummary({ matches, onAddToShopping }: { matches: IngredientMatch<FridgeDoc>[]; onAddToShopping: () => void }) {
  const counted = matches.filter((m) => m.status !== "always" && m.status !== "staple");
  const have = counted.filter((m) => m.status === "enough" || m.status === "unknown_amount").length;
  const staples = matches.filter((m) => m.status === "staple").length;
  const need = counted.filter((m) => (m.status === "missing" || m.status === "short") && !m.ingredient.optional).length;
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-white p-3" data-testid="fridge-summary">
      <span className="text-2xl" aria-hidden>🧊</span>
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-semibold">냉장고에 {have}/{counted.length}개 있어요</p>
        <p className="text-xs text-gray-500">{need > 0 ? `필수 재료 ${need}개가 없거나 부족해요` : "필수 재료는 다 있어요"}{staples > 0 ? ` · 늘 있는 양념 ${staples}개 제외` : ""}</p>
      </div>
      {matches.some((m) => m.status === "missing" || m.status === "short") && (
        <button type="button" onClick={onAddToShopping} className="shrink-0 rounded-xl bg-orange-500 px-3 py-2 text-sm font-semibold text-white">🛒 장보기에 담기</button>
      )}
    </div>
  );
}

type Pick = { checked: boolean; qty: number | null };

/** 없는·부족한 재료를 골라 장보기에 담는다 */
export function AddToShoppingSheet({ matches, recipeTitle, onClose, onConfirm }: {
  matches: IngredientMatch<FridgeDoc>[];
  recipeTitle: string;
  onClose: () => void;
  onConfirm: (items: { name: string; key: string; qty: number | null; unit: Unit }[]) => Promise<void>;
}) {
  // 열려 있는 동안 냉장고가 바뀌어도 줄이 바뀌지 않게 처음 목록을 고정한다
  const [rows] = useState(() => matches.filter((m) => m.status === "missing" || m.status === "short"));
  const [picks, setPicks] = useState<Pick[]>(() => rows.map((m) => ({
    checked: !m.ingredient.optional,
    qty: m.status === "short" ? m.shortBy : m.ingredient.qty,
  })));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const chosen = rows.map((m, i) => ({ m, p: picks[i] })).filter((x) => x.p.checked);

  return (
    <Sheet title="장보기에 담기" onClose={onClose}>
      <div className="flex max-h-[70vh] flex-col gap-2 overflow-y-auto">
        <p className="text-xs text-gray-500">{recipeTitle} 재료 중 냉장고에 없거나 부족한 것이에요. 선택 재료는 기본으로 빠져 있어요.</p>
        <ul className="flex flex-col gap-1.5">
          {rows.map((m, i) => (
            <li key={`${m.ingredient.key}-${i}`} className={`flex items-center gap-2 rounded-xl bg-white px-3 py-2 ${picks[i].checked ? "" : "opacity-50"}`}>
              <input type="checkbox" className="h-5 w-5 accent-orange-500" aria-label={`${m.ingredient.name} 담기`} checked={picks[i].checked}
                onChange={(e) => setPicks((p) => p.map((x, j) => (j === i ? { ...x, checked: e.target.checked } : x)))} />
              <span className="min-w-0 flex-1 truncate">{m.ingredient.name}{m.ingredient.optional && <span className="text-xs text-gray-400"> (선택)</span>}</span>
              <input type="number" inputMode="decimal" min={0} step="any" aria-label={`${m.ingredient.name} 수량`} value={picks[i].qty ?? ""}
                onChange={(e) => setPicks((p) => p.map((x, j) => (j === i ? { ...x, qty: e.target.value === "" ? null : Number(e.target.value) } : x)))}
                className="w-16 rounded-lg border border-orange-200 px-2 py-1 text-sm" />
              <span className="w-10 text-sm text-gray-600">{m.ingredient.unit === "기타" ? "" : m.ingredient.unit}</span>
              <span className={`text-[11px] ${m.status === "short" ? "text-amber-700" : "text-red-600"}`}>{m.status === "short" ? "부족" : "없음"}</span>
            </li>
          ))}
        </ul>
        {err && <p className="text-sm text-red-600">{err}</p>}
        <button disabled={busy || chosen.length === 0} className="rounded-xl bg-orange-500 py-3 font-semibold text-white disabled:opacity-40"
          onClick={async () => {
            setBusy(true); setErr(null);
            try {
              await onConfirm(chosen.map(({ m, p }) => ({ name: m.ingredient.name, key: m.ingredient.key, qty: p.qty, unit: m.ingredient.unit })));
              onClose();
            } catch (e) { setErr(e instanceof Error ? e.message : "담지 못했습니다"); setBusy(false); }
          }}>🛒 {chosen.length}개 담기</button>
      </div>
    </Sheet>
  );
}

/** 없다고 나온 재료를 냉장고 품목과 직접 연결 (이름이 너무 달라 못 찾은 경우) */
export function LinkSheet({ match, fridge, onClose, onLink }: {
  match: IngredientMatch<FridgeDoc>;
  fridge: FridgeDoc[];
  onClose: () => void;
  onLink: (item: FridgeDoc) => Promise<void>;
}) {
  const [q, setQ] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const status: MatchStatus = match.status;
  const similarIds = new Set(match.similar.map((f) => f.id));
  const list = fridge
    .filter((f) => !q.trim() || f.name.includes(q.trim()))
    .sort((a, b) => Number(similarIds.has(b.id)) - Number(similarIds.has(a.id)));
  return (
    <Sheet title={`${match.ingredient.name} 연결`} onClose={onClose}>
      <div className="flex max-h-[70vh] flex-col gap-2">
        {status === "missing" ? (
          <p className="text-sm text-gray-600">냉장고에서 "{match.ingredient.name}"을(를) 못 찾았어요. 같은 재료가 다른 이름으로 들어 있다면 골라 주세요. 고르면 이 레시피에서 그 품목을 "{match.ingredient.name}"(으)로 맞춰 봐요.</p>
        ) : status === "staple" ? (
          <p className="text-sm text-gray-600">"{match.ingredient.name}"은(는) 늘 있는 양념으로 설정돼 있어요 (가족 설정에서 바꿀 수 있어요). 냉장고 품목과 연결하면 그 양으로 맞춰 봐요.</p>
        ) : (
          <p className="text-sm text-gray-600">지금 맞춰진 품목: {match.items.map((i) => i.name).join(", ")}. 다른 품목을 연결할 수도 있어요.</p>
        )}
        <input className="rounded-xl border border-orange-200 bg-white px-3 py-2 text-base" placeholder="냉장고에서 찾기" value={q} onChange={(e) => setQ(e.target.value)} />
        {err && <p className="text-sm text-red-600">{err}</p>}
        <ul className="flex flex-col gap-1 overflow-y-auto">
          {list.length === 0 && <li className="p-3 text-sm text-gray-500">냉장고에 맞는 품목이 없어요.</li>}
          {list.map((f) => (
            <li key={f.id}>
              <button type="button" onClick={async () => {
                setErr(null);
                try { await onLink(f); onClose(); } catch (e) { setErr(e instanceof Error ? e.message : "연결하지 못했어요"); }
              }} className="flex w-full items-center gap-2 rounded-xl bg-white px-3 py-2 text-left">
                <span aria-hidden>{itemLook(f).emoji}</span>
                <span className="flex-1">{f.name}{similarIds.has(f.id) && <span className="ml-1 rounded-full bg-amber-100 px-1.5 text-[11px] text-amber-800">비슷한 이름</span>}</span>
                <span className="text-sm text-gray-500">{formatAmount({ qty: f.qty, unit: f.unit })} · {f.location}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Sheet>
  );
}
