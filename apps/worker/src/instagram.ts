/**
 * 인스타그램 공개 게시물의 캡션 읽기.
 * 인스타 본 페이지는 서버에서 열면 로그인 화면을 주고, 남의 게시물을 읽는 공식 API도 없다.
 * 그래서 블로그에 게시물을 붙일 때 쓰는 공개 "퍼가기(embed)" 페이지에서 캡션·작성자·표지 사진을 읽는다.
 * 막히거나(로그인 화면, 너무 많은 요청) 페이지 구조가 바뀌면 null → 앱이 "캡션 붙여넣기·화면 녹화" 안내로 넘어간다.
 * (Claude는 영상을 볼 수 없어서 영상 자체 분석은 하지 않는다. 화면 녹화를 올리면 앱이 장면을 뽑아 보낸다)
 */
import { htmlToText, metaContent, readLimited } from "./extract";

const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

export type InstagramPost = { shortcode: string; caption: string | null; username: string | null; image: string | null };

/** /p/ABC, /reel/ABC, /reels/ABC, /tv/ABC → ABC */
export function instagramShortcode(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (!/(^|\.)instagram\.com$/i.test(u.hostname)) return null;
    const m = /^\/(?:[\w.]+\/)?(?:p|reels?|tv)\/([\w-]{5,40})/.exec(u.pathname);
    return m ? m[1] : null;
  } catch { return null; }
}

/** JSON 안 어디에 있든 첫 번째로 나오는 키 값을 찾는다 (퍼가기 페이지의 데이터 모양이 자주 바뀐다) */
function findKey(o: unknown, key: string, depth = 0): unknown {
  if (!o || typeof o !== "object" || depth > 12) return undefined;
  if (key in (o as Record<string, unknown>)) return (o as Record<string, unknown>)[key];
  for (const v of Object.values(o as Record<string, unknown>)) {
    const found = findKey(v, key, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const safeImage = (u: string | null) => {
  if (!u) return null;
  try {
    const x = new URL(u.replace(/&amp;/g, "&"));
    return x.protocol === "https:" && /(\.cdninstagram\.com|\.fbcdn\.net)$/i.test(x.hostname) ? x.toString() : null;
  } catch { return null; }
};

/** 퍼가기 페이지 HTML → 캡션·작성자·표지 사진. 못 찾으면 각각 null */
export function parseInstagramEmbed(html: string): Omit<InstagramPost, "shortcode"> {
  let caption: string | null = null, username: string | null = null, image: string | null = null;
  // ① 페이지에 들어 있는 데이터(JSON 문자열을 한 번 더 감싼 것)
  const ctx = /"contextJSON":"((?:[^"\\]|\\.)*)"/.exec(html);
  if (ctx) {
    try {
      const data = JSON.parse(JSON.parse(`"${ctx[1]}"`) as string) as unknown;
      const edges = findKey(data, "edge_media_to_caption") as { edges?: { node?: { text?: string } }[] } | undefined;
      caption = str(edges?.edges?.[0]?.node?.text) ?? str(findKey(data, "caption"));
      const owner = findKey(data, "owner") as { username?: string } | undefined;
      username = str(owner?.username) ?? str(findKey(data, "username"));
      image = str(findKey(data, "display_url"));
    } catch { /* 아래 방법으로 */ }
  }
  // ② 감싸지 않은 데이터
  if (!caption) {
    const m = /"edge_media_to_caption":\{"edges":\[\{"node":\{"text":("(?:[^"\\]|\\.)*")/.exec(html);
    if (m) { try { caption = str(JSON.parse(m[1])); } catch { /* 무시 */ } }
  }
  // ③ 화면에 그려진 캡션 칸
  if (!caption) {
    const m = /<div class="Caption"[^>]*>([\s\S]*?)<div class="CaptionComments"/.exec(html) ?? /<div class="Caption"[^>]*>([\s\S]*?)<\/div>/.exec(html);
    if (m) {
      const user = /<a[^>]*class="CaptionUsername"[^>]*>([\s\S]*?)<\/a>/.exec(m[1]);
      if (user && !username) username = str(htmlToText(user[1], 100));
      const body = m[1].replace(/<a[^>]*class="CaptionUsername"[^>]*>[\s\S]*?<\/a>/, "").replace(/<br\s*\/?>/gi, "\n");
      caption = str(htmlToText(body, 8000));
    }
  }
  if (!username) { const m = /<span class="UsernameText">([^<]+)<\/span>/.exec(html); if (m) username = str(m[1]); }
  if (!image) { const m = /<img[^>]*class="EmbeddedMediaImage"[^>]*src="([^"]+)"/.exec(html); if (m) image = m[1]; }
  return { caption: caption ? caption.slice(0, 8000) : null, username, image: safeImage(image) };
}

/** 본 페이지의 미리보기 문구: "좋아요 12개, 댓글 3개 - user님, 날짜: \"캡션\"" → 캡션 (짧게 잘려 있을 수 있다) */
export function captionFromOgDescription(desc: string | null): string | null {
  if (!desc) return null;
  const m = /:\s*["“](.+)["”]\s*\.?\s*$/s.exec(desc);
  return str(m ? m[1] : null);
}

/** 공개 게시물 읽기. 아무것도 못 읽으면 null */
export async function instagramPost(url: string, f: typeof fetch): Promise<InstagramPost | null> {
  const shortcode = instagramShortcode(url);
  if (!shortcode) return null;
  const headers = { "User-Agent": UA, "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8", Accept: "text/html" };
  let post: Omit<InstagramPost, "shortcode"> = { caption: null, username: null, image: null };
  try {
    const r = await f(`https://www.instagram.com/p/${shortcode}/embed/captioned/`, { headers, redirect: "manual", signal: AbortSignal.timeout(10_000) });
    if (r.ok) post = parseInstagramEmbed(await readLimited(r, 2_000_000));
    else void r.body?.cancel();
    console.log(JSON.stringify({ route: "instagram", step: "embed", status: r.status, caption: !!post.caption, image: !!post.image }));
  } catch (e) { console.warn("instagram embed failed", e instanceof Error ? e.message : e); }
  if (!post.caption) {
    // 퍼가기 페이지가 막혔으면 본 페이지의 미리보기 문구라도 (로그인 화면이면 없다)
    try {
      const r = await f(`https://www.instagram.com/p/${shortcode}/`, { headers, redirect: "manual", signal: AbortSignal.timeout(10_000) });
      if (r.ok) {
        const html = await readLimited(r, 1_500_000);
        const cap = captionFromOgDescription(metaContent(html, "og:description"));
        if (cap) post = { ...post, caption: cap, image: post.image ?? safeImage(metaContent(html, "og:image")) };
      } else void r.body?.cancel();
      console.log(JSON.stringify({ route: "instagram", step: "page", status: r.status, caption: !!post.caption }));
    } catch (e) { console.warn("instagram page failed", e instanceof Error ? e.message : e); }
  }
  return post.caption || post.image ? { shortcode, ...post } : null;
}

/** 표지 사진 받기 (캡션이 짧을 때 화면 글자를 읽으려고). 실패하면 null */
export async function fetchInstagramImage(src: string, f: typeof fetch): Promise<{ mediaType: "image/jpeg" | "image/png" | "image/webp"; data: string } | null> {
  try {
    const r = await f(src, { signal: AbortSignal.timeout(10_000) });
    const type = (r.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!r.ok || !["image/jpeg", "image/png", "image/webp"].includes(type)) { void r.body?.cancel(); return null; }
    const buf = new Uint8Array(await r.arrayBuffer());
    if (buf.byteLength < 500 || buf.byteLength > 4_500_000) return null;
    let bin = "";
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return { mediaType: type as "image/jpeg" | "image/png" | "image/webp", data: btoa(bin) };
  } catch { return null; }
}
