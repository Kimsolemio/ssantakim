import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Check, Lock, X } from "lucide-react";

const chip = "inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full px-4 text-callout font-medium transition-colors";

/** 한 개만 고르는 필터 칩 (폴더, 위치) */
export function FilterChip({ on, className = "", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { on: boolean }) {
  return <button type="button" aria-pressed={on} className={`${chip} ${on ? "border border-ink bg-ink font-semibold text-surface" : "border border-line bg-surface text-ink-2"} ${className}`} {...rest} />;
}

/** 여러 개 고르는 칩 (무드, 바꾸기 요청) */
export function ChoiceChip({ on, children, className = "", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { on: boolean; children: ReactNode }) {
  return (
    <button type="button" aria-pressed={on} className={`${chip} ${on ? "border border-accent bg-accent-soft font-semibold text-accent-strong" : "border border-line-strong bg-surface text-ink-2"} ${className}`} {...rest}>
      {on && <Check size={16} strokeWidth={2.5} aria-hidden />}{children}
    </button>
  );
}

/** 지울 수 있는 칩 (빼고 싶은 재료, 꼭 쓸 재료) */
export function InputChip({ children, className = "", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) {
  return (
    <button type="button" className={`${chip} bg-surface-2 pl-4 pr-2 text-ink ${className}`} {...rest}>
      {children}<X size={16} className="text-ink-3" aria-hidden />
    </button>
  );
}

/** 가족 설정에서 온 고정 칩 (버튼 아님) */
export function LockedChip({ children }: { children: ReactNode }) {
  return <span className={`${chip} bg-surface-2 text-ink-3`}><Lock size={14} aria-hidden />{children}</span>;
}
