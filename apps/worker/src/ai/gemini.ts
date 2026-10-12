/**
 * Gemini API (무료 등급) — Claude 키가 없을 때의 대안. SDK 없이 REST 로 호출한다.
 * 구조화 출력: generationConfig.responseMimeType=application/json + responseJsonSchema
 */
import { GenerationError, lazyFetch, type AiPart, type AiProvider, type JsonRequest, type JsonResult } from "./types";

export const GEMINI_DEFAULT_MODEL = "gemini-2.5-flash";

type GeminiResponse = {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
  error?: { code?: number; message?: string; status?: string };
};

function toGeminiPart(part: AiPart) {
  if (part.type === "text") return { text: part.text };
  if (part.type === "youtube") return { fileData: { fileUri: part.url } }; // 공개 유튜브 영상은 URL만으로 이해한다
  return { inlineData: { mimeType: part.mediaType, data: part.data } };
}

export function geminiProvider(opts: { apiKey: string; model?: string; fetch?: typeof fetch }): AiProvider {
  const model = opts.model || GEMINI_DEFAULT_MODEL;
  const doFetch = opts.fetch ?? lazyFetch;
  return {
    name: "gemini",
    model,
    async generateJson(req: JsonRequest): Promise<JsonResult> {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
      const body = {
        systemInstruction: { parts: [{ text: req.system }] },
        contents: [{ role: "user", parts: req.parts.map(toGeminiPart) }],
        generationConfig: { responseMimeType: "application/json", responseJsonSchema: req.schema, maxOutputTokens: req.maxTokens ?? 8192, temperature: 0.7 },
      };
      let res: Response;
      try {
        res = await doFetch(url, { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": opts.apiKey }, body: JSON.stringify(body) });
      } catch (e) {
        throw new GenerationError(`AI 서버에 연결하지 못했습니다: ${e instanceof Error ? e.message : String(e)}`, 502);
      }
      let data: GeminiResponse;
      try { data = (await res.json()) as GeminiResponse; } catch { throw new GenerationError(`AI 응답을 읽지 못했습니다 (${res.status})`, 502); }

      if (!res.ok) {
        const status = data.error?.status ?? "", msg = data.error?.message ?? res.statusText;
        if (res.status === 400 && /API key/i.test(msg)) throw new GenerationError("AI API 키가 올바르지 않습니다 (Worker 설정 확인)", 502);
        if (res.status === 429 || status === "RESOURCE_EXHAUSTED") throw new GenerationError("무료 사용량 한도에 걸렸습니다. 1분 뒤 다시 시도하세요 (하루 한도면 내일)", 429);
        if (res.status === 404) throw new GenerationError(`AI 모델을 찾을 수 없습니다: ${model} (GEMINI_MODEL 확인)`, 502);
        throw new GenerationError(`AI 호출 실패 (${res.status}): ${msg}`, 502);
      }
      if (data.promptFeedback?.blockReason) throw new GenerationError("AI가 이 요청을 처리할 수 없다고 판단했습니다", 422);
      const cand = data.candidates?.[0];
      const finish = cand?.finishReason ?? "";
      if (finish === "SAFETY" || finish === "PROHIBITED_CONTENT") throw new GenerationError("AI가 이 요청에 응답할 수 없다고 판단했습니다", 422);
      if (finish === "MAX_TOKENS") throw new GenerationError("응답이 너무 길어 잘렸습니다. 다시 시도하세요", 502);
      const text = (cand?.content?.parts ?? []).map((p) => p.text ?? "").join("");
      if (!text) throw new GenerationError("AI가 빈 응답을 보냈습니다. 다시 시도하세요", 502);
      const u = data.usageMetadata ?? {};
      return { text, model, usage: { input: u.promptTokenCount ?? 0, output: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0) } };
    },
  };
}
