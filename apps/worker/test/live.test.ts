/**
 * 실제 AI로 검증하는 테스트. 키가 있을 때만 돈다 (호출마다 요금 발생, Gemini는 무료 한도 사용).
 *   COOK_ANTHROPIC_API_KEY=sk-ant-... pnpm --filter @cook/worker test live    # Claude
 *   COOK_GEMINI_API_KEY=AIza...       pnpm --filter @cook/worker test live    # Gemini
 * (ANTHROPIC_API_KEY 대신 다른 이름을 쓰는 이유: 개발 도구가 같은 이름의 환경변수를 자기 인증으로 쓰는 경우가 있다)
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { claudeProvider } from "../src/ai/claude";
import { geminiProvider } from "../src/ai/gemini";
import type { AiProvider } from "../src/ai/types";
import { generateRecipe } from "../src/recipe";
import { scanReceipt } from "../src/receipt";

const claudeKey = process.env.COOK_ANTHROPIC_API_KEY;
const geminiKey = process.env.COOK_GEMINI_API_KEY;
const ai: AiProvider | null = claudeKey
  ? claudeProvider({ apiKey: claudeKey, model: process.env.COOK_CLAUDE_MODEL })
  : geminiKey ? geminiProvider({ apiKey: geminiKey, model: process.env.COOK_GEMINI_MODEL }) : null;

const here = dirname(fileURLToPath(import.meta.url));

describe.skipIf(!ai)(`live AI (${ai?.name ?? "none"})`, () => {
  it("generates a valid Korean recipe", async () => {
    const t0 = Date.now();
    const r = await generateRecipe(ai!, { dish: "알리오올리오", servings: 2, notes: null, profile: null });
    console.log(JSON.stringify({ seconds: Math.round((Date.now() - t0) / 1000), model: r.model, usage: r.usage, title: r.recipe.title, ingredients: r.recipe.ingredients.length, steps: r.recipe.steps.length }));
    expect(r.recipe.ingredients.length).toBeGreaterThan(2);
    expect(r.recipe.steps.length).toBeGreaterThan(2);
    expect(r.recipe.servingsBase).toBe(2);
  }, 300_000);

  it("reads the sample receipt into fridge items", async () => {
    const data = readFileSync(join(here, "fixtures", "sample-receipt.png")).toString("base64");
    const t0 = Date.now();
    const r = await scanReceipt(ai!, { images: [{ mediaType: "image/png", data }], today: "2026-10-12" });
    const s = r.scan;
    console.log(JSON.stringify({ seconds: Math.round((Date.now() - t0) / 1000), model: r.model, usage: r.usage, store: s.store, purchasedAt: s.purchasedAt }));
    for (const it of s.items) console.log(`${it.isFood ? "  " : "x "}${it.emoji} ${it.name} (${it.key}) ${it.qty ?? "?"}${it.unit} ${it.location}/${it.category} ${it.shelfLifeDays ?? "?"}일 ← ${it.rawText}`);

    const food = s.items.filter((i) => i.isFood);
    const find = (re: RegExp) => s.items.find((i) => re.test(i.name) || re.test(i.rawText));
    expect(food.length).toBeGreaterThanOrEqual(12);
    expect(s.purchasedAt).toBe("2026-10-11");
    expect(find(/우유/)?.location).toBe("냉장");
    expect(find(/교자|만두/)?.location).toBe("냉동");
    expect(find(/라면/)?.location).toBe("실온");
    expect(find(/봉투/)?.isFood).toBe(false);
    expect(find(/콜라/)?.qty).toBe(2);
    expect(JSON.stringify(s)).not.toMatch(/1234|91,?750|합계|포인트/);
  }, 300_000);
});
