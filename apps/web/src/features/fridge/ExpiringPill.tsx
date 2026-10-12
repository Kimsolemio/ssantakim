import { daysUntil } from "@cook/shared";
import { useFamily } from "../../lib/family";
import { useNav } from "../../lib/nav";
import { useFridge } from "./useFridge";

/** 레시피 탭 머리: 사흘 안에 먹어야 할 재료가 있을 때만. 누르면 '뭐 먹지'로 */
export function ExpiringPill() {
  const { familyId } = useFamily();
  const { setTab } = useNav();
  const { items } = useFridge(familyId);
  const n = items.filter((f) => { const d = daysUntil(f.expiresAt); return d != null && d >= 0 && d <= 3; }).length;
  if (n === 0) return null;
  return (
    <button type="button" onClick={() => setTab("today")} aria-label={`빨리 먹어야 할 재료 ${n}개 · 뭐 먹지로`} data-testid="expiring-pill"
      className="inline-flex h-11 shrink-0 items-center px-1 active:opacity-70">
      <span aria-hidden className="inline-flex h-9 items-center gap-1.5 rounded-full bg-danger-soft px-3 text-callout font-semibold text-danger tabular-nums">
        <span className="size-1.5 rounded-full bg-danger" />임박 {n}
      </span>
    </button>
  );
}
