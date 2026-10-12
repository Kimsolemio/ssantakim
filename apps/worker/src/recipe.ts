import { RecipeDraft, recipeDraftJsonSchema, type FamilyProfile } from "@cook/shared";
import { GenerationError, type AiProvider, type ProviderName } from "./ai";
import { RECIPE_SYSTEM_PROMPT, buildRecipeUserMessage } from "./prompts";

const RECIPE_SCHEMA = recipeDraftJsonSchema();

export type RecipeResult = { recipe: RecipeDraft; provider: ProviderName; model: string; usage: { input: number; output: number } };

/** AI 응답 문자열 → zod 검증된 값. 모든 AI 기능이 같이 쓴다 */
export function parseAiJson<T>(text: string, schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } } }): T {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new GenerationError("AI 응답을 해석할 수 없습니다 (JSON 오류)", 502); }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    throw new GenerationError(`AI 응답이 형식에 맞지 않습니다: ${i?.path.map(String).join(".")} ${i?.message}`, 502);
  }
  return parsed.data;
}

export async function generateRecipe(
  ai: AiProvider,
  input: { dish: string; servings: number; profile?: FamilyProfile | null; notes?: string | null },
): Promise<RecipeResult> {
  const out = await ai.generateJson({
    system: RECIPE_SYSTEM_PROMPT,
    parts: [{ type: "text", text: buildRecipeUserMessage(input) }],
    schema: RECIPE_SCHEMA,
    effort: "medium",
  });
  return { recipe: parseAiJson(out.text, RecipeDraft), provider: ai.name, model: out.model, usage: out.usage };
}
