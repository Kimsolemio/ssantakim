import { IngredientGroup, formatAmount, scaleIngredients, type Ingredient, type MatchStatus } from "@cook/shared";

type Props = {
  ingredients: Ingredient[];
  servingsBase: number;
  servings: number;
  highlightKeys?: string[];
  /** 원래 재료 순서와 같은 길이. 냉장고 대조 결과를 줄마다 표시 */
  statuses?: { status: MatchStatus; label: string }[];
  onStatusClick?: (index: number) => void;
};

const STATUS_STYLE: Record<MatchStatus, string> = {
  enough: "bg-emerald-100 text-emerald-800",
  always: "bg-slate-100 text-slate-500",
  unknown_amount: "bg-sky-100 text-sky-800",
  short: "bg-amber-100 text-amber-800",
  missing: "bg-red-100 text-red-700",
};

/** 그룹별로 묶어 인분 스케일링된 재료를 표시 */
export function IngredientList({ ingredients, servingsBase, servings, highlightKeys, statuses, onStatusClick }: Props) {
  const scaled = scaleIngredients(ingredients, servingsBase, servings).map((ing, index) => ({ ing, index }));
  const groups = IngredientGroup.options.filter((g) => scaled.some((x) => x.ing.group === g));
  const hl = new Set(highlightKeys ?? []);
  return (
    <div className="flex flex-col gap-3">
      {groups.map((g) => (
        <div key={g}>
          {groups.length > 1 && <h3 className="mb-1 text-xs font-semibold text-gray-500">{g}</h3>}
          <ul className="overflow-hidden rounded-2xl bg-white divide-y divide-orange-50">
            {scaled.filter((x) => x.ing.group === g).map(({ ing: i, index }) => {
              const st = statuses?.[index];
              return (
                <li key={`${i.key}-${index}`} data-testid="ingredient-row" className={`flex items-center justify-between gap-2 px-4 py-2.5 ${hl.has(i.key) ? "bg-orange-50" : ""}`}>
                  <span className="min-w-0 flex-1">
                    <span className={i.optional ? "text-gray-500" : ""}>{i.name}</span>
                    {i.optional && <span className="ml-1 text-xs text-gray-400">(선택)</span>}
                    {i.note && <span className="ml-1 text-xs text-gray-500">· {i.note}</span>}
                  </span>
                  <span className="shrink-0 font-medium text-gray-700">{formatAmount(i) || "약간"}</span>
                  {st && (
                    <button type="button" onClick={() => onStatusClick?.(index)} data-status={st.status}
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[st.status]}`}>{st.label}</button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
