import { forwardRef, useEffect, useId, useRef, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { ChevronDown, CircleAlert, Search, X } from "lucide-react";
import { Badge } from "./Badge";

/** 입력칸 공통 모양. 흰 면(시트·전체화면) 위 = surface-2, canvas 위 = onCanvas */
export const inputBase = "w-full rounded-control border border-transparent px-4 text-body text-ink placeholder:text-ink-3 outline-none transition "
  + "focus:border-accent focus:bg-surface focus:ring-4 focus:ring-accent/15 disabled:text-ink-disabled";
const fill = (onCanvas?: boolean) => (onCanvas ? "bg-surface" : "bg-surface-2");

type Common = { label?: ReactNode; helper?: ReactNode; error?: string | null; onCanvas?: boolean; wrapClass?: string };

/** 라벨 + 입력 + 도움말/오류 1줄 */
export function Field({ label, helper, error, htmlFor, children, className = "" }: { label?: ReactNode; helper?: ReactNode; error?: string | null; htmlFor?: string; children: ReactNode; className?: string }) {
  // 도움말·오류 문구는 입력칸 id + "-desc" 로 연결한다 (aria-describedby)
  const descId = htmlFor ? `${htmlFor}-desc` : undefined;
  return (
    <div className={className}>
      {label && <label htmlFor={htmlFor} className="mb-2 block text-caption font-semibold text-ink-2">{label}</label>}
      {children}
      {error ? <p id={descId} className="mt-1.5 flex items-center gap-1 text-caption text-danger"><CircleAlert size={14} aria-hidden />{error}</p>
        : helper ? <p id={descId} className="mt-1.5 text-caption text-ink-3">{helper}</p> : null}
    </div>
  );
}

export const TextField = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & Common & { big?: boolean; suffix?: string }>(
  function TextField({ label, helper, error, onCanvas, wrapClass = "", big, suffix, className = "", id, ...rest }, ref) {
    const auto = useId();
    const fid = id ?? auto;
    return (
      <Field label={label} helper={helper} error={error} htmlFor={fid} className={wrapClass}>
        <div className="relative">
          <input ref={ref} id={fid} aria-invalid={error ? true : undefined} aria-describedby={error || helper ? `${fid}-desc` : undefined}
            className={`${inputBase} ${fill(onCanvas)} ${big ? "h-14 text-title2" : "h-12"} ${error ? "border-danger" : ""} ${suffix ? "pr-12" : ""} ${className}`} {...rest} />
          {suffix && <span aria-hidden className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-body text-ink-3">{suffix}</span>}
        </div>
      </Field>
    );
  });

/** 내용에 따라 높이가 늘어나는 여러 줄 입력 */
export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & Common & { /** 1이면 한 줄 높이(48px)에서 시작 */ minRows?: number }>(
  function TextArea({ label, helper, error, onCanvas, wrapClass = "", className = "", id, value, minRows = 4, ...rest }, ref) {
    const auto = useId();
    const fid = id ?? auto;
    const inner = useRef<HTMLTextAreaElement | null>(null);
    useEffect(() => {
      const el = inner.current;
      if (!el) return;
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight + 2, 360)}px`;
    }, [value]);
    return (
      <Field label={label} helper={helper} error={error} htmlFor={fid} className={wrapClass}>
        <textarea id={fid} value={value} aria-invalid={error ? true : undefined} aria-describedby={error || helper ? `${fid}-desc` : undefined}
          ref={(el) => { inner.current = el; if (typeof ref === "function") ref(el); else if (ref) ref.current = el; }}
          style={{ minHeight: minRows * 26 + 24 }}
          className={`${inputBase} ${fill(onCanvas)} resize-none py-3 leading-[26px] ${error ? "border-danger" : ""} ${className}`} {...rest} />
      </Field>
    );
  });

export function Select({ label, helper, error, onCanvas, wrapClass = "", className = "", id, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & Common) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <Field label={label} helper={helper} error={error} htmlFor={fid} className={wrapClass}>
      <div className="relative">
        <select id={fid} className={`${inputBase} ${fill(onCanvas)} h-12 appearance-none pr-10 ${className}`} {...rest}>{children}</select>
        <ChevronDown size={18} aria-hidden className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-ink-3" />
      </div>
    </Field>
  );
}

export const SearchField = forwardRef<HTMLInputElement, {
  value: string; onChange: (v: string) => void; placeholder?: string; label?: string; onCanvas?: boolean; className?: string; autoFocus?: boolean;
}>(function SearchField({ value, onChange, placeholder = "검색", label = "검색", onCanvas, className = "", autoFocus }, ref) {
  return (
    <div className={`relative ${className}`}>
      <Search size={20} aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3" />
      <input ref={ref} type="search" aria-label={label} value={value} placeholder={placeholder} autoFocus={autoFocus} onChange={(e) => onChange(e.target.value)}
        className={`${inputBase} ${fill(onCanvas)} h-12 pl-11 ${value ? "pr-12" : ""} [&::-webkit-search-cancel-button]:hidden`} />
      {value && (
        <button type="button" aria-label="검색어 지우기" onClick={() => onChange("")}
          className="absolute right-1 top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-full text-ink-3 active:bg-fill-pressed"><X size={18} /></button>
      )}
    </div>
  );
});

const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
/** "2026-10-21" → "10월 21일 (수)" */
export function formatDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${m}월 ${d}일 (${WEEK[w]})`;
}

/** 날짜 고르기: 네이티브 date 입력은 숨기고 읽기 쉬운 글자를 보여 준다. 누르면 달력을 연다 */
export function DateField({ label, value, onChange, today, estimated, placeholder = "기한 없음", helper, onCanvas, wrapClass = "", "aria-label": ariaLabel }: {
  label?: ReactNode; value: string; onChange: (v: string) => void; today?: string; estimated?: boolean; placeholder?: string; helper?: ReactNode; onCanvas?: boolean; wrapClass?: string; "aria-label"?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const fid = useId();
  let dday = "";
  if (value && today) {
    const diff = Math.round((Date.parse(value) - Date.parse(today)) / 86_400_000);
    dday = diff === 0 ? "D-day" : diff > 0 ? `D-${diff}` : `${-diff}일 지남`;
  }
  const open = () => {
    const el = ref.current;
    if (!el) return;
    try { el.showPicker(); } catch { el.focus(); el.click(); }
  };
  return (
    <Field label={label} helper={helper} htmlFor={fid} className={wrapClass}>
      <div className="relative">
        {/* 화면 읽기·키보드·테스트는 이 실제 입력을 쓴다. 눈에는 보이지 않게 아래 버튼 뒤에 깐다 */}
        <input ref={ref} id={fid} type="date" value={value} aria-label={ariaLabel} onChange={(e) => onChange(e.target.value)}
          className="peer absolute inset-0 -z-10 h-full w-full opacity-0" />
        <button type="button" onClick={open} aria-hidden tabIndex={-1}
          className={`${inputBase} ${fill(onCanvas)} flex h-12 items-center justify-between gap-2 text-left peer-focus-visible:border-accent peer-focus-visible:ring-4 peer-focus-visible:ring-accent/15`}>
          <span className={value ? "text-ink" : "text-ink-3"}>{value ? `${formatDay(value)}${dday ? ` · ${dday}` : ""}` : placeholder}</span>
          {estimated && value && <Badge>추정</Badge>}
        </button>
      </div>
    </Field>
  );
}
