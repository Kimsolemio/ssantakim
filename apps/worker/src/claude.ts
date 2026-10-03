import Anthropic from "@anthropic-ai/sdk";
import { RecipeDraft, recipeDraftJsonSchema, type FamilyProfile } from "@cook/shared";
import { RECIPE_SYSTEM_PROMPT, buildRecipeUserMessage } from "./prompts";

export const RECIPE_MODEL = "claude-opus-5-5";

export class GenerationError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

const RECIPE_SCHEMA = recipeDraftJsonSchema();

export function makeClient(apiKey: string): Anthropic {
  return new Anthropic({ apiKey, maxRetries: 2, timeout: 5 * 60 * 1000 });
}

export type RecipeResult = {
  recipe: RecipeDraft;
  model: string;
  usage: { input: number; output: number };
};

export async function generateRecipe(
  client: Anthropic,
  input: { dish: string; servings: number; profile?: FamilyProfile | null; notes?: string | null },
): Promise<RecipeResult> {
  let message;
  try {
    // 스트리밍으로 받아 긴 응답에서도 타임아웃을 피하고, 최종 메시지만 사용한다.
    const stream = client.beta.messages.stream({
      model: RECIPE_MODEL,
      max_tokens: 16000,
      system: RECIPE_SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildRecipeUserMessage(input) }],
      output_config: {
        effort: "medium",
        format: { type: "json_schema", schema: RECIPE_SCHEMA },
      },
      // 안전 분류기가 요청을 거절하면 같은 호출 안에서 대체 모델로 재시도한다.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    message = await stream.finalMessage();
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new GenerationError("AI API 키가 올바르지 않습니다 (Worker 설정 확인)", 502);
    if (e instanceof Anthropic.RateLimitError) throw new GenerationError("AI 요청이 너무 많습니다. 잠시 후 다시 시도하세요", 429);
    if (e instanceof Anthropic.APIError) throw new GenerationError(`AI 호출 실패 (${e.status}): ${e.message}`, 502);
    throw new GenerationError(`AI 호출 실패: ${e instanceof Error ? e.message : String(e)}`, 502);
  }

  if (message.stop_reason === "refusal") throw new GenerationError("AI가 이 요청에 응답할 수 없다고 판단했습니다", 422);
  if (message.stop_reason === "max_tokens") throw new GenerationError("응답이 너무 길어 잘렸습니다. 다시 시도하세요", 502);

  const text = message.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new GenerationError("AI 응답을 해석할 수 없습니다 (JSON 오류)", 502); }
  const parsed = RecipeDraft.safeParse(raw);
  if (!parsed.success) throw new GenerationError(`AI 응답이 형식에 맞지 않습니다: ${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}`, 502);

  return {
    recipe: parsed.data,
    model: message.model,
    usage: { input: message.usage.input_tokens, output: message.usage.output_tokens },
  };
}
