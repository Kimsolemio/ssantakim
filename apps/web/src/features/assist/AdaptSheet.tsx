import { useEffect, useRef, useState } from "react";
import type { FamilyProfile, Recipe, RecipeDraft } from "@cook/shared";
import { Sheet } from "../../components/Sheet";
import { callWorker, ApiError } from "../../lib/api";
import { ServingsStepper } from "../recipes/RecipeDetail";

const PRESETS = ["덜 맵게", "더 맵게", "아이 반찬으로", "가볍게 (다이어트)", "에어프라이어로", "냉장고 재료로", "15분 안에", "고기 없이"];

type AdaptResponse = { summary: string; recipe: RecipeDraft };

/** 레시피 바꾸기: 원래 레시피를 요청대로 고친 새 레시피를 만든다 (Claude). 결과는 확인·수정 화면으로 */
export function AdaptSheet({ recipe, servings, fridge, profile, onClose, onResult }: {
  recipe: Recipe; servings: number; fridge: string[]; profile: FamilyProfile | null;
  onClose: () => void; onResult: (draft: RecipeDraft, summary: string) => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [n, setN] = useState(servings);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    if (!busy) return;
    const id = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, [busy]);

  const instruction = [...picked, text.trim()].filter(Boolean).join(", ");
  const run = async () => {
    if (!instruction) { setErr("어떻게 바꿀지 골라 주세요"); return; }
    setBusy(true); setErr(null); setTick(0);
    abort.current = new AbortController();
    try {
      const r = await callWorker<AdaptResponse>("/adapt", {
        recipe: { title: recipe.title, servingsBase: recipe.servingsBase, ingredients: recipe.ingredients, steps: recipe.steps, timeMinutes: recipe.timeMinutes, difficulty: recipe.difficulty, tags: recipe.tags, tips: recipe.tips },
        instruction, servings: n, fridge: fridge.slice(0, 150), profile,
      }, abort.current.signal);
      onResult(r.recipe, r.summary);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "바꾸지 못했어요");
      setBusy(false);
    }
  };

  return (
    <Sheet title="레시피 바꾸기" onClose={() => { abort.current?.abort(); onClose(); }} confirmClose={busy ? "레시피를 바꾸는 중이에요. 그만둘까요?" : null}>
      <div className="flex flex-col gap-3" data-testid="adapt-sheet">
        <p className="text-sm text-gray-600">"{recipe.title}"을(를) 어떻게 바꿀까요? 원래 레시피는 그대로 두고 새 레시피로 만들어요.</p>
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => {
            const on = picked.includes(p);
            return <button key={p} type="button" aria-pressed={on} onClick={() => setPicked((l) => (on ? l.filter((x) => x !== p) : [...l, p]))}
              className={`rounded-full px-3 py-1.5 text-sm ${on ? "bg-orange-500 text-white" : "bg-white text-gray-700 ring-1 ring-orange-100"}`}>{p}</button>;
          })}
        </div>
        <input className="rounded-xl border border-orange-200 bg-white px-3 py-2.5 text-base" placeholder="직접 적기 (예: 간장 대신 소금으로, 국물 넉넉히)" value={text} onChange={(e) => setText(e.target.value)} maxLength={150} aria-label="바꿀 점" />
        <div className="flex items-center justify-between rounded-xl bg-white px-3 py-2">
          <span className="text-sm text-gray-600">인분</span>
          <ServingsStepper value={n} onChange={setN} />
        </div>
        {err && <p className="text-sm text-red-600">{err}</p>}
        {busy ? (
          <div className="flex items-center justify-between rounded-xl bg-orange-50 px-4 py-3 text-sm text-orange-800">
            <span>✨ 레시피를 고치는 중… ({tick}초 · 보통 20~40초)</span>
            <button type="button" className="text-gray-500" onClick={() => abort.current?.abort()}>취소</button>
          </div>
        ) : (
          <button type="button" disabled={!instruction} onClick={run} className="rounded-xl bg-orange-500 py-3 font-semibold text-white disabled:opacity-40">✨ 이렇게 바꾸기</button>
        )}
      </div>
    </Sheet>
  );
}
