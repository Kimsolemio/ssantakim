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

export class ApiError extends Error {
  /** code: 서버가 알려 준 상황 (예: instagram → 캡션 입력으로 전환) */
  constructor(message: string, public status: number, public code?: string) { super(message); }
}

/** Worker 호출. Firebase ID 토큰을 Authorization 헤더로 보낸다. */
export async function callWorker<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  if (isDemo) return viaDemo<T>(path, body, signal);
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
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw new ApiError("취소되었습니다", 0);
    throw new ApiError("서버에 연결할 수 없습니다. 인터넷 연결을 확인하세요", 0);
  }
  let data: unknown = null;
  try { data = await res.json(); } catch { /* 본문 없음 */ }
  if (!res.ok) {
    const d = data as { error?: string; code?: string } | null;
    throw new ApiError(friendly(res.status, d?.error), res.status, d?.code);
  }
  return data as T;
}

/** 로그인한 GET 요청 (예: 오늘 남은 AI 사용량) */
export async function getWorker<T>(path: string): Promise<T> {
  if (isDemo) return viaDemo<T>(path, undefined);
  if (!workerConfigured) throw new ApiError("AI 서버가 연결되지 않았어요", 0);
  if (isOffline()) throw new ApiError("인터넷이 끊겨 있어요", 0, "offline");
  const user = getAuthInstance().currentUser;
  if (!user) throw new ApiError("로그인이 필요합니다", 401);
  const res = await fetch(`${workerUrl}${path}`, { headers: { Authorization: `Bearer ${await user.getIdToken()}` } });
  const data = await res.json().catch(() => null) as { error?: string; code?: string } | null;
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
