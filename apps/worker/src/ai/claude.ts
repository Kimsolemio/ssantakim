import Anthropic from "@anthropic-ai/sdk";
import {
  billedError, GenerationError, lazyFetch,
  type AiPart, type AiProvider, type JsonRequest, type JsonResult, type ResearchRequest, type ResearchResult,
} from "./types";

export const CLAUDE_DEFAULT_MODEL = "claude-opus-5-5";
/** 가볍고 잦은 일에 쓰는 빠르고 싼 모델 */
export const CLAUDE_FAST_DEFAULT_MODEL = "claude-haiku-5-5";
/** 대체 모델 기능은 Opus·Sonnet만 (Haiku는 없다) */
const supportsFallbacks = (model: string) => !/haiku/i.test(model);
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
        // 지시문은 블록으로 보내고, 반복 호출이면 캐시 표시를 붙인다 (Opus·Haiku 5.5는 512토큰 이상이면 캐시된다)
        system: [{ type: "text" as const, text: req.system, ...(req.cache ? { cache_control: { type: "ephemeral" as const } } : {}) }],
        messages: [{ role: "user" as const, content: req.parts.map(toClaudeContent) }],
        output_config: { effort: req.effort ?? "medium", format: { type: "json_schema" as const, schema: req.schema } },
      };

      let msg: Anthropic.Beta.BetaMessage;
      try {
        msg = supportsFallbacks(model)
          ? await client.beta.messages.create({ ...base, betas: [FALLBACK_BETA], fallbacks: "default" })
          : await client.beta.messages.create(base);
      } catch (e) {
        if (!(e instanceof Anthropic.BadRequestError) || !supportsFallbacks(model)) throw mapError(e);
        // 대체 모델 기능(베타)이 거부되는 경우를 대비해 한 번은 일반 요청으로 다시 시도한다
        console.warn(JSON.stringify({ ai: "claude", retryWithoutFallbacks: true, reason: e.message }));
        try { msg = await client.beta.messages.create(base); } catch (e2) { throw mapError(e2); }
      }

      if (msg.stop_reason === "refusal") throw billedError("AI가 이 요청에 응답할 수 없다고 판단했습니다", 422);
      if (msg.stop_reason === "max_tokens") throw billedError("응답이 너무 길어 잘렸습니다. 다시 시도하세요", 502);
      const text = msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
      if (!text) throw billedError("AI가 빈 응답을 보냈습니다. 다시 시도하세요", 502);
      return { text, model: msg.model, usage: usageOf(msg.usage) };
    },

    /**
     * 웹 검색·웹 읽기로 자료를 모은다. 구조화 출력은 웹 검색의 출처 표시(citations)와 같이 쓸 수 없어서,
     * 여기서는 자유 글로 받고 정리(JSON)는 다음 호출에서 한다.
     */
    async research(req: ResearchRequest): Promise<ResearchResult> {
      const tools: Anthropic.Beta.BetaToolUnion[] = [];
      if (req.searches > 0) tools.push({ type: "web_search_20260318", name: "web_search", max_uses: req.searches, allowed_callers: ["direct"], user_location: { type: "approximate", country: "KR", timezone: "Asia/Seoul" } });
      if (req.fetches > 0) tools.push({ type: "web_fetch_20260318", name: "web_fetch", max_uses: req.fetches, allowed_callers: ["direct"], max_content_tokens: 12000 });
      const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: req.prompt }];
      const sources = new Map<string, string | null>();
      let text = "", searches = 0, lastModel = model;
      const usage = { input: 0, output: 0 };
      // 서버 도구 반복이 길면 pause_turn 으로 멈춘다: 받은 내용을 그대로 돌려보내 이어 가게 한다 (최대 4번)
      for (let round = 0; round < 4; round++) {
        let msg: Anthropic.Beta.BetaMessage;
        try {
          msg = await client.beta.messages.create({ model, max_tokens: req.maxTokens ?? 8000, system: req.system, messages, tools, output_config: { effort: "low" } });
        } catch (e) { throw mapError(e); }
        lastModel = msg.model;
        const u = usageOf(msg.usage); usage.input += u.input; usage.output += u.output;
        for (const b of msg.content) {
          if (b.type === "text") {
            text += b.text;
            for (const c of b.citations ?? []) if ("url" in c && typeof c.url === "string") sources.set(c.url, ("title" in c ? (c.title as string | null) : null) ?? sources.get(c.url) ?? null);
          } else if (b.type === "server_tool_use" && b.name === "web_search") {
            searches++;
          } else if (b.type === "web_fetch_tool_result" && b.content && "url" in b.content && typeof b.content.url === "string") {
            if (!sources.has(b.content.url)) sources.set(b.content.url, null);
          }
        }
        if (msg.stop_reason === "refusal") throw billedError("AI가 이 요청에 응답할 수 없다고 판단했습니다", 422);
        if (msg.stop_reason !== "pause_turn") break;
        messages.push({ role: "assistant", content: msg.content as Anthropic.Beta.BetaContentBlockParam[] });
      }
      return { text: text.trim(), sources: [...sources].map(([url, title]) => ({ url, title })).slice(0, 8), searches, model: lastModel, usage };
    },
  };
}

/** 캐시에서 읽은 입력도 합쳐서 센다 (비용 기록용) */
function usageOf(u: Anthropic.Beta.BetaUsage): { input: number; output: number } {
  return { input: u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), output: u.output_tokens };
}
