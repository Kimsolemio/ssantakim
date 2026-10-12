import {
  DEFAULT_STAPLES, SuggestResult, findDislikes, provisionalKey, sameFood, suggestResultJsonSchema,
  type FamilyProfile, type MenuSuggestion,
} from "@cook/shared";
import type { AiProvider, ProviderName } from "./ai";
import { SUGGEST_SYSTEM_PROMPT, buildSuggestUserMessage } from "./prompts";
import { parseAiJson } from "./recipe";

const SCHEMA = suggestResultJsonSchema();

export type SuggestInput = {
  items: { name: string; qty?: number | null; unit?: string; daysLeft?: number | null; estimated?: boolean; location?: string }[];
  mustUse: string[];
  exclude: string[];
  mood?: string | null;
  servings: number;
  profile?: FamilyProfile | null;
  recent: string[];
  avoid: string[];
  count: number;
};

export type SuggestResponse = { suggestions: MenuSuggestion[]; dropped: number; provider: ProviderName; model: string; usage: { input: number; output: number } };

const asNamed = (name: string) => ({ name, key: provisionalKey(name) });

/**
 * AI 답을 그대로 믿지 않고 한 번 더 거른다.
 * - uses 는 실제 냉장고 품목 이름으로 맞추고, 없는 것은 missing 으로 옮긴다
 * - missing 에서 냉장고에 있는 것·늘 있는 양념은 뺀다
 * - 싫어하는 재료·빼기 재료가 이름·재료에 들어간 추천은 버린다
 */
export function cleanSuggestions(raw: MenuSuggestion[], input: SuggestInput, staples: readonly string[]): { list: MenuSuggestion[]; dropped: number } {
  const fridge = input.items.map((i) => asNamed(i.name));
  const isStaple = (n: string) => staples.some((s) => sameFood(asNamed(n), asNamed(s)));
  const avoidWords = [...input.exclude, ...(input.profile?.dislikes ?? [])];
  const seen = new Set<string>();
  const list: MenuSuggestion[] = [];
  let dropped = 0;
  for (const s of raw) {
    const title = s.title.trim();
    const key = provisionalKey(title);
    if (!title || seen.has(key)) { dropped++; continue; }
    const uses: string[] = [];
    const missing: string[] = [];
    for (const u of s.uses) {
      const hit = input.items.find((it) => it.name === u) ?? input.items.find((it) => sameFood(asNamed(it.name), asNamed(u)));
      if (hit) { if (!uses.includes(hit.name)) uses.push(hit.name); }
      else if (!isStaple(u)) missing.push(u);
    }
    for (const m of s.missing) {
      const name = m.trim();
      if (!name || isStaple(name) || fridge.some((f) => sameFood(f, asNamed(name))) || missing.includes(name)) continue;
      missing.push(name);
    }
    // 정리하기 전 AI 원문 전부로 본다 (늘 있는 양념이라 지운 것도 포함해서)
    const all = [{ name: title }, ...s.uses.map((name) => ({ name })), ...s.missing.map((name) => ({ name })), ...uses.map((name) => ({ name })), ...missing.map((name) => ({ name }))];
    if (findDislikes(all, avoidWords).length > 0) { dropped++; continue; }
    seen.add(key);
    list.push({ ...s, title, uses, missing });
  }
  return { list: list.slice(0, input.count), dropped };
}

export async function suggestMenus(ai: AiProvider, input: SuggestInput): Promise<SuggestResponse> {
  const staples = input.profile?.staples ?? [...DEFAULT_STAPLES];
  // 걸러서 모자라지 않게 조금 더 받는다
  const ask = Math.min(input.count + 2, 10);
  const out = await ai.generateJson({
    system: SUGGEST_SYSTEM_PROMPT,
    parts: [{ type: "text", text: buildSuggestUserMessage({ ...input, count: ask, staples }) }],
    schema: SCHEMA,
    effort: "low",
    maxTokens: 6000,
  });
  const parsed = parseAiJson(out.text, SuggestResult);
  const { list, dropped } = cleanSuggestions(parsed.suggestions, input, staples);
  return { suggestions: list, dropped, provider: ai.name, model: out.model, usage: out.usage };
}
