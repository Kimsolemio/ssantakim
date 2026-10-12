import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CircleAlert, CircleCheckBig } from "lucide-react";

type Action = { label: string; onClick: () => void };
type ToastOpts = { action?: Action; kind?: "done" | "error" | "plain"; /** 하단 고정 버튼이 있는 화면이면 그 위로 ("aboveTabs": 탭바 위 고정 버튼) */ raised?: boolean | "aboveTabs" };
type ToastState = { id: number; message: string } & ToastOpts;

const Ctx = createContext<{ show: (message: string, opts?: ToastOpts) => void; hide: () => void } | null>(null);

/** 앱에 하나뿐인 토스트. 새 토스트가 오면 바꿔 끼운다 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [t, setT] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const seq = useRef(0);
  const hide = useCallback(() => { clearTimeout(timer.current); setT(null); }, []);
  const show = useCallback((message: string, opts: ToastOpts = {}) => {
    clearTimeout(timer.current);
    const id = ++seq.current;
    setT({ id, message, ...opts });
    timer.current = setTimeout(() => setT((cur) => (cur?.id === id ? null : cur)), opts.action || opts.kind === "error" ? 6000 : 3500);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  const api = useMemo(() => ({ show, hide }), [show, hide]);
  return (
    <Ctx.Provider value={api}>
      {children}
      {t && <ToastView key={t.id} t={t} onAction={() => { t.action?.onClick(); hide(); }} />}
    </Ctx.Provider>
  );
}

function ToastView({ t, onAction }: { t: ToastState; onAction: () => void }) {
  const bottom = t.raised === "aboveTabs" ? "calc(var(--safe-bottom) + 148px)"
    : t.raised ? "calc(var(--safe-bottom) + 92px)" : "calc(var(--safe-bottom) + 56px + 12px)";
  return (
    <div role={t.kind === "error" ? "alert" : "status"} aria-live="polite" data-testid="toast"
      className="fixed inset-x-0 z-[80] mx-auto flex w-[calc(100%-40px)] max-w-[440px] items-center gap-3 rounded-card bg-toast py-3 pl-4 pr-2 text-callout text-white shadow-overlay animate-toast-in"
      style={{ bottom }}>
      {t.kind === "done" && <CircleCheckBig size={20} className="shrink-0 text-toast-action" aria-hidden />}
      {t.kind === "error" && <CircleAlert size={20} className="shrink-0 text-[#FF8F84]" aria-hidden />}
      <span className={`min-w-0 flex-1 ${t.action ? "" : "py-2.5"}`}>{t.message}</span>
      {t.action && <button type="button" onClick={onAction} className="h-11 shrink-0 px-3 text-callout font-semibold text-toast-action">{t.action.label}</button>}
    </div>
  );
}

export function useToast() {
  const c = useContext(Ctx);
  if (!c) throw new Error("ToastProvider 밖에서 useToast 를 불렀어요");
  return c;
}
