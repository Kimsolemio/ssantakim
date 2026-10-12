/**
 * 이번 주 식단: 주 계산, 식단 레시피들의 재료 합치기, 냉장고와 대조해 살 것 고르기.
 * 화면과 테스트가 같은 규칙을 쓰도록 공용 패키지에 둔다.
 */
import { addDays } from "./keys";
import { convertQty, isAlwaysAvailable, matchIngredient, roundQty, sameFood, type IngredientMatch, type MatchOptions } from "./matching";
import { scaleIngredients } from "./scale";
import type { FridgeItem, Ingredient, Recipe, Unit } from "./schemas";

/** 그 날짜가 든 주의 월요일 (YYYY-MM-DD) */
export function weekStart(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const w = new Date(y, m - 1, d).getDay(); // 0=일
  return addDays(date, -((w + 6) % 7));
}

/** 월요일부터 7일 */
export function weekDays(start: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export type PlannedNeed = {
  /** 합친 재료 (첫 레시피의 이름·단위 기준) */
  ingredient: Ingredient;
  /** 이 재료가 들어가는 요리 이름 */
  recipes: string[];
};

type PlanRecipe = { recipe: Pick<Recipe, "title" | "ingredients" | "servingsBase">; servings: number };

/**
 * 식단 레시피들을 인분대로 늘리고 같은 재료끼리 더한다.
 * 선택 재료·물 같은 늘 있는 것은 뺀다. 단위를 바꿀 수 없으면 따로 둔다. "약간"(양 없음)은 양이 있는 쪽에 묻힌다.
 */
export function combinePlanIngredients(plans: PlanRecipe[]): PlannedNeed[] {
  const out: PlannedNeed[] = [];
  for (const p of plans) {
    for (const ing of scaleIngredients(p.recipe.ingredients, p.recipe.servingsBase, p.servings)) {
      if (ing.optional || isAlwaysAvailable(ing)) continue;
      const hit = out.find((n) => {
        if (!sameFood(n.ingredient, ing)) return false;
        const a = n.ingredient.qty, b = ing.qty;
        return a == null || b == null || convertQty(b, ing.unit, n.ingredient.unit) != null;
      });
      if (!hit) { out.push({ ingredient: { ...ing }, recipes: [p.recipe.title] }); continue; }
      if (!hit.recipes.includes(p.recipe.title)) hit.recipes.push(p.recipe.title);
      const a = hit.ingredient.qty, b = ing.qty;
      if (b == null) continue;
      if (a == null) { hit.ingredient = { ...hit.ingredient, qty: b, unit: ing.unit }; continue; }
      const c = convertQty(b, ing.unit, hit.ingredient.unit)!;
      hit.ingredient = { ...hit.ingredient, qty: roundQty(a + c, hit.ingredient.unit) };
    }
  }
  return out;
}

type FridgeLike = Pick<FridgeItem, "name" | "key" | "qty" | "unit" | "expiresAt">;

export type PlanShoppingRow<T extends FridgeLike> = {
  need: PlannedNeed;
  match: IngredientMatch<T>;
  /** 살 양 (부족하면 모자란 만큼, 없으면 전부) */
  qty: number | null;
  unit: Unit;
};

/** 합친 재료를 냉장고와 대조해 없거나 모자란 것만 */
export function planShopping<T extends FridgeLike>(needs: PlannedNeed[], fridge: T[], opts: MatchOptions = {}): PlanShoppingRow<T>[] {
  const rows: PlanShoppingRow<T>[] = [];
  for (const need of needs) {
    const match = matchIngredient(need.ingredient, fridge, opts);
    if (match.status !== "missing" && match.status !== "short") continue;
    rows.push({ need, match, qty: match.status === "short" ? match.shortBy : need.ingredient.qty, unit: need.ingredient.unit });
  }
  return rows;
}
