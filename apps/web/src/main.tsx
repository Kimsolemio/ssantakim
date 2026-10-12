import React from "react";
import ReactDOM from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
// 한글 글꼴: 필요한 글자 묶음만 내려받는 Pretendard (앱에 함께 담아 오프라인에서도 같은 글꼴)
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import "./index.css";
import { captureShareFromLocation } from "./lib/share";

captureShareFromLocation();

registerSW({ immediate: true });

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
