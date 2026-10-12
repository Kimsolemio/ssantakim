import { RecipeDraft, recipeDraftJsonSchema, type FamilyProfile } from "@cook/shared";
import { billedError, type AiProvider, type ProviderName } from "./ai";
import { RECIPE_SYSTEM_PROMPT, buildRecipeUserMessage } from "./prompts";

const RECIPE_SCHEMA = recipeDraftJsonSchema();

export type RecipeResult = { recipe: RecipeDraft; provider: ProviderName; model: string; usage: { input: number; output: number } };

/** AI 응답 문자열 → zod 검증된 값. 모든 AI 기능이 같이 쓴다 */
export function parseAiJson<T>(
  text: string,
  schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } } },
  /** 검증 전에 고칠 것 (예: 앱이 어차피 덮어쓸 source 를 AI 값과 상관없이 비운다) */
  prepare?: (raw: unknown) => unknown,
): T {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw billedError("AI 응답을 해석할 수 없습니다 (JSON 오류)", 502); }
  if (prepare) raw = prepare(raw);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    throw billedError(`AI 응답이 형식에 맞지 않습니다: ${i?.path.map(String).join(".")} ${i?.message}`, 502);
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
  // 만든 레시피의 출처는 언제나 "AI 생성"이다 (AI가 다른 값을 적어도 검증에서 떨어지지 않게)
  const recipe = parseAiJson(out.text, RecipeDraft, (raw) => (raw && typeof raw === "object" ? { ...(raw as object), source: { type: "generated" } } : raw));
  return { recipe, provider: ai.name, model: out.model, usage: out.usage };
}
