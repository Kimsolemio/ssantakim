import { z } from "zod";
import { RecipeDraft, ReceiptScan, NormalizedNames, ImportResult, SuggestResult, AskResult, AdaptResult, SubstituteResult } from "./schemas";

/**
 * AI 구조화 출력(Gemini responseJsonSchema 등)용 JSON 스키마.
 * 제공자마다 지원이 다른 제약(minLength, minimum, minItems, default 등)은 제거하고,
 * enum·anyOf·format(uri)·additionalProperties:false 는 유지한다.
 * 제거된 제약은 응답을 zod로 다시 검증할 때 적용된다.
 */
const UNSUPPORTED_KEYS = new Set([
  "minLength", "maxLength", "pattern", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum",
  "multipleOf", "minItems", "maxItems", "uniqueItems", "default", "$schema", "id", "$id",
]);

export function sanitizeSchemaForAi(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(sanitizeSchemaForAi);
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (UNSUPPORTED_KEYS.has(k)) continue;
      out[k] = sanitizeSchemaForAi(v);
    }
    if (out.type === "object" && out.properties && out.additionalProperties === undefined) {
      out.additionalProperties = false;
    }
    return out;
  }
  return node;
}

export function recipeDraftJsonSchema(): Record<string, unknown> {
  return sanitizeSchemaForAi(z.toJSONSchema(RecipeDraft)) as Record<string, unknown>;
}

export function receiptScanJsonSchema(): Record<string, unknown> {
  return sanitizeSchemaForAi(z.toJSONSchema(ReceiptScan)) as Record<string, unknown>;
}

export function normalizedNamesJsonSchema(): Record<string, unknown> {
  return sanitizeSchemaForAi(z.toJSONSchema(NormalizedNames)) as Record<string, unknown>;
}

export function importResultJsonSchema(): Record<string, unknown> {
  return sanitizeSchemaForAi(z.toJSONSchema(ImportResult)) as Record<string, unknown>;
}

export function suggestResultJsonSchema(): Record<string, unknown> {
  return sanitizeSchemaForAi(z.toJSONSchema(SuggestResult)) as Record<string, unknown>;
}

export function askResultJsonSchema(): Record<string, unknown> {
  return sanitizeSchemaForAi(z.toJSONSchema(AskResult)) as Record<string, unknown>;
}

export function adaptResultJsonSchema(): Record<string, unknown> {
  return sanitizeSchemaForAi(z.toJSONSchema(AdaptResult)) as Record<string, unknown>;
}

export function substituteResultJsonSchema(): Record<string, unknown> {
  return sanitizeSchemaForAi(z.toJSONSchema(SubstituteResult)) as Record<string, unknown>;
}
