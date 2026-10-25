/**
 * 실제 인스타 게시물로 점검 (.github/workflows/instagram-probe.yml). 주소가 있을 때만 돈다.
 *   COOK_INSTAGRAM_URL=https://www.instagram.com/p/... [COOK_ANTHROPIC_API_KEY=sk-ant-...] pnpm --filter @cook/worker exec vitest run instagram-live
 * 이 컴퓨터에서 직접 읽기 + (키가 있으면) Claude 웹 읽기, 링크 가져오기, 릴스 영상 장면으로 레시피 정리까지 결과만 적는다.
 * 장면 뽑기는 앱(브라우저) 대신 ffmpeg 로 같은 간격·크기로 한다. 실패로 끝나지 않는다.
 */
import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "vitest";
import { claudeProvider } from "../src/ai/claude";
import { importFromText, importFromUrl } from "../src/import";
import { fetchInstagramVideo, instagramPost, instagramShortcode, resolveInstagramUrl } from "../src/instagram";
import { PAGE_READ_PROMPT } from "../src/prompts";

const url = process.env.COOK_INSTAGRAM_URL;
const key = process.env.COOK_ANTHROPIC_API_KEY;

describe.skipIf(!url)("live Instagram", () => {
  it("reads the post from this machine", async () => {
    const resolved = await resolveInstagramUrl(url!, fetch);
    const p = await instagramPost(resolved.url, fetch);
    console.log("THIS MACHINE", JSON.stringify({ resolved, blocked: p.blocked, missing: p.missing, caption: p.post?.caption?.slice(0, 300) ?? null, username: p.post?.username ?? null, image: !!p.post?.image }));
  }, 60_000);

  it.skipIf(!key)("lets Claude read the embed page", async () => {
    const resolved = await resolveInstagramUrl(url!, fetch);
    const code = instagramShortcode(resolved.url);
    const target = code ? `https://www.instagram.com/p/${code}/embed/captioned/` : resolved.url;
    const t0 = Date.now();
    const r = await claudeProvider({ apiKey: key! }).research!({
      system: PAGE_READ_PROMPT, prompt: `이 인스타그램 게시물의 캡션에 있는 레시피를 읽어 주세요: ${target}`, searches: 0, fetches: 1, maxTokens: 4000,
    });
    console.log("CLAUDE", JSON.stringify({ seconds: Math.round((Date.now() - t0) / 1000), target, sources: r.sources, text: r.text.slice(0, 600) }));
  }, 180_000);

  it.skipIf(!key)("imports the link like the app does, then reads the reel's frames", async () => {
    const env = { ANTHROPIC_API_KEY: key!, AI_PROVIDER: "claude" };
    const t0 = Date.now();
    const r = await importFromUrl(env, url!, fetch);
    console.log("IMPORT URL", JSON.stringify({ seconds: Math.round((Date.now() - t0) / 1000), via: r.via, model: r.model, video: r.video ?? null, hasRecipe: r.result.hasRecipe, reason: r.result.reason, title: r.result.recipe?.title ?? null }));
    if (r.result.hasRecipe || !r.video) return;
    const resolved = await resolveInstagramUrl(url!, fetch);
    const p = await instagramPost(resolved.url, fetch);
    const v = p.post?.video ? await fetchInstagramVideo(p.post.video, fetch) : null;
    if (!v) { console.log("REEL", "영상을 받지 못함"); return; }
    const dir = mkdtempSync(join(tmpdir(), "reel-"));
    const file = join(dir, "reel.mp4");
    writeFileSync(file, new Uint8Array(await new Response(v.body).arrayBuffer()));
    // 앱과 같게: 앞뒤를 조금 빼고 고르게 최대 12장, 긴 변 768px
    const duration = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString().trim());
    const n = Math.max(1, Math.min(12, Math.floor(duration / 1.5) || 1));
    const start = Math.min(0.5, duration / 4), end = Math.max(start, duration - 0.3);
    const times = n === 1 ? [duration / 2] : Array.from({ length: n }, (_, i) => start + ((end - start) * i) / (n - 1));
    const images = times.map((t, i) => {
      const out = join(dir, `f${i}.jpg`);
      execFileSync("ffmpeg", ["-v", "error", "-ss", t.toFixed(2), "-i", file, "-frames:v", "1", "-vf", "scale='if(gt(iw,ih),768,-2)':'if(gt(iw,ih),-2,768)'", "-q:v", "5", out]);
      return { mediaType: "image/jpeg" as const, data: Buffer.from(readFileSync(out)).toString("base64") };
    });
    const t1 = Date.now();
    const f = await importFromText(env, { text: r.video.caption, url: url!, images, frames: true });
    const rec = f.result.recipe;
    console.log("REEL", JSON.stringify({ seconds: Math.round((Date.now() - t1) / 1000), duration, frames: images.length, bytes: v.length, hasRecipe: f.result.hasRecipe, reason: f.result.reason, title: rec?.title ?? null,
      ingredients: rec?.ingredients.map((i) => `${i.name} ${i.qty ?? ""}${i.unit === "기타" ? "" : i.unit}${i.note ? ` (${i.note})` : ""}`) ?? [],
      steps: rec?.steps.map((x) => x.text) ?? [] }));
  }, 300_000);
});
