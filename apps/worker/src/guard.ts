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

/**
 * 경로별 비용 가중치 (레시피 1회 = 1). 이름 정리(/normalize)는 저장할 때마다 뒤에서 불리는 아주 작은 호출이라
 * 하루 한도에서 세지 않는다 (KV 쓰기 한도를 아끼고, 같은 키에 몰려 쓰다 실패하는 것도 막는다). 1분 한도는 적용된다.
 */
export const ROUTE_COST: Record<string, number> = {
  "/recipe": 1,
  "/pantry/receipt": 2,
  "/import/url": 1,
  "/import/text": 1,
  "/normalize": 0,
  "/suggest": 1,
  "/ask": 0.5,
  "/adapt": 1,
  "/substitute": 0.5,
};

export function allowList(env: GuardEnv): string[] {
  return (env.ALLOWED_EMAILS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

export function checkAllowed(env: GuardEnv, user: Verified): void {
  const allowed = allowList(env);
  if (allowed.length === 0) {
    throw new GuardError(403, "AI를 쓸 가족 이메일이 아직 등록되지 않았어요. 앱을 설치한 사람에게 알려 주세요 (Worker 설정 ALLOWED_EMAILS)", "not_configured");
  }
  if (allowed.includes("*")) return;
  if (!user.email || !user.emailVerified || !allowed.includes(user.email.toLowerCase())) {
    throw new GuardError(403, "이 구글 계정은 AI 기능을 쓸 수 있는 가족 목록에 없어요. 앱을 설치한 사람에게 이메일을 알려 주세요", "not_allowed");
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
/**
 * 한도 확인 후 사용량을 더한다. 돌려주는 값: 실제로 더한 양 (실패 시 환불에 쓴다).
 * 한계: KV는 읽고-쓰기가 원자적이지 않아 동시에 몰린 요청은 덜 셀 수 있다 (1분 한도와 Anthropic 월 한도가 막는다).
 * KV 자체가 실패하면(쓰기 한도 등) 요청을 막지 않고 기록만 건너뛴다.
 */
export async function chargeUsage(env: GuardEnv, uid: string, route: string, now = Date.now(), costOverride?: number): Promise<number> {
  const cost = costOverride ?? ROUTE_COST[route] ?? 1;
  if (env.AI_LIMIT) {
    const { success } = await env.AI_LIMIT.limit({ key: uid });
    if (!success) throw new GuardError(429, "너무 자주 요청했어요. 1분 뒤에 다시 해 주세요", "rate_limited");
  }
  if (!env.USAGE || cost <= 0) return 0;
  const day = kstDay(now);
  const userKey = `u:${day}:${uid}`, totalKey = `t:${day}`;
  let used = 0, total = 0;
  try {
    const [u, t] = await Promise.all([env.USAGE.get(userKey), env.USAGE.get(totalKey)]);
    used = Number(u ?? 0); total = Number(t ?? 0);
  } catch (e) { console.warn("usage read failed", e); return 0; }
  const perUser = num(env.DAILY_LIMIT_PER_USER, 40), all = num(env.DAILY_LIMIT_TOTAL, 150);
  if (used + cost > perUser) throw new GuardError(429, `오늘 쓸 수 있는 AI 사용량(${perUser}회)을 다 썼어요. 내일 다시 쓸 수 있어요`, "daily_user");
  if (total + cost > all) throw new GuardError(429, "오늘 가족 전체 AI 사용량을 다 썼어요. 내일 다시 쓸 수 있어요", "daily_total");
  const ttl = { expirationTtl: 60 * 60 * 48 };
  try {
    await Promise.all([
      env.USAGE.put(userKey, String(used + cost), ttl),
      env.USAGE.put(totalKey, String(total + cost), ttl),
    ]);
  } catch (e) { console.warn("usage write failed", e); return 0; }
  return cost;
}

/** AI 호출이 실패하면 미리 더한 하루 사용량을 돌려준다 (1분 한도는 돌려줄 수 없다) */
export async function refundUsage(env: GuardEnv, uid: string, cost: number, now = Date.now()): Promise<void> {
  if (!env.USAGE || cost <= 0) return;
  const day = kstDay(now);
  const keys = [`u:${day}:${uid}`, `t:${day}`];
  const vals = await Promise.all(keys.map((k) => env.USAGE!.get(k)));
  await Promise.all(keys.map((k, i) => env.USAGE!.put(k, String(Math.max(0, Number(vals[i] ?? 0) - cost)), { expirationTtl: 60 * 60 * 48 })));
}

/** 오늘 사용량. remaining 은 내 한도와 가족 전체 한도 중 적은 쪽 */
export async function usageToday(env: GuardEnv, uid: string, now = Date.now()): Promise<{ used: number; limit: number; familyUsed: number; familyLimit: number; remaining: number } | null> {
  if (!env.USAGE) return null;
  const day = kstDay(now);
  const [u, t] = await Promise.all([env.USAGE.get(`u:${day}:${uid}`), env.USAGE.get(`t:${day}`)]).catch(() => [null, null]);
  const used = Number(u ?? 0), familyUsed = Number(t ?? 0);
  const limit = num(env.DAILY_LIMIT_PER_USER, 40), familyLimit = num(env.DAILY_LIMIT_TOTAL, 150);
  return { used, limit, familyUsed, familyLimit, remaining: Math.max(0, Math.min(limit - used, familyLimit - familyUsed)) };
}
