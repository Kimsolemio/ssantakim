/**
 * 인스타그램 공개 게시물의 캡션 읽기.
 * 인스타 본 페이지는 서버에서 열면 로그인 화면을 주고, 남의 게시물을 읽는 공식 API도 없다.
 * 그래서 블로그에 게시물을 붙일 때 쓰는 공개 "퍼가기(embed)" 페이지에서 캡션·작성자·표지 사진을 읽는다.
 * 막히거나(로그인 화면, 너무 많은 요청) 페이지 구조가 바뀌면 null → 앱이 "캡션 붙여넣기·화면 녹화" 안내로 넘어간다.
 * (Claude는 영상을 볼 수 없어서 영상 자체 분석은 하지 않는다. 화면 녹화를 올리면 앱이 장면을 뽑아 보낸다)
 */
import { Buffer } from "node:buffer";
import { htmlToText, metaContent, readLimited } from "./extract";

// 다른 페이지 읽기와 같은 이름표 (다른 앱인 척하지 않는다)
const UA = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36 FamilyCookBot/1.0";
/**
 * 인스타가 막고 있으면 10분 동안은 다시 묻지 않는다. 두 갈래로 따로 기억한다:
 *  server: 이 서버의 직접 읽기가 막힘 → 서버 읽기만 건너뛰고 Claude 웹 읽기는 해 본다
 *  ai:     Claude 웹 읽기도 못 읽음 → 돈 드는 웹 읽기까지 건너뛰고 바로 안내
 */
const BLOCK_MS = 10 * 60_000;
export type BlockKind = "server" | "ai";
const blockedUntil: Record<BlockKind, number> = { server: 0, ai: 0 };
export function resetInstagramBlock() { blockedUntil.server = 0; blockedUntil.ai = 0; }
type Kv = { get(k: string): Promise<string | null>; put(k: string, v: string, o?: { expirationTtl?: number }): Promise<void> } | undefined;
export async function instagramBlocked(kv: Kv, kind: BlockKind, now = Date.now()): Promise<boolean> {
  if (blockedUntil[kind] > now) return true;
  try { const until = Number(await kv?.get(`ig:blocked:${kind}`) ?? 0); if (until > now) { blockedUntil[kind] = until; return true; } } catch { /* 무시 */ }
  return false;
}
export async function markInstagramBlocked(kv: Kv, kind: BlockKind, now = Date.now()): Promise<void> {
  blockedUntil[kind] = now + BLOCK_MS;
  try { await kv?.put(`ig:blocked:${kind}`, String(blockedUntil[kind]), { expirationTtl: Math.ceil(BLOCK_MS / 1000) + 60 }); } catch { /* 무시 */ }
}
/** 막힌 것인가: 너무 많은 요청(429)·거절(403)·로그인 화면으로 넘김. 없는 게시물(404)은 막힘이 아니다 */
export function looksBlocked(r: Response): boolean {
  if (r.status === 429 || r.status === 403) return true;
  return r.status >= 300 && r.status < 400 && /login|challenge/i.test(r.headers.get("location") ?? "");
}

export type InstagramPost = { shortcode: string; caption: string | null; username: string | null; image: string | null };

const isInstaHost = (h: string) => /(^|\.)instagram\.com$/i.test(h);

/** /p/ABC, /reel/ABC, /reels/ABC, /tv/ABC → ABC (공유 버튼 주소 /share/… 는 resolveInstagramUrl 로 먼저 푼다) */
export function instagramShortcode(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (!isInstaHost(u.hostname) || /^\/share\//.test(u.pathname)) return null;
    const m = /^\/(?:[\w.]+\/)?(?:p|reels?|tv)\/([\w-]{5,40})(?:\/|$)/.exec(u.pathname);
    return m && !["audio", "share"].includes(m[1].toLowerCase()) ? m[1] : null;
  } catch { return null; }
}

export const isInstagramShare = (raw: string) => { try { const u = new URL(raw); return isInstaHost(u.hostname) && /^\/share\//.test(u.pathname); } catch { return false; } };

/**
 * 인스타 앱 "공유" 주소(/share/reel/…)는 한 번 넘겨 주는 주소라, 실제 게시물 주소로 바꾼다 (인스타 안에서만).
 * 못 풀면 받은 주소 그대로. blocked: 인스타가 막았다 (로그인 화면으로 넘김 등)
 */
export async function resolveInstagramUrl(raw: string, f: typeof fetch): Promise<{ url: string; blocked: boolean }> {
  if (!isInstagramShare(raw)) return { url: raw, blocked: false };
  try {
    const r = await f(raw, { headers: { "User-Agent": UA }, redirect: "manual", signal: AbortSignal.timeout(8_000) });
    void r.body?.cancel();
    if (looksBlocked(r)) return { url: raw, blocked: true };
    const loc = r.headers.get("location");
    if (r.status >= 300 && r.status < 400 && loc) {
      const next = new URL(loc, raw);
      if (next.protocol === "https:" && isInstaHost(next.hostname)) return { url: next.toString(), blocked: false };
    }
  } catch { /* 아래 */ }
  return { url: raw, blocked: false };
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
    return x.protocol === "https:" && !x.port && /(\.cdninstagram\.com|\.fbcdn\.net)$/i.test(x.hostname) ? x.toString() : null;
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
      const cap = findKey(data, "caption") as unknown;
      caption = str(edges?.edges?.[0]?.node?.text) ?? str(cap) ?? str((cap as { text?: unknown } | null)?.text);
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
  if (!image) {
    // 태그를 먼저 끊어 보고 그 안에서 찾는다 (닫히지 않은 <img 가 많아도 느려지지 않게)
    for (const tag of html.match(/<img\b[^>]{0,2000}>/g) ?? []) {
      if (!/class="EmbeddedMediaImage"/.test(tag)) continue;
      const m = /src="([^"]+)"/.exec(tag);
      if (m) { image = m[1]; break; }
    }
  }
  return { caption: caption ? caption.slice(0, 8000) : null, username, image: safeImage(image) };
}

/** 본 페이지의 미리보기 문구: "좋아요 12개, 댓글 3개 - user님, 날짜: \"캡션\"" → 캡션 (짧게 잘려 있을 수 있다) */
export function captionFromOgDescription(desc: string | null): string | null {
  if (!desc) return null;
  const m = /:\s*["“](.+)["”]\s*\.?\s*$/s.exec(desc);
  return str(m ? m[1] : null);
}

/**
 * 공개 게시물 읽기. blocked: 인스타가 서버 접속을 막았다 (로그인 화면·너무 많은 요청).
 * missing: 퍼가기·본 페이지 모두 "없는 게시물"(404) — 지워졌거나 비공개라 다른 방법으로도 못 읽는다
 */
export async function instagramPost(url: string, f: typeof fetch): Promise<{ post: InstagramPost | null; blocked: boolean; missing: boolean }> {
  const shortcode = instagramShortcode(url);
  if (!shortcode) return { post: null, blocked: false, missing: false };
  let blocked = false, embedStatus = 0, pageStatus = 0;
  const headers = { "User-Agent": UA, "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8", Accept: "text/html" };
  let post: Omit<InstagramPost, "shortcode"> = { caption: null, username: null, image: null };
  try {
    const r = await f(`https://www.instagram.com/p/${shortcode}/embed/captioned/`, { headers, redirect: "manual", signal: AbortSignal.timeout(10_000) });
    embedStatus = r.status;
    if (r.ok) post = parseInstagramEmbed(await readLimited(r, 2_000_000));
    else { blocked = looksBlocked(r); void r.body?.cancel(); }
    console.log(JSON.stringify({ route: "instagram", step: "embed", status: r.status, caption: !!post.caption, image: !!post.image }));
  } catch (e) { console.warn("instagram embed failed", e instanceof Error ? e.message : e); }
  if (!post.caption) {
    // 퍼가기 페이지가 막혔으면 본 페이지의 미리보기 문구라도 (로그인 화면이면 없다)
    try {
      const r = await f(`https://www.instagram.com/p/${shortcode}/`, { headers, redirect: "manual", signal: AbortSignal.timeout(10_000) });
      pageStatus = r.status;
      if (r.ok) {
        const html = await readLimited(r, 1_500_000);
        const cap = captionFromOgDescription(metaContent(html, "og:description"));
        if (cap) { post = { ...post, caption: cap, image: post.image ?? safeImage(metaContent(html, "og:image")) }; blocked = false; }
      } else { blocked ||= looksBlocked(r); void r.body?.cancel(); }
      console.log(JSON.stringify({ route: "instagram", step: "page", status: r.status, caption: !!post.caption }));
    } catch (e) { console.warn("instagram page failed", e instanceof Error ? e.message : e); }
  }
  const found = !!(post.caption || post.image);
  return { post: found ? { shortcode, ...post } : null, blocked: blocked && !found, missing: !found && embedStatus === 404 && pageStatus === 404 };
}

const MAX_IMAGE = 1_500_000;
/** 표지 사진 받기 (캡션이 짧을 때 화면 글자를 읽으려고). 실패하면 null */
export async function fetchInstagramImage(src: string, f: typeof fetch): Promise<{ mediaType: "image/jpeg" | "image/png" | "image/webp"; data: string } | null> {
  try {
    // 다른 곳으로 넘기는 응답은 따라가지 않는다 (확인한 인스타 이미지 주소만)
    const r = await f(src, { redirect: "manual", signal: AbortSignal.timeout(10_000) });
    const type = (r.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    const len = Number(r.headers.get("content-length") ?? 0);
    if (!r.ok || !["image/jpeg", "image/png", "image/webp"].includes(type) || len > MAX_IMAGE) { void r.body?.cancel(); return null; }
    const buf = new Uint8Array(await r.arrayBuffer());
    if (buf.byteLength < 500 || buf.byteLength > MAX_IMAGE) return null;
    // Buffer 변환은 문자 하나씩 이어 붙이는 것보다 훨씬 빨라 무료 요금제 CPU 한도 안에 든다
    return { mediaType: type as "image/jpeg" | "image/png" | "image/webp", data: Buffer.from(buf).toString("base64") };
  } catch { return null; }
}
