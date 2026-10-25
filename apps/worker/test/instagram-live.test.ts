/**
 * 실제 인스타 게시물로 점검 (.github/workflows/instagram-probe.yml). 주소가 있을 때만 돈다.
 *   COOK_INSTAGRAM_URL=https://www.instagram.com/p/... [COOK_ANTHROPIC_API_KEY=sk-ant-...] pnpm --filter @cook/worker exec vitest run instagram-live
 * 이 컴퓨터에서 직접 읽기 + (키가 있으면) Claude 웹 읽기가 인스타를 실제로 읽는지 결과만 적는다. 실패로 끝나지 않는다.
 */
import { describe, it } from "vitest";
import { claudeProvider } from "../src/ai/claude";
import { instagramPost, instagramShortcode, resolveInstagramUrl } from "../src/instagram";
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
});
