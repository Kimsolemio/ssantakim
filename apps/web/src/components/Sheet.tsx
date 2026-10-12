import { useId, type ReactNode } from "react";
import { X } from "lucide-react";
import { useBackButton } from "../lib/useBackButton";
import { IconButton } from "./ui/IconButton";

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
  return (
    <div className={`fixed inset-0 ${top ? "z-[70]" : "z-30"} flex items-end justify-center`}>
      <div aria-hidden className="absolute inset-0 bg-scrim animate-fade-in" onClick={tryClose} />
      <section role="dialog" aria-modal="true" aria-labelledby={titleId} data-testid={testId}
        className={`relative flex w-full max-w-lg flex-col rounded-t-sheet bg-surface text-ink shadow-overlay animate-sheet-in ${tall ? "h-[85dvh]" : "max-h-[92dvh]"}`}>
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
          <footer className="shrink-0 border-t border-line px-5 pt-3" style={{ paddingBottom: "calc(var(--safe-bottom) + 12px)" }}>
            {footer}
          </footer>
        )}
      </section>
    </div>
  );
}
