import { useEffect, useRef, useState } from "react";
import type { FamilyProfile, Recipe, RecipeDraft } from "@cook/shared";
import { Sheet } from "../../components/Sheet";
import { AiNotice } from "../../components/AiNotice";
import { AiProgress } from "../../components/ui/Ai";
import { Banner } from "../../components/ui/Banner";
import { Button } from "../../components/ui/Button";
import { ChoiceChip } from "../../components/ui/Chip";
import { TextField } from "../../components/ui/Field";
import { Stepper } from "../../components/ui/Stepper";
import { callWorker, ApiError } from "../../lib/api";

const PRESETS = ["덜 맵게", "더 맵게", "다이어트용", "아이용으로", "더 간단하게", "에어프라이어로", "전자레인지로", "냉장고 재료로"];
const FRIDGE = "냉장고 재료로";

type AdaptResponse = { summary: string; recipe: RecipeDraft };

/** 레시피 바꾸기: 원래 레시피를 요청대로 고친 새 레시피를 만든다 (Claude). 결과는 확인·수정 화면으로 */
export function AdaptSheet({ recipe, servings, fridge, profile, onClose, onResult, initialText }: {
  recipe: Recipe; servings: number; fridge: string[]; profile: FamilyProfile | null;
  onClose: () => void; onResult: (draft: RecipeDraft, summary: string) => void;
  /** 미리 채워 둘 요청 (싫어하는 재료 배너의 "빼고 바꾸기": "오이 빼고") */
  initialText?: string;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const [text, setText] = useState(initialText ?? "");
  const [n, setN] = useState(servings);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const instruction = [...picked, text.trim()].filter(Boolean).join(", ");
  const run = async () => {
    if (!instruction) { setErr("어떻게 바꿀지 골라 주세요"); return; }
    setBusy(true); setErr(null);
    abort.current = new AbortController();
    try {
      const r = await callWorker<AdaptResponse>("/adapt", {
        recipe: { title: recipe.title, servingsBase: recipe.servingsBase, ingredients: recipe.ingredients, steps: recipe.steps, timeMinutes: recipe.timeMinutes, difficulty: recipe.difficulty, tags: recipe.tags, tips: recipe.tips },
        instruction, servings: n, fridge: fridge.slice(0, 150), profile,
      }, abort.current.signal);
      onResult(r.recipe, r.summary);
    } catch (e) {
      // 취소는 오류로 알리지 않는다 (입력은 그대로 남는다)
      if (!abort.current?.signal.aborted) setErr(e instanceof ApiError ? e.message : "바꾸지 못했어요");
      setBusy(false);
    }
  };

  return (
    <Sheet title="레시피 바꾸기" testId="adapt-sheet" onClose={() => { abort.current?.abort(); onClose(); }}
      confirmClose={busy ? "레시피를 바꾸는 중이에요. 그만둘까요?" : null}
      footer={busy ? undefined : <>
        <AiNotice what="레시피와 바꿀 점, 냉장고 목록" kind="fridge" />
        <Button block ai className="mt-3" disabled={!instruction} onClick={() => void run()}>바꾸기</Button>
      </>}>
      {busy ? (
        <AiProgress messages={["바꿀 곳을 찾는 중…", "분량을 다시 계산하는 중…", "조리 순서를 고치는 중…"]} typical="보통 20~40초"
          onCancel={() => abort.current?.abort()} />
      ) : (
        <div className="flex flex-col">
          <p className="text-caption text-ink-3 tabular-nums">{recipe.title} · {recipe.servingsBase}인분 기준</p>
          <p className="mb-2 mt-5 text-caption font-semibold text-ink-2">어떻게 바꿀까요</p>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => {
              const on = picked.includes(p);
              return <ChoiceChip key={p} on={on} onClick={() => setPicked((l) => (on ? l.filter((x) => x !== p) : [...l, p]))}>{p}</ChoiceChip>;
            })}
          </div>
          {picked.includes(FRIDGE) && <p className="mt-2 text-caption text-ink-3 tabular-nums">냉장고 {fridge.length}개 중에서 골라 써요</p>}
          <TextField wrapClass="mt-5" label="직접 적기" placeholder="예: 버터 없이, 국물 넉넉히" aria-label="바꿀 점" maxLength={150}
            value={text} onChange={(e) => setText(e.target.value)} />
          <div className="mt-3 flex min-h-14 items-center justify-between gap-3">
            <span className="text-body text-ink">인분</span>
            <Stepper value={n} onChange={setN} />
          </div>
          {err && <Banner kind="danger" className="mt-3" title="바꾸지 못했어요">{err}</Banner>}
        </div>
      )}
    </Sheet>
  );
}
