/**
 * 레시피 재료 ↔ 냉장고 품목 대조와, 요리 후 차감량 계산.
 * 화면과 테스트가 같은 규칙을 쓰도록 공용 패키지에 둔다.
 */
import { daysUntil, provisionalKey } from "./keys";
import type { FoodCategory } from "./food";
import type { FridgeItem, Ingredient, StorageLocation, Unit } from "./schemas";

const MASS: Partial<Record<Unit, number>> = { g: 1, kg: 1000 };
const VOLUME: Partial<Record<Unit, number>> = { ml: 1, L: 1000, 큰술: 15, 작은술: 5, 컵: 200 };

/** 같은 종류 단위끼리만 바꾼다 (무게끼리, 부피·숟가락끼리). 못 바꾸면 null */
export function convertQty(qty: number, from: Unit, to: Unit): number | null {
  if (from === to) return qty;
  const m1 = MASS[from], m2 = MASS[to];
  if (m1 && m2) return (qty * m1) / m2;
  const v1 = VOLUME[from], v2 = VOLUME[to];
  if (v1 && v2) return (qty * v1) / v2;
  return null;
}

/** 표시용 반올림: 개수 단위는 0.5, 나머지는 소수 첫째 자리 (큰 값은 정수) */
export function roundQty(n: number, unit: Unit): number {
  if (["개", "쪽", "장", "봉", "팩", "캔", "줌"].includes(unit)) return Math.round(n * 2) / 2;
  if (Math.abs(n) >= 100) return Math.round(n);
  return Math.round(n * 10) / 10;
}

/** 늘 있다고 보는 재료 (냉장고에 넣어 두지 않는 것) */
const ALWAYS_KEYS = new Set(["water", "ice"]);
const ALWAYS_NAMES = new Set(["물", "생수", "얼음", "끓는물", "찬물", "따뜻한물"]);
export function isAlwaysAvailable(ing: { key: string; name: string }): boolean {
  return ALWAYS_KEYS.has(ing.key.toLowerCase()) || ALWAYS_NAMES.has(provisionalKey(ing.name));
}

/**
 * 같은 식재료인가. ① 표준 key가 같거나 ② 이름이 같거나 ③ 한쪽이 다른 쪽의 "끝부분"이면 같다고 본다
 * (깐마늘·다진마늘 ↔ 마늘, 진간장 ↔ 간장). 앞부분 포함은 다르다 (고추장 ≠ 고추).
 */
/** 손질·원산지 같은 앞말. "생강", "통조림"처럼 단어의 일부인 경우를 피하려고 한 글자 앞말은 최소화했다 */
const PREFIXES = ["국내산", "무농약", "유기농", "채썬", "다진", "손질", "냉동", "국산", "수입", "볶은", "삶은", "데친", "썬", "깐", "편"];

export function foodBaseName(name: string): string {
  let n = provisionalKey(name);
  for (let changed = true; changed;) {
    changed = false;
    for (const p of PREFIXES) {
      if (n.startsWith(p) && n.length - p.length >= 2) { n = n.slice(p.length); changed = true; break; }
    }
  }
  return n;
}

export function sameFood(a: { key: string; name: string }, b: { key: string; name: string }): boolean {
  if (a.key && b.key && a.key.toLowerCase() === b.key.toLowerCase()) return true;
  const x = foodBaseName(a.name), y = foodBaseName(b.name);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 2 && long.endsWith(short);
}

export type MatchStatus = "enough" | "short" | "unknown_amount" | "missing" | "always";

export type IngredientMatch<T> = {
  ingredient: Ingredient;
  status: MatchStatus;
  /** 맞는 냉장고 품목 (유통기한 빠른 순) */
  items: T[];
  /** 재료 단위로 바꾼 냉장고 보유량 (바꿀 수 있는 것만 합산) */
  have: number | null;
  /** 부족한 양 (재료 단위) */
  shortBy: number | null;
};

type FridgeLike = Pick<FridgeItem, "name" | "key" | "qty" | "unit" | "expiresAt">;

function byExpiry<T extends FridgeLike>(a: T, b: T): number {
  return (daysUntil(a.expiresAt) ?? 99999) - (daysUntil(b.expiresAt) ?? 99999);
}

export function matchIngredient<T extends FridgeLike>(ing: Ingredient, fridge: T[]): IngredientMatch<T> {
  if (isAlwaysAvailable(ing)) return { ingredient: ing, status: "always", items: [], have: null, shortBy: null };
  const items = fridge.filter((f) => sameFood(ing, f)).sort(byExpiry);
  if (items.length === 0) return { ingredient: ing, status: "missing", items, have: null, shortBy: null };
  if (ing.qty == null) return { ingredient: ing, status: "enough", items, have: null, shortBy: null };
  let have = 0, convertible = 0, unknown = 0;
  for (const f of items) {
    if (f.qty == null) { unknown++; continue; }
    const c = convertQty(f.qty, f.unit, ing.unit);
    if (c == null) { unknown++; continue; }
    have += c; convertible++;
  }
  if (convertible === 0) return { ingredient: ing, status: "unknown_amount", items, have: null, shortBy: null };
  if (have + 1e-9 >= ing.qty) return { ingredient: ing, status: "enough", items, have: roundQty(have, ing.unit), shortBy: null };
  // 양을 모르는 품목이 함께 있으면 부족하다고 단정하지 않는다
  if (unknown > 0) return { ingredient: ing, status: "unknown_amount", items, have: roundQty(have, ing.unit), shortBy: null };
  return { ingredient: ing, status: "short", items, have: roundQty(have, ing.unit), shortBy: roundQty(ing.qty - have, ing.unit) };
}

export function matchIngredients<T extends FridgeLike>(ings: Ingredient[], fridge: T[]): IngredientMatch<T>[] {
  return ings.map((i) => matchIngredient(i, fridge));
}

export type Deduction<T> = {
  item: T;
  /** 이 품목에서 뺄 양 (품목 단위). null 이면 단위가 달라 사람이 정해야 한다 */
  use: number | null;
};

/** 요리에 쓴 양을 유통기한 빠른 품목부터 뺀다 */
export function planDeductions<T extends FridgeLike>(m: IngredientMatch<T>): Deduction<T>[] {
  const ing = m.ingredient;
  if (m.items.length === 0) return [];
  if (ing.qty == null) return m.items.map((item) => ({ item, use: 0 })); // "약간"은 기본으로 빼지 않는다
  let remaining = ing.qty; // 재료 단위
  const out: Deduction<T>[] = [];
  for (const item of m.items) {
    if (item.qty == null) { out.push({ item, use: remaining > 1e-9 ? null : 0 }); continue; }
    const remainingInItem = convertQty(remaining, ing.unit, item.unit);
    if (remainingInItem == null) { out.push({ item, use: remaining > 1e-9 && m.status === "unknown_amount" ? null : 0 }); continue; }
    const use = Math.min(item.qty, remainingInItem);
    out.push({ item, use: roundQty(use, item.unit) });
    remaining -= convertQty(use, item.unit, ing.unit) ?? 0;
  }
  return out;
}

/** 장본 것을 냉장고에 넣을 때 기본 보관 위치 */
export function defaultLocation(category: FoodCategory): StorageLocation {
  if (category === "냉동식품") return "냉동";
  if (category === "곡물·면" || category === "간식") return "실온";
  return "냉장";
}

/** 분류별 보통 보관 기간(일). 영수증이 없을 때의 기본값 */
export const DEFAULT_SHELF_DAYS: Record<FoodCategory, number | null> = {
  채소: 7, 과일: 10, 육류: 3, 해산물: 2, 유제품: 10, 달걀: 30, "두부·콩": 7, 음료: 90,
  "소스·양념": 180, "반찬·가공": 14, "곡물·면": 180, 간식: 90, 냉동식품: 90, 기타: null,
};
