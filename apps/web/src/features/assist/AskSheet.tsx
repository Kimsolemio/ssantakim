import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Recipe } from "@cook/shared";
import { Sheet } from "../../components/Sheet";
import { callWorker, ApiError } from "../../lib/api";

type Turn = { q: string; a: string };
type AskResponse = { answer: string; followups: string[] };

const STARTERS = ["불 세기·시간 맞아요?", "다 익었는지 어떻게 알아요?", "없는 재료 대신 뭐 넣어요?", "미리 해 둘 수 있는 건?"];

/** 대화는 레시피마다 이 기기에 잠깐 기억한다 (앱을 켜 둔 동안) */
const memory = new Map<string, Turn[]>();

/** AI 셰프에게 묻기: 지금 레시피·단계·냉장고를 알고 답한다 (Claude) */
export function AskSheet({ recipe, recipeKey, servings, step, fridge, onClose, top }: {
  recipe: Recipe; recipeKey: string; servings: number; step?: number | null; fridge: string[]; onClose: () => void; top?: boolean;
}) {
  const [turns, setTurns] = useState<Turn[]>(() => memory.get(recipeKey) ?? []);
  const [followups, setFollowups] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => { memory.set(recipeKey, turns); end.current?.scrollIntoView({ block: "end" }); }, [turns, recipeKey]);
  useEffect(() => () => abort.current?.abort(), []);

  const ask = async (question: string, e?: FormEvent) => {
    e?.preventDefault();
    const text = question.trim();
    if (!text || busy) return;
    setBusy(true); setErr(null); setQ("");
    abort.current = new AbortController();
    try {
      const r = await callWorker<AskResponse>("/ask", {
        recipe: { title: recipe.title, servingsBase: recipe.servingsBase, ingredients: recipe.ingredients, steps: recipe.steps, tags: recipe.tags, tips: recipe.tips },
        servings, step: step ?? null, question: text, history: turns.slice(-6), fridge: fridge.slice(0, 150),
      }, abort.current.signal);
      setTurns((t) => [...t, { q: text, a: r.answer }]);
      setFollowups(r.followups);
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : "답을 받지 못했어요");
      setQ(text);
    } finally { setBusy(false); }
  };

  const chips = turns.length ? followups : STARTERS;
  return (
    <Sheet title="AI 셰프에게 묻기" onClose={onClose} top={top}>
      <div className="flex flex-col gap-3 text-gray-900" data-testid="ask-sheet">
        <p className="text-xs text-gray-500">{recipe.title}{step ? ` · ${step}단계` : ""} · {servings}인분을 알고 답해요</p>
        <div className="flex max-h-[45dvh] flex-col gap-2 overflow-y-auto">
          {turns.map((t, i) => (
            <div key={i} className="flex flex-col gap-1">
              <p className="self-end rounded-2xl rounded-br-md bg-orange-500 px-3 py-2 text-sm text-white">{t.q}</p>
              <p className="self-start whitespace-pre-line rounded-2xl rounded-bl-md bg-white px-3 py-2 text-sm leading-relaxed" data-testid="ask-answer">{t.a}</p>
            </div>
          ))}
          {busy && <p className="self-start rounded-2xl bg-white px-3 py-2 text-sm text-gray-400">생각하는 중…</p>}
          <div ref={end} />
        </div>
        {err && <p className="text-sm text-red-600">{err}</p>}
        {chips.length > 0 && !busy && (
          <div className="flex flex-wrap gap-1.5">
            {chips.map((c) => <button key={c} type="button" onClick={() => void ask(c)} className="rounded-full bg-white px-3 py-1.5 text-sm text-gray-700 ring-1 ring-orange-100">{c}</button>)}
          </div>
        )}
        <form onSubmit={(e) => void ask(q, e)} className="flex gap-2">
          <input className="min-w-0 flex-1 rounded-xl border border-orange-200 bg-white px-3 py-2.5 text-base" placeholder="무엇이든 물어보세요" value={q} onChange={(e) => setQ(e.target.value)} maxLength={300} aria-label="질문" />
          <button disabled={busy || !q.trim()} className="shrink-0 rounded-xl bg-orange-500 px-4 font-semibold text-white disabled:opacity-40">묻기</button>
        </form>
      </div>
    </Sheet>
  );
}
