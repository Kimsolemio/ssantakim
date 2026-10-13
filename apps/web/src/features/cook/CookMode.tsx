import { useEffect, useRef, useState } from "react";
import { CircleCheckBig, LoaderCircle, Mic, Sparkles, Timer, Volume2, X } from "lucide-react";
import type { Recipe } from "@cook/shared";
import { formatAmount, scaleIngredients } from "@cook/shared";
import { useBackButton } from "../../lib/useBackButton";
import { useTimers, formatRemaining } from "./useTimers";
import { useWakeLock } from "./useWakeLock";
import { useSpeak, useVoiceCommands, ttsSupported, voiceSupported } from "./useSpeech";
import { DarkLayers } from "../../components/Sheet";
import { AskSheet } from "../assist/AskSheet";
import { IconButton } from "../../components/ui/IconButton";
import { Button } from "../../components/ui/Button";
import { AiPill } from "../../components/ui/Ai";
import { useToast } from "../../components/ui/Toast";

type Props = { recipe: Recipe; recipeKey: string; servings: number; fridgeNames: string[]; onClose: () => void; onComplete: () => Promise<void> | void };

/** 하단 64px 버튼 (쿡 모드만) */
const bigBtn = "inline-flex h-16 items-center justify-center gap-2 rounded-control text-headline transition-[background-color,transform] duration-150 active:scale-[0.98] disabled:active:scale-100";

/** 쿡 모드: 한 화면에 한 단계, 큰 글씨, 단계 재료, 타이머, 읽어주기 */
export function CookMode({ recipe, recipeKey, servings, fridgeNames, onClose, onComplete }: Props) {
  const [asking, setAsking] = useState(false);
  const steps = recipe.steps;
  const [idx, setIdx] = useState(0); // steps.length === 완료 화면
  const [busy, setBusy] = useState(false);
  const { timers, start, adjust, remove } = useTimers();
  const wake = useWakeLock(true);
  const { enabled: tts, setEnabled: setTts, speak, stop: stopSpeak } = useSpeak();
  const toast = useToast();
  const touch = useRef<{ x: number; y: number } | null>(null);
  // 돌고 있는 타이머가 있으면 실수로 닫지 않게 묻는다
  const running = timers.filter((t) => !t.done).length;
  const tryClose = () => {
    if (running > 0 && !window.confirm(`타이머 ${running}개가 돌고 있어요. 요리 모드를 닫을까요?`)) return false;
    stopSpeak(); onClose();
    return true;
  };
  useBackButton(true, tryClose);

  const scaled = scaleIngredients(recipe.ingredients, recipe.servingsBase, servings);
  const step = idx < steps.length ? steps[idx] : null;
  const stepIngredients = step ? scaled.filter((i) => step.ingredientKeys.includes(i.key)) : [];
  const stepTimer = step ? timers.find((t) => t.label === `${step.order}단계`) : undefined;
  // 지금 단계 타이머는 본문에 크게, 나머지만 위쪽 줄에
  const otherTimers = timers.filter((t) => t !== stepTimer);

  const go = (n: number) => setIdx(Math.min(Math.max(0, n), steps.length));
  const next = () => go(idx + 1);
  const prev = () => go(idx - 1);
  const startStepTimer = () => { if (step?.minutes && !stepTimer) start(`${step.order}단계`, step.minutes); };

  const voice = useVoiceCommands((c) => {
    if (c === "next") setIdx((i) => Math.min(i + 1, steps.length));
    else if (c === "prev") setIdx((i) => Math.max(i - 1, 0));
    else if (c === "timer") startStepTimer();
    else if (c === "repeat" && step) speak(step.text);
  });

  // 단계가 바뀌면 읽어주기
  useEffect(() => {
    if (!tts) return;
    if (step) speak(`${step.order}단계. ${step.text}`);
    else speak("요리가 끝났어요. 맛있게 드세요.");
  }, [idx, tts]); // eslint-disable-line react-hooks/exhaustive-deps

  // 화면 꺼짐 방지·음성 오류는 고정 상자 대신 토스트로 잠깐
  useEffect(() => { if (wake === "unsupported") toast.show("화면이 꺼지지 않게 자동 잠금 시간을 늘려 주세요", { raised: true }); }, [wake]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (voice.error) toast.show(voice.error, { kind: "error", raised: true }); }, [voice.error]); // eslint-disable-line react-hooks/exhaustive-deps

  // 시트(AI 셰프 등)는 body로 띄워도 React 이벤트는 여기까지 올라온다. 쿡 화면에서 민 것만 단계 이동으로 본다
  const own = (e: React.TouchEvent) => e.currentTarget.contains(e.target as Node);
  const onTouchStart = (e: React.TouchEvent) => { if (!own(e)) { touch.current = null; return; } touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (!touch.current) return;
    const dx = e.changedTouches[0].clientX - touch.current.x, dy = e.changedTouches[0].clientY - touch.current.y;
    touch.current = null;
    if (Math.abs(dx) > 60 && Math.abs(dy) < 50) { if (dx < 0) next(); else prev(); }
  };

  const finish = async () => {
    setBusy(true);
    if (running > 0 && !window.confirm(`타이머 ${running}개가 아직 돌고 있어요. 요리를 마칠까요?`)) { setBusy(false); return; }
    try { await onComplete(); stopSpeak(); onClose(); } finally { setBusy(false); }
  };

  return (
    <div className="theme-dark fixed inset-0 z-50 flex flex-col bg-canvas text-ink" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <header className="mx-auto w-full max-w-2xl shrink-0" style={{ paddingTop: "var(--safe-top)" }}>
        <div className="flex h-14 items-center gap-1 px-1">
          <IconButton tone="dark" onClick={tryClose} aria-label="쿡 모드 닫기"><X size={26} /></IconButton>
          <p className="min-w-0 flex-1 truncate px-1 text-caption text-ink-2">{recipe.title} · {servings}인분</p>
          {ttsSupported && (
            <IconButton tone="filled-dark" aria-label="읽어주기" aria-pressed={tts}
              onClick={() => { const v = !tts; setTts(v); if (!v) stopSpeak(); else if (step) speak(step.text); }}><Volume2 size={22} /></IconButton>
          )}
          {voiceSupported && (
            <IconButton tone={voice.listening ? "dark" : "filled-dark"} aria-label="음성 명령" className={voice.listening ? "bg-danger" : ""}
              onClick={() => (voice.listening ? voice.stop() : voice.start())}><Mic size={22} /></IconButton>
          )}
        </div>
        <div aria-hidden className="mx-4 mt-1 flex gap-1">
          {steps.map((s, k) => <span key={s.order} className={`h-1 flex-1 rounded-full transition-colors ${k <= idx ? "bg-accent" : "bg-ink/15"}`} />)}
        </div>
      </header>

      {step && otherTimers.length > 0 && (
        <div className="mx-auto flex w-full max-w-2xl shrink-0 gap-2 overflow-x-auto px-4 pt-3 [scrollbar-width:none]" data-testid="timer-bar">
          {otherTimers.map((t) => (
            <div key={t.id} className={`flex h-11 shrink-0 items-center gap-1 rounded-full pl-4 text-callout ${t.done ? "bg-danger text-white motion-safe:animate-pulse" : "bg-surface-2 text-ink"}`}>
              <span className="font-semibold tabular-nums">{t.label} {t.done ? "끝" : formatRemaining(t.endsAt - Date.now())}</span>
              <IconButton tone="dark" onClick={() => remove(t.id)} aria-label={`${t.label} 타이머 끄기`}><X size={16} /></IconButton>
            </div>
          ))}
        </div>
      )}

      <main className="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col overflow-y-auto px-5 pb-6 pt-6">
        {step ? (
          <>
            <p className="text-caption font-semibold text-ink-3 tabular-nums">{step.order} / {steps.length} 단계</p>
            <p className="mt-2 text-cook text-ink" data-testid="step-text">{step.text}</p>
            {step.minutes != null && (
              <div className="mt-6">
                {stepTimer ? (
                  <div className="flex items-center justify-between gap-3" data-testid="step-timer">
                    <p className={`text-timer tabular-nums ${stepTimer.done ? "text-danger" : "text-ink"}`}>{stepTimer.done ? "시간 끝" : formatRemaining(stepTimer.endsAt - Date.now())}</p>
                    <div className="flex shrink-0 gap-2">
                      {!stepTimer.done && <Button variant="ghost" size="md" onClick={() => adjust(stepTimer.id, 60_000)}>+1분</Button>}
                      <Button variant="ghost" size="md" onClick={() => remove(stepTimer.id)}>끄기</Button>
                    </div>
                  </div>
                ) : (
                  <button type="button" onClick={startStepTimer}
                    className="inline-flex h-14 items-center gap-2 rounded-control bg-surface-2 px-5 text-headline text-ink transition-[background-color,transform] duration-150 active:scale-[0.98] active:bg-fill-pressed">
                    <Timer size={22} aria-hidden />{step.minutes}분 타이머 시작
                  </button>
                )}
              </div>
            )}
            {stepIngredients.length > 0 && (
              <ul className="mt-6 rounded-card bg-surface p-4">
                {stepIngredients.map((i) => (
                  <li key={i.key} className="flex justify-between gap-3 py-1.5 text-body">
                    <span className="min-w-0 text-ink-2">{i.name}{i.note ? <span className="text-ink-3"> · {i.note}</span> : null}</span>
                    <span className="shrink-0 font-semibold text-ink tabular-nums">{formatAmount(i) || "약간"}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center text-center">
            <span className="grid size-24 place-items-center rounded-full bg-surface-2"><CircleCheckBig size={48} className="text-accent" aria-hidden /></span>
            <p className="mt-6 text-title1 text-ink">요리 완료!</p>
            <p className="mt-2 text-callout text-ink-2">쓴 재료를 냉장고에서 빼 드릴게요</p>
          </div>
        )}
      </main>

      <footer data-toast-anchor className="mx-auto flex w-full max-w-2xl shrink-0 flex-col gap-3 px-4 pt-3" style={{ paddingBottom: "calc(var(--safe-bottom) + 12px)" }}>
        {step && (
          <AiPill onClick={() => setAsking(true)} aria-label="AI 셰프에게 묻기" className="inline-flex items-center gap-2 self-center">
            <Sparkles size={18} strokeWidth={2} aria-hidden />AI 셰프에게 묻기
          </AiPill>
        )}
        <div className="flex gap-3">
          <button type="button" onClick={prev} disabled={idx === 0} className={`${bigBtn} flex-1 bg-surface-2 text-ink active:bg-fill-pressed disabled:text-ink-disabled`}>이전</button>
          {step ? (
            <button type="button" onClick={next} className={`${bigBtn} flex-[2] bg-accent text-on-accent active:bg-accent-pressed`}>{idx === steps.length - 1 ? "마무리" : "다음"}</button>
          ) : (
            <button type="button" disabled={busy} aria-busy={busy || undefined} onClick={finish} className={`${bigBtn} flex-[2] bg-accent text-on-accent active:bg-accent-pressed`}>
              {busy ? <><LoaderCircle size={20} className="animate-spin" aria-hidden />저장 중…</> : "재료 정리하고 끝내기"}
            </button>
          )}
        </div>
      </footer>
      {asking && <DarkLayers><AskSheet recipe={recipe} recipeKey={recipeKey} servings={servings} step={step?.order ?? null} fridge={fridgeNames} onClose={() => setAsking(false)} top /></DarkLayers>}
    </div>
  );
}
