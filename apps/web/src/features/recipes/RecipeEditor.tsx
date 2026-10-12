import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronDown, Ellipsis, Plus, Timer, Trash2, X } from "lucide-react";
import { IngredientGroup, RecipeDraft, Unit, provisionalKey, type Ingredient, type Step } from "@cook/shared";
import { FullScreen } from "../../components/FullScreen";
import { Sheet } from "../../components/Sheet";
import { Button } from "../../components/ui/Button";
import { IconButton } from "../../components/ui/IconButton";
import { Banner } from "../../components/ui/Banner";
import { TextArea, TextField } from "../../components/ui/Field";
import { Stepper } from "../../components/ui/Stepper";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { SwitchRow } from "../../components/ui/Toggle";
import { Band, SectionHeader, rowLine } from "../../components/ui/Section";
import { SourceList } from "../../components/ui/Ai";
import { remapStepKeys } from "../../lib/normalize";

type Props = {
  title: string;
  initial: RecipeDraft;
  /** 가져온 곳 안내 (예: "유튜브 설명란에서 찾았어요") */
  note?: string | null;
  onSave: (draft: RecipeDraft) => Promise<void>;
  onClose: () => void;
  /** 아직 저장하지 않은 AI 결과면 true: 고치지 않았어도 닫기 전에 묻는다 */
  fresh?: boolean;
  /** 고칠 때마다 불린다 (기기에 임시 보관용) */
  onChange?: (draft: RecipeDraft) => void;
};

/** 흰 화면 위 작은 입력칸 (재료 줄·타이머·팁) */
const cell = "h-11 rounded-control border border-transparent bg-surface-2 text-body text-ink placeholder:text-ink-3 outline-none transition "
  + "focus:border-accent focus:bg-surface focus:ring-4 focus:ring-accent/15";
const noSpin = "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none";
const DIFFICULTY = (["쉬움", "보통", "어려움"] as const).map((v) => ({ value: v, label: v }));
const GROUPS = IngredientGroup.options.map((g) => ({ value: g, label: g }));
const groupOf = (i: Ingredient): IngredientGroup => (IngredientGroup.options.includes(i.group) ? i.group : "기타");

function emptyIngredient(): Ingredient {
  return { name: "", key: "", qty: null, unit: "개", scalable: true, optional: false, group: "주재료" };
}

/** 목록 끝 "재료 추가" 같은 행 */
function AddRow({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="flex min-h-14 w-full items-center gap-3 px-5 text-left text-callout font-semibold text-accent transition-colors active:bg-surface-2">
      <Plus size={20} aria-hidden />{children}
    </button>
  );
}

/** 옵션 시트 안의 한 행 */
function ActionRow({ icon, children, onClick, disabled, danger }: { icon: ReactNode; children: ReactNode; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <li className={`${rowLine} before:left-14`}>
      <button type="button" onClick={onClick} disabled={disabled}
        className={`flex min-h-14 w-full items-center gap-4 px-5 text-left text-body transition-colors active:bg-surface-2 disabled:text-ink-disabled ${danger ? "text-danger" : "text-ink"}`}>
        {icon}{children}
      </button>
    </li>
  );
}

/** AI 결과를 저장하기 전에 사람이 고치는 화면. 저장 시 zod로 검증한다. */
export function RecipeEditor({ title, initial, note, onSave, onClose, fresh, onChange }: Props) {
  const [d, setD] = useState<RecipeDraft>(initial);
  const [tagsText, setTagsText] = useState(initial.tags.join(", "));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ingOpt, setIngOpt] = useState<number | null>(null);
  const [stepOpt, setStepOpt] = useState<number | null>(null);
  const timeId = useId();
  const root = useRef<HTMLDivElement>(null);
  const errBox = useRef<HTMLDivElement>(null);
  // 행을 추가하면 그 칸으로 커서를 옮긴다 (data-focus 값)
  const focusNext = useRef<string | null>(null);
  useEffect(() => {
    const key = focusNext.current;
    if (!key) return;
    focusNext.current = null;
    const el = root.current?.querySelector<HTMLElement>(`[data-focus="${key}"]`);
    el?.focus({ preventScroll: true });
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  });
  useEffect(() => { if (err) errBox.current?.scrollIntoView({ block: "start", behavior: "smooth" }); }, [err]);

  // 재료마다 처음 이름·key 를 기억한다. 이름이 처음과 달라지면 key 를 비우고(저장할 때 새로 만든다),
  // 처음 이름으로 되돌리면 처음 key(AI가 정리한 것)를 되살린다. 단계의 ingredientKeys 를 고칠 때도 쓴다
  const [origs, setOrigs] = useState<({ name: string; key: string } | null)[]>(() => initial.ingredients.map((i) => (i.key ? { name: i.name, key: i.key } : null)));
  const setIng = (i: number, patch: Partial<Ingredient>) =>
    setD((p) => ({ ...p, ingredients: p.ingredients.map((x, idx) => {
      if (idx !== i) return x;
      if (patch.name === undefined) return { ...x, ...patch };
      const o = origs[idx];
      const same = o ? provisionalKey(patch.name) === provisionalKey(o.name) : false;
      return { ...x, ...patch, key: same && o ? o.key : o ? "" : x.key && provisionalKey(patch.name) === provisionalKey(x.name) ? x.key : "" };
    }) }));
  const removeIng = (i: number) => {
    setD((p) => ({ ...p, ingredients: p.ingredients.filter((_, idx) => idx !== i) }));
    setOrigs((k) => k.filter((_, idx) => idx !== i));
  };
  const addIng = () => {
    focusNext.current = `ing-${d.ingredients.length}`;
    setD({ ...d, ingredients: [...d.ingredients, emptyIngredient()] });
    setOrigs((k) => [...k, null]);
  };
  const setStep = (i: number, patch: Partial<Step>) =>
    setD((p) => ({ ...p, steps: p.steps.map((x, idx) => (idx === i ? { ...x, ...patch } : x)) }));
  const moveStep = (i: number, dir: -1 | 1) => {
    const a = [...d.steps];
    [a[i + dir], a[i]] = [a[i], a[i + dir]];
    setD({ ...d, steps: a });
  };

  const dirty = d !== initial || tagsText !== initial.tags.join(", ");
  useEffect(() => { if (dirty) onChange?.({ ...d, tags: tagsText.split(/[,，]/).map((t) => t.trim()).filter(Boolean) }); }, [d, tagsText]); // eslint-disable-line react-hooks/exhaustive-deps
  // 새 AI 초안은 기기에 보관되므로 묻지 않는다 (레시피 탭에 "이어서"가 뜬다). 저장된 레시피를 고치다 닫을 때만 묻는다
  const confirmClose = busy || fresh ? null : dirty ? "고친 내용을 저장하지 않고 닫을까요?" : null;

  const save = async () => {
    setErr(null);
    const keyed = d.ingredients.map((i) => ({ ...i, name: i.name.trim(), key: i.key.trim() || provisionalKey(i.name), note: i.note?.trim() || undefined }));
    // 단계 연결 옮기기: 처음 key 를 쓰던 재료가 하나뿐일 때만 (대파 주재료·고명처럼 같은 key 가 둘이면 남은 쪽을 위해 그대로 둔다)
    const origCount = new Map<string, number>();
    origs.forEach((o) => { if (o) origCount.set(o.key, (origCount.get(o.key) ?? 0) + 1); });
    const keyMap = new Map<string, string>();
    keyed.forEach((i, idx) => { const o = origs[idx]; if (o && o.key !== i.key && origCount.get(o.key) === 1) keyMap.set(o.key, i.key); });
    const finalKeys = new Set(keyed.filter((i) => i.name).map((i) => i.key));
    const cleaned: RecipeDraft = {
      ...d,
      title: d.title.trim(),
      tags: tagsText.split(/[,，]/).map((t) => t.trim().replace(/^#/, "")).filter(Boolean),
      ingredients: keyed.filter((i) => i.name),
      // 옮긴 뒤에도 어떤 재료와도 맞지 않는 key 는 뺀다 (요리 모드에 엉뚱한 재료가 뜨지 않게)
      steps: remapStepKeys(d.steps.filter((s) => s.text.trim()).map((s, idx) => ({ ...s, order: idx + 1, text: s.text.trim() })), keyMap)
        .map((s) => ({ ...s, ingredientKeys: s.ingredientKeys.filter((k) => finalKeys.has(k)) })),
      tips: d.tips.map((t) => t.trim()).filter(Boolean),
    };
    const parsed = RecipeDraft.safeParse(cleaned);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const where = issue?.path[0] === "ingredients" ? "재료" : issue?.path[0] === "steps" ? "조리 순서" : issue?.path[0] === "title" ? "제목" : String(issue?.path.join("."));
      setErr(`${where}을(를) 확인하세요: ${issue?.message ?? ""}`);
      return;
    }
    setBusy(true);
    try { await onSave(parsed.data); }
    catch (e) { setErr(e instanceof Error ? e.message : "저장 실패"); }
    finally { setBusy(false); }
  };

  // 배너는 하나만: 오류가 있으면 오류, 아니면 어디서 왔는지 (새 AI 결과)
  const refs = initial.source.refs ?? [];
  const noteText = note ? `${note}${initial.source.url ? " · 원본 링크가 함께 저장돼요" : ""}`
    : fresh && refs.length ? `인기 레시피 ${refs.length}곳을 참고했어요` : null;
  const groups = IngredientGroup.options.filter((g) => d.ingredients.some((x) => groupOf(x) === g));

  const ingRow = (ing: Ingredient, i: number) => {
    const extra = [ing.optional && "선택 재료", !ing.scalable && ing.unit !== "기타" && "인분 고정", ing.note?.trim()].filter(Boolean).join(" · ");
    return (
      <li key={i}>
        <div className="flex items-center gap-1.5 px-4 py-1.5">
          <input data-focus={`ing-${i}`} className={`${cell} min-w-0 flex-1 px-3`} placeholder="재료" value={ing.name} onChange={(e) => setIng(i, { name: e.target.value })} />
          <input className={`${cell} w-[60px] shrink-0 px-2 text-center tabular-nums ${noSpin}`} type="number" inputMode="decimal" step="any" min={0} placeholder="수량" value={ing.qty ?? ""}
            onChange={(e) => setIng(i, { qty: e.target.value === "" ? null : Number(e.target.value) })} />
          <span className="relative w-[72px] shrink-0">
            <select aria-label="단위" className={`${cell} w-full appearance-none pl-2 pr-5 text-callout`} value={ing.unit}
              onChange={(e) => setIng(i, { unit: e.target.value as Unit, ...(e.target.value === "기타" ? { scalable: false } : {}) })}>
              {Unit.options.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
            <ChevronDown size={14} aria-hidden className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-ink-3" />
          </span>
          <IconButton aria-label="재료 옵션" className="-mr-1.5" onClick={() => setIngOpt(i)}><Ellipsis size={20} /></IconButton>
        </div>
        {extra && (
          <button type="button" onClick={() => setIngOpt(i)} className="-mt-0.5 block w-full truncate pb-2 pl-7 pr-4 text-left text-caption text-ink-3">{extra}</button>
        )}
      </li>
    );
  };

  const opt = ingOpt != null ? d.ingredients[ingOpt] : undefined;
  return (
    <FullScreen title={title} onClose={onClose} confirmClose={confirmClose}
      footer={<Button block loading={busy} onClick={save}>{busy ? "저장 중…" : "저장"}</Button>}>
      <div ref={root}>
        {(err || noteText) && (
          <div ref={errBox} className="scroll-mt-2 px-5 pt-2">
            {err ? <Banner kind="danger">{err}</Banner> : <Banner kind="success" testId="import-note" title={noteText} />}
          </div>
        )}

        <TextField big wrapClass="px-5 pt-4" placeholder="요리 이름" aria-label="요리 이름" value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} />
        <div className="mt-2">
          <div className="flex min-h-14 items-center justify-between gap-3 px-5">
            <span className="text-body text-ink">기준 인분</span>
            <Stepper value={d.servingsBase} min={1} max={99} onChange={(v) => setD({ ...d, servingsBase: Math.max(1, v) })}
              labels={{ minus: "기준 인분 줄이기", plus: "기준 인분 늘리기" }} />
          </div>
          <div className="flex min-h-14 items-center justify-between gap-3 px-5">
            <label htmlFor={timeId} className="text-body text-ink">총 시간</label>
            <span className="relative">
              <input id={timeId} className={`${cell} w-24 pl-3 pr-9 text-right tabular-nums ${noSpin}`} type="number" inputMode="numeric" min={0} value={d.timeMinutes ?? ""}
                onChange={(e) => setD({ ...d, timeMinutes: e.target.value === "" ? null : Number(e.target.value) })} />
              <span aria-hidden className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-body text-ink-3">분</span>
            </span>
          </div>
          <div className="flex min-h-14 items-center justify-between gap-3 px-5">
            <span className="text-body text-ink">난이도</span>
            <SegmentedControl label="난이도" className="w-[204px]" value={d.difficulty} options={DIFFICULTY} onChange={(v) => setD({ ...d, difficulty: v })} />
          </div>
        </div>
        <TextField wrapClass="px-5 pb-6 pt-3" label="태그" helper="쉼표로 구분" placeholder="예: 한식, 10분요리" value={tagsText} onChange={(e) => setTagsText(e.target.value)} />

        <Band />
        <section className="pb-1">
          <SectionHeader first title="재료" count={d.ingredients.length} />
          {groups.map((g) => (
            <div key={g}>
              {groups.length > 1 && <p className="px-5 pb-1 pt-3 text-caption font-semibold text-ink-3">{g}</p>}
              <ul>{d.ingredients.map((ing, i) => (groupOf(ing) === g ? ingRow(ing, i) : null))}</ul>
            </div>
          ))}
          <AddRow onClick={addIng}>재료 추가</AddRow>
        </section>

        <Band />
        <section className="pb-1">
          <SectionHeader first title="조리 순서" />
          <ol>
            {d.steps.map((s, i) => (
              <li key={i} className={`${rowLine} flex gap-3 px-4 py-3 before:left-14`}>
                <span aria-hidden className="mt-2.5 grid size-7 shrink-0 place-items-center rounded-full bg-surface-2 text-caption font-semibold text-ink tabular-nums">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <TextArea data-focus={`step-${i}`} aria-label={`${i + 1}단계 설명`} rows={1} minRows={1} value={s.text} onChange={(e) => setStep(i, { text: e.target.value })} />
                  <div className="mt-2 flex items-center gap-2">
                    <label className="flex items-center gap-2 text-callout text-ink-2">
                      <Timer size={16} aria-hidden />타이머
                      <input className={`${cell} w-16 px-2 text-center tabular-nums ${noSpin}`} type="number" inputMode="numeric" min={0} value={s.minutes ?? ""}
                        onChange={(e) => setStep(i, { minutes: e.target.value === "" ? null : Number(e.target.value) })} />
                      분
                    </label>
                    <span className="flex-1" />
                    <IconButton aria-label="단계 옵션" className="-mr-1.5" onClick={() => setStepOpt(i)}><Ellipsis size={20} /></IconButton>
                  </div>
                </div>
              </li>
            ))}
          </ol>
          <AddRow onClick={() => { focusNext.current = `step-${d.steps.length}`; setD({ ...d, steps: [...d.steps, { order: d.steps.length + 1, text: "", minutes: null, ingredientKeys: [] }] }); }}>단계 추가</AddRow>
        </section>

        <Band />
        <section className="pb-1">
          <SectionHeader first title="팁" />
          <ul>
            {d.tips.map((t, i) => (
              <li key={i} className="flex items-center gap-1.5 px-4 py-1.5">
                <input data-focus={`tip-${i}`} className={`${cell} min-w-0 flex-1 px-3`} placeholder="팁" value={t}
                  onChange={(e) => setD({ ...d, tips: d.tips.map((x, idx) => (idx === i ? e.target.value : x)) })} />
                <IconButton aria-label="팁 삭제" className="-mr-1.5" onClick={() => setD({ ...d, tips: d.tips.filter((_, idx) => idx !== i) })}><X size={20} /></IconButton>
              </li>
            ))}
          </ul>
          <AddRow onClick={() => { focusNext.current = `tip-${d.tips.length}`; setD({ ...d, tips: [...d.tips, ""] }); }}>팁 추가</AddRow>
        </section>

        {refs.length > 0 && (
          <>
            <Band />
            <section>
              <SectionHeader first title="참고한 곳" count={refs.length} />
              <SourceList refs={refs} />
            </section>
          </>
        )}
      </div>

      {opt && ingOpt != null && (
        <Sheet title={opt.name.trim() || "재료"} onClose={() => setIngOpt(null)}
          footer={<Button block onClick={() => setIngOpt(null)}>완료</Button>}>
          <p className="mb-2 text-caption font-semibold text-ink-2">분류</p>
          <SegmentedControl label="분류" value={groupOf(opt)} options={GROUPS} onChange={(g) => setIng(ingOpt, { group: g })} />
          <div className="mt-2">
            <SwitchRow title="선택 재료" sub="없어도 만들 수 있어요" checked={opt.optional} onChange={(v) => setIng(ingOpt, { optional: v })} />
            <SwitchRow title="인분 고정" sub="인분을 바꿔도 양이 그대로예요" checked={!opt.scalable} onChange={(v) => setIng(ingOpt, { scalable: !v })} />
          </div>
          <TextField wrapClass="mt-2" label="메모" placeholder="다진 것, 대체 재료" value={opt.note ?? ""} onChange={(e) => setIng(ingOpt, { note: e.target.value })} />
          <button type="button" onClick={() => { const i = ingOpt; setIngOpt(null); removeIng(i); }}
            className="-ml-4 mt-4 inline-flex h-12 items-center gap-2 rounded-control px-4 text-callout font-semibold text-danger transition-colors active:bg-danger-soft">
            <Trash2 size={20} aria-hidden />재료 삭제
          </button>
        </Sheet>
      )}
      {stepOpt != null && d.steps[stepOpt] && (
        <Sheet title={`${stepOpt + 1}단계`} onClose={() => setStepOpt(null)} flush>
          <ul>
            <ActionRow icon={<ArrowUp size={20} aria-hidden />} disabled={stepOpt === 0} onClick={() => { moveStep(stepOpt, -1); setStepOpt(null); }}>위로 옮기기</ActionRow>
            <ActionRow icon={<ArrowDown size={20} aria-hidden />} disabled={stepOpt === d.steps.length - 1} onClick={() => { moveStep(stepOpt, 1); setStepOpt(null); }}>아래로 옮기기</ActionRow>
            <ActionRow icon={<Trash2 size={20} aria-hidden />} danger onClick={() => { const i = stepOpt; setStepOpt(null); setD({ ...d, steps: d.steps.filter((_, idx) => idx !== i) }); }}>단계 삭제</ActionRow>
          </ul>
        </Sheet>
      )}
    </FullScreen>
  );
}
