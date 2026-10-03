import type { ReactNode } from "react";
import { useBackButton } from "../lib/useBackButton";

type Props = { title: string; onClose: () => void; right?: ReactNode; children: ReactNode };

/** 하단 탭 위를 덮는 전체화면 레이어 (상세, 편집) */
export function FullScreen({ title, onClose, right, children }: Props) {
  useBackButton(true, onClose);
  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-[#FFF8F0]">
      <header className="flex items-center gap-2 border-b border-orange-100 bg-white/95 px-2 backdrop-blur"
        style={{ paddingTop: "var(--safe-top)" }}>
        <button onClick={onClose} aria-label="뒤로" className="px-3 py-3 text-2xl leading-none text-gray-600">‹</button>
        <h1 className="min-w-0 flex-1 truncate py-3 text-lg font-bold">{title}</h1>
        {right && <div className="flex items-center gap-1 pr-2">{right}</div>}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto" style={{ paddingBottom: "calc(var(--safe-bottom) + 16px)" }}>
        {children}
      </div>
    </div>
  );
}
