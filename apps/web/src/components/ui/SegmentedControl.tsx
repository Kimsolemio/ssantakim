type Opt<T extends string> = { value: T; label: string };

/** 2~5칸 고르기. role 은 탭처럼 쓸 때 "tab" */
export function SegmentedControl<T extends string>({ value, onChange, options, role = "radio", className = "", label }: {
  value: T; onChange: (v: T) => void; options: Opt<T>[]; role?: "radio" | "tab"; className?: string; label?: string;
}) {
  return (
    <div role={role === "tab" ? "tablist" : "radiogroup"} aria-label={label} className={`flex h-11 rounded-control bg-surface-2 p-1 ${className}`}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button key={o.value} type="button" role={role} {...(role === "tab" ? { "aria-selected": on } : { "aria-checked": on })} onClick={() => onChange(o.value)}
            className={`flex-1 whitespace-nowrap rounded-[9px] px-2 text-callout transition-colors ${on ? "bg-thumb font-semibold text-ink shadow-raised" : "font-medium text-ink-2"}`}>{o.label}</button>
        );
      })}
    </div>
  );
}
