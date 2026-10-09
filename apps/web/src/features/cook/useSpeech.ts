import { useCallback, useEffect, useRef, useState } from "react";

export const ttsSupported = typeof window !== "undefined" && "speechSynthesis" in window;

/** 현재 단계 읽어주기 (기기 내장 TTS, ko-KR) */
export function useSpeak() {
  const [enabled, setEnabled] = useState(false);
  const speak = useCallback((text: string) => {
    if (!ttsSupported) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "ko-KR"; u.rate = 1;
    const ko = window.speechSynthesis.getVoices().find((v) => v.lang.startsWith("ko"));
    if (ko) u.voice = ko;
    window.speechSynthesis.speak(u);
  }, []);
  const stop = useCallback(() => { if (ttsSupported) window.speechSynthesis.cancel(); }, []);
  useEffect(() => () => stop(), [stop]);
  return { enabled, setEnabled, speak, stop };
}

type RecognitionLike = {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>>; resultIndex: number }) => void) | null;
  onend: (() => void) | null; onerror: ((e: { error?: string }) => void) | null;
  start: () => void; stop: () => void; abort: () => void;
};
function getRecognitionCtor(): (new () => RecognitionLike) | null {
  const w = window as unknown as { SpeechRecognition?: new () => RecognitionLike; webkitSpeechRecognition?: new () => RecognitionLike };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}
export const voiceSupported = typeof window !== "undefined" && getRecognitionCtor() !== null;

export type VoiceCommand = "next" | "prev" | "timer" | "repeat";

/** "다음", "이전", "타이머", "다시" 음성 명령 (크롬/안드로이드. iOS 사파리는 미지원이라 버튼 숨김) */
export function useVoiceCommands(onCommand: (c: VoiceCommand) => void) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<RecognitionLike | null>(null);
  const cb = useRef(onCommand); cb.current = onCommand;
  const wantRef = useRef(false);

  const stop = useCallback(() => { wantRef.current = false; rec.current?.abort(); rec.current = null; setListening(false); }, []);
  const start = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;
    const r = new Ctor();
    r.lang = "ko-KR"; r.continuous = true; r.interimResults = false;
    r.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const text = (e.results[i][0]?.transcript ?? "").replace(/\s/g, "");
        if (/다음|넥스트/.test(text)) cb.current("next");
        else if (/이전|뒤로/.test(text)) cb.current("prev");
        else if (/타이머|시작/.test(text)) cb.current("timer");
        else if (/다시|반복/.test(text)) cb.current("repeat");
      }
    };
    r.onerror = (e) => { if (e.error === "not-allowed") { setError("마이크 권한이 필요합니다"); wantRef.current = false; setListening(false); } };
    r.onend = () => { if (wantRef.current) { try { r.start(); } catch { /* 재시작 실패 */ } } else setListening(false); };
    rec.current = r; wantRef.current = true; setError(null);
    try { r.start(); setListening(true); } catch { setListening(false); }
  }, []);
  useEffect(() => () => { wantRef.current = false; rec.current?.abort(); }, []);
  return { listening, error, start, stop };
}
