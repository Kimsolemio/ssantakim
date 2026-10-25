import { getAuthInstance } from "./firebase";
import { isOffline } from "./online";

export const workerUrl: string = (import.meta.env.VITE_WORKER_URL as string | undefined)?.replace(/\/$/, "") ?? "";
export const workerConfigured = workerUrl.length > 0;
/** 체험판: AI 서버 대신 기기 안의 예시 답 (pnpm build:demo) */
export const isDemo = import.meta.env.VITE_DEMO === "1";

async function viaDemo<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const { demoWorker, DemoHttpError } = await import("../demo/worker");
  try { return await demoWorker<T>(path, body as Record<string, unknown>, signal); }
  catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw new ApiError("취소되었습니다", 0);
    if (e instanceof DemoHttpError) throw new ApiError(e.message, e.status, e.code);
    throw e;
  }
}

/** 지금 보고 있는 가족 (AI 서버가 "설치한 사람이 있는 가족의 구성원인가"를 확인하는 데 쓴다) */
let currentFamilyId: string | null = null;
export function setApiFamily(id: string | null) { currentFamilyId = id; }
const familyHeader = (): Record<string, string> => (currentFamilyId ? { "X-Family-Id": currentFamilyId } : {});

export class ApiError extends Error {
  /** code: 서버가 알려 준 상황 (예: instagram → 캡션 입력으로 전환) */
  constructor(message: string, public status: number, public code?: string) { super(message); }
}

/** Worker 호출. Firebase ID 토큰을 Authorization 헤더로 보낸다. */
export async function callWorker<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  if (isDemo) return viaDemo<T>(path, body, signal);
  const res = await postWorker(path, body, signal);
  let data: unknown = null;
  try { data = await res.json(); } catch { /* 본문 없음 */ }
  if (!res.ok) {
    const d = data as { error?: string; code?: string } | null;
    throw new ApiError(friendly(res.status, d?.error), res.status, d?.code);
  }
  return data as T;
}

/** 파일을 돌려받는 Worker 호출 (예: 인스타 릴스 영상). 실패하면 서버가 보낸 오류로 */
export async function callWorkerBlob(path: string, body: unknown, signal?: AbortSignal): Promise<Blob> {
  if (isDemo) throw new ApiError("체험판에서는 인스타 영상을 받지 않아요", 0, "instagram");
  const res = await postWorker(path, body, signal);
  if (!res.ok) {
    const d = await res.json().catch(() => null) as { error?: string; code?: string } | null;
    throw new ApiError(friendly(res.status, d?.error), res.status, d?.code);
  }
  try { return await res.blob(); }
  catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw new ApiError("취소되었습니다", 0);
    throw new ApiError("영상을 끝까지 받지 못했어요", 0);
  }
}

async function postWorker(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
  if (!workerConfigured) throw new ApiError("AI 서버 주소(VITE_WORKER_URL)가 설정되지 않았습니다", 0);
  // 끊긴 채로 기다리게 하지 않는다 (저장한 레시피·냉장고는 오프라인에서도 볼 수 있다)
  if (isOffline()) throw new ApiError("인터넷이 끊겨 있어요. 연결되면 다시 해 주세요", 0, "offline");
  const user = getAuthInstance().currentUser;
  if (!user) throw new ApiError("로그인이 필요합니다", 401);
  const token = await user.getIdToken();
  let res: Response;
  try {
    res = await fetch(`${workerUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...familyHeader() },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw new ApiError("취소되었습니다", 0);
    throw new ApiError("서버에 연결할 수 없습니다. 인터넷 연결을 확인하세요", 0);
  }
  return res;
}

/** 로그인한 GET 요청 (예: 오늘 남은 AI 사용량). timeoutMs: 휴대폰 망이 멈춰도 끝없이 기다리지 않게 */
export async function getWorker<T>(path: string, timeoutMs?: number): Promise<T> {
  if (isDemo) return viaDemo<T>(path, undefined);
  if (!workerConfigured) throw new ApiError("AI 서버가 연결되지 않았어요", 0);
  if (isOffline()) throw new ApiError("인터넷이 끊겨 있어요", 0, "offline");
  const user = getAuthInstance().currentUser;
  if (!user) throw new ApiError("로그인이 필요합니다", 401);
  // AbortSignal.timeout 은 iOS 16 미만에 없어 직접 끊는다
  const ctrl = timeoutMs ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : undefined;
  let res: Response;
  try {
    res = await fetch(`${workerUrl}${path}`, {
      headers: { Authorization: `Bearer ${await user.getIdToken()}`, ...familyHeader() },
      ...(ctrl ? { signal: ctrl.signal } : {}),
    });
  } catch (e) {
    clearTimeout(timer);
    if (ctrl?.signal.aborted) throw new ApiError("서버가 늦게 답해요. 잠시 뒤 다시 해 주세요", 0, "timeout");
    throw new ApiError("서버에 연결할 수 없어요. 인터넷 연결을 확인하세요", 0);
  }
  // 본문이 늦게 오는 것도 같은 시간 제한 안에서
  const data = await res.json().catch(() => null).finally(() => clearTimeout(timer)) as { error?: string; code?: string } | null;
  if (ctrl?.signal.aborted && data == null) throw new ApiError("서버가 늦게 답해요. 잠시 뒤 다시 해 주세요", 0, "timeout");
  if (!res.ok) throw new ApiError(friendly(res.status, data?.error), res.status, data?.code);
  return data as T;
}

/** 서버 메시지 중 개발자용 표현(토큰·JSON·필드 경로)은 가족이 알아듣는 말로 바꾼다. 원문은 콘솔에 남긴다 */
function friendly(status: number, msg: string | undefined): string {
  if (status === 401) { console.warn("401", msg); return "로그인이 만료됐어요. 화면을 새로 고치거나 다시 로그인해 주세요"; }
  if (!msg) return status >= 500 ? "AI 서버에 문제가 생겼어요. 잠시 뒤 다시 시도해 주세요" : `요청이 처리되지 않았어요 (${status})`;
  if (/AI 응답(이|을)/.test(msg)) { console.warn(msg); return "AI가 알아볼 수 없는 답을 보냈어요. 한 번 더 시도해 주세요"; }
  if (/요청 형식 오류|JSON 본문/.test(msg)) { console.warn(msg); return "보낸 내용을 서버가 받지 못했어요. 입력을 확인하고, 계속되면 화면을 새로 고쳐 주세요"; }
  return msg;
}
