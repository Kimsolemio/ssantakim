import { useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Plus, X } from "lucide-react";
import {
  addDays, combinePlanIngredients, formatAmount, localDate, planShopping, sameFood, weekDays, weekStart,
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

/** 이번 주 식단 (전체화면). 오늘부터 남은 식단의 부족한 재료를 한 번에 장보기에 담는다 */
export function PlanScreen({ onClose }: { onClose: () => void }) {
  const { familyId, family } = useFamily();
  const { user } = useAuth();
  const { openRecipe } = useNav();
  const toast = useToast();
  const today = localDate();
  const thisWeek = weekStart(today);
  const [start, setStart] = useState(thisWeek);
  const { entries, loading } = usePlan(familyId, start);
  const { recipes } = useRecipes(familyId);
  const { items: fridge, loading: fridgeLoading } = useFridge(familyId);
  const { items: shopping } = useShopping(familyId);
  const [adding, setAdding] = useState<string | null>(null);
  const [shopOpen, setShopOpen] = useState(false);
  const byId = useMemo(() => new Map(recipes.map((r) => [r.id, r])), [recipes]);
  const staples = family?.profile.staples ?? [...DEFAULT_STAPLES];

  // 지난 날은 이미 먹었다고 보고, 오늘부터 남은 식단만 센다
  const upcoming = entries.filter((e) => e.date >= today && byId.has(e.recipeId));
  const rows = planShopping(combinePlanIngredients(upcoming.map((e) => ({ recipe: byId.get(e.recipeId)!, servings: e.servings }))), fridge, { staples });

  const remove = async (e: PlanDoc) => {
    if (!familyId) return;
    try { await removePlanEntry(familyId, e.id); toast.show(`${dayWord(e.date, today)} ${e.slot}에서 뺐어요`, { raised: true }); }
    catch (err) { toast.show(`빼지 못했어요: ${writeErrorMessage(err)}`, { kind: "error", raised: true }); }
  };

  const footer = (
    <Button block disabled={upcoming.length === 0 || rows.length === 0 || fridgeLoading} onClick={() => setShopOpen(true)} data-testid="plan-shopping">
      {upcoming.length === 0 ? "남은 식단이 없어요" : fridgeLoading ? "냉장고 확인 중…" : rows.length === 0 ? "재료가 다 있어요" : `부족한 재료 ${rows.length}개 장보기에 담기`}
    </Button>
  );

  return (
    <FullScreen title="이번 주 식단" onClose={onClose} canvas footer={footer}>
      <div className="flex items-center justify-between px-2 pb-2 pt-1">
        <IconButton aria-label="지난주" onClick={() => setStart(addDays(start, -7))}><ChevronLeft size={24} /></IconButton>
        <div className="text-center">
          <p className="text-headline text-ink tabular-nums" data-testid="plan-range">{rangeLabel(start)}</p>
          {start !== thisWeek
            ? <button type="button" onClick={() => setStart(thisWeek)} className="h-8 px-2 text-caption font-semibold text-accent active:opacity-60">이번 주로</button>
            : <p className="h-8 text-caption leading-8 text-ink-3">이번 주</p>}
        </div>
        <IconButton aria-label="다음 주" onClick={() => setStart(addDays(start, 7))}><ChevronRight size={24} /></IconButton>
      </div>

      {weekDays(start).map((d) => {
        const list = entries.filter((e) => e.date === d);
        const past = d < today;
        const { m, d: dd } = dateParts(d);
        return (
          <Card key={d} className="mx-5 mb-3 overflow-hidden" data-testid="plan-day" data-date={d}>
            <div className="flex items-center gap-2 py-2 pl-4 pr-3">
              <p className={`min-w-0 flex-1 text-headline ${past ? "text-ink-3" : "text-ink"}`}>
                {weekdayName(d)} <span className="text-callout font-medium text-ink-3 tabular-nums">{m}/{dd}</span>
              </p>
              {d === today && <Badge tone="success">오늘</Badge>}
              <TextAction aria-label={`${weekdayName(d)} 식단 추가`} onClick={() => setAdding(d)}><Plus size={16} aria-hidden />추가</TextAction>
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
                            <span className={`block truncate text-body ${past ? "text-ink-3" : "text-ink"}`}>{r?.title ?? e.title}</span>
                            <span className="mt-0.5 block truncate text-caption text-ink-3 tabular-nums">{e.slot} · {e.servings}인분{r ? "" : " · 지운 레시피"}</span>
                          </span>
                        </button>
                        <IconButton aria-label={`${weekdayName(d)} ${e.slot} ${e.title} 빼기`} onClick={() => void remove(e)}><X size={18} className="text-ink-3" /></IconButton>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        );
      })}
      {!loading && entries.length === 0 && (
        <p className="px-8 pb-4 pt-1 text-center text-caption text-ink-3">날짜 옆 ‘추가’로 레시피를 넣으면, 부족한 재료를 한 번에 장보기에 담을 수 있어요</p>
      )}

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
        <PlanShoppingSheet rows={rows} shopping={shopping} onClose={() => setShopOpen(false)}
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

/** 식단의 부족한 재료 고르기. 이미 장보기에 있는 것은 기본으로 빼 둔다 */
function PlanShoppingSheet({ rows, shopping, onClose, onConfirm }: {
  rows: Row[]; shopping: { name: string; key: string; checked: boolean }[];
  onClose: () => void;
  onConfirm: (items: { name: string; key: string; qty: number | null; unit: Row["unit"]; recipeTitle?: string }[]) => Promise<void>;
}) {
  // 열려 있는 동안 냉장고가 바뀌어도 줄이 바뀌지 않게 처음 목록을 고정한다
  const [list] = useState(() => rows.map((r) => ({ r, already: shopping.some((s) => !s.checked && sameFood(s, r.need.ingredient)) })));
  const [checked, setChecked] = useState(() => list.map((x) => !x.already));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const n = checked.filter(Boolean).length;
  return (
    <Sheet title="장보기에 담기" onClose={onClose} flush testId="plan-shopping-sheet"
      footer={<>
        {err && <p role="alert" className="mb-2 text-caption text-danger">{err}</p>}
        <Button block disabled={n === 0} loading={busy} onClick={async () => {
          setBusy(true); setErr(null);
          try {
            await onConfirm(list.filter((_, i) => checked[i]).map(({ r }) => ({
              name: r.need.ingredient.name, key: r.need.ingredient.key, qty: r.qty, unit: r.unit, recipeTitle: r.need.recipes.join(", "),
            })));
          } catch (e) { setErr(writeErrorMessage(e)); setBusy(false); }
        }}>{busy ? "담는 중…" : `${n}개 담기`}</Button>
      </>}>
      <p className="px-5 pb-2 text-caption text-ink-3">오늘부터 남은 식단을 냉장고와 맞춰 봤어요</p>
      <ul>
        {list.map(({ r, already }, i) => (
          <li key={`${r.need.ingredient.key}-${i}`} className={rowLine + " before:left-[60px]"} data-testid="plan-shopping-row">
            <label className="flex min-h-14 cursor-pointer items-center gap-3 px-5 py-2">
              <Checkbox aria-label={`${r.need.ingredient.name} 담기`} checked={checked[i]} onChange={(e) => setChecked((c) => c.map((v, j) => (j === i ? e.target.checked : v)))} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body text-ink">{r.need.ingredient.name}</span>
                <span className="mt-0.5 block truncate text-caption text-ink-3">{already ? "이미 장보기에 있어요" : r.need.recipes.join(", ")}</span>
              </span>
              <span className="shrink-0 text-callout text-ink-2 tabular-nums">
                {r.match.status === "short" ? `${formatAmount({ qty: r.qty, unit: r.unit })} 더` : formatAmount({ qty: r.qty, unit: r.unit })}
              </span>
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
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  const [date, setDate] = useState(today);
  const [slot, setSlot] = useState<MealSlot>("저녁");
  const [servings, setServings] = useState(initialServings);
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

/** 뭐 먹지 탭: 오늘 식단 + 이번 주 식단 입구 */
export function PlanSection() {
  const { familyId } = useFamily();
  const { openRecipe } = useNav();
  const today = localDate();
  const { entries } = usePlan(familyId, weekStart(today));
  const { recipes } = useRecipes(familyId);
  const [open, setOpen] = useState(false);
  const todays = entries.filter((e) => e.date === today);
  const byId = new Map(recipes.map((r) => [r.id, r]));
  const later = entries.filter((e) => e.date > today).length;
  return (
    <section>
      <SectionHeader title="오늘 식단" right={<TextAction onClick={() => setOpen(true)}>이번 주</TextAction>} />
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
          <li className={rowLinePlain}>
            <button type="button" onClick={() => setOpen(true)} data-testid="open-plan"
              className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left transition-colors active:bg-surface-2">
              <IconThumb><CalendarDays size={20} /></IconThumb>
              <span className="min-w-0 flex-1">
                <span className="block text-body text-ink">{todays.length ? "이번 주 식단 보기" : "이번 주 식단 짜기"}</span>
                <span className="mt-0.5 block text-caption text-ink-3 tabular-nums">{later > 0 ? `앞으로 ${later}끼 정해 뒀어요` : "부족한 재료를 한 번에 장보기에 담아요"}</span>
              </span>
              <ChevronRight size={20} aria-hidden className="shrink-0 text-ink-3" />
            </button>
          </li>
        </ul>
      </Card>
      {open && <PlanScreen onClose={() => setOpen(false)} />}
    </section>
  );
}
