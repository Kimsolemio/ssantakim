/**
 * 다른 앱의 "공유"로 들어온 링크·글을 받아 둔다.
 * - 안드로이드: 설치된 PWA가 공유 대상(manifest share_target)으로 /share?title=&text=&url= 을 연다
 * - 아이폰: 단축어가 /share?url=… 을 연다 (README 참고)
 * 로그인 리다이렉트를 거쳐도 잃어버리지 않게 sessionStorage 에 담아 두고 주소는 / 로 되돌린다.
 */
export type SharedPayload = { url: string | null; text: string | null; title: string | null };
const KEY = "cook:pending-share";

export function firstUrl(s: string | null | undefined): string | null {
  const m = s ? /https?:\/\/[^\s<>"']+/i.exec(s) : null;
  return m ? m[0].replace(/[),.!?。]+$/, "") : null;
}

export function captureShareFromLocation(): void {
  try {
    const loc = window.location;
    if (loc.pathname !== "/share") return;
    const q = new URLSearchParams(loc.search);
    const title = q.get("title"), text = q.get("text"), url = q.get("url");
    const payload: SharedPayload = { url: firstUrl(url) ?? firstUrl(text) ?? firstUrl(title), text: text?.trim() || null, title: title?.trim() || null };
    if (payload.url || payload.text) sessionStorage.setItem(KEY, JSON.stringify(payload));
    window.history.replaceState(null, "", "/");
  } catch { /* 저장소를 못 쓰는 환경이면 무시 */ }
}

export function takePendingShare(): SharedPayload | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    sessionStorage.removeItem(KEY);
    return JSON.parse(raw) as SharedPayload;
  } catch { return null; }
}
