import { createContext, useContext, useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useBackButton } from "../lib/useBackButton";
import { IconButton } from "./ui/IconButton";

/** body로 띄운 레이어가 여는 곳의 테마(쿡 모드의 다크)를 이어받게 한다 */
const LayerTheme = createContext<"dark" | null>(null);
export function DarkLayers({ children }: { children: ReactNode }) {
  return <LayerTheme.Provider value="dark">{children}</LayerTheme.Provider>;
}
export const useLayerTheme = () => (useContext(LayerTheme) === "dark" ? "theme-dark" : "");

type Props = {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** 있으면 닫기 전에 이 문구로 한 번 묻는다 (AI가 만드는 중 등) */
  confirmClose?: string | null;
  /** 요리 모드 같은 전체화면 위에 띄울 때 */
  top?: boolean;
  /** 하단 고정 행동 (주 버튼 1개 + ghost 1개까지) */
  footer?: ReactNode;
  /** 대화처럼 높이를 고정할 때 */
  tall?: boolean;
  /** 본문 여백을 직접 줄 때 (목록 시트) */
  flush?: boolean;
  testId?: string;
};

/** 아래에서 올라오는 시트. 흰 바탕 하나에 손잡이·제목·닫기(X) */
export function Sheet({ title, onClose, children, confirmClose, top, footer, tall, flush, testId }: Props) {
  const titleId = useId();
  const tryClose = () => {
    if (confirmClose && !window.confirm(confirmClose)) return false;
    onClose();
    return true;
  };
  useBackButton(true, tryClose);
  const theme = useLayerTheme();
  const box = useRef<HTMLElement>(null);
  // 연 단추 (autoFocus 로 포커스가 시트 안으로 옮겨지기 전, 첫 렌더 때의 것)
  const opener = useRef<HTMLElement | null>(document.activeElement as HTMLElement | null);
  const closeRef = useRef(tryClose);
  closeRef.current = tryClose;
  // 열면 시트로 포커스를 옮기고, 닫으면 원래 자리로 돌려준다. Esc 로 닫기
  useEffect(() => {
    const before = opener.current;
    if (!box.current?.contains(document.activeElement)) box.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.isComposing) return;
      // 가장 위에 있는 시트만 닫는다
      const sheets = document.querySelectorAll("[data-sheet]");
      if (sheets[sheets.length - 1] === box.current) { e.preventDefault(); closeRef.current(); }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); if (before?.isConnected) before.focus({ preventScroll: true }); };
  }, []);
  // body 에 바로 띄운다 (FullScreen 과 같은 층, 나중에 연 것이 위). top 은 요리 모드 위
  return createPortal(
    <div className={`fixed inset-0 ${top ? "z-[70]" : "z-40"} flex items-end justify-center ${theme}`}>
      <div aria-hidden className="absolute inset-0 bg-scrim animate-fade-in" onClick={tryClose} />
      <section ref={box} role="dialog" aria-modal="true" aria-labelledby={titleId} data-testid={testId} data-sheet tabIndex={-1}
        className={`relative flex outline-none w-full max-w-lg flex-col rounded-t-sheet bg-surface text-ink shadow-overlay animate-sheet-in ${tall ? "h-[85dvh]" : "max-h-[92dvh]"}`}>
        <div aria-hidden className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-line-strong" />
        <header className="flex shrink-0 items-center justify-between gap-2 pb-2 pl-5 pr-2 pt-2">
          <h2 id={titleId} className="min-w-0 text-title2 text-ink">{title}</h2>
          <IconButton aria-label="닫기" onClick={tryClose}><X size={24} /></IconButton>
        </header>
        <div className={`min-h-0 flex-1 overflow-y-auto overscroll-contain ${flush ? "" : "px-5"} ${footer ? "pb-4" : ""}`}
          style={footer ? undefined : { paddingBottom: "calc(var(--safe-bottom) + 20px)" }}>
          {children}
        </div>
        {footer && (
          <footer data-toast-anchor className="shrink-0 border-t border-line px-5 pt-3" style={{ paddingBottom: "calc(var(--safe-bottom) + 12px)" }}>
            {footer}
          </footer>
        )}
      </section>
    </div>,
    document.body,
  );
}
