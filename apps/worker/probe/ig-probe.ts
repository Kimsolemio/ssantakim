/**
 * 인스타 읽기 점검: 진짜 서버와 같은 코드(src/instagram.ts)로 게시물을 읽어 보고, 단계별로 무엇이 왔는지 돌려준다.
 * 점검 워크플로가 만든 열쇠(PROBE_TOKEN)가 있어야만 답한다. 인스타 주소만 읽는다.
 */
import { metaContent } from "../src/extract";
import { captionFromOgDescription, instagramPost, instagramShortcode, parseInstagramEmbed, resolveInstagramUrl, UA } from "../src/instagram";

export default {
  async fetch(req: Request, env: { PROBE_TOKEN?: string }): Promise<Response> {
    const q = new URL(req.url).searchParams;
    if (!env.PROBE_TOKEN || q.get("t") !== env.PROBE_TOKEN) return new Response("forbidden", { status: 403 });
    const raw = q.get("u") ?? "";
    const out: Record<string, unknown> = { colo: (req as Request & { cf?: { colo?: string } }).cf?.colo ?? null };
    const resolved = await resolveInstagramUrl(raw, fetch);
    const code = instagramShortcode(resolved.url);
    Object.assign(out, { resolved, code });
    if (!code) return Response.json(out);
    const headers = { "User-Agent": UA, "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8", Accept: "text/html" };
    for (const [name, target] of [["embed", `https://www.instagram.com/p/${code}/embed/captioned/`], ["page", `https://www.instagram.com/p/${code}/`]] as const) {
      try {
        const r = await fetch(target, { headers, redirect: "manual" });
        const text = r.status === 200 ? await r.text() : "";
        if (r.status !== 200) void r.body?.cancel();
        const parsed = name === "embed" ? parseInstagramEmbed(text) : null;
        out[name] = {
          status: r.status, location: r.headers.get("location"), bytes: text.length,
          title: /<title[^>]*>([^<]{0,120})/.exec(text)?.[1]?.trim() ?? null,
          contextJSON: text.includes('"contextJSON"'), captionDiv: text.includes('class="Caption"'), edge: text.includes("edge_media_to_caption"),
          loginWall: /accounts\/login|LoginAndSignupPage|로그인/i.test(text),
          caption: (parsed ? parsed.caption : captionFromOgDescription(metaContent(text, "og:description")))?.slice(0, 300) ?? null,
          ...(parsed ? { username: parsed.username, image: !!parsed.image } : {}),
        };
      } catch (e) { out[name] = { error: e instanceof Error ? e.message : String(e) }; }
    }
    const p = await instagramPost(resolved.url, fetch);
    out.instagramPost = { blocked: p.blocked, missing: p.missing, caption: p.post?.caption?.slice(0, 300) ?? null, username: p.post?.username ?? null, image: !!p.post?.image };
    return Response.json(out);
  },
};
