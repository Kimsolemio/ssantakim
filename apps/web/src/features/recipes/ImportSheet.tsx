import { useEffect, useRef, useState } from "react";
import type { ImportResult, RecipeDraft } from "@cook/shared";
import { FullScreen } from "../../components/FullScreen";
import { callWorker, workerConfigured, ApiError } from "../../lib/api";
import { prepareImage, type PreparedImage } from "../../lib/image";
import type { SharedPayload } from "../../lib/share";

type ImportResponse = { result: ImportResult; via: string; provider: string; model: string };
type Mode = "link" | "paste";

const isInstagram = (u: string) => /(^|\.)instagram\.com$/i.test((() => { try { return new URL(u).hostname; } catch { return ""; } })());
const isYoutube = (u: string) => /(^|\.)(youtube\.com|youtu\.be)$/i.test((() => { try { return new URL(u).hostname; } catch { return ""; } })());
const VIA_LABEL: Record<string, string> = {
  youtube_description: "유튜브 설명란에서 찾았어요", youtube_video: "유튜브 영상을 보고 정리했어요", jsonld: "레시피 사이트 정보를 읽었어요",
  page: "페이지 본문에서 찾았어요", caption: "붙여넣은 글에서 찾았어요", photo: "사진에서 읽었어요",
};

type Props = {
  initial?: SharedPayload | null;
  onClose: () => void;
  onResult: (draft: RecipeDraft, note: string) => void;
  /** 레시피를 못 찾았을 때: 요리 이름으로 AI 레시피 만들기 */
  onMakeWithAi: (dish: string) => void;
};

/** 유튜브·블로그 링크, 인스타 캡션·스크린샷, 요리책 사진 → 레시피 */
export function ImportSheet({ initial, onClose, onResult, onMakeWithAi }: Props) {
  const startUrl = initial?.url ?? "";
  const [mode, setMode] = useState<Mode>(!startUrl && initial?.text ? "paste" : startUrl && isInstagram(startUrl) ? "paste" : "link");
  const [url, setUrl] = useState(startUrl);
  const [text, setText] = useState(initial?.text && initial.text !== startUrl ? initial.text.replace(startUrl, "").trim() : "");
  const [images, setImages] = useState<PreparedImage[]>([]);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(startUrl && isInstagram(startUrl) ? "인스타그램은 링크만으로 내용을 볼 수 없어요. 게시물의 캡션을 복사해 붙여넣거나 스크린샷을 올려 주세요." : null);
  const [miss, setMiss] = useState<ImportResult | null>(null);
  const abort = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!busy) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [busy]);
  useEffect(() => () => { abort.current?.abort(); images.forEach((i) => URL.revokeObjectURL(i.previewUrl)); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toPaste = (message: string | null) => { setMode("paste"); setInfo(message); setErr(null); };

  const handle = (res: ImportResponse) => {
    if (res.result.hasRecipe && res.result.recipe) onResult(res.result.recipe, VIA_LABEL[res.via] ?? "");
    else setMiss(res.result);
  };

  const run = async <T,>(path: string, body: unknown): Promise<T | null> => {
    setBusy(true); setTick(0); setErr(null); setMiss(null);
    abort.current = new AbortController();
    try { return await callWorker<T>(path, body, abort.current.signal); }
    catch (e) {
      if (e instanceof ApiError && e.code === "instagram") toPaste(e.message);
      else if (e instanceof ApiError && (e.code === "empty_page" || e.code === "fetch_failed" || e.code === "not_html")) { setErr(e.message); }
      else setErr(e instanceof ApiError ? e.message : "가져오지 못했습니다");
      return null;
    } finally { setBusy(false); }
  };

  const importLink = async (u = url) => {
    const target = u.trim();
    if (!/^https?:\/\//i.test(target)) { setErr("http:// 또는 https:// 로 시작하는 주소를 넣어 주세요"); return; }
    if (isInstagram(target)) { toPaste("인스타그램은 링크만으로 내용을 볼 수 없어요. 게시물의 캡션을 복사해 붙여넣거나 스크린샷을 올려 주세요."); return; }
    const res = await run<ImportResponse>("/import/url", { url: target });
    if (res) handle(res);
  };
  const importPaste = async () => {
    const res = await run<ImportResponse>("/import/text", {
      text: text.trim() || null, url: url.trim() || null,
      images: images.map((i) => ({ mediaType: i.mediaType, data: i.data })),
    });
    if (res) handle(res);
  };

  // 공유로 링크가 들어왔으면 바로 가져온다 (인스타 제외).
  // 다음 틈으로 미뤄 두면, 개발 모드처럼 화면이 한 번 내려갔다 다시 올라와도 예약이 취소·재등록되어 정확히 한 번만 돈다
  useEffect(() => {
    if (!startUrl || isInstagram(startUrl) || !workerConfigured) return;
    const t = setTimeout(() => { void importLink(startUrl); }, 0);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const addFiles = async (files: FileList | null) => {
    if (!files) return;
    try {
      const room = 4 - images.length;
      const next: PreparedImage[] = [];
      for (const f of Array.from(files).slice(0, room)) next.push(await prepareImage(f));
      setImages((l) => [...l, ...next]);
    } catch (e) { setErr(e instanceof Error ? e.message : "사진을 처리하지 못했습니다"); }
    finally { if (fileRef.current) fileRef.current.value = ""; }
  };

  const pasteFromClipboard = async () => {
    try { const t = await navigator.clipboard.readText(); if (t) setUrl(t.trim()); }
    catch { setErr("붙여넣기 권한이 없어요. 주소 칸을 길게 눌러 붙여넣어 주세요."); }
  };

  const field = "w-full rounded-xl border border-orange-200 bg-white px-3 py-3 text-base outline-none focus:border-orange-400";
  const tab = (m: Mode, label: string) => (
    <button type="button" role="tab" aria-selected={mode === m} onClick={() => { setMode(m); setErr(null); }}
      className={`flex-1 py-2 text-sm font-semibold ${mode === m ? "bg-orange-500 text-white" : "bg-white text-gray-600"}`}>{label}</button>
  );

  return (
    <FullScreen title="링크·사진으로 가져오기" onClose={() => { abort.current?.abort(); onClose(); }}>
      <div className="flex flex-col gap-3 p-4">
        {!workerConfigured && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">AI 서버 주소(VITE_WORKER_URL)가 설정되지 않았습니다.</p>}
        <div className="flex overflow-hidden rounded-xl border border-orange-200" role="tablist">
          {tab("link", "🔗 링크")}
          {tab("paste", "📋 캡션·사진")}
        </div>

        {busy ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <div className="text-5xl motion-safe:animate-bounce">🍳</div>
            <p className="font-semibold">{mode === "link" ? "링크를 읽고 레시피를 정리하는 중…" : "글과 사진에서 레시피를 찾는 중…"}</p>
            <p className="text-sm text-gray-500">{tick}초{mode === "link" && isYoutube(url) ? " · 영상까지 보면 1분 넘게 걸릴 수 있어요" : " · 보통 15~40초"}</p>
            <button onClick={() => abort.current?.abort()} className="text-sm text-gray-500 underline">취소</button>
          </div>
        ) : mode === "link" ? (
          <>
            <div className="flex gap-2">
              <input className={field} type="url" inputMode="url" placeholder="유튜브·블로그·레시피 사이트 주소" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="링크" />
              {"clipboard" in navigator && <button type="button" onClick={pasteFromClipboard} className="shrink-0 rounded-xl bg-white px-3 text-sm">붙여넣기</button>}
            </div>
            <ul className="rounded-xl bg-white p-3 text-xs leading-relaxed text-gray-600">
              <li>▶️ 유튜브: 설명란의 레시피를 정리해요{" "}(설명란에 없으면 영상 분석은 Gemini 키가 있을 때만)</li>
              <li>📝 블로그·레시피 사이트: 본문을 읽어 정리해요 (네이버 블로그 포함)</li>
              <li>📸 인스타그램: 링크만으로는 못 읽어요 → "캡션·사진" 탭에서 캡션이나 스크린샷을 올려 주세요</li>
            </ul>
            <button disabled={!url.trim() || !workerConfigured} onClick={() => importLink()} className="rounded-xl bg-orange-500 py-3.5 text-lg font-semibold text-white disabled:opacity-40">가져오기</button>
          </>
        ) : (
          <>
            {info && <p className="rounded-xl bg-sky-50 p-3 text-sm text-sky-900" data-testid="import-info">{info}</p>}
            <textarea className={field + " min-h-[140px] leading-relaxed"} placeholder="인스타 캡션, 블로그 본문, 메모한 레시피를 붙여넣어 주세요" value={text} onChange={(e) => setText(e.target.value)} aria-label="캡션·본문" />
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" disabled={images.length >= 4} onClick={() => fileRef.current?.click()} className="rounded-xl bg-white px-3 py-2 text-sm font-semibold disabled:opacity-40">📷 스크린샷·사진 추가 ({images.length}/4)</button>
              <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => addFiles(e.target.files)} data-testid="import-files" />
              {images.map((im, i) => (
                <span key={im.previewUrl} className="relative h-14 w-11 overflow-hidden rounded-lg bg-white">
                  <img src={im.previewUrl} alt={`사진 ${i + 1}`} className="h-full w-full object-cover" />
                  <button type="button" aria-label={`사진 ${i + 1} 빼기`} onClick={() => { URL.revokeObjectURL(im.previewUrl); setImages((l) => l.filter((x) => x !== im)); }} className="absolute right-0 top-0 h-5 w-5 rounded-full bg-black/60 text-[10px] text-white">✕</button>
                </span>
              ))}
            </div>
            <input className={field + " text-sm"} placeholder="원본 링크 (선택, 출처로 남아요)" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="원본 링크" />
            <p className="text-xs text-gray-500">요리책이나 손글씨 레시피는 사진만 올려도 돼요.</p>
            <button disabled={(!text.trim() && images.length === 0) || !workerConfigured} onClick={importPaste} className="rounded-xl bg-orange-500 py-3.5 text-lg font-semibold text-white disabled:opacity-40">정리하기</button>
          </>
        )}

        {err && (
          <div className="rounded-xl bg-red-50 p-3 text-sm text-red-700">
            {err}
            {mode === "link" && <button type="button" onClick={() => toPaste(null)} className="ml-2 underline">캡션·사진으로 하기</button>}
          </div>
        )}
        {miss && (
          <div className="flex flex-col gap-2 rounded-2xl bg-white p-4 text-sm" data-testid="import-miss">
            <p className="font-semibold">레시피를 찾지 못했어요</p>
            <p className="text-gray-600">{miss.reason}</p>
            {miss.dishName && (
              <button type="button" onClick={() => onMakeWithAi(miss.dishName!)} className="rounded-xl bg-orange-500 py-2.5 font-semibold text-white">✨ ‘{miss.dishName}’ AI 레시피로 만들기</button>
            )}
            {mode === "link" && <button type="button" onClick={() => toPaste("영상·글 속 재료가 보이는 스크린샷을 올리거나, 댓글·고정 댓글의 레시피를 복사해 붙여넣어 보세요.")} className="rounded-xl border border-orange-300 py-2.5 font-semibold text-orange-700">📋 캡션·스크린샷으로 다시</button>}
          </div>
        )}
      </div>
    </FullScreen>
  );
}
