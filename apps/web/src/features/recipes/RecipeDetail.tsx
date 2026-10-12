import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowUpRight, CalendarPlus, Check, ChevronRight, Ellipsis, Folder, Pencil, Star, Timer, Trash2 } from "lucide-react";
import { findDislikes, isStandardKey, type Ingredient, type IngredientMatch, type Recipe } from "@cook/shared";
import { FullScreen } from "../../components/FullScreen";
import { Sheet } from "../../components/Sheet";
import { Button } from "../../components/ui/Button";
import { IconButton } from "../../components/ui/IconButton";
import { Stepper } from "../../components/ui/Stepper";
import { Banner } from "../../components/ui/Banner";
import { AiPill, AiToolbar, SourceList } from "../../components/ui/Ai";
import { Band, SectionHeader, rowLine } from "../../components/ui/Section";
import { useToast } from "../../components/ui/Toast";
import { IngredientList } from "./IngredientList";
import { CookMode } from "../cook/CookMode";
import { UseUpSheet, type UseUpResult } from "../cook/UseUpSheet";
import { AddToPlanSheet } from "../plan/PlanScreen";
import { useFamily } from "../../lib/family";
import { useAuth } from "../../lib/auth";
import { useFridge, applyFridgeUpdates, setFridgeItemKey, type FridgeDoc } from "../fridge/useFridge";
import { useShopping, addShoppingItems } from "../shopping/useShopping";
import { normalizeKeysInBackground, remapStepKeys } from "../../lib/normalize";
import { useRecipeMatches, statusLabel, FridgeSummary, FridgeSummaryLoading, AddToShoppingSheet, LinkSheet, josa } from "./FridgeCheck";
import { updateRecipe, type FolderDoc } from "./useRecipes";
import { writeErrorMessage } from "../../lib/write";
import { AskSheet } from "../assist/AskSheet";
import { AdaptSheet } from "../assist/AdaptSheet";
import { SubstitutePanel, SubstituteSheet } from "../assist/SubstitutePanel";
import { DEFAULT_STAPLES, type RecipeDraft } from "@cook/shared";

type Props = {
  recipe: Recipe;
  /** 저장된 레시피 id (장보기 품목에 출처로 남긴다) */
  recipeId?: string;
  folders: FolderDoc[];
  onClose: () => void;
  onEdit: () => void;
  onToggleFavorite: () => Promise<void>;
  onMoveFolder: (folderId: string | null) => Promise<void>;
  onDelete: () => Promise<void>;
  onCooked: (servings: number) => Promise<void>;
  /** 레시피 바꾸기 결과 (확인·수정 화면으로) */
  onAdapted?: (draft: RecipeDraft, summary: string) => void;
};

export const SOURCE_LABEL: Record<Recipe["source"]["type"], string> = {
  generated: "AI 생성", youtube: "유튜브", instagram: "인스타그램", photo: "사진", text: "텍스트", manual: "직접 입력", web: "블로그·웹",
};

/** 인분 스테퍼 (다른 화면에서도 쓴다) */
export function ServingsStepper({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return <Stepper value={value} onChange={onChange} />;
}

/** "2026-10-12T…" → "10월 12일" (이 기기 시간대) */
function shortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso.slice(0, 10) : `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

/** 레시피 관리 시트의 한 줄 */
function ActionRow({ icon, title, value, onClick, danger, disabled }: { icon: ReactNode; title: string; value?: ReactNode; onClick: () => void; danger?: boolean; disabled?: boolean }) {
  return (
    <li className={`${rowLine} before:left-[52px]`}>
      <button type="button" onClick={onClick} disabled={disabled}
        className={`flex min-h-14 w-full items-center gap-3 px-5 py-3 text-left transition-colors active:bg-surface-2 disabled:opacity-50 ${danger ? "text-danger" : "text-ink"}`}>
        <span aria-hidden className={`shrink-0 ${danger ? "" : "text-ink-2"}`}>{icon}</span>
        <span className="min-w-0 flex-1 text-body">{title}</span>
        {value != null && <span className="max-w-[45%] truncate text-callout text-ink-2">{value}</span>}
        {!danger && value != null && <ChevronRight size={20} aria-hidden className="shrink-0 text-ink-3" />}
      </button>
    </li>
  );
}

export function RecipeDetail({ recipe, recipeId, folders, onClose, onEdit, onToggleFavorite, onMoveFolder, onDelete, onCooked, onAdapted }: Props) {
  const [servings, setServings] = useState(recipe.servingsBase);
  const [menu, setMenu] = useState<false | "main" | "folder">(false);
  const [busy, setBusy] = useState(false);
  const [cooking, setCooking] = useState(false);
  const [useUp, setUseUp] = useState<IngredientMatch<FridgeDoc>[] | null>(null);
  const [shopSheet, setShopSheet] = useState(false);
  const [linking, setLinking] = useState<number | null>(null);
  const [subFor, setSubFor] = useState<Pick<Ingredient, "name" | "qty" | "unit">[] | null>(null);
  const [asking, setAsking] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [adapting, setAdapting] = useState<false | { text?: string }>(false);
  const { familyId, family } = useFamily();
  const { user } = useAuth();
  const toast = useToast();
  const { items: fridge, loading: fridgeLoading } = useFridge(familyId);
  const { items: shopping, loading: shoppingLoading } = useShopping(familyId);
  const matches = useRecipeMatches(recipe, servings, fridge, family?.profile.staples);
  // 냉장고·장보기를 다 불러오기 전에는 "없음"으로 잘못 보이지 않게 대조 결과를 숨긴다
  const ready = !fridgeLoading && !shoppingLoading;
  const dislikes = useMemo(() => [...new Set(findDislikes(recipe.ingredients, family?.profile.dislikes ?? []).map((h) => h.word))], [recipe.ingredients, family?.profile.dislikes]);
  const staples = family?.profile.staples ?? [...DEFAULT_STAPLES];

  // 머리의 제목은 비워 두고, 큰 제목이 위로 사라지면 나타낸다
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [titleShown, setTitleShown] = useState(false);
  useEffect(() => {
    const el = titleRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setTitleShown(!e.isIntersecting), { rootMargin: "-56px 0px 0px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const say = (msg: string) => toast.show(msg, { kind: "done", raised: true });

  /**
   * 재료 ↔ 냉장고 품목 연결. AI가 정리한 표준 key 쪽으로 맞춘다
   * (한글 임시 key 는 나중에 이름 정리가 덮어쓰므로 연결이 풀린다).
   */
  const link = async (index: number, f: FridgeDoc) => {
    if (!familyId) return;
    const ing = recipe.ingredients[index];
    if (isStandardKey(ing.key) || !isStandardKey(f.key)) {
      await setFridgeItemKey(familyId, f.id, ing.key);
    } else if (recipeId) {
      const map = new Map([[ing.key, f.key]]);
      await updateRecipe(familyId, recipeId, {
        ingredients: recipe.ingredients.map((x, i) => (i === index ? { ...x, key: f.key } : x)),
        steps: remapStepKeys(recipe.steps, map),
      });
    }
    say(`${josa(f.name, "을/를")} ${josa(ing.name, "으로/로")} 연결했어요`);
  };

  const addToShopping = async (items: { name: string; key: string; qty: number | null; unit: FridgeDoc["unit"] }[], fromRecipe: boolean) => {
    if (!familyId || !user) return;
    const res = await addShoppingItems(familyId, user.uid, items.map((i) => ({ ...i, fromRecipeId: fromRecipe ? recipeId ?? null : null, recipeTitle: fromRecipe ? recipe.title : undefined })), shopping);
    void normalizeKeysInBackground(familyId, "shopping_items", res.added);
    say(`장보기에 ${res.added.length + res.merged}개 담았어요${res.merged ? ` · ${res.merged}개는 양만 더함` : ""}`);
  };
  const applyUseUp = async (r: UseUpResult) => {
    if (!familyId) return;
    // 시트를 연 사이 다른 가족이 지운 품목은 건너뛴다 (없는 문서를 고치면 전체가 실패한다)
    const present = new Set(fridge.map((f) => f.id));
    const updates = r.updates.filter((u) => present.has(u.id));
    try { await applyFridgeUpdates(familyId, updates); }
    catch (e) { throw new Error(writeErrorMessage(e)); }
    if (r.addUsedUpToShopping && r.usedUp.length) await addToShopping(r.usedUp.map((f) => ({ name: f.name, key: f.key, qty: null, unit: f.unit })), false);
    await onCooked(servings);
    const skipped = r.updates.length - updates.length;
    if (updates.length) say(`냉장고에서 ${updates.length}개를 정리했어요${skipped ? ` (${skipped}개는 이미 누가 정리했어요)` : ""}`);
  };

  const run = async (fn: () => Promise<void>) => { setBusy(true); try { await fn(); } finally { setBusy(false); } };

  // 메타 1줄: 시간 · 난이도 · 출처 (출처는 따로 찾을 수 있게 조각마다 span)
  const refs = recipe.source.refs ?? [];
  const meta = [
    recipe.timeMinutes != null ? `${recipe.timeMinutes}분` : null,
    recipe.difficulty,
    recipe.source.type === "generated" && refs.length ? `인기 레시피 ${refs.length}곳 참고` : SOURCE_LABEL[recipe.source.type],
  ].filter(Boolean) as string[];
  const lacking = matches.filter((m) => (m.status === "missing" || m.status === "short") && !m.ingredient.optional);
  const folderName = folders.find((f) => f.id === recipe.folderId)?.name ?? "없음";
  const last = recipe.cookedLog[recipe.cookedLog.length - 1];

  return (
    <FullScreen title={recipe.title} titleHidden={!titleShown}
      onClose={onClose}
      right={<>
        <IconButton aria-label="즐겨찾기" aria-pressed={recipe.favorite} disabled={busy} onClick={() => run(onToggleFavorite)}>
          <Star size={24} fill={recipe.favorite ? "currentColor" : "none"} />
        </IconButton>
        <IconButton aria-label="더보기" onClick={() => setMenu("main")}><Ellipsis size={24} /></IconButton>
      </>}
      footer={<Button block onClick={() => setCooking(true)} disabled={!ready}>요리 시작</Button>}>
      <div className="px-5 pb-4 pt-2">
        <h1 ref={titleRef} className="text-title1 text-ink">{recipe.title}</h1>
        <p className="mt-1 text-caption text-ink-3 tabular-nums">
          {meta.map((m, i) => <Fragment key={i}>{i > 0 && <span aria-hidden> · </span>}<span>{m}</span></Fragment>)}
        </p>
        {recipe.tags.length > 0 && <p className="mt-1 text-caption text-ink-3">{recipe.tags.map((t) => `#${t}`).join(" ")}</p>}
        {recipe.source.url && (
          <a className="-mb-2 mt-1 inline-flex h-11 items-center gap-1 text-caption font-semibold text-accent active:opacity-60" href={recipe.source.url} target="_blank" rel="noreferrer">
            원본 보기<ArrowUpRight size={14} aria-hidden />
          </a>
        )}
      </div>
      <AiToolbar>
        <AiPill onClick={() => setAdapting({})}>레시피 바꾸기</AiPill>
        <AiPill onClick={() => setAsking(true)}>셰프에게 묻기</AiPill>
      </AiToolbar>
      {dislikes.length > 0 && (
        <Banner kind="warning" className="mx-5 mb-5" title={`싫어하는 재료가 있어요: ${dislikes.join(", ")}`}
          action={{ label: "빼고 바꾸기", onClick: () => setAdapting({ text: `${dislikes.join(", ")} 빼고` }) }} />
      )}
      <Band />

      <SectionHeader title="재료" first right={<Stepper value={servings} onChange={setServings} />} />
      {servings !== recipe.servingsBase && <p className="-mt-1 px-5 pb-3 text-caption text-ink-3 tabular-nums">기준 {recipe.servingsBase}인분에서 자동 환산했어요</p>}
      {ready
        ? <FridgeSummary matches={matches} onAddToShopping={() => setShopSheet(true)}
          onSubstitute={fridge.length > 0 ? () => setSubFor(lacking.map((m) => m.ingredient)) : undefined} />
        : <FridgeSummaryLoading />}
      <div className="pb-4 pt-2">
        <IngredientList ingredients={recipe.ingredients} servingsBase={recipe.servingsBase} servings={servings}
          statuses={ready ? matches.map((m) => ({ status: m.status, label: statusLabel(m), similar: m.similar.length > 0 })) : undefined}
          onStatusClick={(i) => { if (matches[i].status !== "always") setLinking(i); }} />
      </div>

      <Band />
      <SectionHeader title="조리 순서" first />
      <ol className="pb-2">
        {recipe.steps.map((s) => (
          <li key={s.order} className={`${rowLine} before:left-[68px] flex gap-4 px-5 py-4`}>
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-2 text-callout font-semibold text-ink tabular-nums">{s.order}</span>
            <div className="min-w-0 flex-1 pt-0.5">
              <p className="text-body text-ink">{s.text}</p>
              {s.minutes != null && <p className="mt-2 inline-flex items-center gap-1 text-caption font-medium text-ink-2 tabular-nums"><Timer size={14} aria-hidden />{s.minutes}분</p>}
            </div>
          </li>
        ))}
      </ol>

      {recipe.tips.length > 0 && (
        <>
          <Band />
          <SectionHeader title="팁" first />
          <ul className="flex flex-col gap-2 px-5 pb-4">
            {recipe.tips.map((t, i) => <li key={i} className="flex gap-2 text-callout text-ink-2"><span aria-hidden className="text-ink-3">•</span><span>{t}</span></li>)}
          </ul>
        </>
      )}
      {refs.length > 0 && (
        <>
          <Band />
          <SectionHeader title="참고한 곳" count={refs.length} first />
          <SourceList refs={refs} limit={2} />
        </>
      )}
      {last && (
        <p className="py-8 text-center text-caption text-ink-3 tabular-nums">요리 기록 {recipe.cookedLog.length}회 · 마지막 {shortDate(last.date)}</p>
      )}

      {cooking && (
        <CookMode recipe={recipe} recipeKey={recipeId ?? recipe.title} servings={servings} fridgeNames={fridge.map((f) => f.name)}
          onClose={() => setCooking(false)} onComplete={() => setUseUp(matches)} />
      )}
      {useUp && (
        <UseUpSheet matches={useUp} servings={servings} recipeTitle={recipe.title} onClose={() => setUseUp(null)} onApply={applyUseUp} onSkip={() => onCooked(servings)} />
      )}
      {shopSheet && (
        <AddToShoppingSheet matches={matches} recipeTitle={recipe.title} onClose={() => setShopSheet(false)} onConfirm={(items) => addToShopping(items, true)} />
      )}
      {linking != null && matches[linking] && (
        <LinkSheet match={matches[linking]} fridge={fridge} onClose={() => setLinking(null)} onLink={(f) => link(linking, f)}
          extra={(matches[linking].status === "missing" || matches[linking].status === "short") ? (
            // 재료 시트를 닫고 "대체 재료" 시트로 바꿔 연다 (시트는 한 번에 하나)
            <SubstitutePanel onFind={() => { const ing = matches[linking].ingredient; setLinking(null); setSubFor([ing]); }} />
          ) : undefined} />
      )}
      {subFor && (
        <SubstituteSheet title={recipe.title} all={recipe.ingredients.map((i) => i.name)} missing={subFor}
          fridge={fridge.map((f) => f.name)} staples={staples}
          onClose={() => setSubFor(null)} onShop={() => { setSubFor(null); setShopSheet(true); }} />
      )}
      {planning && recipeId && <AddToPlanSheet recipe={recipe} recipeId={recipeId} servings={servings} onClose={() => setPlanning(false)} />}
      {asking && (
        <AskSheet recipe={recipe} recipeKey={recipeId ?? recipe.title} servings={servings} fridge={fridge.map((f) => f.name)} onClose={() => setAsking(false)} />
      )}
      {adapting && (
        <AdaptSheet recipe={recipe} servings={servings} fridge={fridge.map((f) => f.name)} profile={family?.profile ?? null} initialText={adapting.text}
          onClose={() => setAdapting(false)}
          onResult={(d, summary) => { setAdapting(false); onAdapted?.(d, summary); }} />
      )}

      {menu && (
        <Sheet title={menu === "folder" ? "폴더 옮기기" : "레시피 관리"} onClose={() => setMenu(false)} flush>
          {menu === "main" ? (
            <ul>
              <ActionRow icon={<Pencil size={20} />} title="수정하기" disabled={busy} onClick={() => { setMenu(false); onEdit(); }} />
              {recipeId && <ActionRow icon={<CalendarPlus size={20} />} title="식단에 넣기" disabled={busy} onClick={() => { setMenu(false); setPlanning(true); }} />}
              {(folders.length > 0 || recipe.folderId) && (
                <ActionRow icon={<Folder size={20} />} title="폴더 옮기기" value={folderName} disabled={busy} onClick={() => setMenu("folder")} />
              )}
              <ActionRow icon={<Trash2 size={20} />} title="삭제" danger disabled={busy}
                onClick={async () => { if (confirm("이 레시피를 삭제할까요?")) { await run(onDelete); setMenu(false); onClose(); } }} />
            </ul>
          ) : (
            <ul>
              {[{ id: null, name: "없음" }, ...folders].map((f) => {
                const on = (recipe.folderId ?? null) === f.id;
                return (
                  <li key={f.id ?? "none"} className={`${rowLine} before:left-5`}>
                    <button type="button" disabled={busy} aria-current={on ? "true" : undefined}
                      onClick={() => { setMenu(false); if (!on) void run(() => onMoveFolder(f.id)); }}
                      className="flex min-h-14 w-full items-center gap-3 px-5 py-3 text-left text-body text-ink transition-colors active:bg-surface-2 disabled:opacity-50">
                      <span className="min-w-0 flex-1 truncate">{f.name}</span>
                      {on && <Check size={20} strokeWidth={2.5} aria-hidden className="shrink-0 text-accent" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Sheet>
      )}
    </FullScreen>
  );
}
