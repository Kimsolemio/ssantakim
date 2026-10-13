/**
 * 메뉴 추천 요청은 탭을 옮겨도 끊기지 않게 화면 밖(모듈)에서 돌린다.
 * 고른 조건(꼭 쓰기·분위기·빼기·인분)도 앱을 켜 둔 동안 기억한다.
 */
import { useSyncExternalStore } from "react";
import type { MenuSuggestion } from "@cook/shared";
import { callWorker, ApiError } from "../../lib/api";
import { loadPending, savePending } from "../../lib/drafts";

export type SuggestResponse = { suggestions: MenuSuggestion[]; dropped: number };
export type Saved = { suggestions: MenuSuggestion[]; at: number; shown: string[]; added: string[]; dropped?: number };
export type Inputs = { mustUse: string[]; moods: string[]; moodText: string; exclude: string[]; excludeText: string; servings: number | null };

type Run = { busy: boolean; startedAt: number | null; error: string | null; version: number };

let run: Run = { busy: false, startedAt: null, error: null, version: 0 };
let controller: AbortController | null = null;
const listeners = new Set<() => void>();
const emit = (patch: Partial<Run>) => { run = { ...run, ...patch, version: run.version + 1 }; listeners.forEach((l) => l()); };

export function useSuggestRun(): Run {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => run);
}

export const savedName = (familyId: string) => `today:${familyId}`;
export const loadSaved = (familyId: string) => loadPending<Saved>(savedName(familyId));
export function writeSaved(familyId: string, s: Saved) { savePending(savedName(familyId), s); emit({}); }

let inputs: Inputs = { mustUse: [], moods: [], moodText: "", exclude: [], excludeText: "", servings: null };
export const getInputs = () => inputs;
export const setInputs = (patch: Partial<Inputs>) => { inputs = { ...inputs, ...patch }; };

export async function startSuggest(familyId: string, body: Record<string, unknown>, shown: string[]): Promise<void> {
  if (run.busy) return;
  controller = new AbortController();
  emit({ busy: true, startedAt: Date.now(), error: null });
  try {
    const res = await callWorker<SuggestResponse>("/suggest", body, controller.signal);
    writeSaved(familyId, { suggestions: res.suggestions, at: Date.now(), shown, added: [], dropped: res.dropped });
    emit({ busy: false, error: res.suggestions.length === 0 ? "조건에 맞는 메뉴를 찾지 못했어요. 꼭 쓰기·빼기 재료를 줄여 보세요" : null });
  } catch (e) {
    const cancelled = controller?.signal.aborted;
    emit({ busy: false, error: cancelled ? null : e instanceof ApiError ? e.message : "추천을 받지 못했어요" });
  } finally {
    controller = null;
  }
}

export function cancelSuggest() { controller?.abort(); }
