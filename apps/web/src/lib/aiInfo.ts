import { useEffect, useState } from "react";
import { workerConfigured, workerUrl } from "./api";

export type AiProviderName = "claude" | "gemini";
export type AiInfo = {
  /** 기본으로 쓰는 AI */
  provider: AiProviderName | null;
  /** Gemini 키도 있는가 (유튜브 영상 분석은 Gemini로 간다) */
  gemini: boolean;
  /** Claude 웹 검색을 쓸 수 있는가 (인기 레시피 찾아보기) */
  webSearch: boolean;
};

let cached: Promise<AiInfo> | null = null;
const NONE: AiInfo = { provider: null, gemini: false, webSearch: false };

/** Worker /health 로 지금 어떤 AI를 쓰는지 한 번만 물어본다 (로그인 없이 공개되는 정보) */
function fetchInfo(): Promise<AiInfo> {
  if (!workerConfigured) return Promise.resolve(NONE);
  const p: Promise<AiInfo> = cached ?? fetch(`${workerUrl}/health`)
    .then((r) => (r.ok ? r.json() : null))
    .then((j: { ai?: { provider?: string | null; webSearch?: boolean }; configured?: { gemini?: boolean } } | null): AiInfo => {
      const name = j?.ai?.provider;
      const provider: AiProviderName | null = name === "claude" || name === "gemini" ? name : null;
      return { provider, gemini: j?.configured?.gemini === true || provider === "gemini", webSearch: j?.ai?.webSearch === true };
    })
    .catch(() => { cached = null; return NONE; });
  cached = p;
  return p;
}

export function useAiInfo(): AiInfo {
  const [info, setInfo] = useState<AiInfo>(NONE);
  useEffect(() => { let alive = true; void fetchInfo().then((v) => { if (alive) setInfo(v); }); return () => { alive = false; }; }, []);
  return info;
}
