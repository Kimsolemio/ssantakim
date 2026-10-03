import { getAuthInstance } from "./firebase";

export const workerUrl: string = (import.meta.env.VITE_WORKER_URL as string | undefined)?.replace(/\/$/, "") ?? "";
export const workerConfigured = workerUrl.length > 0;

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

/** Worker 호출. Firebase ID 토큰을 Authorization 헤더로 보낸다. */
export async function callWorker<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  if (!workerConfigured) throw new ApiError("AI 서버 주소(VITE_WORKER_URL)가 설정되지 않았습니다", 0);
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
    const msg = (data as { error?: string } | null)?.error ?? `요청 실패 (${res.status})`;
    throw new ApiError(msg, res.status);
  }
  return data as T;
}
