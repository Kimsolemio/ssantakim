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
    expect(scaleQty(1, "큰술", 4, 1)).toBe(0.5);
    expect(scaleQty(null, "기타", 2, 4)).toBeNull();
  });
  it("formats amounts", () => {
    expect(formatAmount({ qty: 1.5, unit: "큰술" })).toBe("1.5큰술");
    expect(formatAmount({ qty: 200, unit: "g" })).toBe("200g");
    expect(formatAmount({ qty: null, unit: "기타" })).toBe("");
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
