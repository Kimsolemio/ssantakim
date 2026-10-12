import { RecipeDraft, recipeDraftJsonSchema, type FamilyProfile } from "@cook/shared";
import { billedError, type AiProvider, type ProviderName } from "./ai";
import { RECIPE_SYSTEM_PROMPT, RECIPE_RESEARCH_PROMPT, buildRecipeResearchMessage, buildRecipeUserMessage } from "./prompts";

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
  input: { dish: string; servings: number; profile?: FamilyProfile | null; notes?: string | null; research?: boolean },
): Promise<RecipeResult> {
  // 1) (선택) 웹에서 인기 레시피를 찾아 메모한다 (Claude 웹 검색). 2) 그 메모를 참고해 형식에 맞춰 쓴다
  let notes = "";
  let refs: { url: string; title: string | null }[] = [];
  let researchUsage = { input: 0, output: 0 };
  if (input.research && ai.research) {
    const r = await ai.research({
      system: RECIPE_RESEARCH_PROMPT,
      prompt: buildRecipeResearchMessage(input.dish, input.servings, input.notes),
      searches: 3, fetches: 2, maxTokens: 6000,
    });
    notes = r.text; refs = r.sources; researchUsage = r.usage;
  }
  const text = buildRecipeUserMessage(input) + (notes ? `\n\n웹에서 찾은 인기 레시피 메모 (참고해서 가장 맛있게 정리):\n${notes.slice(0, 6000)}` : "");
  const out = await ai.generateJson({
    system: RECIPE_SYSTEM_PROMPT,
    parts: [{ type: "text", text }],
    schema: RECIPE_SCHEMA,
    effort: "medium",
  });
  // 만든 레시피의 출처는 언제나 "AI 생성"이다 (AI가 다른 값을 적어도 검증에서 떨어지지 않게). 참고한 웹 문서는 refs 로
  const recipe = parseAiJson(out.text, RecipeDraft, (raw) => (raw && typeof raw === "object" ? { ...(raw as object), source: { type: "generated" } } : raw));
  if (refs.length) recipe.source = { type: "generated", refs };
  return { recipe, provider: ai.name, model: out.model, usage: { input: out.usage.input + researchUsage.input, output: out.usage.output + researchUsage.output } };
}
