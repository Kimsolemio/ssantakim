import type { ButtonHTMLAttributes } from "react";

type Tone = "default" | "filled" | "dark" | "filled-dark";
const tones: Record<Tone, string> = {
  default: "text-ink active:bg-surface-2",
  filled: "bg-surface-2 text-ink active:bg-fill-pressed",
  dark: "text-white active:bg-white/10",
  "filled-dark": "bg-white/10 text-white active:bg-white/20",
};

/** 아이콘만 있는 44px 버튼. aria-label 필수 */
export function IconButton({ tone = "default", className = "", type = "button", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: Tone; "aria-label": string }) {
  return (
    <button type={type}
      className={`inline-flex size-11 shrink-0 items-center justify-center rounded-full transition-colors disabled:text-ink-disabled aria-pressed:bg-accent-soft aria-pressed:text-accent-strong ${tones[tone]} ${className}`}
      {...rest} />
  );
}
