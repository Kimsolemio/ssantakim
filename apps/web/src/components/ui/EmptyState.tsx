import type { ReactNode } from "react";

export function EmptyState({ icon, title, body, children, className = "" }: { icon: ReactNode; title: ReactNode; body?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <div className={`flex flex-col items-center px-8 py-16 text-center ${className}`}>
      <span aria-hidden className="grid size-16 place-items-center rounded-full bg-surface-2 text-ink-3">{icon}</span>
      <p className="mt-4 text-headline text-ink">{title}</p>
      {body && <p className="mt-1 text-callout text-ink-2">{body}</p>}
      {children && <div className="mt-6 flex w-full max-w-[280px] flex-col gap-2">{children}</div>}
    </div>
  );
}

/** 불러오는 중 자리 (목록 행 높이 막대) */
export function Skeleton({ rows = 3, className = "" }: { rows?: number; className?: string }) {
  return (
    <div aria-busy="true" aria-label="불러오는 중" className={`flex flex-col gap-2 ${className}`}>
      {Array.from({ length: rows }, (_, i) => <div key={i} className="h-[72px] animate-pulse rounded-card bg-surface-2" />)}
    </div>
  );
}
