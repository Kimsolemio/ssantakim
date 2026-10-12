import Anthropic from "@anthropic-ai/sdk";
import { GenerationError, lazyFetch, type AiPart, type AiProvider, type JsonRequest, type JsonResult } from "./types";

export const CLAUDE_DEFAULT_MODEL = "claude-opus-5-5";
/** 안전 분류기가 거절하면 같은 호출 안에서 알맞은 대체 모델로 다시 시도한다 */
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

function toClaudeContent(part: AiPart): Anthropic.Beta.BetaContentBlockParam {
  if (part.type === "text") return { type: "text", text: part.text };
  if (part.type === "youtube") throw new GenerationError("Claude는 유튜브 영상을 직접 볼 수 없습니다 (Gemini 키 필요)", 500);
  return { type: "image", source: { type: "base64", media_type: part.mediaType, data: part.data } };
}

function mapError(e: unknown): GenerationError {
  if (e instanceof GenerationError) return e;
  if (e instanceof Anthropic.AuthenticationError) return new GenerationError("AI API 키가 올바르지 않습니다 (Worker 설정 확인)", 502);
  if (e instanceof Anthropic.PermissionDeniedError) return new GenerationError("이 API 키로는 해당 모델을 쓸 수 없습니다 (CLAUDE_MODEL 확인)", 502);
  if (e instanceof Anthropic.NotFoundError) return new GenerationError("AI 모델을 찾을 수 없습니다 (CLAUDE_MODEL 확인)", 502);
  if (e instanceof Anthropic.RateLimitError) return new GenerationError("AI 요청이 너무 많습니다. 잠시 후 다시 시도하세요", 429);
  if (e instanceof Anthropic.BadRequestError) return new GenerationError(`AI 요청이 거부되었습니다: ${e.message}`, 502);
  if (e instanceof Anthropic.InternalServerError) return new GenerationError("AI 서버가 바쁩니다. 잠시 후 다시 시도하세요", 503);
  if (e instanceof Anthropic.APIConnectionError) return new GenerationError("AI 서버에 연결하지 못했습니다", 502);
  if (e instanceof Anthropic.APIError) return new GenerationError(`AI 호출 실패 (${e.status}): ${e.message}`, 502);
  return new GenerationError(`AI 호출 실패: ${e instanceof Error ? e.message : String(e)}`, 502);
}

export function claudeProvider(opts: { apiKey: string; model?: string; fetch?: typeof fetch }): AiProvider {
  const model = opts.model || CLAUDE_DEFAULT_MODEL;
  const client = new Anthropic({
    apiKey: opts.apiKey,
    authToken: null,                       // 환경변수의 다른 인증 정보를 끌어오지 않게
    baseURL: "https://api.anthropic.com",  // ANTHROPIC_BASE_URL 환경변수에 영향받지 않게
    maxRetries: 2,
    timeout: 5 * 60 * 1000,
    fetch: opts.fetch ?? lazyFetch,
  });

  return {
    name: "claude",
    model,
    async generateJson(req: JsonRequest): Promise<JsonResult> {
      const base = {
        model,
        max_tokens: req.maxTokens ?? 16000,
        system: req.system,
        messages: [{ role: "user" as const, content: req.parts.map(toClaudeContent) }],
        output_config: { effort: req.effort ?? "medium", format: { type: "json_schema" as const, schema: req.schema } },
      };

      let msg: Anthropic.Beta.BetaMessage;
      try {
        msg = await client.beta.messages.create({ ...base, betas: [FALLBACK_BETA], fallbacks: "default" });
      } catch (e) {
        if (!(e instanceof Anthropic.BadRequestError)) throw mapError(e);
        // 대체 모델 기능(베타)이 거부되는 경우를 대비해 한 번은 일반 요청으로 다시 시도한다
        console.warn(JSON.stringify({ ai: "claude", retryWithoutFallbacks: true, reason: e.message }));
        try { msg = await client.beta.messages.create(base); } catch (e2) { throw mapError(e2); }
      }

      if (msg.stop_reason === "refusal") throw new GenerationError("AI가 이 요청에 응답할 수 없다고 판단했습니다", 422);
      if (msg.stop_reason === "max_tokens") throw new GenerationError("응답이 너무 길어 잘렸습니다. 다시 시도하세요", 502);
      const text = msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
      if (!text) throw new GenerationError("AI가 빈 응답을 보냈습니다. 다시 시도하세요", 502);
      return { text, model: msg.model, usage: { input: msg.usage.input_tokens, output: msg.usage.output_tokens } };
    },
  };
}
