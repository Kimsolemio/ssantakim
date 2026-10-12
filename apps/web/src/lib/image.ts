/**
 * 사진을 AI에 보내기 좋은 크기의 JPEG(base64)로 줄인다.
 * - 영수증은 길쭉해서 "긴 변" 기준만 쓰면 글자가 작아지므로 전체 픽셀 수로도 제한한다.
 * - Claude는 긴 변 2576px까지 그대로 본다. 요청 크기와 Worker CPU를 생각해 약 2.2MP로 맞춘다.
 */
export type PreparedImage = {
  mediaType: "image/jpeg";
  data: string;        // base64, data: 접두사 없음
  previewUrl: string;  // 미리보기용 object URL
  width: number;
  height: number;
  bytes: number;
};

const MAX_EDGE = 2400;
const MAX_PIXELS = 2_200_000;
const TARGET_BYTES = 1_200_000;

async function loadBitmap(file: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  if ("createImageBitmap" in window) {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
    } catch { /* 아래 방식으로 다시 시도 */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    await new Promise<void>((ok, fail) => { img.onload = () => ok(); img.onerror = () => fail(new Error("사진을 열 수 없습니다")); img.src = url; });
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch (e) { URL.revokeObjectURL(url); throw e; }
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error("사진 변환 실패"))), "image/jpeg", quality));
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((ok, fail) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).replace(/^data:[^,]*,/, ""));
    r.onerror = () => fail(new Error("사진 읽기 실패"));
    r.readAsDataURL(blob);
  });
}

export async function prepareImage(file: Blob): Promise<PreparedImage> {
  if (file.type && !file.type.startsWith("image/")) throw new Error("사진 파일만 올릴 수 있습니다");
  const bmp = await loadBitmap(file);
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height), Math.sqrt(MAX_PIXELS / (bmp.width * bmp.height)));
    const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("이 브라우저는 사진 처리를 지원하지 않습니다");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h); // 투명 PNG 캡처 대비
    ctx.drawImage(bmp.source, 0, 0, w, h);
    let blob = await toBlob(canvas, 0.82);
    if (blob.size > TARGET_BYTES) blob = await toBlob(canvas, 0.65);
    return { mediaType: "image/jpeg", data: await blobToBase64(blob), previewUrl: URL.createObjectURL(blob), width: w, height: h, bytes: blob.size };
  } finally { bmp.close(); }
}
