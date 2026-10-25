/**
 * 요리 영상(인스타 릴스 화면 녹화 등)에서 장면 몇 장을 고르게 뽑아 사진처럼 보낸다.
 * Claude는 영상을 볼 수 없어서, 화면 글자·자막·재료가 보이는 장면을 사진으로 읽게 한다 (소리는 못 듣는다).
 * 기기 안에서만 처리하고 영상 파일 자체는 보내지 않는다.
 */
import type { PreparedImage } from "./image";

const MAX_EDGE = 768;

const aborted = () => new DOMException("취소되었습니다", "AbortError");

function once(el: HTMLVideoElement, ok: string, ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(aborted());
    const t = setTimeout(() => { cleanup(); reject(new Error("영상을 읽는 데 너무 오래 걸려요")); }, ms);
    const done = () => { cleanup(); resolve(); };
    const fail = () => { cleanup(); reject(new Error("이 영상은 열 수 없어요. 다른 형식으로 저장해 보세요")); };
    const stop = () => { cleanup(); reject(aborted()); };
    const cleanup = () => { clearTimeout(t); el.removeEventListener(ok, done); el.removeEventListener("error", fail); signal?.removeEventListener("abort", stop); };
    el.addEventListener(ok, done, { once: true });
    el.addEventListener("error", fail, { once: true });
    signal?.addEventListener("abort", stop, { once: true });
  });
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * 옮긴 장면이 실제로 그려질 때까지 (iOS는 seeked 직후 이전 장면을 그리기도 한다).
 * 옮기기 전에 불러 둬야 새 장면이 그려지는 순간을 놓치지 않는다. 돌려준 함수는 seeked 뒤에 기다린다.
 */
function armFrame(v: HTMLVideoElement, t: number): () => Promise<void> {
  type FrameCb = (now: number, meta: { mediaTime: number }) => void;
  const rvfc = (v as HTMLVideoElement & { requestVideoFrameCallback?: (cb: FrameCb) => number }).requestVideoFrameCallback;
  if (rvfc) {
    // 앞 장면이 한 번 더 그려지면 (옮길 시각에서 먼 장면) 다음 그려짐을 기다린다
    const painted = new Promise<void>((r) => {
      const cb: FrameCb = (_, meta) => (Math.abs(meta.mediaTime - t) < 0.5 ? r() : rvfc.call(v, cb));
      rvfc.call(v, cb);
    });
    return () => Promise.race([painted, sleep(400)]);
  }
  return () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
}

/** 장면을 뽑을 시각들: 앞뒤 조금 빼고 고르게 (1.5초에 한 장보다 촘촘하게는 뽑지 않는다) */
export function frameTimes(duration: number, count: number): number[] {
  if (!Number.isFinite(duration) || duration <= 0) return [0];
  const n = Math.max(1, Math.min(count, Math.floor(duration / 1.5) || 1));
  const start = Math.min(0.5, duration / 4), end = Math.max(start, duration - 0.3);
  if (n === 1) return [Math.min(duration / 2, end)];
  return Array.from({ length: n }, (_, i) => +(start + ((end - start) * i) / (n - 1)).toFixed(2));
}

const SIG = 48;
/** 48×48 흑백으로 줄인 밝기: 앞 장면과 똑같으면(멈춘 화면) 빼려고 */
function signature(ctx: CanvasRenderingContext2D, src: HTMLCanvasElement): Uint8Array {
  ctx.drawImage(src, 0, 0, SIG, SIG);
  const d = ctx.getImageData(0, 0, SIG, SIG).data, out = new Uint8Array(SIG * SIG);
  for (let i = 0; i < out.length; i++) out[i] = (d[i * 4] * 3 + d[i * 4 + 1] * 6 + d[i * 4 + 2]) / 10;
  return out;
}
/** 글자 몇 개만 바뀌어도 다른 장면으로 본다 (재료 카드는 배경은 그대로 글자만 바뀐다): 크게 바뀐 점이 몇 개라도 있으면 다르다 */
export function differs(a: Uint8Array, b: Uint8Array): boolean {
  let changed = 0;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 28 && ++changed >= 3) return true;
  return false;
}

/** signal: 취소하면 다음 장면으로 넘어가기 전에 멈춘다 (AbortError) */
export async function extractFrames(file: File, count: number, signal?: AbortSignal): Promise<PreparedImage[]> {
  if (file.type && !file.type.startsWith("video/")) throw new Error("동영상 파일만 올릴 수 있어요");
  const url = URL.createObjectURL(file);
  const v = document.createElement("video");
  v.muted = true; v.playsInline = true; v.preload = "auto"; v.src = url;
  const out: PreparedImage[] = [];
  try {
    await once(v, "loadedmetadata", 15_000, signal);
    // 일부 화면 녹화는 길이를 모른다고 나온다: 끝으로 한 번 보내면 알 수 있다
    if (!Number.isFinite(v.duration)) { v.currentTime = 1e7; await once(v, "seeked", 8_000, signal).catch((e) => { if (signal?.aborted) throw e; }); }
    let duration = v.duration;
    if (!Number.isFinite(duration) && v.seekable.length) duration = v.seekable.end(v.seekable.length - 1);
    // iOS 사파리는 한 번 재생해야 장면이 그려진다 (재생이 안 끝나도 1.5초 뒤 넘어간다)
    await Promise.race([v.play().catch(() => {}), sleep(1500)]); v.pause();
    if (!v.videoWidth || !v.videoHeight) throw new Error("영상 화면을 읽지 못했어요. 다른 형식(MP4)으로 저장해 보세요");
    const scale = Math.min(1, MAX_EDGE / Math.max(v.videoWidth, v.videoHeight));
    const w = Math.max(1, Math.round(v.videoWidth * scale)), h = Math.max(1, Math.round(v.videoHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    const tiny = document.createElement("canvas"); tiny.width = SIG; tiny.height = SIG;
    const tctx = tiny.getContext("2d", { willReadFrequently: true });
    if (!ctx || !tctx) throw new Error("이 브라우저는 영상 처리를 지원하지 않아요");
    let last: Uint8Array | null = null;
    for (const t of frameTimes(duration, count)) {
      if (signal?.aborted) throw aborted();
      const ready = armFrame(v, t);
      v.currentTime = t;
      await once(v, "seeked", 8_000, signal);
      await ready();
      ctx.drawImage(v, 0, 0, w, h);
      // 앞 장면과 거의 같으면 (가만히 있는 화면) 빼고 다음으로
      const sig = signature(tctx, canvas);
      if (last && !differs(last, sig)) continue;
      last = sig;
      const blob = await new Promise<Blob>((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error("장면 변환 실패"))), "image/jpeg", 0.75));
      const data = await new Promise<string>((ok, fail) => {
        const r = new FileReader();
        r.onload = () => ok(String(r.result).replace(/^data:[^,]*,/, ""));
        r.onerror = () => fail(new Error("장면 읽기 실패"));
        r.readAsDataURL(blob);
      });
      out.push({ mediaType: "image/jpeg", data, previewUrl: URL.createObjectURL(blob), width: w, height: h, bytes: blob.size });
    }
    return out;
  } catch (e) {
    out.forEach((f) => URL.revokeObjectURL(f.previewUrl));
    throw e;
  } finally {
    v.removeAttribute("src"); v.load();
    URL.revokeObjectURL(url);
  }
}
