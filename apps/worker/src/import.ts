import { ImportResult, importResultJsonSchema, type RecipeSource } from "@cook/shared";
import { GenerationError, lazyFetch, selectProvider, type AiEnv, type AiPart, type AiProvider, type ImageMediaType, type ProviderName } from "./ai";
import { geminiProvider } from "./ai/gemini";
import { IMPORT_SYSTEM_PROMPT, PAGE_READ_PROMPT } from "./prompts";
import { parseAiJson } from "./recipe";
import {
  htmlToText, isSafePublicUrl, jsonLdRecipeText, linkKind, metaContent, naverBlogMobileUrl, readLimited, youtubeId, youtubePageInfo,
} from "./extract";

const SCHEMA = importResultJsonSchema();
const UA = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36 FamilyCookBot/1.0";

export type ImportEnv = AiEnv & { YOUTUBE_API_KEY?: string };
/** 어디서 레시피를 읽었는지 (화면 안내용) */
export type ImportVia = "youtube_description" | "youtube_video" | "jsonld" | "page" | "caption" | "photo";
export type ImportResponse = { result: ImportResult; via: ImportVia; provider: ProviderName; model: string };

/** 글뿐인지 (사진·영상이 섞이면 읽기가 어려워 기본 모델로 깊게 본다) */
const textOnly = (parts: AiPart[]) => parts.every((p) => p.type === "text");

/**
 * 글에 적힌 레시피를 옮겨 적는 일은 빠른 모델로 충분하다.
 * 속도 시험(test/speed.test.ts, 유튜브 설명란): Opus medium 18.7초, Opus low 13.2초, Haiku low 6.2초. 재료 13개는 모두 똑같이 찾았다
 */
const importAi = (env: AiEnv, parts: AiPart[]): AiProvider => selectProvider(env, undefined, textOnly(parts) ? "fast" : "main");

async function runImport(ai: AiProvider, parts: AiPart[], source: RecipeSource, via: ImportVia): Promise<ImportResponse> {
  const out = await ai.generateJson({ system: IMPORT_SYSTEM_PROMPT, parts, schema: SCHEMA, effort: textOnly(parts) ? "low" : "medium", maxTokens: 16000 });
  // source 는 앱이 원본 정보로 바꾼다. AI가 이상한 주소를 적어도 검증에서 떨어지지 않게 미리 비운다
  const r = parseAiJson(out.text, ImportResult, (raw) => {
    const o = raw as { recipe?: { source?: unknown } | null } | null;
    if (o && o.recipe && typeof o.recipe === "object") o.recipe.source = { type: "text" };
    return o;
  });
  const result: ImportResult = r.hasRecipe && r.recipe
    ? { ...r, recipe: { ...r.recipe, source } }
    : { ...r, hasRecipe: false, recipe: null };
  return { result, via, provider: ai.name, model: out.model };
}

/** 리다이렉트를 따라가되 매번 안전한 주소인지 확인한다 */
async function safeFetch(url: string, f: typeof fetch, init: RequestInit = {}): Promise<Response> {
  let current = url;
  for (let hop = 0; hop < 4; hop++) {
    if (!isSafePublicUrl(current)) throw new GenerationError("열 수 없는 주소입니다", 400);
    const res = await f(current, { ...init, redirect: "manual", signal: AbortSignal.timeout(12_000) });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      current = new URL(res.headers.get("location")!, current).toString();
      continue;
    }
    return res;
  }
  throw new GenerationError("리다이렉트가 너무 많습니다", 502);
}

type YtInfo = { title: string | null; channel: string | null; description: string | null };

async function youtubeInfo(id: string, apiKey: string | undefined, f: typeof fetch): Promise<YtInfo> {
  if (apiKey) {
    try {
      const r = await f(`https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${id}&key=${encodeURIComponent(apiKey)}`, { signal: AbortSignal.timeout(10_000) });
      if (r.ok) {
        const j = (await r.json()) as { items?: { snippet?: { title?: string; description?: string; channelTitle?: string } }[] };
        const sn = j.items?.[0]?.snippet;
        if (sn) return { title: sn.title ?? null, channel: sn.channelTitle ?? null, description: sn.description ?? null };
        throw new GenerationError("유튜브 영상을 찾을 수 없습니다 (비공개이거나 삭제된 영상)", 404);
      }
    } catch (e) { if (e instanceof GenerationError) throw e; /* 아래 방식으로 다시 시도 */ }
  }
  let info: YtInfo = { title: null, channel: null, description: null };
  try {
    const r = await f(`https://www.youtube.com/watch?v=${id}&hl=ko`, { headers: { "User-Agent": UA, "Accept-Language": "ko-KR,ko;q=0.9" }, signal: AbortSignal.timeout(12_000) });
    if (r.ok) info = youtubePageInfo(await readLimited(r, 1_500_000));
  } catch { /* 무시하고 oEmbed 로 제목만이라도 */ }
  if (!info.title) {
    try {
      const r = await f(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`, { signal: AbortSignal.timeout(8_000) });
      if (r.ok) { const j = (await r.json()) as { title?: string; author_name?: string }; info = { ...info, title: j.title ?? null, channel: info.channel ?? j.author_name ?? null }; }
    } catch { /* 제목도 없으면 아래에서 안내 */ }
  }
  return info;
}

/** AI·페이지 읽기 없이 바로 알 수 있는 거절 (사용량을 쓰기 전에 부른다) */
export function precheckImportUrl(rawUrl: string): void {
  const url = rawUrl.trim();
  if (!isSafePublicUrl(url)) throw new GenerationError("열 수 없는 주소입니다 (http/https 공개 주소만 가능)", 400);
  if (linkKind(url) === "instagram") {
    throw new GenerationError("인스타그램은 링크만으로 내용을 볼 수 없어요. 캡션을 복사해 붙여넣거나 스크린샷을 올려 주세요.", 422, "instagram");
  }
}

export async function importFromUrl(env: ImportEnv, rawUrl: string, f: typeof fetch = lazyFetch): Promise<ImportResponse> {
  const url = rawUrl.trim();
  precheckImportUrl(url);
  const kind = linkKind(url);

  if (kind === "youtube") {
    const id = youtubeId(url)!;
    const canonical = `https://www.youtube.com/watch?v=${id}`;
    const info = await youtubeInfo(id, env.YOUTUBE_API_KEY, f);
    const source: RecipeSource = { type: "youtube", url: canonical, ...(info.channel ? { channel: info.channel } : {}), ...(info.title ? { title: info.title } : {}) };
    const header = `유튜브 영상\n제목: ${info.title ?? "(알 수 없음)"}\n채널: ${info.channel ?? "(알 수 없음)"}`;
    let first: ImportResponse | null = null;
    if (info.description && info.description.trim().length >= 20) {
      const parts: AiPart[] = [{ type: "text", text: `${header}\n\n설명란:\n${info.description.slice(0, 12000)}` }];
      first = await runImport(importAi(env, parts), parts, source, "youtube_description");
      if (first.result.hasRecipe) return first;
    }
    // 설명란에 레시피가 없으면 영상 자체를 본다 (Gemini 키가 있을 때만)
    if (env.GEMINI_API_KEY) {
      const gem = geminiProvider({ apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL, fetch: f });
      try {
        const video = await runImport(gem, [{ type: "youtube", url: canonical }, { type: "text", text: `${header}\n\n영상에서 보여 주는 요리의 재료와 조리 순서를 정리해 주세요.` }], source, "youtube_video");
        if (video.result.hasRecipe || !first) return video;
      } catch (e) {
        // 영상 분석이 실패해도 (긴 영상, 무료 한도 등) 설명란 결과나 "못 찾음" 안내는 돌려준다
        console.warn("youtube video analysis failed", e instanceof Error ? e.message : e);
        if (!first) {
          return {
            result: { hasRecipe: false, reason: `영상을 분석하지 못했어요${e instanceof GenerationError ? ` (${e.message})` : ""}`, dishName: info.title, recipe: null },
            via: "youtube_video", provider: "gemini", model: "",
          };
        }
      }
    }
    if (first) return first;
    return {
      result: { hasRecipe: false, reason: info.title ? "설명란에 레시피가 없어 영상을 읽지 못했어요" : "영상 정보를 가져오지 못했어요", dishName: info.title, recipe: null },
      via: "youtube_description", provider: "gemini", model: "",
    };
  }

  // 블로그·레시피 사이트
  const target = kind === "naver_blog" ? naverBlogMobileUrl(url) ?? url : url;
  const ai = selectProvider(env);   // 웹 읽기 도구는 기본 모델로
  /** Worker가 못 읽은 페이지는 Claude가 직접 읽게 한다 (Claude 웹 읽기 도구). Gemini면 그냥 실패를 알린다 */
  const viaClaude = async (why: GenerationError): Promise<ImportResponse> => {
    if (!ai.research) throw why;
    let r: Awaited<ReturnType<NonNullable<typeof ai.research>>>;
    try {
      r = await ai.research({
        system: PAGE_READ_PROMPT,
        prompt: `이 주소의 레시피를 읽어 주세요: ${target}${target !== url ? `\n(원래 주소: ${url})` : ""}`,
        searches: 0, fetches: 2, maxTokens: 6000,
      });
    } catch (e) {
      console.warn("claude web_fetch failed", e instanceof Error ? e.message : e);
      throw why;
    }
    if (r.text.replace(/\s/g, "").length < 40 || /^레시피 없음/.test(r.text.trim())) throw why;
    const parts: AiPart[] = [{ type: "text", text: `웹 페이지 (AI가 직접 읽음)\n주소: ${url}\n\n${r.text.slice(0, 15000)}` }];
    return runImport(importAi(env, parts), parts, { type: "web", url }, "page");
  };
  let res: Response;
  try {
    res = await safeFetch(target, f, { headers: { "User-Agent": UA, "Accept-Language": "ko-KR,ko;q=0.9", Accept: "text/html,application/xhtml+xml" } });
  } catch (e) {
    if (e instanceof GenerationError && e.status === 400) throw e;
    return viaClaude(new GenerationError("페이지를 열지 못했습니다. 주소를 확인하거나 본문을 복사해 붙여넣어 주세요.", 502, "fetch_failed"));
  }
  if (!res.ok) return viaClaude(new GenerationError(`페이지를 열지 못했습니다 (${res.status}). 본문을 복사해 붙여넣어 주세요.`, 502, "fetch_failed"));
  const ct = res.headers.get("content-type") ?? "";
  if (ct && !/html|text\/plain/i.test(ct)) throw new GenerationError("웹 페이지가 아닌 주소입니다", 422, "not_html");
  const html = await readLimited(res, 2_000_000);
  const title = metaContent(html, "og:title") ?? (/<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1]?.trim() || null);
  const source: RecipeSource = { type: "web", url, ...(title ? { title } : {}) };
  const ld = jsonLdRecipeText(html);
  const text = ld ?? [metaContent(html, "og:description"), htmlToText(html, 15000)].filter(Boolean).join("\n\n");
  // 구조화된 레시피(JSON-LD)는 짧아도 완전하다. 일반 본문만 최소 길이를 본다
  if (!ld && text.replace(/\s/g, "").length < 60) {
    return viaClaude(new GenerationError("페이지에서 글을 찾지 못했어요. 본문을 복사해 붙여넣거나 스크린샷을 올려 주세요.", 422, "empty_page"));
  }
  const parts: AiPart[] = [{ type: "text", text: `웹 페이지\n제목: ${title ?? "(없음)"}\n주소: ${url}\n\n${ld ? "구조화된 레시피 정보:\n" : "본문:\n"}${text}` }];
  return runImport(importAi(env, parts), parts, source, ld ? "jsonld" : "page");
}

export async function importFromText(env: ImportEnv, input: { text?: string | null; images?: { mediaType: ImageMediaType; data: string }[]; url?: string | null }): Promise<ImportResponse> {
  const images = input.images ?? [];
  const text = input.text?.trim() ?? "";
  const isInsta = !!input.url && linkKind(input.url) === "instagram";
  const source: RecipeSource = {
    type: isInsta ? "instagram" : images.length > 0 && !text ? "photo" : "text",
    ...(input.url && isSafePublicUrl(input.url) ? { url: input.url } : {}),
  };
  const parts: AiPart[] = [
    ...images.map((im) => ({ type: "image" as const, mediaType: im.mediaType, data: im.data })),
    { type: "text", text: [isInsta ? "인스타그램 게시물" : images.length && !text ? "레시피 사진" : "붙여넣은 글", text ? `\n${text.slice(0, 8000)}` : `\n사진 ${images.length}장`].join("") },
  ];
  return runImport(importAi(env, parts), parts, source, images.length && !text ? "photo" : "caption");
}
