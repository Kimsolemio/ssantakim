import { Fragment, useEffect, useRef, useState } from "react";
import type { MenuSuggestion } from "@cook/shared";
import { Check, ChevronRight, Plus, RefreshCw, SlidersHorizontal } from "lucide-react";
import { workerConfigured } from "../../lib/api";
import { AiNotice } from "../../components/AiNotice";
import { Sheet } from "../../components/Sheet";
import { AiProgress } from "../../components/ui/Ai";
import { Badge } from "../../components/ui/Badge";
import { PlanSection } from "../plan/PlanScreen";
import { Banner } from "../../components/ui/Banner";
import { Button } from "../../components/ui/Button";
import { ChoiceChip, InputChip, LockedChip } from "../../components/ui/Chip";
import { SearchField, TextField } from "../../components/ui/Field";
import { FoodThumb } from "../../components/ui/FoodThumb";
import { Card, SectionHeader, TextAction, rowLinePlain } from "../../components/ui/Section";
import { Stepper } from "../../components/ui/Stepper";
import { useToast } from "../../components/ui/Toast";
import { TabHeader } from "../family/FamilyScreen";
import type { FridgeDoc } from "../fridge/useFridge";
import { itemLook } from "../fridge/FridgeVisual";
import { MOODS, useToday } from "./useToday";

const WAITING = ["냉장고를 둘러보는 중…", "임박 재료를 챙기는 중…", "메뉴를 고르는 중…"];
/** 저장한 지 이만큼 지난 추천은 처음 화면(고르기)을 보여 준다 */
const STALE_MS = 12 * 3600_000;

// 화면 단계 기억 (탭을 옮겨도 유지). 저장된 추천은 지우지 않고 숨기기만 한다
let hiddenAt: number | null = null;   // "처음으로"로 숨긴 추천
let reopenedAt: number | null = null; // 12시간이 지났지만 "지난 추천 보기"로 다시 연 추천

function ago(at: number): string {
  const m = Math.round((Date.now() - at) / 60000);
  if (m < 1) return "방금";
  if (m < 60) return `${m}분 전`;
  if (m < 60 * 24) return `${Math.round(m / 60)}시간 전`;
  return `${Math.round(m / 1440)}일 전`;
}

const dShort = (d: number | null) => (d == null ? "" : d <= 0 ? "오늘" : `D-${d}`);
const dSpoken = (d: number | null) => (d == null ? "" : d <= 0 ? "오늘까지" : `D-${d}`);
/** 무드 값 앞의 이모지를 떼고 글자만 ("⚡ 15분 안에" → "15분 안에") */
const moodLabel = (m: string) => m.replace(/^[^\p{L}\p{N}]+/u, "");
/** 받침에 따라 "로"/"으로" (ㄹ 받침은 "로") */
function ro(word: string): string {
  const c = word.charCodeAt(word.length - 1) - 0xac00;
  const jong = c >= 0 && c < 11172 ? c % 28 : 0;
  return jong === 0 || jong === 8 ? "로" : "으로";
}

type Today = ReturnType<typeof useToday>;

export function TodayTab() {
  const t = useToday();
  const toast = useToast();
  const [conditions, setConditions] = useState(false);
  const [picking, setPicking] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const [allFits, setAllFits] = useState(false);
  const [, setStage] = useState(0);
  const lastAt = useRef<number | null>(t.saved?.at ?? null);

  // 새 추천이 오면 결과(맨 위)로 올린다
  useEffect(() => {
    if (t.saved && t.saved.at !== lastAt.current) {
      lastAt.current = t.saved.at;
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [t.saved]);

  if (!t.ready) return null;
  const { inputs, saved, run } = t;
  const busy = run.busy;

  const hasResults = !!saved && saved.suggestions.length > 0;
  const showResults = !!saved && hasResults && hiddenAt !== saved.at && (Date.now() - saved.at < STALE_MS || reopenedAt === saved.at);
  const goStart = () => { hiddenAt = saved?.at ?? null; reopenedAt = null; setStage((x) => x + 1); window.scrollTo({ top: 0 }); };
  const reopen = () => { hiddenAt = null; reopenedAt = saved?.at ?? null; setStage((x) => x + 1); window.scrollTo({ top: 0 }); };

  const addMissing = async (s: MenuSuggestion) => {
    if (adding) return;
    setAdding(s.title);
    try { toast.show(await t.addMissing(s), { kind: "done" }); }
    catch (e) { toast.show(`담지 못했어요: ${e instanceof Error ? e.message : String(e)}`, { kind: "error" }); }
    finally { setAdding(null); }
  };

  const servingsText = `${t.servings}인분`;
  const excludeText = inputs.exclude.length ? `${inputs.exclude.join("·")} 빼고` : "";
  const moodsText = [...inputs.moods.map(moodLabel), inputs.moodText.trim()].filter(Boolean);
  const startSummary = ["조건", ...moodsText, excludeText, servingsText].filter(Boolean).join(" · ");
  const must = inputs.mustUse;
  const suggestLabel = must.length === 0 ? "메뉴 추천받기"
    : must.length === 1 ? `${must[0]}${ro(must[0])} 메뉴 추천받기`
      : `${must[0]} 외 ${must.length - 1}개로 메뉴 추천받기`;
  const canSuggest = workerConfigured && !t.fridgeLoading && !busy;

  const skeletons = (
    <div aria-hidden className="mt-3 flex flex-col gap-3 px-5">
      {[0, 1, 2].map((i) => <div key={i} className="h-[148px] animate-pulse rounded-card bg-surface" />)}
    </div>
  );

  const sheets = (
    <>
      {conditions && (
        <ConditionSheet t={t} onClose={() => setConditions(false)} onPick={() => setPicking(true)}
          onSubmit={() => { setConditions(false); t.suggest(false); }} />
      )}
      {picking && <PickSheet items={t.fresh.map((x) => x.f)} selected={inputs.mustUse} onClose={() => setPicking(false)} onChange={(v) => t.update({ mustUse: v })} />}
    </>
  );

  // ---------- 상태 C: 결과 ----------
  if (showResults && saved) {
    const resultSummary = [...must, ...moodsText, excludeText, servingsText, ago(saved.at)].filter(Boolean).join(" · ");
    return (
      <div style={{ paddingBottom: "calc(var(--safe-bottom) + 56px + 32px)" }}>
        <TabHeader title="오늘 뭐 먹지?" />
        <div className="mx-5 flex items-center gap-2 rounded-control bg-surface-2 py-2 pl-4 pr-1">
          <span className="min-w-0 flex-1 truncate text-caption text-ink-2 tabular-nums">{resultSummary}</span>
          <button type="button" onClick={() => setConditions(true)} disabled={busy}
            className="-my-1.5 h-11 shrink-0 rounded-control px-3 text-callout font-semibold text-accent active:opacity-60 disabled:text-ink-disabled">조건 바꾸기</button>
        </div>

        <section data-testid="suggestions">
          <SectionHeader title="추천 메뉴" right={
            <TextAction disabled={busy} onClick={() => t.suggest(true)}><RefreshCw size={16} aria-hidden />다른 메뉴</TextAction>
          } />
          {run.error && !busy && <Banner kind="danger" className="mx-5 mb-3">{run.error}</Banner>}
          {busy ? (
            <>
              <AiProgress size="sm" messages={WAITING} onCancel={t.cancel} startedAt={t.run.startedAt ?? undefined} className="mx-5" />
              {skeletons}
            </>
          ) : (
            <>
              {(saved.dropped ?? 0) > 0 && <p className="-mt-1 px-5 pb-3 text-caption text-ink-3" data-testid="dropped-note">빼기·싫어하는 재료가 든 메뉴 {saved.dropped}개는 뺐어요</p>}
              <ul className="flex flex-col gap-3 px-5">
                {saved.suggestions.map((s) => (
                  <SuggestCard key={s.title} s={s} t={t} added={saved.added.includes(s.title)} adding={adding === s.title} onAdd={() => void addMissing(s)} />
                ))}
              </ul>
              <div className="px-5 pt-3">
                <Button variant="ghost" size="md" block onClick={goStart}>처음으로</Button>
              </div>
            </>
          )}
        </section>
        <PlanSection />
        {sheets}
      </div>
    );
  }

  // ---------- 상태 A(고르기) · B(추천 중) ----------
  const showEmptyFridge = !t.fridgeLoading && t.fresh.length === 0 && !run.error;
  return (
    <div style={{ paddingBottom: "calc(var(--safe-bottom) + 56px + 32px)" }}>
      <TabHeader title="오늘 뭐 먹지?" />
      {/* 오늘 정해 둔 식단이 있으면 그게 답이라 맨 위에 */}
      <PlanSection where="top" />

      {t.expiring.length > 0 && (
        <section>
          <SectionHeader first title="빨리 먹어야 해요" />
          <p className="-mt-2 px-5 pb-3 text-caption text-ink-3">고르면 그 재료로 추천해요</p>
          <div className="flex gap-2 overflow-x-auto px-5 [scrollbar-width:none]">
            {t.expiring.map(({ f, d, check }) => {
              const on = inputs.mustUse.includes(f.name);
              const mark = f.expiresEstimated ? "~" : "";
              const shown = check ? "확인 필요" : `${mark}${dShort(d)}`;
              const spoken = check ? "기한 확인 필요" : `${dSpoken(d)}${f.expiresEstimated ? " 추정" : ""}`;
              return (
                <button key={f.id} type="button" data-testid="expiring-card" aria-pressed={on} onClick={() => t.toggleMustUse(f.name)}
                  className={`relative flex w-[88px] shrink-0 flex-col items-center gap-1 rounded-card px-2 pb-2.5 pt-3 transition-colors ${on ? "bg-accent-soft ring-2 ring-inset ring-accent" : "bg-surface active:bg-surface-2"}`}>
                  {on && (
                    <span aria-hidden className="absolute right-1.5 top-1.5 grid size-5 place-items-center rounded-full bg-accent text-on-accent">
                      <Check size={12} strokeWidth={3} />
                    </span>
                  )}
                  <FoodThumb emoji={itemLook(f).emoji} size="lg" />
                  <span className="w-full truncate text-center text-callout font-semibold text-ink">{f.name}</span>
                  <Badge role="img" aria-label={spoken} tone={check ? "warning" : "danger"}>{shown}</Badge>
                </button>
              );
            })}
          </div>
        </section>
      )}

      <div className="px-5 pt-6">
        {showEmptyFridge && <Banner kind="info" className="mb-4" action={{ label: "채우기", onClick: t.fillFridge }}>냉장고가 비어 있어요</Banner>}
        {busy ? (
          <AiProgress size="sm" messages={WAITING} onCancel={t.cancel} startedAt={t.run.startedAt ?? undefined} />
        ) : (
          <>
            <Button block ai disabled={!canSuggest} onClick={() => t.suggest(false)}><span className="truncate">{suggestLabel}</span></Button>
            <Button variant="ghost" size="md" block className="mt-2" data-testid="open-conditions" onClick={() => setConditions(true)}
              icon={<SlidersHorizontal size={18} aria-hidden />}><span className="truncate">{startSummary}</span></Button>
            <AiNotice what="냉장고 목록과 가족 취향" kind="fridge" className="mt-3" />
          </>
        )}
        {run.error && !busy && <Banner kind="danger" className="mt-3">{run.error}</Banner>}
      </div>
      {busy && skeletons}

      {t.fits.length > 0 && (
        <section>
          <SectionHeader title="내 레시피로 바로" right={t.fits.length > 3 && !allFits ? <TextAction onClick={() => setAllFits(true)}>모두 보기</TextAction> : undefined} />
          <Card className="mx-5 overflow-hidden">
            <ul>
              {(allFits ? t.fits : t.fits.slice(0, 3)).map((x) => (
                <li key={x.recipe.id} className={rowLinePlain}>
                  <button type="button" data-testid="fit-row" onClick={() => t.openRecipe(x.recipe.id)}
                    className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left transition-colors active:bg-surface-2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-headline text-ink">{x.recipe.title}</span>
                      <span className="mt-0.5 block truncate text-caption">
                        {x.missing.length === 0
                          ? <span className="text-success">재료가 다 있어요</span>
                          : <span className="text-ink-3">없는 것: {x.missing.join(", ")}</span>}
                        {x.unsure > 0 && <span className="text-ink-3"> · 양 확인 {x.unsure}개</span>}
                        {x.expiring.length > 0 && (
                          <span className="text-danger"> · {x.expiring.map((n) => `${n} ${dShort(t.daysOf.get(n) ?? null)}`.trim()).join(", ")} 사용</span>
                        )}
                      </span>
                    </span>
                    <span className="shrink-0 text-callout text-ink-2 tabular-nums">{x.have}/{x.needed}</span>
                    <ChevronRight size={20} aria-hidden className="shrink-0 text-ink-3" />
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}

      <PlanSection where="bottom" />

      {!busy && hasResults && (
        <div className="px-5 pt-6">
          <button type="button" onClick={reopen} className="-ml-2 h-11 px-2 text-callout font-semibold text-accent active:opacity-60">지난 추천 보기</button>
        </div>
      )}

      {t.expired.length > 0 && (
        <button type="button" onClick={t.goFridge} data-testid="expired-note" className="block w-full px-5 py-6 text-left text-caption text-ink-3 active:opacity-60">
          기한 지난 재료 {t.expired.length}개는 추천에서 빠져요 · <span className="font-semibold text-ink-2">냉장고에서 보기</span>
        </button>
      )}
      {sheets}
    </div>
  );
}

/** 추천 카드: 카드마다 주 버튼을 두지 않는다 (보조 + 글자 버튼) */
function SuggestCard({ s, t, added, adding, onAdd }: { s: MenuSuggestion; t: Today; added: boolean; adding: boolean; onAdd: () => void }) {
  const meta = [s.timeMinutes != null ? `${s.timeMinutes}분` : "", s.difficulty].filter(Boolean).join(" · ");
  return (
    <li data-testid="suggest-card" className="rounded-card bg-surface p-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0 text-title2 text-ink">{s.title}</p>
        {meta && <span className="shrink-0 text-caption text-ink-3 tabular-nums">{meta}</span>}
      </div>
      {s.reason && <p className="mt-1 line-clamp-2 text-callout text-ink-2">{s.reason}</p>}
      {s.uses.length > 0 && (
        <p className="mt-3 text-caption text-ink-2">
          <span className="mr-2 text-ink-3">냉장고</span>
          {s.uses.map((u, i) => {
            const d = t.daysOf.get(u) ?? null;
            const urgent = d != null && d <= 3;
            return <Fragment key={u}>{i > 0 && " · "}<span className={urgent ? "font-semibold text-danger" : ""}>{u}{urgent ? ` ${dShort(d)}` : ""}</span></Fragment>;
          })}
        </p>
      )}
      <p className={`${s.uses.length ? "mt-0.5" : "mt-3"} text-caption ${s.missing.length ? "text-warning" : "text-success"}`} data-testid="suggest-missing">
        {s.missing.length ? <><span className="mr-2 font-semibold">살 것</span>{s.missing.join(", ")}</> : "더 살 것 없어요"}
      </p>
      <div className="mt-4 flex gap-2">
        <Button variant="secondary" size="md" className="flex-1" disabled={t.run.busy} onClick={() => t.make(s)}>레시피 만들기</Button>
        {s.missing.length > 0 && (
          <Button variant="ghost" size="md" disabled={added || adding} onClick={onAdd} icon={added ? <Check size={18} strokeWidth={2.5} aria-hidden /> : undefined}>
            {added ? "담았어요" : "살 것 담기"}
          </Button>
        )}
      </div>
    </li>
  );
}

const pickChip = "inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full border border-line-strong bg-surface px-4 text-callout font-medium text-ink-2 transition-colors active:bg-surface-2 disabled:text-ink-disabled";

/** 조건 시트: 꼭 쓸 재료 · 무드 · 빼기 · 인분. 고르는 즉시 기억되고, 제출하면 시트를 닫고 바로 추천한다 */
function ConditionSheet({ t, onClose, onPick, onSubmit }: { t: Today; onClose: () => void; onPick: () => void; onSubmit: () => void }) {
  const { inputs, profile } = t;
  const reset = () => t.update({ mustUse: [], moods: [], moodText: "", exclude: [], excludeText: "", servings: null });
  return (
    <Sheet title="조건" onClose={onClose} footer={
      <>
        <AiNotice what="냉장고 목록과 가족 취향" kind="fridge" className="mb-3" />
        <Button block ai disabled={!workerConfigured || t.fridgeLoading || t.run.busy} onClick={onSubmit}>이 조건으로 추천받기</Button>
        <Button variant="ghost" size="md" block className="mt-1" onClick={reset}>초기화</Button>
      </>
    }>
      <div className="flex flex-col gap-7 pb-2 pt-2">
        <section>
          <h3 className="mb-3 text-headline text-ink">꼭 쓸 재료</h3>
          <div className="flex flex-wrap gap-2">
            {inputs.mustUse.map((n) => <InputChip key={n} aria-label={`${n} 꼭 쓰기 빼기`} onClick={() => t.toggleMustUse(n)}>{n}</InputChip>)}
            <button type="button" onClick={onPick} disabled={t.fresh.length === 0} className={pickChip}><Plus size={16} aria-hidden />냉장고에서 고르기</button>
          </div>
        </section>

        <section>
          <h3 className="mb-3 text-headline text-ink">어떤 게 당겨요</h3>
          <div className="flex flex-wrap gap-2">
            {MOODS.map((m) => <ChoiceChip key={m} on={inputs.moods.includes(m)} onClick={() => t.toggleMood(m)}>{moodLabel(m)}</ChoiceChip>)}
          </div>
          <TextField wrapClass="mt-3" placeholder="직접 적기 (예: 비 오는 날)" aria-label="직접 적기" value={inputs.moodText}
            onChange={(e) => t.update({ moodText: e.target.value })} maxLength={60} />
        </section>

        <form onSubmit={(e) => { e.preventDefault(); t.commitExclude(); }}>
          <h3 className="mb-3 text-headline text-ink">빼고 싶은 재료</h3>
          <div className="flex gap-2">
            <TextField wrapClass="min-w-0 flex-1" placeholder="예: 오이, 가지" aria-label="빼고 싶은 재료" value={inputs.excludeText}
              onChange={(e) => t.update({ excludeText: e.target.value })} maxLength={60} enterKeyHint="done" />
            <Button type="submit" variant="secondary" size="md">추가</Button>
          </div>
          {(inputs.exclude.length > 0 || (profile && profile.dislikes.length > 0)) && (
            <div className="mt-3 flex flex-wrap gap-2">
              {profile?.dislikes.map((n) => <LockedChip key={`d-${n}`}>{n}</LockedChip>)}
              {inputs.exclude.map((n) => (
                <InputChip key={n} aria-label={`${n} 빼기 취소`} onClick={() => t.update({ exclude: inputs.exclude.filter((x) => x !== n) })}>{n}</InputChip>
              ))}
            </div>
          )}
          <p className="mt-2 text-caption text-ink-3">싫어하는 재료는 가족 설정대로 늘 빠져요</p>
        </form>

        <div className="flex items-center justify-between gap-3">
          <h3 className="text-headline text-ink">인분</h3>
          <Stepper value={t.servings} onChange={(v) => t.update({ servings: v })} />
        </div>
      </div>
    </Sheet>
  );
}

/** 냉장고에서 꼭 쓸 재료 고르기 (최대 10개) */
function PickSheet({ items, selected, onClose, onChange }: { items: FridgeDoc[]; selected: string[]; onClose: () => void; onChange: (v: string[]) => void }) {
  const names = [...new Set(items.map((i) => i.name))];
  const [q, setQ] = useState("");
  const list = names.filter((n) => !q.trim() || n.includes(q.trim()));
  return (
    <Sheet title="꼭 쓸 재료 고르기" onClose={onClose} footer={
      <Button block onClick={onClose}>다 골랐어요{selected.length > 0 ? ` (${selected.length}개)` : ""}</Button>
    }>
      <div className="flex flex-col gap-4 pt-2">
        <SearchField value={q} onChange={setQ} placeholder="냉장고에서 찾기" label="냉장고에서 찾기" />
        <div className="flex flex-wrap gap-2">
          {list.map((n) => {
            const on = selected.includes(n);
            return <ChoiceChip key={n} on={on} onClick={() => onChange(on ? selected.filter((x) => x !== n) : [...selected, n].slice(0, 10))}>{n}</ChoiceChip>;
          })}
        </div>
        {selected.length >= 10 && <p className="text-caption text-ink-3">10개까지 고를 수 있어요</p>}
      </div>
    </Sheet>
  );
}
