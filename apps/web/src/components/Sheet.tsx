import type { ReactNode } from "react";

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div className="w-full max-w-lg rounded-t-3xl bg-[#FFF8F0] p-5 shadow-xl"
        style={{ paddingBottom: "calc(var(--safe-bottom) + 20px)" }} onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">{title}</h2>
          <button onClick={onClose} className="rounded-full px-3 py-1 text-gray-500">닫기</button>
        </div>
        {children}
      </div>
    </div>
  );
}
