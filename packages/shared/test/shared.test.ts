import { describe, expect, it } from "vitest";
import {
  provisionalKey, daysUntil, makeInviteCode, scaleQty, formatAmount, recipeDraftJsonSchema,
  FridgeItem, Recipe, RecipeDraft,
} from "../src";

describe("keys", () => {
  it("provisionalKey normalizes names", () => {
    expect(provisionalKey(" 대파 ")).toBe("대파");
    expect(provisionalKey("Green Onion (large)")).toBe("greenonion");
  });
  it("daysUntil counts calendar days", () => {
    expect(daysUntil("2026-10-02", new Date(2026, 8, 29))).toBe(3);
    expect(daysUntil("2026-09-28", new Date(2026, 8, 29))).toBe(-1);
    expect(daysUntil(null)).toBeNull();
  });
  it("invite codes avoid confusing characters", () => {
    for (let i = 0; i < 50; i++) expect(makeInviteCode()).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
  });
});

describe("scaling", () => {
  it("rounds count units to halves and grams sensibly", () => {
    expect(scaleQty(3, "쪽", 2, 3)).toBe(4.5);
    expect(scaleQty(200, "g", 2, 3)).toBe(300);
    expect(scaleQty(1, "큰술", 4, 1)).toBe(0.25); // 1/4큰술까지는 살린다
    expect(scaleQty(1, "작은술", 2, 1)).toBe(0.5);
    expect(scaleQty(0.25, "작은술", 2, 2)).toBe(0.25); // 인분이 그대로면 손대지 않는다
    expect(scaleQty(1, "모", 2, 1)).toBe(0.5);
    expect(scaleQty(null, "기타", 2, 4)).toBeNull();
  });
  it("formats amounts", () => {
    expect(formatAmount({ qty: 1.5, unit: "큰술" })).toBe("1.5큰술");
    expect(formatAmount({ qty: 200, unit: "g" })).toBe("200g");
    expect(formatAmount({ qty: null, unit: "기타" })).toBe("");
    expect(formatAmount({ qty: 0.25, unit: "작은술" })).toBe("1/4작은술");
  });
});

describe("schemas", () => {
  it("fills defaults and rejects empty recipes", () => {
    const fi = FridgeItem.parse({ name: "대파", key: "대파", qty: 2, unit: "개", location: "냉장", expiresAt: null, addedBy: "u", addedAt: new Date().toISOString() });
    expect(fi.photoUrl).toBeNull();
    expect(Recipe.safeParse({ title: "x", source: { type: "generated" }, servingsBase: 2, ingredients: [], steps: [], createdAt: "", createdBy: "" }).success).toBe(false);
  });
  it("AI JSON schema has no unsupported constraints and closes every object", () => {
    const s = recipeDraftJsonSchema();
    const txt = JSON.stringify(s);
    for (const k of ["minLength", "minimum", "minItems", "default", "$schema", "maxLength", "maximum"]) expect(txt).not.toContain(`"${k}"`);
    expect(txt).toContain('"enum":["g","kg"');
    const walk = (n: unknown): void => {
      if (Array.isArray(n)) return n.forEach(walk);
      if (n && typeof n === "object") {
        const o = n as Record<string, unknown>;
        if (o.type === "object") expect(o.additionalProperties).toBe(false);
        Object.values(o).forEach(walk);
      }
    };
    walk(s);
    // RecipeDraft 자체는 스키마와 일치하는 예시를 받아들인다
    expect(RecipeDraft.safeParse({
      title: "t", source: { type: "generated" }, servingsBase: 2, timeMinutes: null, difficulty: "쉬움", tags: [], tips: [],
      ingredients: [{ name: "a", key: "a", qty: 1, unit: "개", scalable: true, optional: false, group: "주재료" }],
      steps: [{ order: 1, text: "x", minutes: null, ingredientKeys: [] }],
    }).success).toBe(true);
  });
});

import { guessFood, fridgeZone, receiptScanJsonSchema, ReceiptScan, addDays, localDate, FridgeItem as FI } from "../src";

describe("virtual fridge helpers", () => {
  it("guesses category and emoji from Korean names", () => {
    expect(guessFood("서울우유")).toEqual({ category: "유제품", emoji: "🥛" });
    expect(guessFood("배추")).toMatchObject({ category: "채소" });
    expect(guessFood("배")).toMatchObject({ category: "과일" });
    expect(guessFood("냉동 만두")).toMatchObject({ category: "냉동식품" });
    expect(guessFood("삼겹살")).toMatchObject({ category: "육류", emoji: "🥩" });
    expect(guessFood("정체불명")).toMatchObject({ category: "기타" });
  });
  it("places items in fridge zones", () => {
    expect(fridgeZone("냉동", "육류")).toBe("freezer");
    expect(fridgeZone("실온", "곡물·면")).toBe("pantry");
    expect(fridgeZone("냉장", "음료")).toBe("door");
    expect(fridgeZone("냉장", "달걀")).toBe("top");
    expect(fridgeZone("냉장", "해산물")).toBe("bottom");
    expect(fridgeZone("냉장", "과일")).toBe("crisper");
    expect(fridgeZone("냉장", "반찬·가공")).toBe("middle");
  });
  it("date helpers use local calendar days", () => {
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(localDate(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
  it("receipt schema is AI-safe and old fridge items still parse", () => {
    const txt = JSON.stringify(receiptScanJsonSchema());
    for (const k of ["minLength", "minimum", "maximum", "default", "$schema"]) expect(txt).not.toContain(`"${k}"`);
    expect(ReceiptScan.safeParse({ store: null, purchasedAt: null, items: [] }).success).toBe(true);
    expect(FI.safeParse({ name: "대파", key: "대파", qty: 1, unit: "개", location: "냉장", expiresAt: null, addedBy: "u", addedAt: "x" }).success).toBe(true);
  });
});

import { convertQty, sameFood, matchIngredient, planDeductions, isAlwaysAvailable, defaultLocation, normalizedNamesJsonSchema, type Ingredient } from "../src";

const ing = (o: Partial<Ingredient> & { name: string; key: string }): Ingredient => ({ qty: null, unit: "개", scalable: true, optional: false, group: "주재료", ...o });
const fr = (o: { id: string; name: string; key: string; qty: number | null; unit: any; expiresAt?: string | null }) => ({ expiresAt: null, ...o });

describe("matching", () => {
  it("converts only compatible units", () => {
    expect(convertQty(1.5, "kg", "g")).toBe(1500);
    expect(convertQty(2, "큰술", "ml")).toBe(30);
    expect(convertQty(1, "L", "컵")).toBe(5);
    expect(convertQty(1, "개", "g")).toBeNull();
  });
  it("treats processed forms as the same food but not prefixes", () => {
    expect(sameFood({ key: "", name: "다진 마늘" }, { key: "깐마늘", name: "깐마늘" })).toBe(true);
    expect(sameFood({ key: "soy_sauce", name: "간장" }, { key: "진간장", name: "진간장" })).toBe(true);
    expect(sameFood({ key: "gochujang", name: "고추장" }, { key: "고추", name: "고추" })).toBe(false);
    expect(sameFood({ key: "spaghetti", name: "스파게티면" }, { key: "spaghetti", name: "파스타면" })).toBe(true);
    expect(sameFood({ key: "", name: "파" }, { key: "", name: "대파" })).toBe(true); // 동의어
    expect(isAlwaysAvailable({ key: "water", name: "물" })).toBe(true);
    expect(sameFood({ key: "", name: "냉동 만두" }, { key: "", name: "만두" })).toBe(true);
    expect(sameFood({ key: "", name: "생강" }, { key: "", name: "강" })).toBe(false);
    expect(sameFood({ key: "", name: "돼지고기" }, { key: "", name: "소고기" })).toBe(false);
  });
  it("does not confuse different foods that share an ending", () => {
    // 둘 다 AI가 정리한 key면 key를 믿는다
    expect(sameFood({ key: "butter", name: "버터" }, { key: "peanut_butter", name: "땅콩버터" })).toBe(false);
    expect(sameFood({ key: "napa_cabbage", name: "배추" }, { key: "cabbage", name: "양배추" })).toBe(false);
    expect(sameFood({ key: "milk", name: "우유" }, { key: "banana_milk", name: "바나나우유" })).toBe(false);
    // 아직 한글 임시 key여도 모르는 앞말이면 같다고 하지 않는다
    expect(sameFood({ key: "butter", name: "버터" }, { key: "땅콩버터", name: "땅콩버터" })).toBe(false);
    expect(sameFood({ key: "배추", name: "배추" }, { key: "양배추", name: "양배추" })).toBe(false);
    expect(sameFood({ key: "", name: "고추" }, { key: "", name: "청양고추" })).toBe(false);
    expect(sameFood({ key: "", name: "두부" }, { key: "", name: "순두부" })).toBe(false);
    // 같은 재료로 보는 앞말과 동의어
    expect(sameFood({ key: "", name: "소금" }, { key: "", name: "굵은소금" })).toBe(true);
    expect(sameFood({ key: "egg", name: "계란" }, { key: "달걀", name: "달걀" })).toBe(true);
    expect(sameFood({ key: "", name: "녹말가루" }, { key: "", name: "감자전분" })).toBe(true);
    expect(sameFood({ key: "eggs", name: "eggs" }, { key: "egg", name: "달걀" })).toBe(true);
    expect(sameFood({ key: "welsh_onion", name: "파" }, { key: "green_onion", name: "대파" })).toBe(true);
    expect(sameFood({ key: "scallion", name: "쪽파" }, { key: "green_onion", name: "대파" })).toBe(false);
    expect(sameFood({ key: "tomatoes", name: "a" }, { key: "tomato", name: "b" })).toBe(true);
  });
  it("offers look-alikes as hints only", () => {
    const fridge = [fr({ id: "pb", name: "땅콩버터", key: "peanut_butter", qty: 1, unit: "병" })];
    const m = matchIngredient(ing({ name: "버터", key: "butter", qty: 10, unit: "g" }), fridge);
    expect(m.status).toBe("missing");
    expect(m.similar.map((x) => x.id)).toEqual(["pb"]);
  });
  it("treats family staples as available unless the fridge says otherwise", () => {
    const staples = ["소금", "간장", "후춧가루"];
    expect(matchIngredient(ing({ name: "소금", key: "salt", unit: "기타" }), [], { staples }).status).toBe("staple");
    expect(matchIngredient(ing({ name: "후추", key: "black_pepper", unit: "기타" }), [], { staples }).status).toBe("staple");
    expect(matchIngredient(ing({ name: "진간장", key: "soy_sauce", qty: 2, unit: "큰술" }), [], { staples }).status).toBe("staple");
    expect(matchIngredient(ing({ name: "버터", key: "butter", qty: 10, unit: "g" }), [], { staples }).status).toBe("missing");
    const low = [fr({ id: "s", name: "간장", key: "soy_sauce", qty: 1, unit: "큰술" })];
    expect(matchIngredient(ing({ name: "간장", key: "soy_sauce", qty: 3, unit: "큰술" }), low, { staples }).status).toBe("short");
  });
  it("counts eggs in 개 and 알 together", () => {
    expect(convertQty(2, "알", "개")).toBe(2);
    const m = matchIngredient(ing({ name: "달걀", key: "egg", qty: 2, unit: "개" }), [fr({ id: "e", name: "계란", key: "egg", qty: 10, unit: "알" })]);
    expect(m.status).toBe("enough");
  });
  it("classifies enough / short / unknown / missing", () => {
    const fridge = [fr({ id: "a", name: "스파게티면", key: "spaghetti", qty: 500, unit: "g" }), fr({ id: "b", name: "깐마늘", key: "garlic", qty: 200, unit: "g" }),
      fr({ id: "c", name: "올리브유", key: "olive_oil", qty: 2, unit: "큰술" })];
    expect(matchIngredient(ing({ name: "스파게티면", key: "spaghetti", qty: 300, unit: "g" }), fridge).status).toBe("enough");
    expect(matchIngredient(ing({ name: "스파게티면", key: "spaghetti", qty: 0.6, unit: "kg" }), fridge)).toMatchObject({ status: "short", shortBy: 0.1 });
    expect(matchIngredient(ing({ name: "마늘", key: "garlic", qty: 8, unit: "쪽" }), fridge).status).toBe("unknown_amount");
    expect(matchIngredient(ing({ name: "올리브오일", key: "olive_oil", qty: 60, unit: "ml" }), fridge)).toMatchObject({ status: "short", have: 30, shortBy: 30 });
    expect(matchIngredient(ing({ name: "소금", key: "salt", unit: "기타" }), fridge).status).toBe("missing");
    expect(matchIngredient(ing({ name: "물", key: "water", qty: 2, unit: "L" }), fridge).status).toBe("always");
  });
  it("deducts from the soonest-expiring item first", () => {
    const fridge = [
      fr({ id: "late", name: "대파", key: "green_onion", qty: 2, unit: "개", expiresAt: "2099-01-10" }),
      fr({ id: "soon", name: "대파", key: "green_onion", qty: 1, unit: "개", expiresAt: "2099-01-02" }),
    ];
    const m = matchIngredient(ing({ name: "대파", key: "green_onion", qty: 2, unit: "개" }), fridge);
    expect(planDeductions(m).map((d) => [d.item.id, d.use])).toEqual([["soon", 1], ["late", 1]]);
    const g = matchIngredient(ing({ name: "마늘", key: "garlic", qty: 8, unit: "쪽" }), [fr({ id: "g", name: "깐마늘", key: "garlic", qty: 200, unit: "g" })]);
    expect(planDeductions(g)).toEqual([{ item: expect.objectContaining({ id: "g" }), use: null }]);
    const salt = matchIngredient(ing({ name: "소금", key: "salt", unit: "기타" }), [fr({ id: "s", name: "소금", key: "salt", qty: 500, unit: "g" })]);
    expect(planDeductions(salt)[0].use).toBe(0);
  });
  it("defaults and schema", () => {
    expect(defaultLocation("냉동식품")).toBe("냉동");
    expect(defaultLocation("곡물·면")).toBe("실온");
    expect(defaultLocation("채소")).toBe("냉장");
    expect(JSON.stringify(normalizedNamesJsonSchema())).not.toContain('"minLength"');
  });
});
