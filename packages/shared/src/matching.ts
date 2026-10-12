/**
 * 레시피 재료 ↔ 냉장고 품목 대조와, 요리 후 차감량 계산.
 * 화면과 테스트가 같은 규칙을 쓰도록 공용 패키지에 둔다.
 */
import { daysUntil, provisionalKey } from "./keys";
import type { FoodCategory } from "./food";
import type { FridgeItem, Ingredient, StorageLocation, Unit } from "./schemas";

const MASS: Partial<Record<Unit, number>> = { g: 1, kg: 1000 };
const VOLUME: Partial<Record<Unit, number>> = { ml: 1, L: 1000, 큰술: 15, 작은술: 5, 컵: 200 };
/** 낱개를 세는 말. "달걀 2알" = "달걀 2개", "대파 1대" = "대파 1개" */
const PIECE: Partial<Record<Unit, number>> = { 개: 1, 알: 1, 대: 1 };

/** 같은 종류 단위끼리만 바꾼다 (무게끼리, 부피·숟가락끼리, 낱개끼리). 못 바꾸면 null */
export function convertQty(qty: number, from: Unit, to: Unit): number | null {
  if (from === to) return qty;
  for (const table of [MASS, VOLUME, PIECE]) {
    const a = table[from], b = table[to];
    if (a && b) return (qty * a) / b;
  }
  return null;
}

/** 셈 단위: 0.5 단위로 다룬다 */
export const COUNT_UNITS: ReadonlySet<Unit> = new Set<Unit>(["개", "쪽", "장", "봉", "팩", "캔", "줌", "모", "단", "대", "마리", "송이", "포기", "알", "병"]);

/** 표시용 반올림: 셈 단위는 0.5, 나머지는 소수 첫째 자리 (큰 값은 정수) */
export function roundQty(n: number, unit: Unit): number {
  if (COUNT_UNITS.has(unit)) return Math.round(n * 2) / 2;
  if (Math.abs(n) >= 100) return Math.round(n);
  return Math.round(n * 10) / 10;
}

/** 늘 있다고 보는 재료 (냉장고에 넣어 두지 않는 것) */
const ALWAYS_KEYS = new Set(["water", "ice"]);
const ALWAYS_NAMES = new Set(["물", "생수", "얼음", "끓는물", "찬물", "따뜻한물", "뜨거운물", "미지근한물", "면수"]);
export function isAlwaysAvailable(ing: { key: string; name: string }): boolean {
  return ALWAYS_KEYS.has(ing.key.toLowerCase()) || ALWAYS_NAMES.has(provisionalKey(ing.name));
}

/** AI가 정리한 표준 영문 key인가 (한글 임시 key와 구분) */
export const isStandardKey = (k: string): boolean => /^[a-z][a-z0-9_]*$/.test(k);

/** 같은 재료인데 AI가 가끔 다르게 붙이는 key */
const KEY_ALIASES: Record<string, string> = {
  // 대파 = green_onion, 쪽파 = scallion 으로 따로 둔다 (요리에서 다르게 쓴다)
  welsh_onion: "green_onion", large_green_onion: "green_onion", daepa: "green_onion", spring_onion: "scallion", chive: "scallion", jjokpa: "scallion",
  minced_garlic: "garlic", garlic_clove: "garlic", peeled_garlic: "garlic",
  cooking_oil: "vegetable_oil", canola_oil: "vegetable_oil", grapeseed_oil: "vegetable_oil", soybean_oil: "vegetable_oil",
  toasted_sesame_seed: "sesame_seed", ground_black_pepper: "black_pepper", korean_chili_flakes: "chili_flakes", gochugaru: "chili_flakes",
  mirin: "cooking_wine", rice_wine: "cooking_wine", corn_starch: "starch", potato_starch: "starch",
};

/** 복수형 정리 + 별칭. 표준 key가 아니면 그대로 */
export function canonKey(key: string): string {
  let k = key.trim().toLowerCase();
  if (!isStandardKey(k)) return k;
  if (k.length > 4 && k.endsWith("ies")) k = k.slice(0, -3) + "y";
  else if (k.length > 4 && k.endsWith("oes")) k = k.slice(0, -2);
  else if (k.length > 3 && k.endsWith("s") && !k.endsWith("ss") && !k.endsWith("us")) k = k.slice(0, -1);
  return KEY_ALIASES[k] ?? k;
}

/** 손질·원산지 같은 앞말. "생강", "통조림"처럼 단어의 일부인 경우를 피하려고 한 글자 앞말은 최소화했다 */
const PREFIXES = ["국내산", "무농약", "유기농", "친환경", "채썬", "다진", "손질", "냉동", "냉장", "국산", "수입", "볶은", "삶은", "데친", "썬", "깐", "편"];

/** 같은 재료의 다른 이름 → 대표 이름 (앞말을 뗀 뒤 적용) */
const NAME_SYNONYMS: Record<string, string> = {
  계란: "달걀", 파: "대파", 실파: "쪽파", 쇠고기: "소고기", 돈육: "돼지고기", 닭: "닭고기",
  녹말: "전분", 녹말가루: "전분", 전분가루: "전분", 감자전분: "전분", 옥수수전분: "전분",
  후추: "후춧가루", 후추가루: "후춧가루", 고추가루: "고춧가루",
  카놀라유: "식용유", 포도씨유: "식용유", 콩기름: "식용유", 해바라기유: "식용유",
  올리브유: "올리브오일", 엑스트라버진올리브오일: "올리브오일",
  깨: "참깨", 통깨: "참깨", 깨소금: "참깨",
  진간장: "간장", 양조간장: "간장", 미림: "맛술", 케찹: "케첩", 토마토케첩: "케첩", 마요: "마요네즈",
  양송이버섯: "양송이", 표고버섯: "표고", 새송이버섯: "새송이", 팽이버섯: "팽이", 느타리버섯: "느타리",
  스파게티면: "스파게티", 마늘쫑: "마늘종", 쪽파김치: "파김치",
  // 그냥 "김치"는 보통 배추김치다
  배추김치: "김치", 포기김치: "김치", 맛김치: "김치", 썰은김치: "김치", 신김치: "김치", 묵은지: "김치",
};

/** 앞에 붙어도 같은 재료로 보는 말 (진간장 = 간장, 통마늘 = 마늘, 굵은소금 = 소금) */
const VARIANT_HEADS = new Set(["진", "양조", "통", "햇", "흙", "생", "굵은", "고운", "꽃", "천일"]);

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

/** 비교용 대표 이름 */
export function canonName(name: string): string {
  const b = foodBaseName(name);
  return NAME_SYNONYMS[b] ?? b;
}

type Named = { key: string; name: string };

/**
 * 같은 식재료인가.
 * ① 표준 key가 같다 ② 대표 이름이 같다 (계란 = 달걀, 다진 마늘 = 마늘)
 * ③ 둘 중 하나라도 아직 AI가 정리하지 않은 이름이면, 같은 재료로 보는 앞말만 붙은 경우 (진간장 = 간장)
 * 둘 다 AI가 정리한 key인데 서로 다르면 다른 재료다 (butter ≠ peanut_butter, napa_cabbage ≠ cabbage).
 */
export function sameFood(a: Named, b: Named): boolean {
  const ka = canonKey(a.key), kb = canonKey(b.key);
  if (ka && kb && ka === kb) return true;
  const x = canonName(a.name), y = canonName(b.name);
  if (!x || !y) return false;
  if (x === y) return true;
  if (isStandardKey(ka) && isStandardKey(kb)) return false;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  if (short.length < 2 || !long.endsWith(short)) return false;
  return VARIANT_HEADS.has(long.slice(0, long.length - short.length));
}

/** 같다고는 못 하지만 비슷한 이름 (땅콩버터 ↔ 버터, 양배추 ↔ 배추). 화면에서 "혹시 이것?"으로만 보여 준다 */
export function similarFood(a: Named, b: Named): boolean {
  if (sameFood(a, b)) return false;
  const x = canonName(a.name), y = canonName(b.name);
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 2 && long.includes(short);
}

export type MatchStatus = "enough" | "short" | "unknown_amount" | "missing" | "always" | "staple";

export type IngredientMatch<T> = {
  ingredient: Ingredient;
  status: MatchStatus;
  /** 맞는 냉장고 품목 (유통기한 빠른 순) */
  items: T[];
  /** 재료 단위로 바꾼 냉장고 보유량 (바꿀 수 있는 것만 합산) */
  have: number | null;
  /** 부족한 양 (재료 단위) */
  shortBy: number | null;
  /** 같은 재료로 단정하지 않은 비슷한 품목 (예: 버터를 찾는데 땅콩버터) */
  similar: T[];
};

export type MatchOptions = {
  /** 늘 있는 양념 이름 (가족 설정). 냉장고에 없으면 "staple"로 본다 */
  staples?: readonly string[];
};

type FridgeLike = Pick<FridgeItem, "name" | "key" | "qty" | "unit" | "expiresAt">;

function byExpiry<T extends FridgeLike>(a: T, b: T): number {
  return (daysUntil(a.expiresAt) ?? 99999) - (daysUntil(b.expiresAt) ?? 99999);
}

export function matchIngredient<T extends FridgeLike>(ing: Ingredient, fridge: T[], opts: MatchOptions = {}): IngredientMatch<T> {
  const base = { ingredient: ing, have: null, shortBy: null, similar: [] as T[] };
  if (isAlwaysAvailable(ing)) return { ...base, status: "always", items: [] };
  const items = fridge.filter((f) => sameFood(ing, f)).sort(byExpiry);
  if (items.length === 0) {
    if (opts.staples?.some((s) => sameFood(ing, { key: provisionalKey(s), name: s }))) return { ...base, status: "staple", items };
    return { ...base, status: "missing", items, similar: fridge.filter((f) => similarFood(ing, f)).sort(byExpiry) };
  }
  if (ing.qty == null) return { ...base, status: "enough", items };
  let have = 0, convertible = 0, unknown = 0;
  for (const f of items) {
    if (f.qty == null) { unknown++; continue; }
    const c = convertQty(f.qty, f.unit, ing.unit);
    if (c == null) { unknown++; continue; }
    have += c; convertible++;
  }
  if (convertible === 0) return { ...base, status: "unknown_amount", items };
  if (have + 1e-9 >= ing.qty) return { ...base, status: "enough", items, have: roundQty(have, ing.unit) };
  // 양을 모르는 품목이 함께 있으면 부족하다고 단정하지 않는다
  if (unknown > 0) return { ...base, status: "unknown_amount", items, have: roundQty(have, ing.unit) };
  return { ...base, status: "short", items, have: roundQty(have, ing.unit), shortBy: roundQty(ing.qty - have, ing.unit) };
}

export function matchIngredients<T extends FridgeLike>(ings: Ingredient[], fridge: T[], opts: MatchOptions = {}): IngredientMatch<T>[] {
  return ings.map((i) => matchIngredient(i, fridge, opts));
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
