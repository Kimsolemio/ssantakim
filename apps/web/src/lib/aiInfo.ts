import { useEffect, useState } from "react";
import { workerConfigured, workerUrl } from "./api";

export type AiProviderName = "claude" | "gemini";

let cached: Promise<AiProviderName | null> | null = null;

/** Worker /health 로 지금 어떤 AI를 쓰는지 한 번만 물어본다 (로그인 없이 공개되는 정보) */
function fetchProvider(): Promise<AiProviderName | null> {
  if (!workerConfigured) return Promise.resolve(null);
  cached ??= fetch(`${workerUrl}/health`)
    .then((r) => (r.ok ? r.json() : null))
    .then((j: { ai?: { provider?: string | null } } | null) => (j?.ai?.provider === "claude" || j?.ai?.provider === "gemini" ? j.ai.provider : null))
    .catch(() => { cached = null; return null; });
  return cached;
}

export function useAiProvider(): AiProviderName | null {
  const [p, setP] = useState<AiProviderName | null>(null);
  useEffect(() => { let alive = true; void fetchProvider().then((v) => { if (alive) setP(v); }); return () => { alive = false; }; }, []);
  return p;
}
