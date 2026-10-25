import type { InputHTMLAttributes, ReactNode } from "react";
import { Check } from "lucide-react";

/** 네모 체크박스 (round: 장보기의 둥근 체크). 감싸는 label 이 44px 이상이 되게 쓴다 */
export function Checkbox({ round, className = "", ...rest }: InputHTMLAttributes<HTMLInputElement> & { round?: boolean }) {
  const shape = round ? "size-7 rounded-full" : "size-6 rounded-[7px]";
  return (
    <span className={`relative inline-grid shrink-0 place-items-center ${shape} ${className}`}>
      <input type="checkbox" className={`peer col-start-1 row-start-1 appearance-none border-2 border-line-strong bg-surface transition-colors checked:border-accent checked:bg-accent disabled:opacity-50 ${shape}`} {...rest} />
      <Check size={round ? 18 : 16} strokeWidth={3} aria-hidden className="pointer-events-none col-start-1 row-start-1 text-on-accent opacity-0 peer-checked:opacity-100" />
    </span>
  );
}

/** 켜고 끄기 (role=switch) */
export function Switch({ checked, onChange, label, disabled, className = "" }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean; className?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}
      className={`relative inline-flex h-[31px] w-[51px] shrink-0 items-center rounded-full bg-line-strong transition-colors aria-checked:bg-accent disabled:opacity-50 ${className}`}>
      <span aria-hidden className={`size-[27px] rounded-full bg-white shadow-raised transition-transform ${checked ? "translate-x-[22px]" : "translate-x-0.5"}`} />
    </button>
  );
}

/** 라벨 줄 + 오른쪽 스위치 (설정 행) */
export function SwitchRow({ title, sub, checked, onChange, disabled }: { title: ReactNode; sub?: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="flex min-h-14 items-center gap-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="text-body text-ink">{title}</p>
        {sub && <p className="mt-0.5 text-caption text-ink-3">{sub}</p>}
      </div>
      <Switch checked={checked} onChange={onChange} label={typeof title === "string" ? title : "켜기"} disabled={disabled} />
    </div>
  );
}

/** 하나 고르기 동그라미. 행 전체를 label 로 감싼다 */
export function Radio({ className = "", ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <span className={`relative inline-grid size-6 shrink-0 place-items-center ${className}`}>
      <input type="radio" className="peer col-start-1 row-start-1 size-6 appearance-none rounded-full border-2 border-line-strong bg-surface transition-colors checked:border-accent" {...rest} />
      <span aria-hidden className="pointer-events-none col-start-1 row-start-1 size-3 rounded-full bg-accent opacity-0 peer-checked:opacity-100" />
    </span>
  );
}
