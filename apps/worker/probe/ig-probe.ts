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
    // 같은 게시물을 여러 방식으로 열어 어떤 방식에 캡션이 담겨 오는지 본다
    const variants: [string, string, Record<string, string>][] = [
      ["embed+iframe", `https://www.instagram.com/p/${code}/embed/captioned/`, { ...headers, "Sec-Fetch-Dest": "iframe", "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Site": "cross-site", Referer: "https://family-cook.example/" }],
      ["embed?cr", `https://www.instagram.com/p/${code}/embed/captioned/?cr=1&v=14&wp=540`, headers],
      ["reel-embed", `https://www.instagram.com/reel/${code}/embed/captioned/`, headers],
      ["embed-plain", `https://www.instagram.com/p/${code}/embed/`, headers],
      ["embed-noUA", `https://www.instagram.com/p/${code}/embed/captioned/`, { Accept: "text/html" }],
      ["oembed", `https://www.instagram.com/api/v1/oembed/?url=${encodeURIComponent(`https://www.instagram.com/p/${code}/`)}`, { "User-Agent": UA, Accept: "application/json" }],
    ];
    const deep: Record<string, unknown> = {};
    for (const [name, target, h] of variants) {
      try {
        const r = await fetch(target, { headers: h, redirect: "manual" });
        const text = r.status === 200 ? await r.text() : "";
        if (r.status !== 200) void r.body?.cancel();
        const at = (needle: string) => { const i = text.indexOf(needle); return i < 0 ? null : text.slice(Math.max(0, i - 60), i + 240).replace(/\s+/g, " "); };
        deep[name] = {
          status: r.status, location: r.headers.get("location"), type: r.headers.get("content-type"), bytes: text.length,
          title: /<title[^>]*>([^<]{0,120})/.exec(text)?.[1]?.trim() ?? null,
          codeHits: text.split(code).length - 1,
          markers: ["contextJSON", 'class="Caption"', "edge_media_to_caption", "EmbeddedMedia", "xdt_", "shortcode_media", "ScheduledServerJS", "og:description", '"caption"', "accessibility_caption"].filter((m) => text.includes(m)),
          parsed: parseInstagramEmbed(text).caption?.slice(0, 200) ?? null,
          snipCaption: at('"caption"') ?? at('class="Caption"'),
          snipCode: at(code),
          head: text.length < 3000 ? text.slice(0, 1500) : null,
        };
      } catch (e) { deep[name] = { error: e instanceof Error ? e.message : String(e) }; }
    }
    out.deep = deep;
    const p = await instagramPost(resolved.url, fetch);
    out.instagramPost = { blocked: p.blocked, missing: p.missing, caption: p.post?.caption?.slice(0, 300) ?? null, username: p.post?.username ?? null, image: !!p.post?.image };
    return Response.json(out);
  },
};
