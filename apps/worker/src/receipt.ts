import { ReceiptScan, receiptScanJsonSchema } from "@cook/shared";
import type { AiProvider, ImageMediaType, ProviderName } from "./ai";
import { RECEIPT_SYSTEM_PROMPT, PANTRY_PHOTO_SYSTEM_PROMPT, buildReceiptUserMessage, buildPantryPhotoUserMessage } from "./prompts";
import { parseAiJson } from "./recipe";

const RECEIPT_SCHEMA = receiptScanJsonSchema();

export type ReceiptResult = { scan: ReceiptScan; provider: ProviderName; model: string; usage: { input: number; output: number } };

/** 영수증·주문내역 캡처(receipt) 또는 식재료 사진(photo) → 품목 목록 */
export async function scanReceipt(
  ai: AiProvider,
  input: { images: { mediaType: ImageMediaType; data: string }[]; today: string; mode?: "receipt" | "photo" },
): Promise<ReceiptResult> {
  const photo = input.mode === "photo";
  const msg = { today: input.today, imageCount: input.images.length };
  const out = await ai.generateJson({
    system: photo ? PANTRY_PHOTO_SYSTEM_PROMPT : RECEIPT_SYSTEM_PROMPT,
    parts: [
      ...input.images.map((im) => ({ type: "image" as const, mediaType: im.mediaType, data: im.data })),
      { type: "text" as const, text: photo ? buildPantryPhotoUserMessage(msg) : buildReceiptUserMessage(msg) },
    ],
    schema: RECEIPT_SCHEMA,
    effort: "medium",
    maxTokens: 16000,
  });
  const scan = parseAiJson(out.text, ReceiptScan);
  // 사진에는 가게·구매일이 없다 (AI가 적어도 무시)
  return { scan: photo ? { ...scan, store: null, purchasedAt: null } : scan, provider: ai.name, model: out.model, usage: out.usage };
}
