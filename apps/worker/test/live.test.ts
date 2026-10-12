/**
 * 실제 Claude API로 레시피를 한 번 만들어 보는 테스트. 키가 있을 때만 돈다(호출 1회 요금 발생).
 * 실행: COOK_ANTHROPIC_API_KEY=sk-ant-... pnpm --filter @cook/worker test live
 * (ANTHROPIC_API_KEY 대신 다른 이름을 쓰는 이유: 개발 도구가 같은 이름의 환경변수를 자기 인증으로 쓰는 경우가 있다)
 */
import { describe, expect, it } from "vitest";
import { claudeProvider } from "../src/ai/claude";
import { generateRecipe } from "../src/recipe";

const key = process.env.COOK_ANTHROPIC_API_KEY;

describe.skipIf(!key)("live Claude", () => {
  it("generates a valid Korean recipe", async () => {
    const ai = claudeProvider({ apiKey: key!, model: process.env.COOK_CLAUDE_MODEL });
    const t0 = Date.now();
    const r = await generateRecipe(ai, { dish: "알리오올리오", servings: 2, notes: null, profile: null });
    console.log(JSON.stringify({ seconds: Math.round((Date.now() - t0) / 1000), model: r.model, usage: r.usage, title: r.recipe.title, ingredients: r.recipe.ingredients.length, steps: r.recipe.steps.length }));
    console.log(JSON.stringify(r.recipe, null, 2));
    expect(r.recipe.ingredients.length).toBeGreaterThan(2);
    expect(r.recipe.steps.length).toBeGreaterThan(2);
    expect(r.recipe.servingsBase).toBe(2);
  }, 300_000);
});
