import { Check, ChevronRight } from "lucide-react";
import { IngredientGroup, formatAmount, scaleIngredients, type Ingredient, type MatchStatus } from "@cook/shared";
import { Badge } from "../../components/ui/Badge";
import { GroupLabel, rowLine } from "../../components/ui/Section";

type Props = {
  ingredients: Ingredient[];
  servingsBase: number;
  servings: number;
  highlightKeys?: string[];
  /** 원래 재료 순서와 같은 길이. 냉장고 대조 결과를 줄마다 표시 (similar: 없음이지만 비슷한 이름이 있음) */
  statuses?: { status: MatchStatus; label: string; similar?: boolean }[];
  onStatusClick?: (index: number) => void;
};

/**
 * 상태 칸. 행의 마지막 <span>은 수량이어야 한다(e2e가 수량을 그렇게 읽는다) — 그래서 이 안에는 span을 쓰지 않는다.
 * 정상(있음)은 색 없이 체크만, 부족만 노랑 배지, 없음은 회색 글자 + 화살표(누르면 재료 시트)
 */
function StatusMark({ status, label, similar }: { status: MatchStatus; label: string; similar?: boolean }) {
  switch (status) {
    case "enough": return <Check size={18} strokeWidth={2.5} aria-hidden className="text-success" />;
    case "unknown_amount": return <><Check size={16} strokeWidth={2.5} aria-hidden className="shrink-0 text-success" />양 확인</>;
    case "short": return <b className="inline-flex h-6 items-center rounded-badge bg-warning-soft px-2 font-semibold text-warning">{label}</b>;
    case "missing": return similar ? <b className="font-semibold text-accent">비슷한 것?</b> : <>없음<ChevronRight size={14} aria-hidden className="shrink-0" /></>;
    case "staple": return <>늘 있음</>;
    case "always": return null;
  }
}

/** 그룹별로 묶어 인분 스케일링된 재료를 표시 */
export function IngredientList({ ingredients, servingsBase, servings, highlightKeys, statuses, onStatusClick }: Props) {
  const scaled = scaleIngredients(ingredients, servingsBase, servings).map((ing, index) => ({ ing, index }));
  const groups = IngredientGroup.options.filter((g) => scaled.some((x) => x.ing.group === g));
  const hl = new Set(highlightKeys ?? []);
  return (
    <div>
      {groups.map((g) => (
        <div key={g}>
          {groups.length > 1 && <GroupLabel>{g}</GroupLabel>}
          <ul>
            {scaled.filter((x) => x.ing.group === g).map(({ ing: i, index }) => {
              const st = statuses?.[index];
              return (
                <li key={`${i.key}-${index}`} data-testid="ingredient-row"
                  className={`${rowLine} before:left-5 flex min-h-14 items-center gap-3 py-1 pl-5 ${st ? "pr-3" : "pr-5"} ${hl.has(i.key) ? "bg-accent-soft" : ""}`}>
                  <span className="min-w-0 flex-1 py-2">
                    <span className="text-body text-ink">{i.name}</span>
                    {i.note && <span className="ml-1.5 text-caption text-ink-3">{i.note}</span>}
                    {i.optional && <Badge className="ml-1.5 align-[1px]">선택</Badge>}
                  </span>
                  <span className="shrink-0 text-callout text-ink-2 tabular-nums">{formatAmount(i) || "약간"}</span>
                  {st && st.status !== "always" ? (
                    <button type="button" onClick={() => onStatusClick?.(index)} data-status={st.status}
                      aria-label={st.status === "enough" ? st.label : undefined}
                      className="-my-1 flex h-11 min-w-[76px] shrink-0 items-center justify-end gap-1 rounded-control px-2 text-caption tabular-nums text-ink-3 transition-colors active:bg-surface-2">
                      <StatusMark {...st} />
                    </button>
                  ) : st ? <div aria-hidden className="min-w-[76px] shrink-0" /> : null}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
