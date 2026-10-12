import type { ButtonHTMLAttributes, ReactNode } from "react";
import { LoaderCircle, Sparkles } from "lucide-react";
import { useOnline } from "../../lib/online";

const base = "inline-flex items-center justify-center gap-2 rounded-control font-semibold whitespace-nowrap select-none "
  + "transition-[background-color,color,transform] duration-150 active:scale-[0.98] disabled:cursor-not-allowed disabled:active:scale-100";
const sizes = { lg: "h-14 px-5 text-headline", md: "h-12 px-4 text-callout font-semibold" };
const variants = {
  primary: "bg-accent text-on-accent active:bg-accent-pressed disabled:bg-surface-2 disabled:text-ink-disabled",
  secondary: "bg-surface text-ink border border-line-strong active:bg-surface-2 disabled:text-ink-disabled",
  ghost: "bg-transparent text-ink-2 active:bg-surface-2 disabled:text-ink-disabled",
  destructive: "bg-danger-soft text-danger active:brightness-95 disabled:opacity-40",
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
  block?: boolean;
  /** AI에게 요청을 보내는 버튼 (반짝이 하나) */
  ai?: boolean;
  loading?: boolean;
  icon?: ReactNode;
};

export function Button({ variant = "primary", size = "lg", block, ai, loading, icon, className = "", children, type = "button", disabled, ...rest }: ButtonProps) {
  const iconSize = size === "lg" ? 20 : 18;
  // AI 요청 단추는 인터넷이 끊기면 누를 수 없다 (머리의 '오프라인' 표시가 이유를 알려 준다)
  const online = useOnline();
  return (
    <button type={type} disabled={disabled || loading || (ai && !online)} aria-busy={loading || undefined}
      className={`${base} ${sizes[size]} ${variants[variant]} ${block ? "w-full" : ""} ${className}`} {...rest}>
      {loading ? <LoaderCircle size={iconSize} className="animate-spin" aria-hidden />
        : ai ? <Sparkles size={iconSize} strokeWidth={2} aria-hidden /> : icon}
      {children}
    </button>
  );
}
