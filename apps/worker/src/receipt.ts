import { ReceiptScan, receiptScanJsonSchema } from "@cook/shared";
import type { AiProvider, ImageMediaType, ProviderName } from "./ai";
import { RECEIPT_SYSTEM_PROMPT, buildReceiptUserMessage } from "./prompts";
import { parseAiJson } from "./recipe";

const RECEIPT_SCHEMA = receiptScanJsonSchema();

export type ReceiptResult = { scan: ReceiptScan; provider: ProviderName; model: string; usage: { input: number; output: number } };

/** 영수증·주문내역 캡처 사진 → 장본 품목 목록 */
export async function scanReceipt(
  ai: AiProvider,
  input: { images: { mediaType: ImageMediaType; data: string }[]; today: string },
): Promise<ReceiptResult> {
  const out = await ai.generateJson({
    system: RECEIPT_SYSTEM_PROMPT,
    parts: [
      ...input.images.map((im) => ({ type: "image" as const, mediaType: im.mediaType, data: im.data })),
      { type: "text" as const, text: buildReceiptUserMessage({ today: input.today, imageCount: input.images.length }) },
    ],
    schema: RECEIPT_SCHEMA,
    effort: "medium",
    maxTokens: 16000,
  });
  return { scan: parseAiJson(out.text, ReceiptScan), provider: ai.name, model: out.model, usage: out.usage };
}
