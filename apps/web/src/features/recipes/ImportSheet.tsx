import { useEffect, useId, useRef, useState } from "react";
import { Camera, ClipboardPaste, Film, Plus, X } from "lucide-react";
import type { ImportResult, RecipeDraft } from "@cook/shared";
import { FullScreen } from "../../components/FullScreen";
import { AiNotice } from "../../components/AiNotice";
import { Button } from "../../components/ui/Button";
import { Banner } from "../../components/ui/Banner";
import { Field, TextArea, TextField, inputBase } from "../../components/ui/Field";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { AiProgress } from "../../components/ui/Ai";
import { callWorker, workerConfigured, ApiError } from "../../lib/api";
import { prepareImage, type PreparedImage } from "../../lib/image";
import { extractFrames } from "../../lib/videoFrames";
import type { SharedPayload } from "../../lib/share";

type ImportResponse = { result: ImportResult; via: string; provider: string; model: string };
type Mode = "link" | "paste";
type Info = { title: string; body?: string };

const isYoutube = (u: string) => /(^|\.)(youtube\.com|youtu\.be)$/i.test((() => { try { return new URL(u).hostname; } catch { return ""; } })());
const VIA_LABEL: Record<string, string> = {
  youtube_description: "유튜브 설명란에서 찾았어요", youtube_video: "유튜브 영상을 보고 정리했어요", jsonld: "레시피 사이트 정보를 읽었어요",
  page: "페이지 본문에서 찾았어요", caption: "붙여넣은 글에서 찾았어요", photo: "사진에서 읽었어요",
  instagram_caption: "인스타 캡션에서 찾았어요",
};
/** 사진·영상 장면을 합쳐 한 번에 보낼 수 있는 수 */
const MAX_IMAGES = 8;
/** 영상 하나에서 뽑는 장면 수 */
const VIDEO_FRAMES = 8;
const MODES: { value: Mode; label: string }[] = [{ value: "link", label: "링크" }, { value: "paste", label: "캡션·사진" }];
const LINK_STEPS = ["페이지를 읽는 중…", "레시피를 찾는 중…", "재료와 순서를 정리하는 중…"];
const PASTE_STEPS = ["글과 사진을 읽는 중…", "레시피를 찾는 중…", "재료와 순서를 정리하는 중…"];
const TO_PASTE: Info = { title: "캡션을 붙여넣거나 스크린샷을 올려 주세요" };
/** 인스타 캡션에 레시피가 없을 때: 영상 속 화면 글자를 읽게 한다 */
const INSTA_VIDEO: Info = { title: "캡션에는 레시피가 없어요", body: "릴스를 화면 녹화해 '동영상'으로 올리면 화면 속 글자와 재료를 읽어 볼게요" };

/** 서버 문장 "A했어요. B해 주세요." → 제목 A, 본문 B */
function splitMessage(msg: string): Info {
  const m = msg.match(/^(.+?[.!?])\s+(.+)$/);
  return m ? { title: m[1].replace(/\.$/, ""), body: m[2] } : { title: msg };
}

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
  const [mode, setMode] = useState<Mode>(!startUrl && initial?.text ? "paste" : "link");
  const [url, setUrl] = useState(startUrl);
  const [text, setText] = useState(initial?.text && initial.text !== startUrl ? initial.text.replace(startUrl, "").trim() : "");
  const [images, setImages] = useState<PreparedImage[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  /** 주소 칸 바로 아래 오류 (형식·붙여넣기 권한) */
  const [urlErr, setUrlErr] = useState<string | null>(null);
  /** 서버가 이 페이지를 못 읽었을 때 (링크 탭) */
  const [unreadable, setUnreadable] = useState<string | null>(null);
  const [info, setInfo] = useState<Info | null>(null);
  /** 동영상에서 장면을 뽑는 중 */
  const [framing, setFraming] = useState(false);
  /** 올린 사진 중 영상 장면이 있는가 (서버에 "시간 순서 장면"이라고 알려 준다) */
  const [fromVideo, setFromVideo] = useState(false);
  const [miss, setMiss] = useState<ImportResult | null>(null);
  const [srcOpen, setSrcOpen] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);
  const urlId = useId();
  const canPaste = typeof navigator !== "undefined" && "clipboard" in navigator;

  useEffect(() => () => { abort.current?.abort(); images.forEach((i) => URL.revokeObjectURL(i.previewUrl)); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 사진을 모두 빼면 "영상 장면"이라는 표시도 지운다
  useEffect(() => { if (images.length === 0) setFromVideo(false); }, [images.length]);

  const clearNotes = () => { setErr(null); setUrlErr(null); setUnreadable(null); setMiss(null); };
  const switchMode = (m: Mode) => { setMode(m); clearNotes(); };
  const toPaste = (message: Info | null) => { switchMode("paste"); setInfo(message); };

  const handle = (res: ImportResponse) => {
    if (res.result.hasRecipe && res.result.recipe) onResult(res.result.recipe, VIA_LABEL[res.via] ?? "");
    else if (res.via === "instagram_caption") toPaste(INSTA_VIDEO);
    else setMiss(res.result);
  };

  const run = async <T,>(path: string, body: unknown): Promise<T | null> => {
    setBusy(true); clearNotes();
    abort.current = new AbortController();
    try { return await callWorker<T>(path, body, abort.current.signal); }
    catch (e) {
      // 취소는 입력 화면으로 조용히 돌아간다
      if (abort.current?.signal.aborted) return null;
      if (e instanceof ApiError && e.code === "instagram") toPaste(splitMessage(e.message));
      else if (e instanceof ApiError && (e.code === "empty_page" || e.code === "fetch_failed" || e.code === "not_html") && mode === "link") setUnreadable(splitMessage(e.message).title);
      else setErr(e instanceof ApiError ? e.message : "가져오지 못했습니다");
      return null;
    } finally { setBusy(false); }
  };

  const importLink = async (u = url) => {
    const target = u.trim();
    if (!/^https?:\/\//i.test(target)) { setUrlErr("http:// 또는 https:// 로 시작하는 주소를 넣어 주세요"); return; }
    const res = await run<ImportResponse>("/import/url", { url: target });
    if (res) handle(res);
  };
  const importPaste = async () => {
    const res = await run<ImportResponse>("/import/text", {
      text: text.trim() || null, url: url.trim() || null,
      images: images.map((i) => ({ mediaType: i.mediaType, data: i.data })),
      ...(fromVideo && images.length ? { frames: true } : {}),
    });
    if (res) handle(res);
  };

  // 공유로 링크가 들어왔으면 바로 가져온다 (인스타도: 공개 게시물이면 캡션을 읽어 본다).
  // 다음 틈으로 미뤄 두면, 개발 모드처럼 화면이 한 번 내려갔다 다시 올라와도 예약이 취소·재등록되어 정확히 한 번만 돈다
  useEffect(() => {
    if (!startUrl || !workerConfigured) return;
    const t = setTimeout(() => { void importLink(startUrl); }, 0);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const addFiles = async (files: FileList | null) => {
    if (!files) return;
    try {
      const room = MAX_IMAGES - images.length;
      const next: PreparedImage[] = [];
      for (const f of Array.from(files).slice(0, room)) next.push(await prepareImage(f));
      setImages((l) => [...l, ...next]);
      setMiss(null);
    } catch (e) { setErr(e instanceof Error ? e.message : "사진을 처리하지 못했습니다"); }
    finally { if (fileRef.current) fileRef.current.value = ""; }
  };

  const addVideo = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setFraming(true); setErr(null);
    try {
      const frames = await extractFrames(file, Math.min(VIDEO_FRAMES, MAX_IMAGES - images.length));
      setImages((l) => [...l, ...frames].slice(0, MAX_IMAGES));
      setFromVideo(true);
      setMiss(null);
    } catch (e) { setErr(e instanceof Error ? e.message : "영상을 처리하지 못했어요"); }
    finally { setFraming(false); if (videoRef.current) videoRef.current.value = ""; }
  };

  const pasteFromClipboard = async () => {
    try { const t = await navigator.clipboard.readText(); if (t) { setUrl(t.trim()); setUrlErr(null); setMiss(null); } }
    catch { setUrlErr("붙여넣기 권한이 없어요. 칸을 길게 눌러 붙여넣어 주세요."); }
  };

  // 배너는 한 화면에 하나 (위험 > 경고 > 정보)
  const banner = err ? (
    <Banner kind="danger" action={mode === "link" ? { label: "캡션·사진으로", onClick: () => toPaste(TO_PASTE) } : undefined}>{err}</Banner>
  ) : !workerConfigured ? (
    <Banner kind="warning" title="AI 서버가 아직 연결되지 않았어요">앱을 설치한 사람에게 알려 주세요</Banner>
  ) : mode === "link" && unreadable ? (
    <Banner kind="info" title="이 페이지는 읽을 수 없어요" action={{ label: "캡션·사진으로", onClick: () => toPaste(TO_PASTE) }}>{unreadable}</Banner>
  ) : mode === "paste" && info ? (
    <Banner kind="info" testId="import-info" title={info.title}>{info.body}</Banner>
  ) : null;

  // 못 찾아서 "AI로 만들기"를 보일 때는 하단 버튼을 숨긴다 (주 버튼 하나)
  const showFooter = !busy && !miss?.dishName;
  const footer = showFooter ? (
    <>
      <AiNotice className="mb-3" what={mode === "link" ? "링크의 글" : "붙여넣은 글과 사진"} kind={mode === "link" ? "link" : "default"} video={mode === "link"} />
      {mode === "link" ? (
        <Button ai block disabled={!url.trim() || !workerConfigured} onClick={() => importLink()}>가져오기</Button>
      ) : (
        <Button ai block disabled={(!text.trim() && images.length === 0) || !workerConfigured} onClick={importPaste}>정리하기</Button>
      )}
    </>
  ) : undefined;

  return (
    <FullScreen title="레시피 가져오기" onClose={() => { abort.current?.abort(); onClose(); }}
      confirmClose={busy ? "레시피를 정리하는 중이에요. 그만둘까요?" : null} footer={footer}>
      {busy ? (
        <AiProgress messages={mode === "link" ? LINK_STEPS : PASTE_STEPS}
          typical={mode === "link" && isYoutube(url) ? "영상까지 보면 1분 넘게 걸려요" : "보통 15~40초"}
          onCancel={() => abort.current?.abort()} />
      ) : (
        <div className="pb-4">
          <SegmentedControl role="tab" label="가져올 곳" className="mx-5 mt-2" value={mode} options={MODES} onChange={switchMode} />

          {mode === "link" ? (
            <>
              <Field label="링크" error={urlErr} htmlFor={urlId} className="mx-5 mt-5">
                <div className="relative">
                  <input id={urlId} type="url" inputMode="url" placeholder="레시피가 있는 주소" value={url} aria-invalid={urlErr ? true : undefined}
                    onChange={(e) => { setUrl(e.target.value); setUrlErr(null); setMiss(null); }}
                    className={`${inputBase} h-12 bg-surface-2 ${canPaste ? "pr-[112px]" : ""} ${urlErr ? "border-danger" : ""}`} />
                  {canPaste && (
                    <button type="button" onClick={pasteFromClipboard}
                      className="absolute right-1 top-1/2 inline-flex h-11 -translate-y-1/2 items-center gap-1.5 rounded-control px-3 text-callout font-semibold text-accent active:bg-fill-pressed">
                      <ClipboardPaste size={18} aria-hidden />붙여넣기
                    </button>
                  )}
                </div>
              </Field>
              {banner && <div className="mx-5 mt-4">{banner}</div>}
            </>
          ) : (
            <>
              {banner && <div className="mx-5 mt-4">{banner}</div>}
              <TextArea wrapClass="mx-5 mt-4" minRows={5} placeholder="캡션이나 블로그 글을 붙여넣어 주세요" aria-label="캡션·본문" maxLength={8000} value={text}
                onChange={(e) => { setText(e.target.value.slice(0, 8000)); setMiss(null); }}
                helper={text.length > 7000 ? `${text.length.toLocaleString()} / 8,000자 · 재료와 순서만 남기면 더 정확해요` : undefined} />
              <div className="mx-5 mt-4">
                <div className="flex flex-wrap gap-3">
                  {images.map((im, i) => (
                    <span key={im.previewUrl} className="relative size-16 shrink-0">
                      <img src={im.previewUrl} alt={`사진 ${i + 1}`} className="size-16 rounded-control object-cover ring-1 ring-line" />
                      <button type="button" aria-label={`사진 ${i + 1} 빼기`} onClick={() => { URL.revokeObjectURL(im.previewUrl); setImages((l) => l.filter((x) => x !== im)); }}
                        className="absolute -right-3 -top-3 grid size-11 place-items-center">
                        <span className="grid size-7 place-items-center rounded-full bg-ink/70 text-surface"><X size={16} strokeWidth={2.5} aria-hidden /></span>
                      </button>
                    </span>
                  ))}
                  {images.length < MAX_IMAGES && (
                    <button type="button" aria-label="사진 추가" onClick={() => fileRef.current?.click()}
                      className="flex size-16 shrink-0 flex-col items-center justify-center gap-0.5 rounded-control bg-surface-2 text-ink-2 transition-colors active:bg-fill-pressed">
                      <Camera size={22} aria-hidden /><span className="text-micro tabular-nums">{images.length}/{MAX_IMAGES}</span>
                    </button>
                  )}
                  {images.length < MAX_IMAGES && (
                    <button type="button" aria-label="동영상에서 장면 뽑기" onClick={() => videoRef.current?.click()} disabled={framing} aria-busy={framing}
                      className="flex size-16 shrink-0 flex-col items-center justify-center gap-0.5 rounded-control bg-surface-2 text-ink-2 transition-colors active:bg-fill-pressed disabled:opacity-60">
                      <Film size={22} aria-hidden /><span className="text-micro">{framing ? "읽는 중" : "동영상"}</span>
                    </button>
                  )}
                </div>
                <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => addFiles(e.target.files)} data-testid="import-files" />
                <input ref={videoRef} type="file" accept="video/*" className="hidden" onChange={(e) => addVideo(e.target.files)} data-testid="import-video" />
                <p className="mt-2 text-caption text-ink-3">요리책·손글씨는 사진만 올려도 돼요. 릴스·쇼츠는 화면 녹화를 '동영상'으로 올리면 장면 {VIDEO_FRAMES}장을 뽑아 화면 글자를 읽어요 (소리는 못 들어요)</p>
              </div>
              {srcOpen || url.trim() ? (
                <TextField wrapClass="mx-5 mt-5" label="원본 링크" aria-label="원본 링크" type="url" inputMode="url" placeholder="https://" value={url}
                  autoFocus={srcOpen && !url} onChange={(e) => { setUrl(e.target.value); setSrcOpen(true); }} />
              ) : (
                <Button variant="ghost" size="md" icon={<Plus size={20} aria-hidden />} className="ml-1 mt-3" onClick={() => setSrcOpen(true)}>원본 링크 추가</Button>
              )}
            </>
          )}

          {miss && (
            <div className="px-5 pt-8" data-testid="import-miss">
              <p className="text-headline text-ink">레시피를 찾지 못했어요</p>
              {miss.reason && <p className="mt-1 text-callout text-ink-2">{miss.reason}</p>}
              <div className="mt-5 flex flex-col gap-2">
                {miss.dishName && <Button ai size="md" block onClick={() => onMakeWithAi(miss.dishName!)}>‘{miss.dishName}’ AI로 만들기</Button>}
                {mode === "link" && (
                  <Button variant="secondary" size="md" block
                    onClick={() => toPaste({ title: TO_PASTE.title, body: "재료가 보이는 화면, 화면 녹화 영상, 댓글 속 레시피도 좋아요" })}>캡션·사진·영상으로 다시</Button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </FullScreen>
  );
}
