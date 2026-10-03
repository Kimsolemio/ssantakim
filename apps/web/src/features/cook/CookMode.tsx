import { useEffect, useRef, useState } from "react";
import type { Recipe } from "@cook/shared";
import { formatAmount, scaleIngredients } from "@cook/shared";
import { useBackButton } from "../../lib/useBackButton";
import { useTimers, formatRemaining } from "./useTimers";
import { useWakeLock } from "./useWakeLock";
import { useSpeak, useVoiceCommands, ttsSupported, voiceSupported } from "./useSpeech";

type Props = { recipe: Recipe; servings: number; onClose: () => void; onComplete: () => Promise<void> | void };

/** 쿡 모드: 한 화면에 한 단계, 큰 글씨, 단계 재료, 타이머, 읽어주기 */
export function CookMode({ recipe, servings, onClose, onComplete }: Props) {
  const steps = recipe.steps;
  const [idx, setIdx] = useState(0); // steps.length === 완료 화면
  const [busy, setBusy] = useState(false);
  const { timers, start, adjust, remove } = useTimers();
  const wake = useWakeLock(true);
  const { enabled: tts, setEnabled: setTts, speak, stop: stopSpeak } = useSpeak();
  const touch = useRef<{ x: number; y: number } | null>(null);
  useBackButton(true, onClose);

  const scaled = scaleIngredients(recipe.ingredients, recipe.servingsBase, servings);
  const step = idx < steps.length ? steps[idx] : null;
  const stepIngredients = step ? scaled.filter((i) => step.ingredientKeys.includes(i.key)) : [];
  const stepTimer = step ? timers.find((t) => t.label === `${step.order}단계`) : undefined;

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

  const onTouchStart = (e: React.TouchEvent) => { touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (!touch.current) return;
    const dx = e.changedTouches[0].clientX - touch.current.x, dy = e.changedTouches[0].clientY - touch.current.y;
    touch.current = null;
    if (Math.abs(dx) > 60 && Math.abs(dy) < 50) { if (dx < 0) next(); else prev(); }
  };

  const finish = async () => {
    setBusy(true);
    try { await onComplete(); stopSpeak(); onClose(); } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#1F2937] text-white" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <header className="flex items-center gap-2 px-2" style={{ paddingTop: "var(--safe-top)" }}>
        <button onClick={() => { stopSpeak(); onClose(); }} aria-label="쿡 모드 닫기" className="px-3 py-3 text-2xl leading-none text-gray-300">✕</button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-gray-300">{recipe.title} · {servings}인분</p>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-gray-600">
            <div className="h-full bg-orange-500 transition-all" style={{ width: `${(Math.min(idx + 1, steps.length) / steps.length) * 100}%` }} />
          </div>
        </div>
        {ttsSupported && (
          <button onClick={() => { const v = !tts; setTts(v); if (!v) stopSpeak(); else if (step) speak(step.text); }} aria-label="읽어주기"
            className={`rounded-full px-3 py-1.5 text-sm ${tts ? "bg-orange-500 text-white" : "bg-gray-700 text-gray-200"}`}>🔊</button>
        )}
        {voiceSupported && (
          <button onClick={() => (voice.listening ? voice.stop() : voice.start())} aria-label="음성 명령"
            className={`ml-1 rounded-full px-3 py-1.5 text-sm ${voice.listening ? "bg-red-500 text-white" : "bg-gray-700 text-gray-200"}`}>🎤</button>
        )}
      </header>

      {(wake === "unsupported" || voice.error) && (
        <p className="mx-4 mt-1 rounded-lg bg-gray-700 px-3 py-1.5 text-xs text-gray-200">
          {voice.error ?? "이 브라우저는 화면 꺼짐 방지를 지원하지 않아요. 기기 설정에서 자동 잠금을 늘려 주세요."}
        </p>
      )}

      {timers.length > 0 && (
        <div className="flex gap-2 overflow-x-auto px-4 pt-2" data-testid="timer-bar">
          {timers.map((t) => (
            <div key={t.id} className={`flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm ${t.done ? "animate-pulse bg-red-500" : "bg-gray-700"}`}>
              <span className="font-semibold">{t.label}</span>
              <span className="font-mono text-base">{t.done ? "완료!" : formatRemaining(t.endsAt - Date.now())}</span>
              {!t.done && <button onClick={() => adjust(t.id, 60_000)} className="rounded bg-gray-600 px-1.5">+1분</button>}
              <button onClick={() => remove(t.id)} aria-label="타이머 끄기" className="rounded bg-gray-600 px-1.5">✕</button>
            </div>
          ))}
        </div>
      )}

      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-4">
        {step ? (
          <>
            <p className="text-sm text-orange-400">{step.order} / {steps.length} 단계</p>
            <p className="mt-2 text-2xl font-semibold leading-relaxed" data-testid="step-text">{step.text}</p>
            {step.minutes != null && (
              <div className="mt-4">
                {stepTimer ? (
                  <p className="text-lg text-orange-300">⏱ {stepTimer.done ? "시간 끝!" : formatRemaining(stepTimer.endsAt - Date.now())}</p>
                ) : (
                  <button onClick={startStepTimer} className="rounded-xl bg-orange-500 px-4 py-2.5 text-lg font-semibold">⏱ {step.minutes}분 타이머 시작</button>
                )}
              </div>
            )}
            {stepIngredients.length > 0 && (
              <ul className="mt-5 flex flex-col gap-1.5 rounded-2xl bg-gray-700/60 p-3">
                {stepIngredients.map((i) => (
                  <li key={i.key} className="flex justify-between gap-3 text-base">
                    <span>{i.name}{i.note ? <span className="text-gray-400"> · {i.note}</span> : null}</span>
                    <span className="font-semibold text-orange-200">{formatAmount(i) || "약간"}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
            <p className="text-5xl">🍽️</p>
            <p className="text-2xl font-bold">요리 완료!</p>
            <p className="text-gray-300">맛있게 드세요. 완료를 누르면 요리 기록이 남아요.</p>
            <button disabled={busy} onClick={finish} className="rounded-xl bg-orange-500 px-6 py-3 text-lg font-semibold disabled:opacity-50">{busy ? "저장 중…" : "요리 완료"}</button>
            <p className="text-xs text-gray-400">냉장고 재료 자동 차감은 4단계에서 추가됩니다</p>
          </div>
        )}
      </main>

      <footer className="flex gap-3 px-4 pb-3" style={{ paddingBottom: "calc(var(--safe-bottom) + 12px)" }}>
        <button onClick={prev} disabled={idx === 0} className="flex-1 rounded-2xl bg-gray-700 py-4 text-lg font-semibold disabled:opacity-30">‹ 이전</button>
        {step ? (
          <button onClick={next} className="flex-[2] rounded-2xl bg-orange-500 py-4 text-lg font-semibold">{idx === steps.length - 1 ? "마무리 ›" : "다음 ›"}</button>
        ) : (
          <button onClick={() => { stopSpeak(); onClose(); }} className="flex-[2] rounded-2xl bg-gray-700 py-4 text-lg font-semibold">기록 없이 닫기</button>
        )}
      </footer>
    </div>
  );
}
