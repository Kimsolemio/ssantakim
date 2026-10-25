/**
 * 링크에서 레시피 재료가 될 글을 뽑는다. 무료 요금제 CPU 한도(10ms)를 생각해
 * 무거운 HTML 파서 없이 indexOf·정규식만 쓰고, 읽는 크기도 제한한다.
 */

export type LinkKind = "youtube" | "instagram" | "naver_blog" | "web";

/** youtube.com/watch?v=, youtu.be/, /shorts/, /live/, m.youtube.com 모두 지원 */
export function youtubeId(raw: string): string | null {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  const host = u.hostname.replace(/^www\.|^m\.|^music\./, "");
  if (host === "youtu.be") return /^[\w-]{11}$/.test(u.pathname.slice(1, 12)) ? u.pathname.slice(1, 12) : null;
  if (host !== "youtube.com") return null;
  const v = u.searchParams.get("v");
  if (v && /^[\w-]{11}$/.test(v)) return v;
  const m = /^\/(?:shorts|live|embed)\/([\w-]{11})/.exec(u.pathname);
  return m ? m[1] : null;
}

export function linkKind(raw: string): LinkKind {
  if (youtubeId(raw)) return "youtube";
  let host = "";
  try { host = new URL(raw).hostname.replace(/^www\./, ""); } catch { return "web"; }
  if (host === "instagram.com" || host.endsWith(".instagram.com")) return "instagram";
  if (host === "blog.naver.com" || host === "m.blog.naver.com") return "naver_blog";
  return "web";
}

/** 네이버 블로그 PC 주소는 본문이 iframe 안에 있어서 모바일 주소로 바꿔 읽는다 */
export function naverBlogMobileUrl(raw: string): string | null {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  const blogId = u.searchParams.get("blogId"), logNo = u.searchParams.get("logNo");
  if (blogId && logNo) return `https://m.blog.naver.com/${encodeURIComponent(blogId)}/${encodeURIComponent(logNo)}`;
  const m = /^\/([\w-]+)\/(\d+)/.exec(u.pathname);
  return m ? `https://m.blog.naver.com/${m[1]}/${m[2]}` : null;
}

/** 내부망·로컬 주소, http(s)가 아닌 주소는 읽지 않는다 */
export function isSafePublicUrl(raw: string): boolean {
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  if (u.username || u.password) return false;
  if (u.port && !["80", "443"].includes(u.port)) return false;
  // 끝의 점("localhost.", "10.0.0.1.")은 떼고 본다
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.+$/, "");
  if (!h.includes(".") || h === "localhost" || /\.(local|localhost|internal|lan|home|arpa|test|invalid)$/.test(h)) return false;
  // 주소 안에 IP를 넣어 내부망으로 풀리게 하는 공개 와일드카드 DNS
  if (/(^|\.)(nip\.io|sslip\.io|xip\.io|localtest\.me|lvh\.me|traefik\.me|vcap\.me|lacolhost\.com|127\.0\.0\.1\.[a-z]+)$/.test(h)) return false;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    const [a, b] = h.split(".").map(Number);
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224) return false;
  }
  if (h.includes(":")) return false; // IPv6 리터럴은 받지 않는다
  return true;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", middot: "·" };
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

export function metaContent(html: string, prop: string): string | null {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop.replace(/[.:]/g, "\\$&")}["'][^>]*>`, "i");
  const tag = re.exec(html)?.[0];
  if (!tag) return null;
  const c = /content=["']([^"']*)["']/i.exec(tag)?.[1];
  return c ? decodeEntities(c).trim() : null;
}

/** 본문 글만 남긴다 (스크립트·스타일·태그 제거, 줄바꿈 정리) */
export function htmlToText(html: string, maxChars = 15000): string {
  const bodyStart = html.search(/<body[\s>]/i);
  let s = bodyStart >= 0 ? html.slice(bodyStart) : html;
  s = s.replace(/<(script|style|noscript|svg|iframe|template)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\b[^>]*>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<[^>]+>/g, " ");
  s = decodeEntities(s).replace(/[ \t\f\v ]+/g, " ").replace(/\s*\n\s*/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return s.length > maxChars ? s.slice(0, maxChars) + "\n…(이하 생략)" : s;
}

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

/** schema.org Recipe JSON-LD 를 찾아 사람이 읽는 글로 바꾼다 (블로그·레시피 사이트 대부분이 넣어 둔다) */
export function jsonLdRecipeText(html: string): string | null {
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    let data: Json;
    try { data = JSON.parse(m[1].trim()) as Json; } catch { continue; }
    const found = findRecipe(data);
    if (found) return recipeToText(found);
  }
  return null;
}

function isType(o: { [k: string]: Json }, t: string): boolean {
  const ty = o["@type"];
  return ty === t || (Array.isArray(ty) && ty.includes(t));
}
function findRecipe(d: Json): { [k: string]: Json } | null {
  if (Array.isArray(d)) { for (const x of d) { const r = findRecipe(x); if (r) return r; } return null; }
  if (d && typeof d === "object") {
    if (isType(d, "Recipe")) return d;
    if (d["@graph"]) return findRecipe(d["@graph"]);
  }
  return null;
}
function str(j: Json | undefined): string {
  if (j == null) return "";
  if (typeof j === "string") return decodeEntities(j).trim();
  if (typeof j === "number" || typeof j === "boolean") return String(j);
  if (Array.isArray(j)) return j.map(str).filter(Boolean).join(", ");
  return str(j.text ?? j.name ?? "");
}
function steps(j: Json | undefined): string[] {
  if (j == null) return [];
  if (typeof j === "string") return [str(j)];
  if (Array.isArray(j)) return j.flatMap(steps);
  if (typeof j === "object") {
    if (isType(j, "HowToSection")) return steps(j.itemListElement);
    return [str(j.text ?? j.name)];
  }
  return [];
}
function recipeToText(r: { [k: string]: Json }): string {
  const lines = [`요리 이름: ${str(r.name)}`];
  if (r.recipeYield) lines.push(`분량: ${str(r.recipeYield)}`);
  if (r.totalTime || r.cookTime) lines.push(`시간: ${str(r.totalTime ?? r.cookTime)}`);
  if (r.description) lines.push(`설명: ${str(r.description)}`);
  const ings = Array.isArray(r.recipeIngredient) ? r.recipeIngredient.map(str) : [str(r.recipeIngredient)];
  lines.push("재료:", ...ings.filter(Boolean).map((i) => `- ${i}`));
  lines.push("조리 순서:", ...steps(r.recipeInstructions).filter(Boolean).map((s, i) => `${i + 1}. ${s}`));
  return lines.join("\n");
}

/** 응답 본문을 최대 maxBytes 까지만 읽는다 */
export async function readLimited(res: Response, maxBytes = 2_000_000): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); total += value.byteLength;
  }
  await reader.cancel().catch(() => {});
  const buf = new Uint8Array(Math.min(total, maxBytes));
  let off = 0;
  for (const c of chunks) { const n = Math.min(c.byteLength, buf.length - off); buf.set(c.subarray(0, n), off); off += n; if (off >= buf.length) break; }
  return new TextDecoder("utf-8").decode(buf); // 깨진 글자는 대체 문자로 (기본값)
}

/** 유튜브 영상 페이지에 들어 있는 JSON 조각에서 설명란·제목·채널을 꺼낸다 (API 키가 없을 때) */
export function youtubePageInfo(html: string): { title: string | null; description: string | null; channel: string | null } {
  const grab = (key: string) => {
    const m = new RegExp(`"${key}":"((?:[^"\\\\]|\\\\.)*)"`).exec(html);
    if (!m) return null;
    try { return JSON.parse(`"${m[1]}"`) as string; } catch { return null; }
  };
  return { description: grab("shortDescription"), title: metaContent(html, "og:title") ?? grab("title"), channel: grab("author") ?? grab("ownerChannelName") };
}
