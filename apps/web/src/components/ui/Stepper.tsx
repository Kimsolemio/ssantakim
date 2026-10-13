import { Minus, Plus } from "lucide-react";

export function Stepper({ value, onChange, min = 1, max = 20, unit = "인분", labels = { minus: "인분 줄이기", plus: "인분 늘리기" } }: {
  value: number; onChange: (v: number) => void; min?: number; max?: number; unit?: string; labels?: { minus: string; plus: string };
}) {
  const btn = "grid size-11 place-items-center rounded-full text-ink active:bg-fill-pressed disabled:text-ink-disabled";
  return (
    <div className="inline-flex h-11 items-center rounded-full bg-surface-2">
      <button type="button" aria-label={labels.minus} className={btn} disabled={value <= min} onClick={() => onChange(value - 1)}><Minus size={20} /></button>
      <span className="min-w-16 text-center text-headline tabular-nums">{value}{unit}</span>
      <button type="button" aria-label={labels.plus} className={btn} disabled={value >= max} onClick={() => onChange(value + 1)}><Plus size={20} /></button>
    </div>
  );
}
