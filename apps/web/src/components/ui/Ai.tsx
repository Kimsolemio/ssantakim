import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { ArrowUpRight, Globe, LoaderCircle, Sparkles } from "lucide-react";
import { Button } from "./Button";
import { rowLine } from "./Section";

/** AI 입구 여러 개를 한 줄로. 반짝이는 줄 앞 라벨에 한 번만 */
export function AiToolbar({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`flex items-center gap-2 overflow-x-auto px-5 pb-5 [scrollbar-width:none] ${className}`}>
      <span className="inline-flex shrink-0 items-center gap-1 text-caption font-semibold text-ink-3"><Sparkles size={16} strokeWidth={2} aria-hidden />AI</span>
      {children}
    </div>
  );
}

export function AiPill({ className = "", ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className={`h-11 shrink-0 whitespace-nowrap rounded-full bg-surface-2 px-4 text-callout font-semibold text-ink transition-colors active:bg-fill-pressed disabled:text-ink-disabled ${className}`} {...rest} />;
}

/** 지난 초 (AI 진행 표시용) */
export function useSeconds(running = true, startedAt?: number) {
  const since = () => (startedAt ? Math.max(0, Math.floor((Date.now() - startedAt) / 1000)) : 0);
  const [sec, setSec] = useState(since);
  useEffect(() => {
    if (!running) { setSec(0); return; }
    const start = startedAt ?? Date.now();
    setSec(Math.max(0, Math.floor((Date.now() - start) / 1000)));
    const t = setInterval(() => setSec(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(t);
  }, [running, startedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  return sec;
}

/** AI 작업 중 (모든 AI 기능 공통). messages 는 6초마다 다음 문구로 */
export function AiProgress({ messages, typical, onCancel, size = "lg", icon, className = "", startedAt }: {
  messages: string[]; typical?: string; onCancel?: () => void; size?: "lg" | "sm"; icon?: ReactNode; className?: string;
  /** 탭을 옮겼다 와도 이어서 세도록 시작 시각(ms) */ startedAt?: number;
}) {
  const sec = useSeconds(true, startedAt);
  const msg = messages[Math.min(Math.floor(sec / 6), messages.length - 1)] ?? "AI가 일하는 중…";
  if (size === "sm") {
    return (
      <div role="status" aria-live="polite" className={`flex items-center gap-3 rounded-card bg-surface py-3 pl-4 pr-2 ${className}`}>
        <LoaderCircle size={24} className="shrink-0 animate-spin text-accent" aria-hidden />
        <span className="min-w-0 flex-1 text-callout text-ink">{msg} <span aria-hidden className="text-ink-3 tabular-nums">{sec}초</span></span>
        {onCancel && <Button variant="ghost" size="md" onClick={onCancel}>취소</Button>}
      </div>
    );
  }
  return (
    <div role="status" aria-live="polite" className={`flex flex-col items-center px-8 py-16 text-center ${className}`}>
      {icon ?? <LoaderCircle size={32} className="animate-spin text-accent" aria-hidden />}
      <p className="mt-5 text-headline text-ink">{msg}</p>
      <p aria-hidden className="mt-1 text-caption text-ink-3 tabular-nums">{sec}초{typical ? ` · ${typical}` : ""}</p>
      {onCancel && <Button variant="ghost" size="md" className="mt-6" onClick={onCancel}>취소</Button>}
    </div>
  );
}

function siteName(url: string): string {
  try { return new URL(url).hostname.replace(/^www\.|^m\./, ""); } catch { return url; }
}

/** 웹 검색으로 참고한 곳 */
export function SourceList({ refs, limit }: { refs: { url: string; title: string | null }[]; limit?: number }) {
  const [all, setAll] = useState(false);
  const shown = limit && !all ? refs.slice(0, limit) : refs;
  return (
    <>
      <ul data-testid="recipe-refs">
        {shown.map((r) => (
          <li key={r.url} className={`${rowLine} before:left-[72px]`}>
            <a href={r.url} target="_blank" rel="noreferrer" className="flex min-h-14 items-center gap-3 px-5 py-3 transition-colors active:bg-surface-2">
              <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-full bg-surface-2 text-ink-2"><Globe size={20} /></span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body text-ink">{siteName(r.url)}</span>
                {r.title && <span className="mt-0.5 block truncate text-caption text-ink-3">{r.title}</span>}
              </span>
              <ArrowUpRight size={18} aria-hidden className="shrink-0 text-ink-3" />
            </a>
          </li>
        ))}
      </ul>
      {limit && refs.length > limit && !all && (
        <button type="button" onClick={() => setAll(true)} className="ml-5 h-11 text-callout font-semibold text-accent active:opacity-60">모두 보기 ({refs.length})</button>
      )}
    </>
  );
}
