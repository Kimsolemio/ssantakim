import type { ReactNode } from "react";

const tones = {
  neutral: "bg-surface-2 text-ink-2",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
};

export function Badge({ tone = "neutral", children, className = "" }: { tone?: keyof typeof tones; children: ReactNode; className?: string }) {
  return <span className={`inline-flex h-6 shrink-0 items-center gap-1 rounded-badge px-2 text-caption font-semibold tabular-nums ${tones[tone]} ${className}`}>{children}</span>;
}
