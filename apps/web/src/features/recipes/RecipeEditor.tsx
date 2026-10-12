import { useEffect, useState } from "react";
import { IngredientGroup, RecipeDraft, Unit, provisionalKey, type Ingredient, type Step } from "@cook/shared";
import { FullScreen } from "../../components/FullScreen";
import { remapStepKeys } from "../../lib/normalize";
import { useFamily } from "../../lib/family";
import { AllergyBanner, AllergyChip } from "./AllergyBanner";

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

const field = "w-full rounded-xl border border-orange-200 bg-white px-3 py-2.5 text-base outline-none focus:border-orange-400";
const small = "rounded-lg border border-orange-200 bg-white px-2 py-2 text-sm outline-none focus:border-orange-400";

function emptyIngredient(): Ingredient {
  return { name: "", key: "", qty: null, unit: "개", scalable: true, optional: false, group: "주재료" };
}

/** AI 결과를 저장하기 전에 사람이 고치는 화면. 저장 시 zod로 검증한다. */
export function RecipeEditor({ title, initial, note, onSave, onClose, fresh, onChange }: Props) {
  const [d, setD] = useState<RecipeDraft>(initial);
  const [tagsText, setTagsText] = useState(initial.tags.join(", "));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { family } = useFamily();

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
  const setStep = (i: number, patch: Partial<Step>) =>
    setD((p) => ({ ...p, steps: p.steps.map((x, idx) => (idx === i ? { ...x, ...patch } : x)) }));

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

  return (
    <FullScreen title={title} onClose={onClose} confirmClose={confirmClose}
      right={<button disabled={busy} onClick={save} className="rounded-full bg-orange-500 px-4 py-1.5 font-semibold text-white disabled:opacity-50">{busy ? "저장 중…" : "저장"}</button>}>
      <div className="flex flex-col gap-5 p-4">
        {note && <p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800" data-testid="import-note">✅ {note}{initial.source.url ? " · 원본 링크가 함께 저장돼요" : ""}. 저장 전에 재료와 순서를 확인해 주세요.</p>}
        {err && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{err}</p>}
        <AllergyBanner ingredients={d.ingredients.filter((i) => i.name.trim())} profile={family?.profile} />

        <section className="flex flex-col gap-2">
          <input className={`${field} text-lg font-bold`} placeholder="요리 이름" value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} />
          <div className="grid grid-cols-3 gap-2">
            <label className="text-xs text-gray-500">기준 인분
              <input className={small + " mt-1 w-full"} type="number" inputMode="numeric" min={1} value={d.servingsBase}
                onChange={(e) => setD({ ...d, servingsBase: Math.max(1, Number(e.target.value) || 1) })} /></label>
            <label className="text-xs text-gray-500">총 시간(분)
              <input className={small + " mt-1 w-full"} type="number" inputMode="numeric" min={0} value={d.timeMinutes ?? ""}
                onChange={(e) => setD({ ...d, timeMinutes: e.target.value === "" ? null : Number(e.target.value) })} /></label>
            <label className="text-xs text-gray-500">난이도
              <select className={small + " mt-1 w-full"} value={d.difficulty} onChange={(e) => setD({ ...d, difficulty: e.target.value as RecipeDraft["difficulty"] })}>
                {["쉬움", "보통", "어려움"].map((x) => <option key={x}>{x}</option>)}
              </select></label>
          </div>
          <input className={field} placeholder="태그 (쉼표로 구분: 한식, 10분요리)" value={tagsText} onChange={(e) => setTagsText(e.target.value)} />
        </section>

        <section>
          <h2 className="mb-2 font-bold">재료 <span className="text-sm font-normal text-gray-500">{d.ingredients.length}개</span></h2>
          <div className="flex flex-col gap-2">
            {d.ingredients.map((ing, i) => (
              <div key={i} className="rounded-2xl bg-white p-3">
                <div className="flex gap-2">
                  <input className={small + " min-w-0 flex-1"} placeholder="재료" value={ing.name} onChange={(e) => setIng(i, { name: e.target.value })} />
                  <input className={small + " w-16"} type="number" inputMode="decimal" step="any" min={0} placeholder="수량" value={ing.qty ?? ""}
                    onChange={(e) => setIng(i, { qty: e.target.value === "" ? null : Number(e.target.value) })} />
                  <select className={small + " w-24"} value={ing.unit} onChange={(e) => setIng(i, { unit: e.target.value as Unit, ...(e.target.value === "기타" ? { scalable: false } : {}) })}>
                    {Unit.options.map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                  <AllergyChip name={ing.name} profile={family?.profile} />
                  <select className={small + " py-1"} value={ing.group} onChange={(e) => setIng(i, { group: e.target.value as IngredientGroup })}>
                    {IngredientGroup.options.map((g) => <option key={g} value={g}>{g}</option>)}
                  </select>
                  <label className="flex items-center gap-1"><input type="checkbox" checked={ing.optional} onChange={(e) => setIng(i, { optional: e.target.checked })} />선택 재료</label>
                  <label className="flex items-center gap-1"><input type="checkbox" checked={!ing.scalable} onChange={(e) => setIng(i, { scalable: !e.target.checked })} />인분 고정</label>
                  <input className={small + " min-w-0 flex-1 py-1"} placeholder="메모 (다진 것, 대체: …)" value={ing.note ?? ""} onChange={(e) => setIng(i, { note: e.target.value })} />
                  <button className="text-red-500" onClick={() => removeIng(i)}>삭제</button>
                </div>
              </div>
            ))}
            <button className="rounded-xl border border-dashed border-orange-300 py-2 text-sm text-orange-700" onClick={() => { setD({ ...d, ingredients: [...d.ingredients, emptyIngredient()] }); setOrigs((k) => [...k, null]); }}>+ 재료 추가</button>
          </div>
        </section>

        <section>
          <h2 className="mb-2 font-bold">조리 순서</h2>
          <div className="flex flex-col gap-2">
            {d.steps.map((s, i) => (
              <div key={i} className="rounded-2xl bg-white p-3">
                <div className="flex items-start gap-2">
                  <span className="mt-2 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-orange-500 text-xs font-bold text-white">{i + 1}</span>
                  <textarea className={small + " min-w-0 flex-1 leading-relaxed"} rows={3} value={s.text} onChange={(e) => setStep(i, { text: e.target.value })} />
                </div>
                <div className="mt-2 flex items-center gap-2 pl-8 text-xs">
                  <label className="flex items-center gap-1">⏱ <input className={small + " w-16 py-1"} type="number" inputMode="numeric" min={0} placeholder="분" value={s.minutes ?? ""}
                    onChange={(e) => setStep(i, { minutes: e.target.value === "" ? null : Number(e.target.value) })} /> 분</label>
                  <span className="flex-1" />
                  <button disabled={i === 0} className="text-gray-500 disabled:opacity-30" onClick={() => { const a = [...d.steps]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; setD({ ...d, steps: a }); }}>↑</button>
                  <button disabled={i === d.steps.length - 1} className="text-gray-500 disabled:opacity-30" onClick={() => { const a = [...d.steps]; [a[i + 1], a[i]] = [a[i], a[i + 1]]; setD({ ...d, steps: a }); }}>↓</button>
                  <button className="text-red-500" onClick={() => setD({ ...d, steps: d.steps.filter((_, idx) => idx !== i) })}>삭제</button>
                </div>
              </div>
            ))}
            <button className="rounded-xl border border-dashed border-orange-300 py-2 text-sm text-orange-700"
              onClick={() => setD({ ...d, steps: [...d.steps, { order: d.steps.length + 1, text: "", minutes: null, ingredientKeys: [] }] })}>+ 단계 추가</button>
          </div>
        </section>

        <section>
          <h2 className="mb-2 font-bold">팁</h2>
          <div className="flex flex-col gap-2">
            {d.tips.map((t, i) => (
              <div key={i} className="flex gap-2">
                <input className={small + " min-w-0 flex-1"} value={t} onChange={(e) => setD({ ...d, tips: d.tips.map((x, idx) => (idx === i ? e.target.value : x)) })} />
                <button className="text-sm text-red-500" onClick={() => setD({ ...d, tips: d.tips.filter((_, idx) => idx !== i) })}>삭제</button>
              </div>
            ))}
            <button className="rounded-xl border border-dashed border-orange-300 py-2 text-sm text-orange-700" onClick={() => setD({ ...d, tips: [...d.tips, ""] })}>+ 팁 추가</button>
          </div>
        </section>
      </div>
    </FullScreen>
  );
}
