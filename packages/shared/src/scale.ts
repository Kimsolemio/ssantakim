import type { Ingredient, Unit } from "./schemas";
import { COUNT_UNITS } from "./matching";

/** 숟가락·컵: 0.5 단위가 기본, 아주 적은 양은 0.25 (1/4작은술)까지 */
const SPOON_UNITS: ReadonlySet<Unit> = new Set<Unit>(["컵", "큰술", "작은술"]);

export function scaleQty(qty: number | null, unit: Unit, base: number, target: number): number | null {
  if (qty == null) return null;
  if (base <= 0 || target <= 0 || base === target) return qty;
  const raw = (qty * target) / base;
  if (SPOON_UNITS.has(unit)) {
    if (raw < 0.5) return Math.max(0.25, Math.round(raw * 4) / 4);
    return Math.round(raw * 2) / 2;
  }
  if (COUNT_UNITS.has(unit)) return Math.max(0.5, Math.round(raw * 2) / 2);
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

/** 2 → "2", 1.5 → "1.5", 0.25 → "1/4", 0.33 → "0.3", null → "" */
export function formatQty(qty: number | null): string {
  if (qty == null) return "";
  if (Number.isInteger(qty)) return String(qty);
  if (qty === 0.25) return "1/4";
  if (qty === 0.75) return "3/4";
  return String(Math.round(qty * 10) / 10);
}

/** "200g", "2개", "1.5큰술", 기타 단위는 수량만 */
export function formatAmount(ing: Pick<Ingredient, "qty" | "unit">): string {
  const q = formatQty(ing.qty);
  // 수량을 모르면 단위만 덩그러니 보이지 않게 아무것도 쓰지 않는다 ("kg", "개" X)
  if (!q || ing.unit === "기타") return q;
  return `${q}${ing.unit}`;
}
