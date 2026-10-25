import { useEffect, useRef, useState, type FormEvent } from "react";
import { Users } from "lucide-react";
import type { FamilyProfile, RecipeDraft } from "@cook/shared";
import { Sheet } from "../../components/Sheet";
import { AiNotice } from "../../components/AiNotice";
import { AiProgress } from "../../components/ui/Ai";
import { Banner } from "../../components/ui/Banner";
import { Button } from "../../components/ui/Button";
import { TextField } from "../../components/ui/Field";
import { Stepper } from "../../components/ui/Stepper";
import { SwitchRow } from "../../components/ui/Toggle";
import { FamilyScreen } from "../family/FamilyScreen";
import { useAiInfo } from "../../lib/aiInfo";
import { callWorker, workerConfigured, ApiError } from "../../lib/api";

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
const WAITING_SEARCH = ["인기 레시피를 찾는 중…", "레시피 여러 곳을 비교하는 중…", "우리 집에 맞게 고치는 중…", "분량을 계산하는 중…"];

type RecipeResponse = { recipe: RecipeDraft; model: string; usage: { input: number; output: number } };

/** 가족 취향 1줄: "보통 맵기 · 아이와 함께 · 오이, 고수 빼고" */
function tasteLine(p: FamilyProfile): string {
  const dis = p.dislikes.length ? `${p.dislikes.slice(0, 2).join(", ")}${p.dislikes.length > 2 ? ` 외 ${p.dislikes.length - 2}개` : ""} 빼고` : null;
  return [p.spicyLevel === "보통" ? "보통 맵기" : p.spicyLevel, p.kidsFriendly ? "아이와 함께" : null, dis].filter(Boolean).join(" · ");
}

/** 음식 이름 → AI 레시피 생성. 결과는 편집 화면으로 넘긴다. */
export function GenerateSheet({ profile, onResult, onClose, initialDish, initialNotes, initialServings, autoStart }: Props) {
  const [dish, setDish] = useState(initialDish ?? "");
  const [servings, setServings] = useState(initialServings ?? profile?.defaultServings ?? 2);
  const [notes, setNotes] = useState(initialNotes ?? "");
  // 웹에서 인기 레시피를 찾아보고 만들기 (Claude 웹 검색). 고른 값은 기억해 둔다
  const [research, setResearch] = useState(() => { try { return localStorage.getItem("cook:research") === "1"; } catch { return false; } });
  useEffect(() => { try { localStorage.setItem("cook:research", research ? "1" : "0"); } catch { /* 무시 */ } }, [research]);
  const aiInfo = useAiInfo();
  const searching = research && aiInfo.webSearch;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [nameErr, setNameErr] = useState<string | null>(null);
  const [family, setFamily] = useState(false);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!dish.trim()) { setNameErr("음식 이름을 입력하세요"); return; }
    setErr(null); setNameErr(null); setBusy(true);
    abort.current = new AbortController();
    try {
      const res = await callWorker<RecipeResponse>("/recipe", { dish: dish.trim(), servings, profile, notes: notes.trim() || null, research: research && aiInfo.webSearch }, abort.current.signal);
      onResult(res.recipe);
    } catch (e) {
      // 취소는 오류로 알리지 않는다 (입력은 그대로 남는다)
      if (!abort.current?.signal.aborted) setErr(e instanceof ApiError ? e.message : "레시피를 만들지 못했습니다");
    } finally { setBusy(false); }
  };

  // 고른 메뉴로 바로 시작. StrictMode 의 두 번 실행에도 한 번만 부르도록 예약 후 정리한다
  useEffect(() => {
    if (!autoStart || !workerConfigured) return;
    const t = setTimeout(() => { void submit(); }, 0);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <Sheet title="음식 이름으로 만들기" onClose={() => { abort.current?.abort(); onClose(); }}
        confirmClose={busy ? "레시피를 만드는 중이에요. 그만둘까요? (이미 쓴 AI 사용량은 돌아오지 않을 수 있어요)" : dish.trim() || notes.trim() ? "적은 내용이 사라져요. 닫을까요?" : null}
        footer={busy ? undefined : <>
          <AiNotice what="요리 이름과 가족 취향" webSearch={searching} />
          <Button block ai className="mt-3" disabled={!workerConfigured} onClick={() => void submit()}>레시피 만들기</Button>
        </>}>
        {busy ? (
          <AiProgress messages={searching ? WAITING_SEARCH : WAITING} typical={searching ? "보통 20~60초" : "보통 15~40초"}
            onCancel={() => abort.current?.abort()} />
        ) : (
          <form onSubmit={submit} className="flex flex-col">
            {!workerConfigured && (
              <Banner kind="warning" className="mb-4" title="AI 서버가 아직 연결되지 않았어요">앱을 설치한 사람에게 알려 주세요</Banner>
            )}
            <TextField big placeholder="예: 김치찌개, 알리오올리오" aria-label="음식 이름" value={dish} autoFocus maxLength={100}
              error={nameErr} onChange={(e) => { setDish(e.target.value); setNameErr(null); }} />
            <div className="flex items-center justify-between gap-3 py-3">
              <span className="text-body text-ink">인분</span>
              <Stepper value={servings} onChange={setServings} />
            </div>
            <TextField label="추가 요청" placeholder="예: 덜 맵게, 에어프라이어로" maxLength={500}
              value={notes} onChange={(e) => setNotes(e.target.value)} />
            {aiInfo.webSearch && (
              <div className="mt-2">
                <SwitchRow title="인기 레시피 찾아서 참고" sub="웹에서 찾아보고 출처를 함께 보여 줘요" checked={research} onChange={setResearch} />
              </div>
            )}
            {profile && (
              <button type="button" onClick={() => setFamily(true)}
                className="-mx-2 mt-1 flex min-h-11 items-center gap-1.5 self-start rounded-control px-2 text-left text-caption text-ink-3 active:bg-surface-2">
                <Users size={14} aria-hidden className="shrink-0" />{tasteLine(profile)}
              </button>
            )}
            {err && <Banner kind="danger" className="mt-3" title="레시피를 만들지 못했어요">{err}</Banner>}
            {/* 키보드의 "이동"으로도 만든다 */}
            <button type="submit" hidden aria-hidden tabIndex={-1} />
          </form>
        )}
      </Sheet>
      {family && <FamilyScreen onClose={() => setFamily(false)} />}
    </>
  );
}
