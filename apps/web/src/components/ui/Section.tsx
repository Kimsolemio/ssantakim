import type { ReactNode } from "react";

/** 섹션 제목 (+ 오른쪽 글자 버튼이나 스테퍼 하나) */
export function SectionHeader({ title, count, right, first, className = "" }: { title: ReactNode; count?: number; right?: ReactNode; first?: boolean; className?: string }) {
  return (
    <div className={`flex items-end justify-between gap-3 px-5 pb-3 ${first ? "pt-4" : "pt-8"} ${className}`}>
      <h2 className="text-title2 text-ink">{title}{count != null && <span className="ml-1.5 text-callout font-medium text-ink-3 tabular-nums">{count}</span>}</h2>
      {right}
    </div>
  );
}

/** 섹션 오른쪽 글자 버튼 */
export function TextAction({ children, className = "", ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className={`-my-2.5 -mr-2 inline-flex h-11 items-center gap-1 px-2 text-callout font-semibold text-accent active:opacity-60 disabled:text-ink-disabled ${className}`} {...rest}>{children}</button>;
}

/** 그룹 라벨 (주재료/양념, 냉장/냉동) */
export function GroupLabel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p className={`px-5 pb-2 pt-5 text-caption font-semibold text-ink-3 ${className}`}>{children}</p>;
}

/** 흰 화면 안 섹션 사이 띠 */
export function Band() {
  return <div aria-hidden className="h-2 bg-canvas" />;
}

export function Card({ children, className = "", ...rest }: React.HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return <div className={`rounded-card bg-surface ${className}`} {...rest}>{children}</div>;
}

/** 목록 행 구분선 (첫 행 제외). 썸네일이 있으면 inset 68 */
export const rowLine = "relative before:absolute before:right-0 before:top-0 before:h-px before:bg-line first:before:hidden";
export const rowLineInset = `${rowLine} before:left-[68px]`;
export const rowLinePlain = `${rowLine} before:left-4`;
