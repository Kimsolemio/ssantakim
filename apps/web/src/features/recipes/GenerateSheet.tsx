import { useEffect, useRef, useState, type FormEvent } from "react";
import type { FamilyProfile, RecipeDraft } from "@cook/shared";
import { Sheet } from "../../components/Sheet";
import { callWorker, workerConfigured, ApiError } from "../../lib/api";
import { ServingsStepper } from "./RecipeDetail";

type Props = { profile: FamilyProfile | null; onResult: (draft: RecipeDraft) => void; onClose: () => void };

const WAITING = ["재료를 고르는 중…", "분량을 계산하는 중…", "조리 순서를 정리하는 중…", "팁을 적는 중…", "마무리 중…"];

type RecipeResponse = { recipe: RecipeDraft; model: string; usage: { input: number; output: number } };

/** 음식 이름 → AI 레시피 생성. 결과는 편집 화면으로 넘긴다. */
export function GenerateSheet({ profile, onResult, onClose }: Props) {
  const [dish, setDish] = useState("");
  const [servings, setServings] = useState(profile?.defaultServings ?? 2);
  const [notes, setNotes] = useState("");
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

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!dish.trim()) { setErr("음식 이름을 입력하세요"); return; }
    setErr(null); setBusy(true); setTick(0);
    abort.current = new AbortController();
    try {
      const res = await callWorker<RecipeResponse>("/recipe", { dish: dish.trim(), servings, profile, notes: notes.trim() || null }, abort.current.signal);
      onResult(res.recipe);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "레시피를 만들지 못했습니다");
    } finally { setBusy(false); }
  };

  const field = "w-full rounded-xl border border-orange-200 bg-white px-3 py-3 text-base outline-none focus:border-orange-400";

  return (
    <Sheet title="AI 레시피 만들기" onClose={() => { abort.current?.abort(); onClose(); }}>
      {!workerConfigured && (
        <p className="mb-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">AI 서버 주소가 설정되지 않았습니다. <code>apps/web/.env</code>의 <code>VITE_WORKER_URL</code>을 채우세요.</p>
      )}
      <form onSubmit={submit} className="flex flex-col gap-3">
        <input className={field} placeholder="예: 알리오올리오, 김치찌개, 닭볶음탕" value={dish} onChange={(e) => setDish(e.target.value)} autoFocus disabled={busy} />
        <div className="flex items-center justify-between rounded-xl bg-white px-3 py-2">
          <span className="text-sm text-gray-600">인분</span>
          <ServingsStepper value={servings} onChange={setServings} />
        </div>
        <input className={field} placeholder="추가 요청 (선택: 덜 맵게, 에어프라이어로, 15분 안에)" value={notes} onChange={(e) => setNotes(e.target.value)} disabled={busy} />
        {profile && (
          <p className="text-xs text-gray-500">가족 취향 반영: {profile.spicyLevel}{profile.kidsFriendly ? " · 아이 있음" : ""}{profile.allergies.length ? ` · 알레르기 ${profile.allergies.join(", ")}` : ""}</p>
        )}
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
