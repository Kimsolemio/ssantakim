import { useEffect, useRef } from "react";

/**
 * 레이어(상세·편집·시트)가 열려 있을 때 안드로이드 뒤로가기/iOS 스와이프백이
 * 앱을 종료하지 않고 레이어를 닫도록 history 항목을 하나 쌓는다.
 *
 * - 컴포넌트 인스턴스마다 고정 토큰을 쓰므로 StrictMode의 이중 실행에도 항목이 하나만 쌓인다.
 * - 버튼으로 닫으면 내 항목이 맨 위에 있을 때만 history.back()으로 걷어낸다.
 * - 아무 레이어도 소유하지 않는 낡은 항목에 도착하면 자동으로 한 번 더 back() 한다.
 */
type LayerState = { layer?: string } | null;
const activeTokens = new Set<string>();
let globalInstalled = false;

function installGlobal() {
  if (globalInstalled) return;
  globalInstalled = true;
  window.addEventListener("popstate", () => {
    const layer = (history.state as LayerState)?.layer;
    if (layer && !activeTokens.has(layer)) history.back();
  });
}

export function useBackButton(active: boolean, onBack: () => void) {
  const cb = useRef(onBack);
  cb.current = onBack;
  const token = useRef<string>("");
  if (!token.current) token.current = Math.random().toString(36).slice(2);
  const pending = useRef<number | null>(null);

  useEffect(() => {
    if (!active) return;
    installGlobal();
    const t = token.current;
    if (pending.current !== null) { clearTimeout(pending.current); pending.current = null; }
    activeTokens.add(t);
    if ((history.state as LayerState)?.layer !== t) history.pushState({ layer: t }, "");
    let closedByPop = false;
    const handler = () => {
      if ((history.state as LayerState)?.layer === t) return; // 위에 쌓인 다른 레이어가 닫힌 것
      closedByPop = true;
      cb.current();
    };
    window.addEventListener("popstate", handler);
    return () => {
      window.removeEventListener("popstate", handler);
      activeTokens.delete(t);
      if (closedByPop) return;
      pending.current = window.setTimeout(() => {
        pending.current = null;
        if ((history.state as LayerState)?.layer === t) history.back();
      }, 0);
    };
  }, [active]);
}
