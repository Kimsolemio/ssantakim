/**
 * 요리 영상(인스타 릴스 화면 녹화 등)에서 장면 몇 장을 고르게 뽑아 사진처럼 보낸다.
 * Claude는 영상을 볼 수 없어서, 화면 글자·자막·재료가 보이는 장면을 사진으로 읽게 한다 (소리는 못 듣는다).
 * 기기 안에서만 처리하고 영상 파일 자체는 보내지 않는다.
 */
import type { PreparedImage } from "./image";

const MAX_EDGE = 1024;

function once(el: HTMLVideoElement, ok: string, ms: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { cleanup(); reject(new Error("영상을 읽는 데 너무 오래 걸려요")); }, ms);
    const done = () => { cleanup(); resolve(); };
    const fail = () => { cleanup(); reject(new Error("이 영상은 열 수 없어요. 다른 형식으로 저장해 보세요")); };
    const cleanup = () => { clearTimeout(t); el.removeEventListener(ok, done); el.removeEventListener("error", fail); };
    el.addEventListener(ok, done, { once: true });
    el.addEventListener("error", fail, { once: true });
  });
}

/** 장면을 뽑을 시각들: 앞뒤 조금 빼고 고르게 */
export function frameTimes(duration: number, count: number): number[] {
  if (!Number.isFinite(duration) || duration <= 0) return [0];
  const n = Math.max(1, Math.min(count, Math.floor(duration / 1.5) || 1));
  const start = Math.min(0.5, duration / 4), end = Math.max(start, duration - 0.3);
  if (n === 1) return [Math.min(duration / 2, end)];
  return Array.from({ length: n }, (_, i) => +(start + ((end - start) * i) / (n - 1)).toFixed(2));
}

export async function extractFrames(file: File, count: number): Promise<PreparedImage[]> {
  if (file.type && !file.type.startsWith("video/")) throw new Error("동영상 파일만 올릴 수 있어요");
  const url = URL.createObjectURL(file);
  const v = document.createElement("video");
  v.muted = true; v.playsInline = true; v.preload = "auto"; v.src = url;
  try {
    await once(v, "loadedmetadata", 15_000);
    // 일부 화면 녹화는 길이를 모른다고 나온다: 끝으로 한 번 보내면 알 수 있다
    if (!Number.isFinite(v.duration)) { v.currentTime = 1e7; await once(v, "seeked", 8_000).catch(() => {}); }
    // iOS 사파리는 한 번 재생해야 장면이 그려진다
    await v.play().catch(() => {}); v.pause();
    const scale = Math.min(1, MAX_EDGE / Math.max(v.videoWidth || 1, v.videoHeight || 1));
    const w = Math.max(1, Math.round((v.videoWidth || 720) * scale)), h = Math.max(1, Math.round((v.videoHeight || 1280) * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("이 브라우저는 영상 처리를 지원하지 않아요");
    const out: PreparedImage[] = [];
    for (const t of frameTimes(v.duration, count)) {
      v.currentTime = t;
      await once(v, "seeked", 8_000);
      ctx.drawImage(v, 0, 0, w, h);
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
  } finally {
    v.removeAttribute("src"); v.load();
    URL.revokeObjectURL(url);
  }
}
