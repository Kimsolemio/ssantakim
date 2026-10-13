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

registerSW({ immediate: true });

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
