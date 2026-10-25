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
    const sf = { "Sec-Fetch-Dest": "iframe", "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Site": "cross-site" };
    const variants: [string, string, Record<string, string>][] = [
      ["dest-only", `https://www.instagram.com/p/${code}/embed/captioned/`, { ...headers, "Sec-Fetch-Dest": "iframe" }],
      ["sf3-noRef", `https://www.instagram.com/p/${code}/embed/captioned/`, { ...headers, ...sf }],
      ["page-document", `https://www.instagram.com/p/${code}/`, { ...headers, "Sec-Fetch-Dest": "document", "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Site": "none" }],
    ];
    const deep: Record<string, unknown> = {};
    let embedHtml = "";
    for (const [name, target, h] of variants) {
      try {
        const r = await fetch(target, { headers: h, redirect: "manual" });
        const text = r.status === 200 ? await r.text() : "";
        if (r.status !== 200) void r.body?.cancel();
        if (!embedHtml && text.includes("contextJSON")) embedHtml = text;
        deep[name] = {
          status: r.status, location: r.headers.get("location"), bytes: text.length,
          markers: ["contextJSON", 'class="Caption"', "edge_media_to_caption", "og:description", "video_url"].filter((m) => text.includes(m)),
          parsed: parseInstagramEmbed(text).caption?.slice(0, 120) ?? null,
          og: captionFromOgDescription(metaContent(text, "og:description"))?.slice(0, 120) ?? null,
        };
      } catch (e) { deep[name] = { error: e instanceof Error ? e.message : String(e) }; }
    }
    // 영상 파일 주소가 함께 오는지, 받을 수 있는지
    if (embedHtml) {
      const ctx = /"contextJSON":"((?:[^"\\]|\\.)*)"/.exec(embedHtml);
      let data: unknown = null;
      try { data = ctx ? JSON.parse(JSON.parse(`"${ctx[1]}"`) as string) : null; } catch (e) { deep.ctxError = String(e); }
      const find = (o: unknown, key: string, d = 0): unknown => {
        if (!o || typeof o !== "object" || d > 12) return undefined;
        if (key in (o as Record<string, unknown>)) return (o as Record<string, unknown>)[key];
        for (const v of Object.values(o as Record<string, unknown>)) { const f = find(v, key, d + 1); if (f !== undefined) return f; }
        return undefined;
      };
      const videoUrl = find(data, "video_url");
      const full = parseInstagramEmbed(embedHtml);
      const video: Record<string, unknown> = {
        is_video: find(data, "is_video") ?? null, product_type: find(data, "product_type") ?? null,
        video_duration: find(data, "video_duration") ?? null, video_view_count: find(data, "video_view_count") ?? null,
        videoHost: typeof videoUrl === "string" ? new URL(videoUrl).hostname : null,
        rawVideoInHtml: /\.mp4/.test(embedHtml), caption: full.caption?.slice(0, 1000) ?? null, username: full.username, image: !!full.image,
        ctxKeys: data && typeof data === "object" ? Object.keys(data as object).slice(0, 20) : null,
      };
      if (typeof videoUrl === "string") {
        try {
          const r = await fetch(videoUrl, { headers: { "User-Agent": UA, Range: "bytes=0-1023" } });
          void r.body?.cancel();
          Object.assign(video, { videoStatus: r.status, videoType: r.headers.get("content-type"), videoRange: r.headers.get("content-range"), videoLength: r.headers.get("content-length"), videoCors: r.headers.get("access-control-allow-origin") });
        } catch (e) { video.videoError = String(e); }
      }
      deep.video = video;
    }
    out.deep = deep;
    const p = await instagramPost(resolved.url, fetch);
    out.instagramPost = { blocked: p.blocked, missing: p.missing, caption: p.post?.caption?.slice(0, 300) ?? null, username: p.post?.username ?? null, image: !!p.post?.image, video: p.post?.video ? new URL(p.post.video).hostname : null };
    return Response.json(out);
  },
};
