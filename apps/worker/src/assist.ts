/**
 * 요리를 도와주는 Claude 기능들: 물어보기, 레시피 바꾸기, 대체 재료.
 */
import {
  AdaptResult, AskResult, SubstituteResult, adaptResultJsonSchema, askResultJsonSchema, provisionalKey, sameFood, substituteResultJsonSchema,
  type FamilyProfile,
} from "@cook/shared";
import type { AiProvider, ProviderName } from "./ai";
import {
  ADAPT_SYSTEM_PROMPT, ASK_SYSTEM_PROMPT, SUBSTITUTE_SYSTEM_PROMPT,
  buildAdaptUserMessage, buildAskUserMessage, buildSubstituteUserMessage,
} from "./prompts";
import { parseAiJson } from "./recipe";

const ASK_SCHEMA = askResultJsonSchema();
const ADAPT_SCHEMA = adaptResultJsonSchema();
const SUB_SCHEMA = substituteResultJsonSchema();

type Meta = { provider: ProviderName; model: string; usage: { input: number; output: number } };
type RecipeLite = Parameters<typeof buildAskUserMessage>[0]["recipe"];

export async function askChef(ai: AiProvider, input: Omit<Parameters<typeof buildAskUserMessage>[0], "recipe"> & { recipe: RecipeLite }): Promise<AskResult & Meta> {
  const out = await ai.generateJson({
    system: ASK_SYSTEM_PROMPT,
    parts: [{ type: "text", text: buildAskUserMessage(input) }],
    schema: ASK_SCHEMA,
    effort: "low",
    maxTokens: 3000,
    cache: true,
  });
  const r = parseAiJson(out.text, AskResult);
  return { answer: r.answer, followups: r.followups.slice(0, 3), provider: ai.name, model: out.model, usage: out.usage };
}

export async function adaptRecipe(ai: AiProvider, input: { recipe: unknown; instruction: string; servings: number; fridge: string[]; profile?: FamilyProfile | null }): Promise<AdaptResult & Meta> {
  const out = await ai.generateJson({
    system: ADAPT_SYSTEM_PROMPT,
    parts: [{ type: "text", text: buildAdaptUserMessage(input) }],
    schema: ADAPT_SCHEMA,
    effort: "medium",
    maxTokens: 16000,
  });
  // 바꾼 레시피의 출처는 "AI 생성"
  const r = parseAiJson(out.text, AdaptResult, (raw) => {
    const o = raw as { recipe?: Record<string, unknown> } | null;
    if (o?.recipe && typeof o.recipe === "object") o.recipe.source = { type: "generated" };
    return o;
  });
  return { ...r, provider: ai.name, model: out.model, usage: out.usage };
}

export async function suggestSubstitutes(ai: AiProvider, input: Parameters<typeof buildSubstituteUserMessage>[0]): Promise<SubstituteResult & Meta> {
  const out = await ai.generateJson({
    system: SUBSTITUTE_SYSTEM_PROMPT,
    parts: [{ type: "text", text: buildSubstituteUserMessage(input) }],
    schema: SUB_SCHEMA,
    effort: "low",
    maxTokens: 4000,
    cache: true,
  });
  const r = parseAiJson(out.text, SubstituteResult);
  // 냉장고에 있다고 한 것이 정말 목록에 있는지 다시 확인
  const named = (n: string) => ({ name: n, key: provisionalKey(n) });
  const items = r.items.map((it) => ({ ...it, options: it.options.slice(0, 3).map((o) => ({ ...o, fromFridge: input.fridge.some((f) => sameFood(named(f), named(o.name))) })) }));
  return { items, provider: ai.name, model: out.model, usage: out.usage };
}
