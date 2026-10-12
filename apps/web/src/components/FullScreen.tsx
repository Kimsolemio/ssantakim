import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useBackButton } from "../lib/useBackButton";
import { BackBar } from "./ui/Bars";

type Props = {
  title: ReactNode;
  onClose: () => void;
  /** 머리 오른쪽 아이콘 버튼 (2개까지) */
  right?: ReactNode;
  children: ReactNode;
  /** 하단 고정 행동 (저장·요리 시작 등 주 행동은 여기에) */
  footer?: ReactNode;
  /** 있으면 닫기 전에 이 문구로 한 번 묻는다 (저장 안 한 내용이 있을 때) */
  confirmClose?: string | null;
  /** 설정 화면처럼 회색 바탕 위에 카드를 놓을 때 */
  canvas?: boolean;
  /** 본문 큰 제목이 보이는 동안 머리 제목을 숨길 때 */
  titleHidden?: boolean;
};

/** 하단 탭 위를 덮는 전체화면 레이어 (상세, 편집). 흰 바탕 */
export function FullScreen({ title, onClose, right, children, footer, confirmClose, canvas, titleHidden }: Props) {
  const [scrolled, setScrolled] = useState(false);
  const tryClose = () => {
    if (confirmClose && !window.confirm(confirmClose)) return false;
    onClose();
    return true;
  };
  useBackButton(true, tryClose);
  // body 에 바로 띄운다: 흐림 효과(backdrop-filter)가 있는 머리 줄 안에서 열려도 그 안에 갇히지 않게.
  // 겹침 순서는 연 순서대로 (나중에 연 것이 위)
  return createPortal(
    <div className={`fixed inset-0 z-40 flex flex-col text-ink ${canvas ? "bg-canvas" : "bg-surface"}`}>
      <BackBar title={title} onBack={tryClose} right={right} scrolled={scrolled} canvas={canvas} titleHidden={titleHidden} />
      <div className="min-h-0 flex-1 overflow-y-auto" onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 4)}
        style={{ paddingBottom: footer ? 24 : "calc(var(--safe-bottom) + 24px)" }}>
        {children}
      </div>
      {footer && (
        <div data-toast-anchor className="shrink-0 border-t border-line bg-surface px-5 pt-3" style={{ paddingBottom: "calc(var(--safe-bottom) + 12px)" }}>
          {footer}
        </div>
      )}
    </div>,
    document.body,
  );
}
