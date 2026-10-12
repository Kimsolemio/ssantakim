/**
 * 비용 차단 장치. AI 호출은 돈이 들므로 기본값을 "막힘"으로 둔다.
 * ① 허용 목록(ALLOWED_EMAILS)이 비어 있으면 아무도 쓸 수 없다 ("*"를 적어야 모두 허용)
 * ② 이메일 인증이 끝난 계정만 허용 목록과 맞춰 본다
 * ③ 1분에 몇 번 (AI_LIMIT 바인딩, 설정 없이 동작) + 하루에 몇 번 (USAGE KV, 선택)
 */
import type { Verified } from "./auth";

export class GuardError extends Error {
  constructor(public status: number, message: string, public code?: string) { super(message); }
}

export type GuardEnv = {
  ALLOWED_EMAILS?: string;
  /** 1분 단위 호출 제한 (wrangler.toml [[ratelimits]]) */
  AI_LIMIT?: RateLimit;
  /** 하루 사용량 기록 (선택). wrangler kv namespace create USAGE */
  USAGE?: KVNamespace;
  DAILY_LIMIT_PER_USER?: string;
  DAILY_LIMIT_TOTAL?: string;
};

/** 경로별 비용 가중치 (레시피 1회 = 1) */
export const ROUTE_COST: Record<string, number> = {
  "/recipe": 1,
  "/pantry/receipt": 2,
  "/import/url": 1,
  "/import/text": 1,
  "/normalize": 0.25,
};

export function allowList(env: GuardEnv): string[] {
  return (env.ALLOWED_EMAILS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

export function checkAllowed(env: GuardEnv, user: Verified): void {
  const allowed = allowList(env);
  if (allowed.length === 0) {
    throw new GuardError(403, "Worker에 ALLOWED_EMAILS(가족 이메일 목록)가 설정되지 않아 AI를 쓸 수 없어요", "not_configured");
  }
  if (allowed.includes("*")) return;
  if (!user.email || !user.emailVerified || !allowed.includes(user.email.toLowerCase())) {
    throw new GuardError(403, "이 앱을 사용할 수 있는 계정이 아닙니다", "not_allowed");
  }
}

const num = (v: string | undefined, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
};

/** 오늘(한국 시간) 날짜. 하루 한도는 한국 자정에 초기화된다 */
export function kstDay(now = Date.now()): string {
  return new Date(now + 9 * 3600_000).toISOString().slice(0, 10);
}

/**
 * 호출 전에 한도를 확인하고 사용량을 미리 더한다. KV는 동시에 여러 요청이 오면 조금 넘칠 수 있지만,
 * 가족 규모에서는 충분하다 (정확한 상한은 Anthropic 콘솔의 월 사용 한도로 건다).
 */
export async function chargeUsage(env: GuardEnv, uid: string, route: string, now = Date.now()): Promise<void> {
  const cost = ROUTE_COST[route] ?? 1;
  if (env.AI_LIMIT) {
    const { success } = await env.AI_LIMIT.limit({ key: uid });
    if (!success) throw new GuardError(429, "너무 자주 요청했어요. 1분 뒤에 다시 해 주세요", "rate_limited");
  }
  if (!env.USAGE) return;
  const day = kstDay(now);
  const userKey = `u:${day}:${uid}`, totalKey = `t:${day}`;
  const [u, t] = await Promise.all([env.USAGE.get(userKey), env.USAGE.get(totalKey)]);
  const used = Number(u ?? 0), total = Number(t ?? 0);
  const perUser = num(env.DAILY_LIMIT_PER_USER, 40), all = num(env.DAILY_LIMIT_TOTAL, 150);
  if (used + cost > perUser) throw new GuardError(429, `오늘 쓸 수 있는 AI 사용량(${perUser}회)을 다 썼어요. 내일 다시 쓸 수 있어요`, "daily_user");
  if (total + cost > all) throw new GuardError(429, "오늘 가족 전체 AI 사용량을 다 썼어요. 내일 다시 쓸 수 있어요", "daily_total");
  const ttl = { expirationTtl: 60 * 60 * 48 };
  await Promise.all([
    env.USAGE.put(userKey, String(used + cost), ttl),
    env.USAGE.put(totalKey, String(total + cost), ttl),
  ]);
}

export async function usageToday(env: GuardEnv, uid: string, now = Date.now()): Promise<{ used: number; limit: number } | null> {
  if (!env.USAGE) return null;
  const used = Number((await env.USAGE.get(`u:${kstDay(now)}:${uid}`)) ?? 0);
  return { used, limit: num(env.DAILY_LIMIT_PER_USER, 40) };
}
