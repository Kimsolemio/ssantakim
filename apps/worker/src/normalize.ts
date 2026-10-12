import { NormalizedNames, normalizedNamesJsonSchema, provisionalKey } from "@cook/shared";
import type { AiProvider, ProviderName } from "./ai";
import { NORMALIZE_SYSTEM_PROMPT, buildNormalizeUserMessage } from "./prompts";
import { parseAiJson } from "./recipe";

const SCHEMA = normalizedNamesJsonSchema();
const KEY_RE = /^[a-z][a-z0-9_]{0,59}$/;

export type NormalizeResult = { items: { name: string; key: string }[]; provider: ProviderName; model: string };

/** 재료 이름들 → 표준 영문 key. AI가 빠뜨리거나 이상한 값을 주면 그 이름만 임시 key로 둔다 */
export async function normalizeNames(ai: AiProvider, names: string[]): Promise<NormalizeResult> {
  const out = await ai.generateJson({
    system: NORMALIZE_SYSTEM_PROMPT,
    parts: [{ type: "text", text: buildNormalizeUserMessage(names) }],
    schema: SCHEMA,
    effort: "low",
    maxTokens: 4000,
  });
  const parsed = parseAiJson(out.text, NormalizedNames);
  const items = names.map((name, i) => {
    const byIndex = parsed.items[i];
    const hit = byIndex && byIndex.name.trim() === name.trim() ? byIndex : parsed.items.find((x) => x.name.trim() === name.trim());
    const key = hit?.key.trim().toLowerCase() ?? "";
    return { name, key: KEY_RE.test(key) ? key : provisionalKey(name) };
  });
  return { items, provider: ai.name, model: out.model };
}
