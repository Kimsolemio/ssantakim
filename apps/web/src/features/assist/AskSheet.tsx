import { Fragment, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ArrowUp, CircleStop, RotateCcw } from "lucide-react";
import type { Recipe } from "@cook/shared";
import { Sheet } from "../../components/Sheet";
import { AiNotice } from "../../components/AiNotice";
import { callWorker, ApiError } from "../../lib/api";

type Turn = { q: string; a: string };
type AskResponse = { answer: string; followups: string[] };

/** 첫 화면 질문 (누르면 바로 보낸다). 쿡 모드는 지금 단계 기준 */
const STARTERS = ["없는 재료 대신 뭐 넣어?", "미리 만들어 둬도 돼?", "아이가 먹기엔 매워?", "곁들일 반찬 추천해 줘"];
const STARTERS_COOK = ["불 세기 맞아?", "다 익었는지 어떻게 알아?", "없는 재료 대신 뭐 넣어?", "이 단계 다시 설명해 줘"];

/** 대화는 레시피마다 이 기기에 잠깐 기억한다 (앱을 켜 둔 동안) */
const memory = new Map<string, Turn[]>();

const chip = "inline-flex h-11 shrink-0 items-center rounded-full border border-line-strong bg-surface px-4 text-callout text-ink transition-colors active:bg-surface-2";

/** **굵게** 만 살린다 */
function inline(s: string): ReactNode[] {
  return s.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    /^\*\*[^*]+\*\*$/.test(part) ? <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong> : <Fragment key={i}>{part}</Fragment>);
}

/** 셰프 답: 굵게·목록만 허용하는 간단한 마크다운 */
function ChefText({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const items = list.items.map((t, i) => <li key={i}>{inline(t)}</li>);
    blocks.push(list.ordered
      ? <ol key={blocks.length} className="list-decimal space-y-1 pl-5 marker:text-ink-3">{items}</ol>
      : <ul key={blocks.length} className="list-disc space-y-1 pl-5 marker:text-ink-3">{items}</ul>);
    list = null;
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const ul = /^[-*•]\s+(.*)$/.exec(line);
    const ol = /^\d+[.)]\s+(.*)$/.exec(line);
    if (ul || ol) {
      const ordered = !!ol;
      if (!list || list.ordered !== ordered) { flush(); list = { ordered, items: [] }; }
      list.items.push((ol ?? ul)![1]);
      continue;
    }
    flush();
    if (!line) continue;
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    blocks.push(<p key={blocks.length} className={heading ? "font-semibold" : ""}>{inline(heading ? heading[1] : line)}</p>);
  }
  flush();
  return <div className="space-y-2">{blocks}</div>;
}

/** AI 셰프에게 묻기: 지금 레시피·단계·냉장고를 알고 답한다 (Claude). 쿡 모드에서는 theme-dark 안에서 열린다 */
export function AskSheet({ recipe, recipeKey, servings, step, fridge, onClose, top }: {
  recipe: Recipe; recipeKey: string; servings: number; step?: number | null; fridge: string[]; onClose: () => void; top?: boolean;
}) {
  const [turns, setTurns] = useState<Turn[]>(() => memory.get(recipeKey) ?? []);
  const [followups, setFollowups] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<{ q: string; msg: string } | null>(null);
  const lastTurn = useRef<HTMLLIElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => { memory.set(recipeKey, turns); }, [turns, recipeKey]);
  // 새 답이 오면 그 답의 시작(내 질문)으로, 답을 기다리는 동안은 맨 아래로
  useEffect(() => { lastTurn.current?.scrollIntoView({ block: "start", behavior: "smooth" }); }, [turns.length]);
  useEffect(() => { if (busy) end.current?.scrollIntoView({ block: "end", behavior: "smooth" }); }, [busy]);
  useEffect(() => () => abort.current?.abort(), []);
  // 입력에 따라 높이를 늘린다 (최대 120px)
  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [q]);

  const resetting = useRef(false);
  const ask = async (question: string, e?: FormEvent) => {
    e?.preventDefault();
    const text = question.trim();
    if (!text || busy) return;
    setBusy(true); setFailed(null); setQ("");
    abort.current = new AbortController();
    try {
      const r = await callWorker<AskResponse>("/ask", {
        recipe: { title: recipe.title, servingsBase: recipe.servingsBase, ingredients: recipe.ingredients, steps: recipe.steps, tags: recipe.tags, tips: recipe.tips },
        servings, step: step ?? null, question: text, history: turns.slice(-6), fridge: fridge.slice(0, 150),
      }, abort.current.signal);
      setTurns((t) => [...t, { q: text, a: r.answer }]);
      setFollowups(r.followups);
    } catch (e2) {
      // 멈추기로 그만둔 것은 오류로 알리지 않는다
      if (!abort.current?.signal.aborted) setFailed({ q: text, msg: e2 instanceof ApiError ? e2.message : "답을 받지 못했어요" });
      // "새 대화"로 지운 것은 되살리지 않는다
      if (!resetting.current) setQ(text);
      resetting.current = false;
    } finally { setBusy(false); }
  };
  const reset = () => { if (busy) resetting.current = true; abort.current?.abort(); setTurns([]); setFollowups([]); setFailed(null); setQ(""); memory.delete(recipeKey); };

  const fresh = turns.length === 0;
  const chips = fresh ? (step ? STARTERS_COOK : STARTERS) : followups.slice(0, 3);
  return (
    <Sheet title="AI 셰프" onClose={onClose} top={top} tall testId="ask-sheet"
      footer={<>
        {fresh && <AiNotice what="질문과 레시피, 냉장고 목록" kind="fridge" className="mb-2" />}
        <form onSubmit={(e) => void ask(q, e)} className="flex items-end gap-2">
          <textarea ref={input} rows={1} aria-label="질문" placeholder="셰프에게 물어보기" maxLength={300} value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void ask(q); } }}
            className="max-h-[120px] min-h-11 flex-1 resize-none rounded-[22px] bg-surface-2 px-4 py-[9px] text-body text-ink outline-none placeholder:text-ink-3 focus:ring-2 focus:ring-accent/30" />
          {busy ? (
            <button type="button" aria-label="멈추기" onClick={() => abort.current?.abort()}
              className="grid size-11 shrink-0 place-items-center rounded-full bg-surface-2 text-ink transition-colors active:bg-fill-pressed"><CircleStop size={22} /></button>
          ) : (
            <button type="submit" aria-label="보내기" disabled={!q.trim()}
              className="grid size-11 shrink-0 place-items-center rounded-full bg-accent text-on-accent transition-colors active:bg-accent-pressed disabled:bg-surface-2 disabled:text-ink-disabled"><ArrowUp size={22} strokeWidth={2.25} /></button>
          )}
        </form>
      </>}>
      {/* 맥락 줄 (스크롤해도 남는다) */}
      <div className="sticky top-0 z-[1] -mx-5 -mt-1 flex min-h-11 items-center justify-between gap-2 bg-surface pl-5 pr-2">
        <p className="min-w-0 truncate text-caption text-ink-3 tabular-nums">{recipe.title} · {step ? `${step}단계` : `${servings}인분`}</p>
        {!fresh && <button type="button" onClick={reset} className="inline-flex h-11 shrink-0 items-center gap-1.5 px-3 text-callout font-semibold text-accent active:opacity-60"><RotateCcw size={16} aria-hidden />새 대화</button>}
      </div>
      {fresh && <p className="pt-2 text-callout text-ink-2">이 레시피에 대해 물어보세요</p>}
      <ol className={`flex flex-col gap-3 ${!fresh || busy || failed ? "py-3" : ""}`} aria-live="polite">
        {turns.map((t, i) => (
          <Fragment key={i}>
            <li ref={i === turns.length - 1 ? lastTurn : undefined}
              className="ml-auto max-w-[80%] scroll-mt-14 whitespace-pre-line rounded-card rounded-br-badge bg-accent-soft px-4 py-2.5 text-body text-ink">{t.q}</li>
            <li className="mr-auto max-w-[88%] rounded-card rounded-bl-badge bg-surface-2 px-4 py-3 text-body text-ink" data-testid="ask-answer"><ChefText text={t.a} /></li>
          </Fragment>
        ))}
        {busy && (
          <li className="mr-auto flex gap-1 rounded-card rounded-bl-badge bg-surface-2 px-4 py-4" aria-label="답을 쓰는 중">
            <span className="size-1.5 animate-pulse rounded-full bg-ink-3" />
            <span className="size-1.5 animate-pulse rounded-full bg-ink-3 [animation-delay:150ms]" />
            <span className="size-1.5 animate-pulse rounded-full bg-ink-3 [animation-delay:300ms]" />
          </li>
        )}
        {failed && !busy && (
          <li role="alert" className="mr-auto max-w-[88%] rounded-card bg-danger-soft px-4 py-3 text-callout text-danger">
            {failed.msg}
            <button type="button" onClick={() => void ask(failed.q)} className="-my-2 ml-2 h-11 font-semibold active:opacity-60">다시 보내기</button>
          </li>
        )}
      </ol>
      {chips.length > 0 && !busy && (
        <div className={`flex gap-2 pb-3 ${fresh ? "flex-wrap pt-4" : "-mx-5 overflow-x-auto px-5 [scrollbar-width:none]"}`}>
          {chips.map((c) => <button key={c} type="button" onClick={() => void ask(c)} className={chip}>{c}</button>)}
        </div>
      )}
      <div ref={end} />
    </Sheet>
  );
}
