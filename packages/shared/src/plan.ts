/**
 * 이번 주 식단: 주 계산, 식단 레시피들의 재료 합치기, 냉장고와 대조해 살 것 고르기.
 * 화면과 테스트가 같은 규칙을 쓰도록 공용 패키지에 둔다.
 */
import { addDays } from "./keys";
import { convertQty, isAlwaysAvailable, matchIngredient, roundQty, sameFood, type IngredientMatch, type MatchOptions } from "./matching";
import { scaleIngredients } from "./scale";
import type { FridgeItem, Ingredient, Recipe, ShoppingItem, Unit } from "./schemas";

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
      // 합친 양은 읽기 좋은 단위로: g·ml가 끼면 그쪽, 아니면 큰 단위 (1작은술 + 1컵 → "41작은술"이 되지 않게)
      const unit = pickUnit(hit.ingredient.unit, ing.unit);
      const total = convertQty(a, hit.ingredient.unit, unit)! + convertQty(b, ing.unit, unit)!;
      hit.ingredient = { ...hit.ingredient, qty: roundQty(total, unit), unit };
    }
  }
  return out;
}

const METRIC = new Set<Unit>(["g", "kg", "ml", "L"]);
function pickUnit(a: Unit, b: Unit): Unit {
  if (a === b) return a;
  if (METRIC.has(a) !== METRIC.has(b)) return METRIC.has(a) ? a : b;
  return (convertQty(1, a, b) ?? 0) > 1 ? a : b;
}

type FridgeLike = Pick<FridgeItem, "name" | "key" | "qty" | "unit" | "expiresAt">;
type ShoppingLike = Pick<ShoppingItem, "name" | "key" | "qty" | "unit">;

export type PlanShoppingRow<T extends FridgeLike> = {
  need: PlannedNeed;
  match: IngredientMatch<T>;
  /** 살 양 (모자란 만큼에서 장보기에 이미 있는 만큼을 뺀 것). null 이면 양을 모른다 */
  qty: number | null;
  unit: Unit;
  /** 장보기에 이미 있는 양 (이 줄 단위로 바꾼 것, 산 것 포함). 없거나 바꿀 수 없으면 null */
  listed: number | null;
  /** 장보기로 이미 다 채워졌다 (기본으로 빼 둔다) */
  covered: boolean;
  /** 냉장고에 있지만 양을 비교할 수 없다 (기본으로 빼 두고 "양 확인"으로 알린다) */
  unsure: boolean;
};

/**
 * 합친 재료를 냉장고와 대조해 없거나 모자란 것(과 양을 모르는 것)을 고른다.
 * shopping 을 주면 장보기에 이미 있는 양(산 것 포함)만큼 덜 산다.
 */
export function planShopping<T extends FridgeLike>(needs: PlannedNeed[], fridge: T[], opts: MatchOptions = {}, shopping: ShoppingLike[] = []): PlanShoppingRow<T>[] {
  const rows: PlanShoppingRow<T>[] = [];
  for (const need of needs) {
    const match = matchIngredient(need.ingredient, fridge, opts);
    if (match.status !== "missing" && match.status !== "short" && match.status !== "unknown_amount") continue;
    const unit = need.ingredient.unit;
    const base = match.status === "short" ? match.shortBy : need.ingredient.qty;
    const same = shopping.filter((s) => sameFood(s, need.ingredient));
    let listed: number | null = null;
    let unknownListed = false;
    for (const s of same) {
      const c = s.qty == null || base == null ? null : convertQty(s.qty, s.unit, unit);
      if (c == null) unknownListed = true; else listed = (listed ?? 0) + c;
    }
    let qty = base;
    let covered = false;
    if (same.length > 0) {
      if (base == null) covered = true; // "약간"은 하나만 있으면 된다
      else if (listed != null) {
        qty = roundQty(Math.max(0, base - listed), unit);
        covered = qty <= 0;
      } else if (unknownListed) covered = true; // 양을 비교할 수 없으면 이미 있다고 본다
    }
    rows.push({ need, match, qty, unit, listed: listed == null ? null : roundQty(listed, unit), covered, unsure: match.status === "unknown_amount" });
  }
  return rows;
}
