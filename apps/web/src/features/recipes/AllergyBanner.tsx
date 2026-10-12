import { findAllergens, findDislikes, type FamilyProfile } from "@cook/shared";

/** 가족 알레르기·싫어하는 재료가 레시피에 들어 있으면 위에 크게 알린다 */
export function AllergyBanner({ ingredients, profile }: { ingredients: { name: string }[]; profile: FamilyProfile | null | undefined }) {
  if (!profile) return null;
  const allergy = findAllergens(ingredients, profile.allergies);
  const dislike = findDislikes(ingredients, profile.dislikes);
  if (allergy.length === 0 && dislike.length === 0) return null;
  const group = (hits: { allergy: string; ingredient: string }[]) => {
    const m = new Map<string, Set<string>>();
    for (const h of hits) m.set(h.allergy, (m.get(h.allergy) ?? new Set()).add(h.ingredient));
    return [...m].map(([a, ings]) => `${a}(${[...ings].join(", ")})`).join(" · ");
  };
  return (
    <div role="alert" data-testid="allergy-banner" className={`rounded-2xl p-3 text-sm ${allergy.length ? "bg-red-50 text-red-800 ring-1 ring-red-200" : "bg-amber-50 text-amber-900"}`}>
      {allergy.length > 0 && (
        <>
          <p className="font-bold">⚠️ 가족 알레르기 재료가 있어요: {group(allergy)}</p>
          <p className="mt-0.5 text-xs">재료 이름으로만 확인했어요. 간장·고추장·굴소스 같은 시판 양념은 포장의 알레르기 표시를 꼭 확인하세요.</p>
        </>
      )}
      {dislike.length > 0 && <p className={allergy.length ? "mt-1 text-xs" : ""}>🙅 싫어하는 재료: {group(dislike)}</p>}
    </div>
  );
}
