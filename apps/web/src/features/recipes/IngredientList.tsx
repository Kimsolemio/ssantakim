import { IngredientGroup, formatAmount, scaleIngredients, type Ingredient } from "@cook/shared";

type Props = { ingredients: Ingredient[]; servingsBase: number; servings: number; highlightKeys?: string[] };

/** 그룹별로 묶어 인분 스케일링된 재료를 표시 */
export function IngredientList({ ingredients, servingsBase, servings, highlightKeys }: Props) {
  const scaled = scaleIngredients(ingredients, servingsBase, servings);
  const groups = IngredientGroup.options.filter((g) => scaled.some((i) => i.group === g));
  const hl = new Set(highlightKeys ?? []);
  return (
    <div className="flex flex-col gap-3">
      {groups.map((g) => (
        <div key={g}>
          {groups.length > 1 && <h3 className="mb-1 text-xs font-semibold text-gray-500">{g}</h3>}
          <ul className="overflow-hidden rounded-2xl bg-white divide-y divide-orange-50">
            {scaled.filter((i) => i.group === g).map((i, idx) => (
              <li key={`${i.key}-${idx}`} className={`flex items-baseline justify-between gap-3 px-4 py-2.5 ${hl.has(i.key) ? "bg-orange-50" : ""}`}>
                <span className="min-w-0">
                  <span className={i.optional ? "text-gray-500" : ""}>{i.name}</span>
                  {i.optional && <span className="ml-1 text-xs text-gray-400">(선택)</span>}
                  {i.note && <span className="ml-1 text-xs text-gray-500">· {i.note}</span>}
                </span>
                <span className="shrink-0 font-medium text-gray-700">{formatAmount(i) || "약간"}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
