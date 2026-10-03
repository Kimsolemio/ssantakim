import type { Ingredient, Unit } from "./schemas";

/** 개수 단위는 0.5 단위로, 나머지는 소수 첫째 자리까지 반올림 */
const HALF_STEP_UNITS: ReadonlySet<Unit> = new Set<Unit>(["개", "쪽", "장", "봉", "팩", "캔", "컵", "큰술", "작은술", "줌"]);

export function scaleQty(qty: number | null, unit: Unit, base: number, target: number): number | null {
  if (qty == null) return null;
  if (base <= 0 || target <= 0) return qty;
  const raw = (qty * target) / base;
  if (HALF_STEP_UNITS.has(unit)) return Math.max(0.5, Math.round(raw * 2) / 2);
  if (raw >= 100) return Math.round(raw);
  if (raw >= 10) return Math.round(raw * 2) / 2;
  return Math.round(raw * 10) / 10;
}

export function scaleIngredient(ing: Ingredient, base: number, target: number): Ingredient {
  if (!ing.scalable) return ing;
  return { ...ing, qty: scaleQty(ing.qty, ing.unit, base, target) };
}

export function scaleIngredients(list: Ingredient[], base: number, target: number): Ingredient[] {
  return list.map((i) => scaleIngredient(i, base, target));
}

/** 2 → "2", 1.5 → "1.5", 0.33 → "0.3", null → "" */
export function formatQty(qty: number | null): string {
  if (qty == null) return "";
  if (Number.isInteger(qty)) return String(qty);
  return String(Math.round(qty * 10) / 10);
}

/** "200g", "2개", "1.5큰술", 기타 단위는 수량만 */
export function formatAmount(ing: Pick<Ingredient, "qty" | "unit">): string {
  const q = formatQty(ing.qty);
  if (ing.unit === "기타") return q;
  return q ? `${q}${ing.unit}` : ing.unit;
}
