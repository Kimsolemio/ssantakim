import { daysUntil } from "@cook/shared";
import { useFamily } from "../../lib/family";
import { useNav } from "../../lib/nav";
import { useFridge } from "./useFridge";

/** '뭐 먹지'의 "빨리 먹어야 해요"와 같은 규칙: 사흘 안, 또는 추정 기한이 사흘 안으로 지난 것(실제로는 멀쩡할 수 있다) */
export function isExpiringSoon(f: { expiresAt: string | null; expiresEstimated?: boolean }): boolean {
  const d = daysUntil(f.expiresAt);
  if (d == null) return false;
  return d >= 0 ? d <= 3 : f.expiresEstimated === true && d >= -3;
}

/** 레시피 탭 머리: 빨리 먹어야 할 재료가 있을 때만. 누르면 '뭐 먹지'로 */
export function ExpiringPill() {
  const { familyId } = useFamily();
  const { setTab } = useNav();
  const { items } = useFridge(familyId);
  const n = items.filter(isExpiringSoon).length;
  if (n === 0) return null;
  return (
    <button type="button" onClick={() => setTab("today")} aria-label={`빨리 먹어야 할 재료 ${n}개 · 뭐 먹지로`} data-testid="expiring-pill"
      className="inline-flex h-11 shrink-0 items-center px-1 active:opacity-70">
      <span aria-hidden className="inline-flex h-8 items-center gap-1.5 rounded-full bg-danger-soft px-3 text-caption font-semibold text-danger tabular-nums">
        <span className="size-1.5 rounded-full bg-danger" />임박 {n}
      </span>
    </button>
  );
}
