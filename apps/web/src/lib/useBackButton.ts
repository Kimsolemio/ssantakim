import { useEffect, useRef } from "react";

/**
 * 레이어(상세·편집·시트)가 열려 있을 때 안드로이드 뒤로가기/iOS 스와이프백이
 * 앱을 종료하지 않고 레이어를 닫도록 history 항목을 하나 쌓는다.
 *
 * - 항목마다 깊이(depth)를 저장해, 현재 위치가 내 항목보다 아래로 내려갔을 때만 닫는다.
 *   (위에 쌓였던 레이어의 낡은 항목을 지나가는 popstate 에 반응하지 않는다)
 * - 컴포넌트 인스턴스마다 고정 토큰을 쓰므로 StrictMode의 이중 실행에도 항목이 하나만 쌓인다.
 * - 버튼으로 닫으면 내 항목이 맨 위에 있을 때만 history.back()으로 걷어낸다.
 * - 아무 레이어도 소유하지 않는 낡은 항목에 도착하면 자동으로 한 번 더 back() 한다.
 */
type LayerState = { layer?: string; depth?: number } | null;
const activeTokens = new Set<string>();
let globalInstalled = false;
const current = () => (history.state as LayerState) ?? null;

function installGlobal() {
  if (globalInstalled) return;
  globalInstalled = true;
  window.addEventListener("popstate", () => {
    const layer = current()?.layer;
    if (layer && !activeTokens.has(layer)) history.back();
  });
}

/** onBack 이 false 를 돌려주면 닫지 않는다 (예: "저장하지 않고 나갈까요?"에서 취소) */
export function useBackButton(active: boolean, onBack: () => void | boolean) {
  const cb = useRef(onBack);
  cb.current = onBack;
  const token = useRef<string>("");
  if (!token.current) token.current = Math.random().toString(36).slice(2);
  const depth = useRef(0);
  const pending = useRef<number | null>(null);

  useEffect(() => {
    if (!active) return;
    installGlobal();
    const t = token.current;
    if (pending.current !== null) { clearTimeout(pending.current); pending.current = null; }
    activeTokens.add(t);
    if (current()?.layer !== t) {
      depth.current = (current()?.depth ?? 0) + 1;
      history.pushState({ layer: t, depth: depth.current }, "");
    } else {
      depth.current = current()?.depth ?? depth.current;
    }
    let closedByPop = false;
    const handler = () => {
      if ((current()?.depth ?? 0) >= depth.current) return; // 아직 내 항목이 살아 있다
      closedByPop = true;
      if (cb.current() === false) {
        // 닫기를 취소했다: 걷힌 내 항목을 다시 쌓는다
        closedByPop = false;
        history.pushState({ layer: t, depth: depth.current }, "");
      }
    };
    window.addEventListener("popstate", handler);
    return () => {
      window.removeEventListener("popstate", handler);
      activeTokens.delete(t);
      if (closedByPop) return;
      pending.current = window.setTimeout(() => {
        pending.current = null;
        if (current()?.layer === t) history.back();
      }, 0);
    };
  }, [active]);
}
