import { useCallback, useEffect, useRef, useState } from "react";

export type Timer = { id: string; label: string; totalMs: number; endsAt: number; done: boolean; acknowledged: boolean };

/**
 * 소리 장치는 사용자가 버튼을 누를 때(타이머 시작) 미리 만들어 깨워 둔다.
 * iOS·크롬은 터치 없이 만든 AudioContext 를 "잠든" 상태로 두어, 나중에 끝날 때 소리가 안 난다.
 */
let shared: AudioContext | null = null;
export function unlockAudio() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    shared ??= new Ctx();
    if (shared.state === "suspended") void shared.resume();
  } catch { /* 소리 실패는 무시 */ }
}

/** 짧은 알림음 (Web Audio, 파일 없음) */
function beep() {
  try {
    if (!shared) unlockAudio();
    const ctx = shared;
    if (!ctx) return;
    if (ctx.state === "suspended") void ctx.resume();
    const now = ctx.currentTime;
    [0, 0.35, 0.7].forEach((t) => {
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.type = "sine"; osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, now + t);
      gain.gain.exponentialRampToValueAtTime(0.4, now + t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + t + 0.3);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + t); osc.stop(now + t + 0.32);
    });
  } catch { /* 소리 실패는 무시 */ }
}

export function formatRemaining(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60), r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

/** 여러 타이머를 동시에 돌린다. 끝나면 소리+진동, 사용자가 확인할 때까지 표시 */
export function useTimers() {
  const [timers, setTimers] = useState<Timer[]>([]);
  const [, setTick] = useState(0);
  const seen = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (timers.length === 0) return;
    const id = setInterval(() => {
      const now = Date.now();
      setTimers((list) => {
        let changed = false;
        const next = list.map((t) => {
          if (!t.done && t.endsAt <= now) { changed = true; return { ...t, done: true }; }
          return t;
        });
        return changed ? next : list;
      });
      setTick((x) => x + 1);
    }, 250);
    return () => clearInterval(id);
  }, [timers.length]);

  useEffect(() => {
    for (const t of timers) {
      if (t.done && !seen.current.has(t.id)) {
        seen.current.add(t.id);
        beep();
        try { navigator.vibrate?.([300, 150, 300, 150, 600]); } catch { /* 미지원 */ }
      }
    }
  }, [timers]);

  const start = useCallback((label: string, minutes: number) => {
    unlockAudio();
    const id = Math.random().toString(36).slice(2);
    const totalMs = Math.round(minutes * 60 * 1000);
    setTimers((l) => [...l, { id, label, totalMs, endsAt: Date.now() + totalMs, done: false, acknowledged: false }]);
    return id;
  }, []);
  const adjust = useCallback((id: string, deltaMs: number) =>
    setTimers((l) => l.map((t) => (t.id === id && !t.done ? { ...t, endsAt: Math.max(Date.now(), t.endsAt + deltaMs), totalMs: t.totalMs + deltaMs } : t))), []);
  const remove = useCallback((id: string) => setTimers((l) => l.filter((t) => t.id !== id)), []);
  const clear = useCallback(() => setTimers([]), []);

  return { timers, start, adjust, remove, clear };
}
