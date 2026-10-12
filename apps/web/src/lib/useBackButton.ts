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

// 우리가 부른 history.back() 중 아직 popstate 가 오지 않은 수.
// 그사이에 새 레이어가 항목을 쌓으면, 늦게 도착한 back 이 방금 연 레이어를 닫아 버린다
// (시트를 닫자마자 다른 시트를 열 때). 그래서 back 이 끝날 때까지 쌓기를 미룬다
let inflight = 0;
let safety: ReturnType<typeof setTimeout> | undefined;
const queue: (() => void)[] = [];
function flush() { while (inflight === 0 && queue.length) queue.shift()!(); }
function goBack() {
  inflight++;
  clearTimeout(safety);
  // popstate 가 끝내 오지 않는 브라우저가 있어도 앱이 멈추지 않게
  safety = setTimeout(() => { inflight = 0; flush(); }, 800);
  history.back();
}
function whenSettled(fn: () => void) {
  if (inflight === 0) fn();
  else queue.push(fn);
}

function installGlobal() {
  if (globalInstalled) return;
  globalInstalled = true;
  window.addEventListener("popstate", () => {
    if (inflight > 0) inflight--;
    // 레이어들의 처리(닫기, 또는 닫기 취소로 항목 다시 쌓기)가 끝난 뒤에 판단한다.
    // 곧바로 back() 하면, 취소해서 다시 쌓은 뒤에 한 번 더 뒤로 가서 확인 창이 두 번 뜬다
    setTimeout(() => {
      const layer = current()?.layer;
      if (layer && !activeTokens.has(layer)) { goBack(); return; }
      if (inflight === 0) { clearTimeout(safety); flush(); }
    }, 0);
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
    let alive = true;
    let pushed = false;
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
    whenSettled(() => {
      if (!alive) return;
      if (current()?.layer !== t) {
        depth.current = (current()?.depth ?? 0) + 1;
        history.pushState({ layer: t, depth: depth.current }, "");
      } else {
        depth.current = current()?.depth ?? depth.current;
      }
      pushed = true;
      window.addEventListener("popstate", handler);
    });
    return () => {
      alive = false;
      window.removeEventListener("popstate", handler);
      activeTokens.delete(t);
      if (closedByPop || !pushed) return;
      pending.current = window.setTimeout(() => {
        pending.current = null;
        if (current()?.layer === t) goBack();
      }, 0);
    };
  }, [active]);
}
