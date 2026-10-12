import { useEffect, useRef, useState, type FormEvent } from "react";
import type { FamilyProfile, RecipeDraft } from "@cook/shared";
import { Sheet } from "../../components/Sheet";
import { AiNotice } from "../../components/AiNotice";
import { useAiInfo } from "../../lib/aiInfo";
import { callWorker, workerConfigured, ApiError } from "../../lib/api";
import { ServingsStepper } from "./RecipeDetail";

type Props = {
  profile: FamilyProfile | null;
  onResult: (draft: RecipeDraft) => void;
  onClose: () => void;
  initialDish?: string;
  initialNotes?: string;
  initialServings?: number;
  /** 열자마자 만들기 시작 ("오늘 뭐 먹지"에서 고른 메뉴) */
  autoStart?: boolean;
};

const WAITING = ["재료를 고르는 중…", "분량을 계산하는 중…", "조리 순서를 정리하는 중…", "팁을 적는 중…", "마무리 중…"];

type RecipeResponse = { recipe: RecipeDraft; model: string; usage: { input: number; output: number } };

/** 음식 이름 → AI 레시피 생성. 결과는 편집 화면으로 넘긴다. */
export function GenerateSheet({ profile, onResult, onClose, initialDish, initialNotes, initialServings, autoStart }: Props) {
  const [dish, setDish] = useState(initialDish ?? "");
  const [servings, setServings] = useState(initialServings ?? profile?.defaultServings ?? 2);
  const [notes, setNotes] = useState(initialNotes ?? "");
  // 웹에서 인기 레시피를 찾아보고 만들기 (Claude 웹 검색). 고른 값은 기억해 둔다
  const [research, setResearch] = useState(() => { try { return localStorage.getItem("cook:research") === "1"; } catch { return false; } });
  useEffect(() => { try { localStorage.setItem("cook:research", research ? "1" : "0"); } catch { /* 무시 */ } }, [research]);
  const aiInfo = useAiInfo();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!busy) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [busy]);
  useEffect(() => () => abort.current?.abort(), []);

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!dish.trim()) { setErr("음식 이름을 입력하세요"); return; }
    setErr(null); setBusy(true); setTick(0);
    abort.current = new AbortController();
    try {
      const res = await callWorker<RecipeResponse>("/recipe", { dish: dish.trim(), servings, profile, notes: notes.trim() || null, research: research && aiInfo.webSearch }, abort.current.signal);
      onResult(res.recipe);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "레시피를 만들지 못했습니다");
    } finally { setBusy(false); }
  };

  // 고른 메뉴로 바로 시작. StrictMode 의 두 번 실행에도 한 번만 부르도록 예약 후 정리한다
  useEffect(() => {
    if (!autoStart || !workerConfigured) return;
    const t = setTimeout(() => { void submit(); }, 0);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const field = "w-full rounded-xl border border-orange-200 bg-white px-3 py-3 text-base outline-none focus:border-orange-400";

  return (
    <Sheet title="AI 레시피 만들기" onClose={() => { abort.current?.abort(); onClose(); }}
      confirmClose={busy ? "레시피를 만드는 중이에요. 그만둘까요? (이미 쓴 AI 사용량은 돌아오지 않을 수 있어요)" : null}>
      {!workerConfigured && (
        <p className="mb-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">AI 서버가 아직 연결되지 않았어요. 앱을 설치한 사람에게 알려 주세요 (README "Worker 배포").</p>
      )}
      <form onSubmit={submit} className="flex flex-col gap-3">
        <input className={field} placeholder="예: 알리오올리오, 김치찌개, 닭볶음탕" value={dish} onChange={(e) => setDish(e.target.value)} autoFocus disabled={busy} maxLength={100} />
        <div className="flex items-center justify-between rounded-xl bg-white px-3 py-2">
          <span className="text-sm text-gray-600">인분</span>
          <ServingsStepper value={servings} onChange={setServings} />
        </div>
        <input className={field} placeholder="추가 요청 (선택: 덜 맵게, 에어프라이어로, 15분 안에)" value={notes} onChange={(e) => setNotes(e.target.value)} disabled={busy} maxLength={500} />
        {profile && (
          <p className="text-xs text-gray-500">가족 취향 반영: {profile.spicyLevel}{profile.kidsFriendly ? " · 아이 있음" : ""}{profile.dislikes.length ? ` · 피할 재료 ${profile.dislikes.join(", ")}` : ""}</p>
        )}
        {aiInfo.webSearch && (
          <label className="flex items-start gap-2 rounded-xl bg-white px-3 py-2.5 text-sm">
            <input type="checkbox" className="mt-0.5 h-5 w-5 accent-orange-500" checked={research} onChange={(e) => setResearch(e.target.checked)} disabled={busy} />
            <span><b>🔎 인기 레시피 찾아보고 만들기</b><br /><span className="text-xs text-gray-500">웹에서 평이 좋은 레시피를 비교해 정리해요. 30초쯤 더 걸리고 AI를 2회 써요. 참고한 글은 레시피에 남아요.</span></span>
          </label>
        )}
        <AiNotice what="요리 이름과 가족 취향" />
        {err && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{err}</p>}
        {busy ? (
          <div className="flex items-center justify-between rounded-xl bg-orange-50 px-4 py-3 text-sm text-orange-800">
            <span>🍳 {WAITING[Math.min(Math.floor(tick / 6), WAITING.length - 1)]} ({tick}초)</span>
            <button type="button" className="text-gray-500" onClick={() => abort.current?.abort()}>취소</button>
          </div>
        ) : (
          <button disabled={!workerConfigured} className="rounded-xl bg-orange-500 py-3 font-semibold text-white disabled:opacity-50">레시피 만들기</button>
        )}
      </form>
    </Sheet>
  );
}
