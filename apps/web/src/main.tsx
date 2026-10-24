import React from "react";
import ReactDOM from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
// 한글 글꼴: 필요한 글자 묶음만 내려받는 Pretendard (앱에 함께 담아 오프라인에서도 같은 글꼴)
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import "./index.css";
import { captureShareFromLocation } from "./lib/share";

captureShareFromLocation();

// 체험판은 링크로 여는 페이지라 확인 창(confirm)이 뜨지 않는다 → 묻는 곳은 '예'로 진행
if (import.meta.env.VITE_DEMO === "1") window.confirm = () => true;

// 홈 화면 앱은 다시 열어도 새로 고침되지 않을 때가 많아, 10분 넘게 떠나 있다가 돌아오면 새 버전을 확인한다.
// 새 버전이 있으면 화면이 새로 고쳐지므로, 요리 모드 중(타이머가 메모리에만 있다)에는 확인하지 않는다
registerSW({
  immediate: true,
  onRegisteredSW(_url, reg) {
    if (!reg) return;
    let hiddenAt = 0;
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") { hiddenAt = Date.now(); return; }
      if (!hiddenAt || Date.now() - hiddenAt < 10 * 60_000 || !navigator.onLine) return;
      if (document.querySelector("[data-cooking]")) return;
      void reg.update().catch(() => {});
    });
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
