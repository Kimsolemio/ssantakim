import { claudeProvider, CLAUDE_DEFAULT_MODEL, CLAUDE_FAST_DEFAULT_MODEL } from "./claude";
import { geminiProvider, GEMINI_DEFAULT_MODEL } from "./gemini";
import { GenerationError, type AiProvider, type AiTier, type ProviderName } from "./types";

export * from "./types";
export { CLAUDE_DEFAULT_MODEL, CLAUDE_FAST_DEFAULT_MODEL, GEMINI_DEFAULT_MODEL };

export type AiEnv = {
  /** auto(기본) | claude | gemini. auto는 Claude 키가 있으면 Claude, 없으면 Gemini */
  AI_PROVIDER?: string;
  ANTHROPIC_API_KEY?: string;
  CLAUDE_MODEL?: string;
  /** 가볍고 잦은 일(이름 정리·물어보기·대체 재료)에 쓰는 모델. 기본 claude-haiku-5-5 */
  CLAUDE_FAST_MODEL?: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
};

function pick(env: AiEnv): ProviderName {
  const pref = (env.AI_PROVIDER || "auto").trim().toLowerCase();
  if (pref === "claude" || pref === "gemini") return pref;
  if (pref !== "auto") throw new GenerationError(`AI_PROVIDER 값이 올바르지 않습니다: ${pref} (auto / claude / gemini)`, 500);
  if (env.ANTHROPIC_API_KEY) return "claude";
  if (env.GEMINI_API_KEY) return "gemini";
  throw new GenerationError("Worker에 AI 키가 없습니다 (ANTHROPIC_API_KEY 또는 GEMINI_API_KEY)", 500);
}

export function selectProvider(env: AiEnv, fetchImpl?: typeof fetch, tier: AiTier = "main"): AiProvider {
  const name = pick(env);
  if (name === "claude") {
    if (!env.ANTHROPIC_API_KEY) throw new GenerationError("AI_PROVIDER=claude 인데 ANTHROPIC_API_KEY가 없습니다", 500);
    const model = tier === "fast" ? env.CLAUDE_FAST_MODEL || CLAUDE_FAST_DEFAULT_MODEL : env.CLAUDE_MODEL;
    return claudeProvider({ apiKey: env.ANTHROPIC_API_KEY, model, fetch: fetchImpl });
  }
  if (!env.GEMINI_API_KEY) throw new GenerationError("AI_PROVIDER=gemini 인데 GEMINI_API_KEY가 없습니다", 500);
  return geminiProvider({ apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL, fetch: fetchImpl });
}

/** /health 에 보여줄 현재 설정 (키 값은 절대 노출하지 않는다) */
export function describeAi(env: AiEnv): { provider: ProviderName | null; model: string | null; fastModel?: string | null; webSearch?: boolean; error?: string } {
  try {
    const name = pick(env);
    if (name === "claude") return { provider: name, model: env.CLAUDE_MODEL || CLAUDE_DEFAULT_MODEL, fastModel: env.CLAUDE_FAST_MODEL || CLAUDE_FAST_DEFAULT_MODEL, webSearch: true };
    return { provider: name, model: env.GEMINI_MODEL || GEMINI_DEFAULT_MODEL };
  } catch (e) {
    return { provider: null, model: null, error: e instanceof Error ? e.message : String(e) };
  }
}
