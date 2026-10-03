import { z } from "zod";
import { RecipeDraft } from "./schemas";

/**
 * Claude 구조화 출력(output_config.format)용 JSON 스키마.
 * API가 지원하지 않는 제약(minLength, minimum, minItems, default 등)은 제거하고,
 * enum·anyOf·format(uri)·additionalProperties:false 는 유지한다.
 * 제거된 제약은 응답을 zod로 다시 검증할 때 적용된다.
 */
const UNSUPPORTED_KEYS = new Set([
  "minLength", "maxLength", "pattern", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum",
  "multipleOf", "minItems", "maxItems", "uniqueItems", "default", "$schema", "id", "$id",
]);

export function sanitizeForClaude(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(sanitizeForClaude);
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (UNSUPPORTED_KEYS.has(k)) continue;
      out[k] = sanitizeForClaude(v);
    }
    if (out.type === "object" && out.properties && out.additionalProperties === undefined) {
      out.additionalProperties = false;
    }
    return out;
  }
  return node;
}

export function recipeDraftJsonSchema(): Record<string, unknown> {
  return sanitizeForClaude(z.toJSONSchema(RecipeDraft)) as Record<string, unknown>;
}
