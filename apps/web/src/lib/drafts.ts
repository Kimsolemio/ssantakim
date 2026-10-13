/**
 * 저장하기 전의 AI 결과(레시피 초안, 영수증 인식 결과)를 이 기기에 잠시 보관한다.
 * 뒤로가기·앱 종료로 날아가도 다시 열면 이어서 볼 수 있다. 저장하거나 버리면 지운다.
 */
const PREFIX = "cook:pending:";
const MAX_AGE_MS = 3 * 24 * 3600_000;

type Stored<T> = { at: number; value: T };

export function loadPending<T>(name: string): T | null {
  try {
    const raw = localStorage.getItem(PREFIX + name);
    if (!raw) return null;
    const s = JSON.parse(raw) as Stored<T>;
    if (!s || typeof s.at !== "number" || Date.now() - s.at > MAX_AGE_MS) { localStorage.removeItem(PREFIX + name); return null; }
    return s.value;
  } catch { return null; }
}

export function savePending<T>(name: string, value: T): void {
  try { localStorage.setItem(PREFIX + name, JSON.stringify({ at: Date.now(), value } satisfies Stored<T>)); } catch { /* 저장 공간 없음 등 */ }
}

export function clearPending(name: string): void {
  try { localStorage.removeItem(PREFIX + name); } catch { /* 무시 */ }
}
