/**
 * 비용 차단 장치. AI 호출은 돈이 들므로 기본값을 "막힘"으로 둔다.
 * ① 허용 목록(ALLOWED_EMAILS)이 비어 있으면 아무도 쓸 수 없다 ("*"를 적어야 모두 허용)
 * ② 이메일 인증이 끝난 계정만 허용 목록과 맞춰 본다
 * ②' 허용 목록에 없어도, 허용된 사람(설치한 사람)이 있는 가족에 초대 코드로 들어온 사람은 쓸 수 있다
 *     (Firestore 규칙이 가족 참여는 초대 코드로만, memberEmails 는 각자 자기 인증된 이메일로만 쓰게 막는다)
 * ③ 1분에 몇 번 (AI_LIMIT 바인딩, 설정 없이 동작) + 하루에 몇 번 (USAGE KV. 자동 배포가 만든다. ②'는 이게 있어야만 열린다)
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

/** 가족 확인에 필요한 것: 요청한 사람의 Firebase ID 토큰(그 사람 권한으로 가족 문서를 읽는다)과 앱이 알려 준 가족 ID */
export type FamilyProof = { projectId: string; idToken: string; familyId: string | null; fetch?: typeof fetch };

const NOT_ALLOWED = "이 계정은 아직 AI를 쓸 수 없어요. 앱을 설치한 사람의 가족에 초대 코드로 참여했는지 확인해 주세요. 참여했는데도 이러면, 설치한 사람이 새 버전 앱을 한 번 열어 주면 풀려요";

function emailAllowed(allowed: string[], user: Verified): boolean {
  return !!user.email && user.emailVerified && allowed.includes(user.email.toLowerCase());
}

/** 같은 사람·같은 가족의 허용은 10분 기억한다 (AI 요청마다 Firestore를 읽지 않게) */
const familyMemo = new Map<string, number>();
/** 거절은 사람 단위로 1분: 가족 ID를 바꿔 가며 Firestore 읽기를 늘리지 못하게 */
const deniedUntil = new Map<string, number>();
export function resetFamilyMemo() { familyMemo.clear(); deniedUntil.clear(); }

/** Firestore를 잠깐 못 읽었을 때 (거절이 아니라 다시 해 볼 일) */
export class FamilyCheckError extends Error {}

type FsValue = { stringValue?: string; arrayValue?: { values?: FsValue[] }; mapValue?: { fields?: Record<string, FsValue> } };

/**
 * 요청한 사람의 토큰으로 가족 문서를 읽는다. 보안 규칙상 가족이 아니면 읽기부터 거절된다.
 * 가족 구성원 중 한 명이라도 허용 목록 이메일(각자 자기 인증된 이메일로만 적을 수 있다)이면 허용.
 */
export async function familyAllowed(allowed: string[], user: Verified, proof: FamilyProof, now = Date.now()): Promise<boolean> {
  const fid = proof.familyId?.trim() ?? "";
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(fid)) return false;
  const memoKey = `${user.uid}|${fid}`;
  if ((familyMemo.get(memoKey) ?? 0) > now) return true;
  if ((deniedUntil.get(user.uid) ?? 0) > now) return false;
  // 허용은 10분. 거절은 읽기부터 막힌 경우(가족 아님) 1분, 가족이지만 허용된 사람이 아직 없으면 15초
  // (설치한 사람이 앱을 열어 이메일이 적히면 곧 풀리게)
  const remember = (ok: boolean, denyMs = 60_000) => {
    const m = ok ? familyMemo : deniedUntil;
    m.set(ok ? memoKey : user.uid, now + (ok ? 600_000 : denyMs));
    if (m.size > 500) m.delete(m.keys().next().value!);
    return ok;
  };
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(proof.projectId)}/databases/(default)/documents/families/${fid}`
    + "?mask.fieldPaths=members&mask.fieldPaths=memberEmails";
  let res: Response;
  try { res = await (proof.fetch ?? fetch)(url, { headers: { Authorization: `Bearer ${proof.idToken}` }, signal: AbortSignal.timeout(5000) }); }
  catch { throw new FamilyCheckError("가족 확인 연결 실패"); } // 잠깐 연결이 안 되면 거절이 아니라 "다시 해 주세요"
  if (res.status === 403 || res.status === 404) { void res.body?.cancel(); return remember(false); }
  if (!res.ok) { void res.body?.cancel(); throw new FamilyCheckError(`가족 확인 실패 ${res.status}`); }
  let doc: { fields?: Record<string, FsValue> } | null;
  try { doc = (await res.json()) as typeof doc; }
  catch { throw new FamilyCheckError("가족 확인 응답을 읽지 못함"); } // 늦은 본문을 '가족 아님'으로 보지 않는다
  const members = (doc?.fields?.members?.arrayValue?.values ?? []).map((v) => v.stringValue).filter((v): v is string => !!v);
  if (!members.includes(user.uid)) return remember(false);
  const emails = doc?.fields?.memberEmails?.mapValue?.fields ?? {};
  const ok = members.some((uid) => {
    const e = emails[uid]?.stringValue?.trim().toLowerCase();
    return !!e && allowed.includes(e);
  });
  return remember(ok, 15_000);
}

export async function checkAllowed(env: GuardEnv, user: Verified, proof?: FamilyProof): Promise<void> {
  const allowed = allowList(env);
  if (allowed.length === 0) {
    throw new GuardError(403, "AI를 쓸 가족 이메일이 아직 등록되지 않았어요. 앱을 설치한 사람에게 알려 주세요 (Worker 설정 ALLOWED_EMAILS)", "not_configured");
  }
  if (allowed.includes("*")) return;
  if (emailAllowed(allowed, user)) return;
  if (proof?.familyId) {
    // 가족 단위로 열어 줄 때는 하루 한도(USAGE KV)가 꼭 켜져 있어야 한다: 초대 코드가 새도 손해에 상한이 있게
    if (!env.USAGE) {
      throw new GuardError(403, "가족과 AI를 함께 쓰려면 하루 사용 한도가 켜져 있어야 해요. 앱을 설치한 사람에게 알려 주세요 (README: 하루 한도 KV)", "family_needs_daily_limit");
    }
    let ok: boolean;
    try { ok = await familyAllowed(allowed, user, proof); }
    catch (e) {
      if (e instanceof FamilyCheckError) throw new GuardError(503, "가족인지 잠깐 확인하지 못했어요. 잠시 뒤 다시 해 주세요", "family_check_failed");
      throw e;
    }
    if (ok) return;
  }
  throw new GuardError(403, NOT_ALLOWED, "not_allowed");
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
