/**
 * Gemini API (무료 등급) 호출. SDK 없이 REST + fetch 만 사용한다.
 * 구조화 출력: generationConfig.responseMimeType=application/json + responseJsonSchema
 */
import { RecipeDraft, recipeDraftJsonSchema, type FamilyProfile } from "@cook/shared";
import { RECIPE_SYSTEM_PROMPT, buildRecipeUserMessage } from "./prompts";

export const DEFAULT_MODEL = "gemini-2.5-flash";

export class GenerationError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

const RECIPE_SCHEMA = recipeDraftJsonSchema();

type GeminiResponse = {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
  error?: { code?: number; message?: string; status?: string };
};

export type GeminiClient = { apiKey: string; model: string; fetch?: typeof fetch };

export async function generateJson(
  client: GeminiClient,
  system: string,
  user: string,
  schema: Record<string, unknown>,
  maxOutputTokens = 8192,
): Promise<{ text: string; model: string; usage: { input: number; output: number }; finishReason: string }> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(client.model)}:generateContent`;
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: user }] }],
    generationConfig: { responseMimeType: "application/json", responseJsonSchema: schema, maxOutputTokens, temperature: 0.7 },
  };
  let res: Response;
  try {
    res = await (client.fetch ?? fetch)(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": client.apiKey },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new GenerationError(`AI 서버에 연결하지 못했습니다: ${e instanceof Error ? e.message : String(e)}`, 502);
  }
  let data: GeminiResponse;
  try { data = (await res.json()) as GeminiResponse; } catch { throw new GenerationError(`AI 응답을 읽지 못했습니다 (${res.status})`, 502); }

  if (!res.ok) {
    const status = data.error?.status ?? "", msg = data.error?.message ?? res.statusText;
    if (res.status === 400 && /API key/i.test(msg)) throw new GenerationError("AI API 키가 올바르지 않습니다 (Worker 설정 확인)", 502);
    if (res.status === 429 || status === "RESOURCE_EXHAUSTED") throw new GenerationError("무료 사용량 한도에 걸렸습니다. 1분 뒤 다시 시도하세요 (하루 한도면 내일)", 429);
    if (res.status === 404) throw new GenerationError(`AI 모델을 찾을 수 없습니다: ${client.model} (GEMINI_MODEL 확인)`, 502);
    throw new GenerationError(`AI 호출 실패 (${res.status}): ${msg}`, 502);
  }
  if (data.promptFeedback?.blockReason) throw new GenerationError("AI가 이 요청을 처리할 수 없다고 판단했습니다", 422);
  const cand = data.candidates?.[0];
  const finishReason = cand?.finishReason ?? "";
  if (finishReason === "SAFETY" || finishReason === "PROHIBITED_CONTENT") throw new GenerationError("AI가 이 요청에 응답할 수 없다고 판단했습니다", 422);
  const text = (cand?.content?.parts ?? []).map((p) => p.text ?? "").join("");
  if (finishReason === "MAX_TOKENS") throw new GenerationError("응답이 너무 길어 잘렸습니다. 다시 시도하세요", 502);
  if (!text) throw new GenerationError("AI가 빈 응답을 보냈습니다. 다시 시도하세요", 502);
  const u = data.usageMetadata ?? {};
  return { text, model: client.model, usage: { input: u.promptTokenCount ?? 0, output: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0) }, finishReason };
}

export type RecipeResult = { recipe: RecipeDraft; model: string; usage: { input: number; output: number } };

export async function generateRecipe(
  client: GeminiClient,
  input: { dish: string; servings: number; profile?: FamilyProfile | null; notes?: string | null },
): Promise<RecipeResult> {
  const out = await generateJson(client, RECIPE_SYSTEM_PROMPT, buildRecipeUserMessage(input), RECIPE_SCHEMA);
  let raw: unknown;
  try { raw = JSON.parse(out.text); } catch { throw new GenerationError("AI 응답을 해석할 수 없습니다 (JSON 오류)", 502); }
  const parsed = RecipeDraft.safeParse(raw);
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    throw new GenerationError(`AI 응답이 형식에 맞지 않습니다: ${i?.path.join(".")} ${i?.message}`, 502);
  }
  return { recipe: parsed.data, model: out.model, usage: out.usage };
}
