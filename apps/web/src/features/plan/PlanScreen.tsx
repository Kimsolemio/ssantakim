import { useMemo, useState } from "react";
import { CalendarDays, Check, ChevronLeft, ChevronRight, Plus, X } from "lucide-react";
import {
  addDays, combinePlanIngredients, daysUntil, formatAmount, localDate, planShopping, weekDays, weekStart,
  DEFAULT_STAPLES, type MealSlot,
} from "@cook/shared";
import { useFamily } from "../../lib/family";
import { useAuth } from "../../lib/auth";
import { useNav } from "../../lib/nav";
import { normalizeKeysInBackground } from "../../lib/normalize";
import { writeErrorMessage } from "../../lib/write";
import { FullScreen } from "../../components/FullScreen";
import { Sheet } from "../../components/Sheet";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { Card, GroupLabel, SectionHeader, TextAction, rowLine, rowLineInset, rowLinePlain } from "../../components/ui/Section";
import { IconButton } from "../../components/ui/IconButton";
import { FoodThumb, IconThumb } from "../../components/ui/FoodThumb";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { Stepper } from "../../components/ui/Stepper";
import { SearchField } from "../../components/ui/Field";
import { ChoiceChip } from "../../components/ui/Chip";
import { Checkbox } from "../../components/ui/Toggle";
import { EmptyState } from "../../components/ui/EmptyState";
import { useToast } from "../../components/ui/Toast";
import { useRecipes, type RecipeDoc } from "../recipes/useRecipes";
import { recipeEmoji } from "../recipes/recipeLook";
import { useFridge } from "../fridge/useFridge";
import { useShopping, addShoppingItems } from "../shopping/useShopping";
import { SLOTS, addPlanEntry, removePlanEntry, usePlan, type PlanDoc } from "./usePlan";

const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
const dateParts = (iso: string) => { const [y, m, d] = iso.split("-").map(Number); return { m, d, w: new Date(y, m - 1, d).getDay() }; };
/** "수요일" */
const weekdayName = (iso: string) => `${WEEK[dateParts(iso).w]}요일`;
/** "오늘" / "내일" / "수요일" */
export function dayWord(iso: string, today = localDate()): string {
  if (iso === today) return "오늘";
  if (iso === addDays(today, 1)) return "내일";
  return weekdayName(iso);
}
/** "10월 12일 – 18일" / "10월 26일 – 11월 1일" */
function rangeLabel(start: string) {
  const a = dateParts(start), b = dateParts(addDays(start, 6));
  return a.m === b.m ? `${a.m}월 ${a.d}일 – ${b.d}일` : `${a.m}월 ${a.d}일 – ${b.m}월 ${b.d}일`;
}

const SLOT_OPTIONS = SLOTS.map((s) => ({ value: s, label: s }));

/** 식단 한 줄의 음식 그림 (레시피를 지웠으면 이름 첫 글자) */
function EntryThumb({ recipe, title }: { recipe?: RecipeDoc; title: string }) {
  const e = recipe ? recipeEmoji(recipe) : null;
  return e ? <FoodThumb emoji={e} /> : <IconThumb><span className="text-callout font-semibold">{[...title.trim()][0] ?? "?"}</span></IconThumb>;
}

/** 처음 보여 줄 주: 일요일에는 끝나 가는 이번 주 대신 다음 주 (일요일 저녁에 다음 주 식단을 짠다) */
export function defaultPlanWeek(today = localDate()): string {
  const start = weekStart(today);
  return dateParts(today).w === 0 ? addDays(start, 7) : start;
}
/** "이번 주" / "다음 주" / "지난주" / "2주 뒤" */
function weekWord(start: string, thisWeek: string): string {
  const n = Math.round((Date.parse(start) - Date.parse(thisWeek)) / (7 * 86_400_000));
  return n === 0 ? "이번 주" : n === 1 ? "다음 주" : n === -1 ? "지난주" : n > 0 ? `${n}주 뒤` : `${-n}주 전`;
}

/** 식단 (전체화면). 오늘부터 남은 식단의 부족한 재료를 한 번에 장보기에 담는다 */
export function PlanScreen({ initialStart, onClose }: { initialStart?: string; onClose: () => void }) {
  const { familyId, family } = useFamily();
  const { user } = useAuth();
  const { openRecipe } = useNav();
  const toast = useToast();
  const today = localDate();
  const thisWeek = weekStart(today);
  const [start, setStart] = useState(() => initialStart ?? defaultPlanWeek(today));
  const [showPast, setShowPast] = useState(false);
  const { entries, loading } = usePlan(familyId, start);
  // 장보기 계산은 오늘부터 보고 있는 주의 끝까지 (금요일에 다음 주를 보면 이번 주 남은 날도 함께 센다)
  const end = addDays(start, 6);
  const span = end >= today ? (daysUntil(end) ?? 0) + 1 : 0;
  const { entries: ahead } = usePlan(familyId, today, Math.max(span, 1));
  const { recipes } = useRecipes(familyId);
  const { items: fridge, loading: fridgeLoading } = useFridge(familyId);
  const { items: shopping, loading: shoppingLoading } = useShopping(familyId);
  const [adding, setAdding] = useState<string | null>(null);
  const [shopOpen, setShopOpen] = useState(false);
  const byId = useMemo(() => new Map(recipes.map((r) => [r.id, r])), [recipes]);
  const profileStaples = family?.profile.staples;
  const staples = useMemo(() => profileStaples ?? [...DEFAULT_STAPLES], [profileStaples]);

  // 지난 날은 이미 먹었다고 보고, 오늘부터 남은 식단만 센다
  const upcoming = useMemo(() => (span > 0 ? ahead : []).filter((e) => byId.has(e.recipeId)), [span, ahead, byId]);
  const rows = useMemo(() => planShopping(
    combinePlanIngredients(upcoming.map((e) => ({ recipe: byId.get(e.recipeId)!, servings: e.servings }))), fridge, { staples }, shopping,
  ), [upcoming, byId, fridge, staples, shopping]);
  const pending = rows.filter((r) => !r.covered && !r.unsure);

  const remove = async (e: PlanDoc) => {
    if (!familyId || !user) return;
    try {
      await removePlanEntry(familyId, e.id);
      toast.show(`${dayWord(e.date, today)} ${e.slot}에서 뺐어요`, {
        raised: true,
        action: { label: "되돌리기", onClick: () => { void addPlanEntry(familyId, user.uid, { date: e.date, slot: e.slot, recipeId: e.recipeId, title: e.title, servings: e.servings }); } },
      });
    } catch (err) { toast.show(`빼지 못했어요: ${writeErrorMessage(err)}`, { kind: "error", raised: true }); }
  };

  // 남은 식단이 없으면 하단 행동을 두지 않는다. 다 있거나 다 담았으면 버튼 대신 한 줄로 알린다
  const footer = upcoming.length === 0 ? undefined : fridgeLoading || shoppingLoading
    ? <Button block disabled>냉장고 확인 중…</Button>
    : pending.length === 0
      ? <p className="flex h-14 items-center justify-center gap-2 text-callout text-ink-2" data-testid="plan-shopping-done"><Check size={18} aria-hidden className="text-success" />{rows.some((r) => r.covered) ? "부족한 재료는 장보기에 다 담았어요" : "남은 식단 재료가 냉장고에 다 있어요"}</p>
      : <Button block onClick={() => setShopOpen(true)} data-testid="plan-shopping">부족한 재료 담기 ({pending.length}개)</Button>;

  const days = weekDays(start);
  const past = days.filter((d) => d < today);
  // 이번 주를 볼 때 지난 날은 한 줄로 접어 둔다
  const fold = past.length > 0 && past.length < 7 && !showPast;
  const shown = fold ? days.filter((d) => d >= today) : days;

  return (
    <FullScreen title="식단" onClose={onClose} canvas footer={footer}>
      <div className="flex items-center justify-between px-2 pb-2 pt-1">
        <IconButton aria-label="지난주" onClick={() => { setStart(addDays(start, -7)); setShowPast(false); }}><ChevronLeft size={24} /></IconButton>
        <div className="text-center">
          <p className="text-headline text-ink tabular-nums" data-testid="plan-range" aria-live="polite">{rangeLabel(start)}</p>
          {start !== thisWeek
            ? <button type="button" onClick={() => setStart(thisWeek)} className="h-8 px-2 text-caption font-semibold text-accent active:opacity-60">{weekWord(start, thisWeek)} · 이번 주로</button>
            : <p className="h-8 text-caption leading-8 text-ink-3">이번 주</p>}
        </div>
        <IconButton aria-label="다음 주" onClick={() => { setStart(addDays(start, 7)); setShowPast(false); }}><ChevronRight size={24} /></IconButton>
      </div>
      {!loading && entries.length === 0 && <p className="px-5 pb-3 text-center text-caption text-ink-3">날짜 옆 + 로 레시피를 넣어요</p>}
      {fold && (
        <button type="button" onClick={() => setShowPast(true)} className="mx-5 mb-3 flex h-11 w-[calc(100%-40px)] items-center justify-center gap-1 rounded-card text-callout text-ink-3 active:bg-surface-2">
          지난 {past.length}일 보기{entries.some((e) => e.date < today) ? ` (${entries.filter((e) => e.date < today).length}끼)` : ""}
        </button>
      )}

      {shown.map((d) => {
        const list = entries.filter((e) => e.date === d);
        const isPast = d < today;
        const { m, d: dd } = dateParts(d);
        return (
          <Card key={d} className="mx-5 mb-3 overflow-hidden" data-testid="plan-day" data-date={d}>
            <div className="flex min-h-12 items-center gap-2 py-1 pl-4 pr-1">
              <p className={`min-w-0 flex-1 text-headline ${isPast ? "text-ink-3" : "text-ink"}`}>
                {weekdayName(d)} <span className="text-callout font-medium text-ink-3 tabular-nums">{m}/{dd}</span>
              </p>
              {d === today && <Badge>오늘</Badge>}
              {!isPast && <IconButton aria-label={`${weekdayName(d)} 식단 추가`} onClick={() => setAdding(d)}><Plus size={22} className="text-ink-2" /></IconButton>}
            </div>
            {list.length > 0 && (
              <ul>
                {list.map((e) => {
                  const r = byId.get(e.recipeId);
                  return (
                    <li key={e.id} className={rowLineInset} data-testid="plan-entry">
                      <div className="flex min-h-14 items-center gap-3 py-2 pl-4 pr-1">
                        <button type="button" disabled={!r} onClick={() => r && openRecipe(r.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left active:opacity-70">
                          <EntryThumb recipe={r} title={e.title} />
                          <span className="min-w-0 flex-1">
                            <span className={`block truncate text-body ${isPast ? "text-ink-3" : "text-ink"}`}>{r?.title ?? e.title}</span>
                            <span className="mt-0.5 block truncate text-caption text-ink-3 tabular-nums">{e.slot} · {e.servings}인분{r ? "" : " · 지운 레시피"}</span>
                          </span>
                        </button>
                        <IconButton aria-label={`${weekdayName(d)} ${e.slot} ${r?.title ?? e.title} 빼기`} onClick={() => void remove(e)}><X size={18} className="text-ink-3" /></IconButton>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        );
      })}

      {adding && familyId && user && (
        <PickRecipeSheet date={adding} recipes={recipes} defaultServings={family?.profile.defaultServings ?? 2}
          onClose={() => setAdding(null)}
          onPick={async (r, slot, servings) => {
            try {
              await addPlanEntry(familyId, user.uid, { date: adding, slot, recipeId: r.id, title: r.title, servings });
              toast.show(`${dayWord(adding, today)} ${slot}에 ${r.title} 넣었어요`, { kind: "done", raised: true });
              setAdding(null);
            } catch (err) { toast.show(`넣지 못했어요: ${writeErrorMessage(err)}`, { kind: "error", raised: true }); }
          }} />
      )}
      {shopOpen && familyId && user && (
        <PlanShoppingSheet rows={rows} until={end} onClose={() => setShopOpen(false)}
          onConfirm={async (items) => {
            const res = await addShoppingItems(familyId, user.uid, items, shopping);
            void normalizeKeysInBackground(familyId, "shopping_items", res.added);
            setShopOpen(false);
            toast.show(`장보기에 ${res.added.length + res.merged}개 담았어요${res.merged ? ` · ${res.merged}개는 양만 더함` : ""}`, { kind: "done", raised: true });
          }} />
      )}
    </FullScreen>
  );
}

/** 날짜 하나에 넣을 레시피 고르기 */
function PickRecipeSheet({ date, recipes, defaultServings, onClose, onPick }: {
  date: string; recipes: RecipeDoc[]; defaultServings: number; onClose: () => void;
  onPick: (r: RecipeDoc, slot: MealSlot, servings: number) => Promise<void>;
}) {
  const [slot, setSlot] = useState<MealSlot>("저녁");
  const [servings, setServings] = useState(defaultServings);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const { m, d } = dateParts(date);
  const shown = recipes.filter((r) => !q.trim() || r.title.includes(q.trim()) || r.ingredients.some((i) => i.name.includes(q.trim())));
  return (
    <Sheet title={`${m}월 ${d}일 ${weekdayName(date)}`} onClose={onClose} tall flush testId="plan-pick">
      <div className="space-y-3 px-5 pb-2 pt-1">
        <SegmentedControl label="끼니" value={slot} onChange={setSlot} options={SLOT_OPTIONS} />
        <div className="flex items-center justify-between gap-3">
          <span className="text-body text-ink">인분</span>
          <Stepper value={servings} onChange={setServings} />
        </div>
        {recipes.length > 6 && <SearchField value={q} onChange={setQ} placeholder="레시피 찾기" label="레시피 찾기" />}
      </div>
      <GroupLabel>레시피를 누르면 넣어요</GroupLabel>
      {recipes.length === 0
        ? <EmptyState icon={<CalendarDays size={28} />} title="저장한 레시피가 없어요" body="레시피 탭에서 먼저 만들어 주세요" className="py-8" />
        : (
          <ul>
            {shown.length === 0 && <li className="px-5 py-6 text-center text-callout text-ink-3">‘{q.trim()}’ 레시피가 없어요</li>}
            {shown.map((r) => {
              const e = recipeEmoji(r);
              return (
                <li key={r.id} className={rowLineInset}>
                  <button type="button" disabled={busy} onClick={async () => { setBusy(true); try { await onPick(r, slot, servings); } finally { setBusy(false); } }}
                    className="flex min-h-14 w-full items-center gap-3 px-5 py-2 text-left transition-colors active:bg-surface-2 disabled:opacity-50">
                    {e ? <FoodThumb emoji={e} /> : <IconThumb><span className="text-callout font-semibold">{[...r.title.trim()][0] ?? ""}</span></IconThumb>}
                    <span className="min-w-0 flex-1 truncate text-body text-ink">{r.title}</span>
                    <Plus size={20} aria-hidden className="shrink-0 text-ink-3" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
    </Sheet>
  );
}

type Row = ReturnType<typeof planShopping>[number];

/** 식단의 부족한 재료 고르기. 장보기로 이미 채워진 것과 양을 비교할 수 없는 것은 기본으로 빼 둔다 */
function PlanShoppingSheet({ rows, until, onClose, onConfirm }: {
  rows: Row[]; until: string;
  onClose: () => void;
  onConfirm: (items: { name: string; key: string; qty: number | null; unit: Row["unit"]; recipeTitle?: string }[]) => Promise<void>;
}) {
  // 열려 있는 동안 냉장고·장보기가 바뀌어도 줄이 바뀌지 않게 처음 목록을 고정한다
  const [list] = useState(() => rows);
  const [checked, setChecked] = useState(() => list.map((r) => !r.covered && !r.unsure));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const n = checked.filter(Boolean).length;
  const { m, d } = dateParts(until);
  const why = (r: Row) => (r.need.recipes.length > 1 ? `${r.need.recipes[0]} 외 ${r.need.recipes.length - 1}` : r.need.recipes[0]);
  const note = (r: Row) => {
    if (r.covered) return "이미 장보기에 있어요";
    if (r.unsure) return `냉장고에 있음 · 양 확인 · ${why(r)}`;
    const home = r.match.status === "short" && r.match.have != null ? `집에 ${formatAmount({ qty: r.match.have, unit: r.unit })}` : "집에 없음";
    const listed = r.listed ? ` · 장보기에 ${formatAmount({ qty: r.listed, unit: r.unit })}` : "";
    return `${home}${listed} · ${why(r)}`;
  };
  return (
    <Sheet title="장보기에 담기" onClose={onClose} flush testId="plan-shopping-sheet"
      footer={<>
        {err && <p role="alert" className="mb-2 text-caption text-danger">{err}</p>}
        <Button block disabled={n === 0} loading={busy} onClick={async () => {
          setBusy(true); setErr(null);
          try {
            await onConfirm(list.filter((_, i) => checked[i]).map((r) => ({
              name: r.need.ingredient.name, key: r.need.ingredient.key, qty: r.qty, unit: r.unit, recipeTitle: r.need.recipes.join(", "),
            })));
          } catch (e) { setErr(writeErrorMessage(e)); setBusy(false); }
        }}>{busy ? "담는 중…" : `${n}개 담기`}</Button>
      </>}>
      <p className="px-5 pb-2 text-caption text-ink-3 tabular-nums">오늘부터 {m}월 {d}일까지 식단을 냉장고와 맞춰 봤어요 · 선택 재료와 늘 있는 양념은 뺐어요</p>
      <ul>
        {list.map((r, i) => (
          <li key={`${r.need.ingredient.key}-${r.unit}-${i}`} className={rowLine + " before:left-[60px]"} data-testid="plan-shopping-row">
            {/* 이름은 줄 전체(재료·집에 있는 양·살 양)에서 읽는다 */}
            <label className="flex min-h-14 cursor-pointer items-center gap-3 px-5 py-2">
              <Checkbox checked={checked[i]} onChange={(e) => setChecked((c) => c.map((v, j) => (j === i ? e.target.checked : v)))} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body text-ink">{r.need.ingredient.name}</span>
                <span className="mt-0.5 block truncate text-caption text-ink-3 tabular-nums">{note(r)}</span>
              </span>
              <span className="shrink-0 text-callout text-ink-2 tabular-nums" data-testid="plan-buy">{r.qty ? formatAmount({ qty: r.qty, unit: r.unit }) : ""}</span>
            </label>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

/** 레시피 상세 → 식단에 넣기 (오늘부터 7일 중 하루) */
export function AddToPlanSheet({ recipe, recipeId, servings: initialServings, onClose }: { recipe: { title: string }; recipeId: string; servings: number; onClose: () => void }) {
  const { familyId } = useFamily();
  const { user } = useAuth();
  const toast = useToast();
  const today = localDate();
  // 오늘부터 8일 (일요일에도 다음 주 일요일까지 고를 수 있게)
  const days = Array.from({ length: 8 }, (_, i) => addDays(today, i));
  const [date, setDate] = useState(today);
  const [slot, setSlot] = useState<MealSlot>("저녁");
  const [servings, setServings] = useState(() => Math.min(20, Math.max(1, Math.round(initialServings))));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    if (!familyId || !user) return;
    setBusy(true); setErr(null);
    try {
      await addPlanEntry(familyId, user.uid, { date, slot, recipeId, title: recipe.title, servings });
      toast.show(`${dayWord(date, today)} ${slot} 식단에 넣었어요`, { kind: "done", raised: true });
      onClose();
    } catch (e) { setErr(writeErrorMessage(e)); setBusy(false); }
  };
  return (
    <Sheet title="식단에 넣기" onClose={onClose} testId="add-to-plan"
      footer={<>
        {err && <p role="alert" className="mb-2 text-caption text-danger">{err}</p>}
        <Button block loading={busy} onClick={() => void save()}>{busy ? "넣는 중…" : "식단에 넣기"}</Button>
      </>}>
      <p className="pb-3 text-callout text-ink-2">{recipe.title}</p>
      <SectionHeader title="날짜" first className="px-0! pt-0!" />
      <div className="flex flex-wrap gap-2">
        {days.map((d) => {
          const { m, d: dd } = dateParts(d);
          const word = dayWord(d, today);
          return <ChoiceChip key={d} on={date === d} onClick={() => setDate(d)} aria-label={`${word} ${m}월 ${dd}일`}>{word === "오늘" || word === "내일" ? word : `${WEEK[dateParts(d).w]} ${dd}일`}</ChoiceChip>;
        })}
      </div>
      <SectionHeader title="끼니" className="px-0! pt-6!" />
      <SegmentedControl label="끼니" value={slot} onChange={setSlot} options={SLOT_OPTIONS} />
      <div className="mt-5 flex items-center justify-between gap-3">
        <span className="text-body text-ink">인분</span>
        <Stepper value={servings} onChange={setServings} />
      </div>
    </Sheet>
  );
}

/** 뭐 먹지 탭: 오늘 식단 + 식단 입구. where="top"은 오늘 식단이 있을 때만, "bottom"은 없을 때만 그린다 */
export function PlanSection({ where = "any" }: { where?: "top" | "bottom" | "any" }) {
  const { familyId } = useFamily();
  const { openRecipe, openPlan } = useNav();
  const today = localDate();
  const { entries } = usePlan(familyId, today, 14);
  const { recipes } = useRecipes(familyId);
  const todays = entries.filter((e) => e.date === today);
  if (where === "top" && todays.length === 0) return null;
  if (where === "bottom" && todays.length > 0) return null;
  const byId = new Map(recipes.map((r) => [r.id, r]));
  const later = entries.filter((e) => e.date > today).length;
  return (
    <section>
      <SectionHeader title="오늘 식단" first={where === "top"} right={todays.length > 0 ? <TextAction onClick={() => openPlan()}>식단 보기</TextAction> : undefined} />
      <Card className="mx-5 overflow-hidden">
        <ul>
          {todays.map((e) => {
            const r = byId.get(e.recipeId);
            return (
              <li key={e.id} className={rowLinePlain}>
                <button type="button" disabled={!r} onClick={() => r && openRecipe(r.id)} data-testid="today-plan-row"
                  className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left transition-colors active:bg-surface-2">
                  <EntryThumb recipe={r} title={e.title} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body text-ink">{r?.title ?? e.title}</span>
                    <span className="mt-0.5 block text-caption text-ink-3 tabular-nums">{e.slot} · {e.servings}인분</span>
                  </span>
                  <ChevronRight size={20} aria-hidden className="shrink-0 text-ink-3" />
                </button>
              </li>
            );
          })}
          {todays.length === 0 && (
            <li className={rowLinePlain}>
              <button type="button" onClick={() => openPlan()} data-testid="open-plan"
                className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left transition-colors active:bg-surface-2">
                <IconThumb><CalendarDays size={20} /></IconThumb>
                <span className="min-w-0 flex-1">
                  <span className="block text-body text-ink">{entries.length ? "식단 보기" : "식단 짜기"}</span>
                  <span className="mt-0.5 block text-caption text-ink-3 tabular-nums">{later > 0 ? `앞으로 ${later}끼 정해 뒀어요` : "부족한 재료를 한 번에 장보기에 담아요"}</span>
                </span>
                <ChevronRight size={20} aria-hidden className="shrink-0 text-ink-3" />
              </button>
            </li>
          )}
        </ul>
      </Card>
    </section>
  );
}
