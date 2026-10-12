/**
 * "오늘 뭐 먹지": 저장된 레시피를 지금 냉장고로 얼마나 만들 수 있는지 점수 매긴다 (AI 없이, 바로).
 */
import { daysUntil } from "./keys";
import { matchIngredients, type MatchOptions } from "./matching";
import type { FridgeItem, Recipe } from "./schemas";

type FridgeLike = Pick<FridgeItem, "name" | "key" | "qty" | "unit" | "expiresAt">;

export type RecipeFit<R> = {
  recipe: R;
  /** 꼭 필요한 재료 수 (선택 재료·물·늘 있는 양념 제외) */
  needed: number;
  /** 그중 냉장고에 있는 수 (양이 모자란 것은 빼고, 양을 모르는 것은 있다고 본다) */
  have: number;
  /** have 중 양을 비교하지 못한 것 (단위가 달라 "있음·양 확인") */
  unsure: number;
  /** 없거나 모자란 꼭 필요한 재료 이름 */
  missing: string[];
  /** 이 레시피가 쓰는 임박(3일 이내) 냉장고 품목 이름 */
  expiring: string[];
  score: number;
};

export function rankRecipesByFridge<R extends Pick<Recipe, "ingredients" | "cookedLog">, F extends FridgeLike>(
  recipes: R[], fridge: F[], opts: MatchOptions & { today?: Date; maxMissing?: number } = {},
): RecipeFit<R>[] {
  const today = opts.today ?? new Date();
  const fresh = fridge.filter((f) => { const d = daysUntil(f.expiresAt, today); return d == null || d >= 0; });
  const out: RecipeFit<R>[] = [];
  for (const recipe of recipes) {
    const matches = matchIngredients(recipe.ingredients, fresh, opts);
    let needed = 0, have = 0, unsure = 0;
    const missing: string[] = [];
    const expiring = new Set<string>();
    for (const m of matches) {
      for (const it of m.items) { const d = daysUntil(it.expiresAt, today); if (d != null && d <= 3) expiring.add(it.name); }
      if (m.ingredient.optional || m.status === "always" || m.status === "staple") continue;
      needed++;
      if (m.status === "enough" || m.status === "unknown_amount") {
        have++;
        if (m.status === "unknown_amount") unsure++;
      } else {
        missing.push(m.ingredient.name);
      }
    }
    if (needed === 0 || have === 0) continue;
    if (missing.length > (opts.maxMissing ?? 3)) continue;
    // 최근 이틀 안에 만든 것은 조금 뒤로
    const last = recipe.cookedLog[recipe.cookedLog.length - 1]?.date;
    const recent = last ? (today.getTime() - new Date(last).getTime()) / 86400000 < 2 : false;
    const score = (have / needed) * 100 + expiring.size * 15 - missing.length * 5 - (recent ? 30 : 0);
    out.push({ recipe, needed, have, unsure, missing, expiring: [...expiring], score });
  }
  return out.sort((a, b) => b.score - a.score);
}
