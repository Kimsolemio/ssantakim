import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, Plus } from "lucide-react";
import { IconButton } from "./IconButton";

/** 탭 화면 머리: 위쪽 줄(오른쪽 버튼들) + 큰 제목. 제목이 스크롤로 사라지면 위쪽 줄 가운데에 작은 제목이 나타난다 */
export function LargeTitleBar({ title, right }: { title: string; right?: ReactNode }) {
  const h1 = useRef<HTMLHeadingElement>(null);
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const el = h1.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setCompact(!e.isIntersecting), { rootMargin: "-56px 0px 0px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <>
      <div data-compact={compact} className="sticky top-0 z-10 bg-canvas/85 backdrop-blur-xl data-[compact=true]:border-b data-[compact=true]:border-line"
        style={{ paddingTop: "var(--safe-top)" }}>
        <div className="relative flex h-12 items-center justify-end gap-1 px-2">
          <span aria-hidden className={`pointer-events-none absolute inset-x-16 text-center text-headline text-ink transition-opacity ${compact ? "opacity-100" : "opacity-0"}`}>{title}</span>
          {right}
        </div>
      </div>
      <h1 ref={h1} className="px-5 pb-3 pt-1 text-display text-ink">{title}</h1>
    </>
  );
}

/** 가족 메뉴 단추 (가족 이름 첫 글자) */
export function FamilyAvatar({ name, onClick }: { name: string; onClick: () => void }) {
  return (
    <IconButton aria-label="우리 가족" onClick={onClick}>
      <span aria-hidden className="grid size-9 place-items-center rounded-full bg-surface text-callout font-semibold text-ink-2 ring-1 ring-line">{[...name.trim()][0] ?? "가"}</span>
    </IconButton>
  );
}

/** 전체화면 머리: 뒤로 + 제목 + 오른쪽 아이콘 버튼 2개까지 */
export function BackBar({ title, onBack, right, scrolled, canvas }: { title: ReactNode; onBack: () => void; right?: ReactNode; scrolled?: boolean; canvas?: boolean }) {
  return (
    <header data-scrolled={scrolled} className={`sticky top-0 z-10 shrink-0 ${canvas ? "bg-canvas/85" : "bg-surface/90"} backdrop-blur-xl data-[scrolled=true]:border-b data-[scrolled=true]:border-line`}
      style={{ paddingTop: "var(--safe-top)" }}>
      <div className="flex h-14 items-center gap-1 px-1">
        <IconButton aria-label="뒤로" onClick={onBack}><ChevronLeft size={26} /></IconButton>
        <h1 className="min-w-0 flex-1 truncate text-headline text-ink">{title}</h1>
        {right && <div className="flex shrink-0 items-center">{right}</div>}
      </div>
    </header>
  );
}

/** 화면 하단 고정 행동 영역. aboveTabs: 탭바 위에 놓을 때 */
export function BottomBar({ children, aboveTabs, className = "", inline }: { children: ReactNode; aboveTabs?: boolean; className?: string; /** 전체화면 flex 안에서 흐름대로 놓을 때 */ inline?: boolean }) {
  if (inline) {
    return (
      <div className={`shrink-0 border-t border-line bg-surface px-5 pt-3 ${className}`} style={{ paddingBottom: "calc(var(--safe-bottom) + 12px)" }}>
        {children}
      </div>
    );
  }
  return (
    <div className={`fixed inset-x-0 z-20 mx-auto max-w-lg border-t border-line bg-surface/90 px-5 pt-3 backdrop-blur-xl ${className}`}
      style={aboveTabs ? { bottom: "calc(var(--safe-bottom) + 56px)", paddingBottom: 12 } : { bottom: 0, paddingBottom: "calc(var(--safe-bottom) + 12px)" }}>
      {children}
    </div>
  );
}

/** 탭 화면의 추가 버튼 (그 화면의 유일한 주 버튼) */
export function ExtendedFab({ children, onClick, label }: { children: ReactNode; onClick: () => void; label?: string }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 z-20 mx-auto flex max-w-lg justify-end px-5" style={{ bottom: "calc(var(--safe-bottom) + 56px + 16px)" }}>
      <button type="button" onClick={onClick} aria-label={label}
        className="pointer-events-auto flex h-14 items-center gap-2 rounded-full bg-accent pl-4 pr-5 text-headline text-on-accent shadow-overlay transition-colors active:bg-accent-pressed">
        <Plus size={22} strokeWidth={2.25} aria-hidden />{children}
      </button>
    </div>
  );
}
