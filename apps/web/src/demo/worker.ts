/** 체험판 전용: AI 서버(Worker) 대신 미리 준비한 예시 답을 조금 기다렸다 돌려준다 */
import { addDays, localDate, type RecipeDraft } from "@cook/shared";
import { demoRecipeFor, DEMO_RECIPES } from "./recipes";

type Body = Record<string, unknown> & {
  dish?: string; servings?: number; research?: boolean; url?: string; text?: string; images?: unknown[];
  question?: string; step?: number | null; instruction?: string; recipe?: RecipeDraft; missing?: { name: string }[];
  fridge?: string[]; names?: string[]; items?: { name: string }[]; mustUse?: string[]; exclude?: string[]; mood?: string; avoid?: string[]; mode?: string;
};

export class DemoHttpError extends Error { constructor(public status: number, message: string, public code?: string) { super(message); } }

const wait = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener("abort", () => { clearTimeout(t); reject(new DOMException("aborted", "AbortError")); });
});

const KEYS: Record<string, string> = {
  스파게티면: "spaghetti", 파스타면: "spaghetti", 깐마늘: "garlic", 마늘: "garlic", 올리브유: "olive_oil", 올리브오일: "olive_oil", 대파: "green_onion", 파: "green_onion",
  두부: "tofu", 소금: "salt", 우유: "milk", 달걀: "egg", 계란: "egg", 김치: "kimchi", 신김치: "kimchi", 양파: "onion", 감자: "potato", 애호박: "zucchini",
  돼지고기: "pork", 삼겹살: "pork_belly", 고등어: "mackerel", 간장: "soy_sauce", 된장: "doenjang", 참기름: "sesame_oil", 고춧가루: "chili_powder",
};

const RECEIPT = [
  ["우유", "milk", "서울우유 1L", 1, "팩", "냉장", "유제품", "🥛", 10, "1L"],
  ["달걀", "egg", "대란 15구", 15, "개", "냉장", "달걀", "🥚", 30, "대란"],
  ["두부", "tofu", "부침두부", 1, "모", "냉장", "두부·콩", "🫘", 7, ""],
  ["대파", "green_onion", "대파 1단", 1, "단", "냉장", "채소", "🌿", 10, ""],
  ["사과", "apple", "부사 사과 1.5kg", 1.5, "kg", "냉장", "과일", "🍎", 21, "부사"],
  ["삼겹살", "pork_belly", "국내산 삼겹살 600g", 600, "g", "냉장", "육류", "🥓", 3, "국내산"],
  ["콩나물", "bean_sprouts", "콩나물 300g", 300, "g", "냉장", "채소", "🌱", 4, ""],
  ["만두", "dumpling", "왕교자 1.05kg", 1.05, "kg", "냉동", "냉동식품", "🥟", 180, ""],
  ["라면", "ramen", "라면 5입", 5, "봉", "실온", "곡물·면", "🍜", 180, ""],
  ["종량제봉투", "trash_bag", "종량제봉투 20L", 1, "개", "실온", "기타", "🛍️", null, ""],
].map(([name, key, rawText, qty, unit, location, category, emoji, shelfLifeDays, memo]) => ({
  name, key, rawText, qty, unit, location, category, emoji, shelfLifeDays, memo, dateFromPackage: false, isFood: key !== "trash_bag",
}));
const PHOTO = [
  { name: "양배추", key: "cabbage", rawText: "랩에 싼 양배추 반 통", qty: 0.5, unit: "포기", location: "냉장", category: "채소", emoji: "🥬", shelfLifeDays: 14, dateFromPackage: false, memo: "", isFood: true },
  { name: "요거트", key: "yogurt", rawText: "플레인 요거트 컵", qty: 4, unit: "개", location: "냉장", category: "유제품", emoji: "🥛", shelfLifeDays: 12, dateFromPackage: true, memo: "", isFood: true },
  { name: "당근", key: "carrot", rawText: "당근 2개", qty: 2, unit: "개", location: "냉장", category: "채소", emoji: "🥕", shelfLifeDays: 14, dateFromPackage: false, memo: "", isFood: true },
];

/** /health */
export const DEMO_HEALTH = { ok: true, ai: { provider: "claude", model: "demo", fastModel: "demo", webSearch: true }, configured: { gemini: false } };

export async function demoWorker<T>(path: string, body: Body = {}, signal?: AbortSignal): Promise<T> {
  const today = localDate();
  const reply = async (ms: number, data: unknown) => { await wait(ms, signal); return { ...(data as object), provider: "claude", model: "demo" } as T; };
  switch (path) {
    case "/usage": return { today: { used: 0, limit: 40, familyUsed: 0, familyLimit: 150, remaining: 40 } } as T;
    case "/normalize": return reply(150, { items: (body.names ?? []).map((name) => ({ name, key: KEYS[name.replace(/\s/g, "")] ?? name })) });
    case "/recipe": {
      const r = demoRecipeFor(String(body.dish ?? ""), Number(body.servings ?? 2));
      const recipe = body.research ? { ...r, source: { type: "generated", refs: [{ url: "https://www.10000recipe.com/", title: "만개의레시피 (체험판 예시)" }] } } : r;
      return reply(body.research ? 2600 : 1600, { recipe, usage: { input: 0, output: 0 } });
    }
    case "/import/url": {
      const u = String(body.url ?? "");
      if (u.includes("instagram.com")) throw new DemoHttpError(422, "체험판에서는 인스타 게시물을 읽지 않아요. 캡션을 복사해 붙여넣거나, 영상을 화면 녹화해 올려 주세요.", "instagram");
      const yt = /youtu/.test(u);
      const recipe = { ...demoRecipeFor(yt ? "김치찌개" : "된장찌개", 2), source: yt ? { type: "youtube", url: u, channel: "예시 채널", title: "체험판 예시 영상" } : { type: "web", url: u, title: "체험판 예시 글" } };
      return reply(1800, { result: { hasRecipe: true, reason: "", dishName: recipe.title, recipe }, via: yt ? "youtube_description" : "jsonld" });
    }
    case "/import/text": {
      if (!(body.text && String(body.text).trim()) && !(body.images?.length)) throw new DemoHttpError(400, "글이나 사진이 필요합니다");
      const recipe = { ...demoRecipeFor("떡볶이", 2), title: "메모 레시피 (예시)", source: body.text ? { type: "text" } : { type: "photo" } };
      return reply(1800, { result: { hasRecipe: true, reason: "", dishName: recipe.title, recipe }, via: body.text ? "caption" : "photo" });
    }
    case "/ask": {
      const q = String(body.question ?? "");
      const answer = /대신|없으면|없어/.test(q) ? "**체험판 예시 답변이에요.** 비슷한 맛을 내는 재료로 바꾸면 돼요. 예를 들어 간장이 없으면 소금을 조금씩 넣어 간을 보세요."
        : /미리|보관|남은/.test(q) ? "**체험판 예시 답변이에요.** 식힌 뒤 밀폐 용기에 담아 냉장 2일까지 괜찮아요. 데울 때 물을 조금 더해 주세요."
          : /얼마|양|몇/.test(q) ? "**체험판 예시 답변이에요.** 2인분 기준으로 레시피 양 그대로면 충분해요. 싱거우면 마지막에 조금씩 더하세요."
            : "**체험판 예시 답변이에요.** 실제 앱에서는 AI 셰프가 이 레시피와 지금 단계를 보고 답해 줘요.";
      return reply(1200, { answer: body.step ? `(${body.step}단계) ${answer}` : answer, followups: ["불 세기는?", "미리 만들어 둬도 돼?", "아이도 먹을 수 있게 하려면?"] });
    }
    case "/adapt": {
      const base = body.recipe as RecipeDraft;
      return reply(2000, { summary: `${body.instruction}에 맞게 양념을 조절했어요 (체험판 예시)`, recipe: { ...base, title: `${base.title} (${body.instruction})`, source: { type: "generated" }, servingsBase: Number(body.servings ?? base.servingsBase) } });
    }
    case "/substitute": {
      const fridge = body.fridge ?? [];
      return reply(1200, { items: (body.missing ?? []).map((m, i) => ({ ingredient: m.name, skippable: true, options: [{ name: fridge[i] ?? "비슷한 재료", fromFridge: !!fridge[i], amount: "조금", how: "체험판 예시: 비슷한 역할을 해요" }] })) });
    }
    case "/suggest": {
      const names = (body.items ?? []).map((i) => i.name);
      const second = (body.avoid ?? []).length > 0;
      const titles = second ? ["고등어 김치찜", "두부 부침", "감자조림", "대파 라면", "삼겹살 숙주볶음"] : ["고등어구이", "애호박 된장찌개", "삼겹살 김치볶음", "계란말이", "감자전"];
      const suggestions = titles.map((title, i) => ({
        title, reason: "냉장고에 있는 재료로 금방 만들 수 있어요 (체험판 예시)",
        uses: names.slice(i, i + 2), missing: i === 1 ? ["청양고추"] : [], timeMinutes: 15 + i * 5, difficulty: "쉬움", tags: ["집밥"],
      }));
      return reply(2200, { suggestions, dropped: 0 });
    }
    case "/pantry/receipt": {
      if (!body.images?.length) throw new DemoHttpError(400, "사진이 필요합니다");
      const scan = body.mode === "photo"
        ? { store: null, purchasedAt: null, items: PHOTO }
        : { store: "예시 마트 (체험판)", purchasedAt: addDays(today, -1), items: RECEIPT };
      return reply(2500, { scan, usage: { input: 0, output: 0 } });
    }
    default: throw new DemoHttpError(404, "체험판에서는 쓸 수 없는 기능이에요");
  }
}

export { DEMO_RECIPES };
