import type { ReactNode } from "react";
import { CircleCheckBig, Info, TriangleAlert, X } from "lucide-react";

const styles = {
  info: "bg-surface-2 text-ink-2",
  success: "bg-surface-2 text-ink-2",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger ring-1 ring-inset ring-danger/20",
};

/** 정보·경고·위험 알림 상자. 한 화면에 하나, 1~2줄 */
export function Banner({ kind = "info", title, children, action, onClose, className = "", testId, onCanvas }: {
  kind?: keyof typeof styles; title?: ReactNode; children?: ReactNode; action?: { label: string; onClick: () => void }; onClose?: () => void; className?: string; testId?: string;
  /** 회색 바탕(탭 화면) 위: 정보 상자를 흰색으로 */ onCanvas?: boolean;
}) {
  const Icon = kind === "success" ? CircleCheckBig : kind === "info" ? Info : TriangleAlert;
  return (
    <div role={kind === "danger" ? "alert" : "status"} data-testid={testId} className={`flex items-start gap-3 rounded-card py-3 pl-4 ${action || onClose ? "pr-2" : "pr-4"} ${onCanvas && (kind === "info" || kind === "success") ? "bg-surface text-ink-2" : styles[kind]} ${className}`}>
      <Icon size={20} aria-hidden className={`mt-0.5 shrink-0 ${kind === "success" ? "text-success" : ""}`} />
      <div className="min-w-0 flex-1">
        {title && <p className="text-callout font-semibold">{title}</p>}
        {children && <div className={`${title ? "mt-0.5 text-caption" : "text-callout"}`}>{children}</div>}
      </div>
      {action && <button type="button" onClick={action.onClick} className="-my-1 h-11 shrink-0 px-3 text-callout font-semibold active:opacity-60">{action.label}</button>}
      {onClose && <button type="button" aria-label="알림 닫기" onClick={onClose} className="-my-1.5 grid size-11 shrink-0 place-items-center rounded-full active:bg-black/5"><X size={18} /></button>}
    </div>
  );
}

/** 처음 한 번만 보여 줄 안내 (localStorage seen:<key>) */
export function seen(key: string): boolean {
  try { return localStorage.getItem(`seen:${key}`) === "1"; } catch { return false; }
}
export function markSeen(key: string) {
  try { localStorage.setItem(`seen:${key}`, "1"); } catch { /* 저장 못 해도 괜찮다 */ }
}
