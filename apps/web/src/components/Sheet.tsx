import type { ReactNode } from "react";
import { useBackButton } from "../lib/useBackButton";

/** 아래에서 올라오는 시트. confirmClose 가 있으면 닫기 전에 묻는다 (AI가 만드는 중 등) */
export function Sheet({ title, onClose, children, confirmClose, top }: { title: string; onClose: () => void; children: ReactNode; confirmClose?: string | null; /** 요리 모드 같은 전체화면 위에 띄울 때 */ top?: boolean }) {
  const tryClose = () => {
    if (confirmClose && !window.confirm(confirmClose)) return false;
    onClose();
    return true;
  };
  useBackButton(true, tryClose);
  return (
    <div className={`fixed inset-0 ${top ? "z-[70]" : "z-30"} flex items-end justify-center bg-black/40`} onClick={tryClose}>
      {/* 작은 폰에서 키보드가 올라와도 위쪽이 화면 밖으로 밀리지 않게 높이를 제한하고 안에서 스크롤 */}
      <div className="max-h-[92dvh] w-full max-w-lg overflow-y-auto overscroll-contain rounded-t-3xl bg-[#FFF8F0] p-5 shadow-xl"
        style={{ paddingBottom: "calc(var(--safe-bottom) + 20px)" }} onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">{title}</h2>
          <button onClick={tryClose} className="rounded-full px-3 py-1 text-gray-500">닫기</button>
        </div>
        {children}
      </div>
    </div>
  );
}
