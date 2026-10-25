// 2단계 e2e용 가짜 Worker: Authorization 헤더만 확인하고 고정 레시피를 돌려준다.
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
/** 인스타 릴스 영상 자리: E2E가 화면을 녹화해 여기에 놓는다 */
const REEL_FILE = join(tmpdir(), "family-cook-reel.webm");
const recipe = {
  title: "알리오올리오", source: { type: "generated" }, servingsBase: 2, timeMinutes: 20, difficulty: "쉬움",
  tags: ["파스타", "20분요리", "간단"],
  ingredients: [
    { name: "스파게티면", key: "spaghetti", qty: 200, unit: "g", scalable: true, optional: false, group: "주재료" },
    { name: "마늘", key: "garlic", qty: 8, unit: "쪽", scalable: true, optional: false, group: "주재료", note: "편으로 썬 것" },
    { name: "올리브오일", key: "olive_oil", qty: 4, unit: "큰술", scalable: true, optional: false, group: "양념" },
    { name: "페페론치노", key: "chili_flakes", qty: 1, unit: "작은술", scalable: true, optional: true, group: "양념" },
    { name: "소금", key: "salt", qty: null, unit: "기타", scalable: false, optional: false, group: "양념", note: "약간" },
    { name: "파슬리", key: "parsley", qty: null, unit: "기타", scalable: false, optional: true, group: "고명", note: "약간" }
  ],
  steps: [
    { order: 1, text: "큰 냄비에 물 2L를 끓이고 소금 1큰술을 넣은 뒤 면을 봉지 표기보다 1분 짧게 삶는다.", minutes: 9, ingredientKeys: ["spaghetti", "salt"] },
    { order: 2, text: "팬에 올리브오일을 두르고 약불에서 편마늘을 노릇해질 때까지 천천히 볶는다.", minutes: 4, ingredientKeys: ["olive_oil", "garlic"] },
    { order: 3, text: "페페론치노를 넣고 10초 볶은 뒤 면수 한 국자를 넣고 빠르게 저어 오일과 섞는다.", minutes: null, ingredientKeys: ["chili_flakes"] },
    { order: 4, text: "삶은 면을 넣고 중불에서 면수를 조금씩 더하며 소스가 면에 코팅될 때까지 1분간 뒤적인다.", minutes: 1, ingredientKeys: [] },
    { order: 5, text: "불을 끄고 파슬리를 뿌려 바로 낸다.", minutes: null, ingredientKeys: ["parsley"] }
  ],
  tips: ["면수의 전분이 오일과 유화되어야 소스가 겉돌지 않아요.", "마늘은 타기 직전 색에서 멈추세요."]
};
// 영수증 분석 가짜 응답: 칸 배치를 골고루 확인할 수 있게 고른 품목들
const receiptItems = [
  ["우유", "milk", "서울우유 1L", 1, "팩", "냉장", "유제품", "🥛", 10, "서울우유 1L"],
  ["달걀", "egg", "무항생제 대란 15구", 15, "개", "냉장", "달걀", "🥚", 30, "대란"],
  ["두부", "tofu", "풀무원 부침두부", 1, "모", "냉장", "두부·콩", "🫘", 7, "풀무원"],
  ["대파", "green_onion", "대파 1단", 1, "봉", "냉장", "채소", "🌿", 10, ""],
  ["사과", "apple", "부사 사과 1.5kg", 1.5, "kg", "냉장", "과일", "🍎", 21, "부사"],
  ["삼겹살", "pork_belly", "국내산 삼겹살 600g", 600, "g", "냉장", "육류", "🥓", 3, "국내산"],
  ["고등어", "mackerel", "손질 고등어 2마리", 2, "개", "냉장", "해산물", "🐟", 2, "손질"],
  ["김치", "kimchi", "종가 포기김치 1kg", 1, "kg", "냉장", "반찬·가공", "🥬", 30, "종가"],
  ["콜라", "cola", "코카콜라 1.5L", 1, "개", "냉장", "음료", "🥤", 180, "1.5L"],
  ["간장", "soy_sauce", "샘표 진간장 500ml", 500, "ml", "냉장", "소스·양념", "🫙", 365, "샘표"],
  ["만두", "dumpling", "비비고 왕교자 1.05kg", 1.05, "kg", "냉동", "냉동식품", "🥟", 180, "비비고"],
  ["아이스크림", "ice_cream", "메로나 6개입", 6, "개", "냉동", "간식", "🍦", 365, "메로나"],
  ["라면", "ramen", "신라면 5입", 5, "봉", "실온", "곡물·면", "🍜", 180, "신라면"],
  ["양파", "onion", "양파 1.5kg", 1.5, "kg", "실온", "채소", "🧅", 30, ""],
  ["종량제봉투", "trash_bag", "종량제봉투 20L", 1, "개", "실온", "기타", "🛍️", null, ""],
].map(([name, key, rawText, qty, unit, location, category, emoji, shelfLifeDays, memo]) => ({
  name, key, rawText, qty, unit: unit === "모" ? "개" : unit, location, category, emoji, shelfLifeDays, memo, isFood: key !== "trash_bag",
}));
const minusDays = (d, n) => { const [y, m, dd] = d.split("-").map(Number); const t = new Date(y, m - 1, dd - n); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`; };

let calls = 0;
createServer((req, res) => {
  const cors = { "Access-Control-Allow-Origin": req.headers.origin ?? "*", "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Family-Id", "Access-Control-Allow-Methods": "GET,POST,OPTIONS" };
  if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
  if (req.url === "/health") { res.writeHead(200, { ...cors, "content-type": "application/json" }); return res.end(JSON.stringify({ ok: true, ai: { provider: process.env.MOCK_PROVIDER ?? "claude", model: "mock", fastModel: "mock-fast", webSearch: true }, configured: { gemini: false } })); }
  let body = ""; req.on("data", (c) => (body += c)); req.on("end", () => {
    const auth = req.headers.authorization ?? "";
    if (!auth.startsWith("Bearer ") || auth.length < 40) { res.writeHead(401, { ...cors, "content-type": "application/json" }); return res.end(JSON.stringify({ error: "로그인이 필요합니다" })); }
    if (req.url === "/recipe") {
      calls++; const b = JSON.parse(body || "{}");
      console.log("mock /recipe", JSON.stringify({ dish: b.dish, servings: b.servings, profile: b.profile, notes: b.notes }));
      if (b.dish === "실패테스트") { res.writeHead(502, { ...cors, "content-type": "application/json" }); return res.end(JSON.stringify({ error: "AI 호출 실패 (테스트)" })); }
      const f = (b.servings ?? 2) / 2; // 실제 AI처럼 요청 인분 기준 분량으로
      const r = { ...recipe, title: b.dish, servingsBase: b.servings, ingredients: recipe.ingredients.map((i) => ({ ...i, qty: i.qty == null ? null : i.qty * f })),
        ...(b.research ? { source: { type: "generated", refs: [{ url: "https://www.10000recipe.com/recipe/1", title: "참고 레시피 (mock)" }] } } : {}) };
      setTimeout(() => { res.writeHead(200, { ...cors, "content-type": "application/json" }); res.end(JSON.stringify({ recipe: r, model: "mock", usage: { input: 1, output: 1 } })); }, 800);
      return;
    }
    // 인스타 릴스 영상: 앱이 받아 장면을 뽑는다
    if (req.url === "/import/instagram-video") {
      const b = JSON.parse(body || "{}");
      console.log("mock /import/instagram-video", JSON.stringify({ url: b.url }));
      if (!String(b.url ?? "").includes("REELvideo") || !existsSync(REEL_FILE)) { res.writeHead(422, { ...cors, "content-type": "application/json" }); return res.end(JSON.stringify({ error: "이 게시물의 영상을 받지 못했어요. 캡션을 복사해 붙여넣거나, 영상을 화면 녹화해 올려 주세요.", code: "instagram" })); }
      res.writeHead(200, { ...cors, "content-type": "video/webm" });
      return res.end(readFileSync(REEL_FILE));
    }
    if (req.url === "/import/url" || req.url === "/import/text") {
      const b = JSON.parse(body || "{}");
      console.log("mock " + req.url, JSON.stringify({ url: b.url, text: b.text?.slice(0, 40), images: b.images?.length, frames: b.frames }));
      const send = (status, data) => { res.writeHead(status, { ...cors, "content-type": "application/json" }); res.end(JSON.stringify(data)); };
      const make = (title, source) => ({ ...recipe, title, servingsBase: 2, source });
      if (req.url === "/import/url") {
        const u = String(b.url ?? "");
        // 공개 게시물(캡션을 읽을 수 있는 경우)과 막힌 경우
        // 캡션이 짧은 릴스: AI 없이 "영상을 봐 주세요"
        if (u.includes("instagram.com/reel/REELvideo")) return setTimeout(() => send(200, { result: { hasRecipe: false, reason: "캡션이 짧아 영상을 보고 찾아야 해요", dishName: null, recipe: null }, via: "instagram_caption", provider: "mock", model: "", video: { caption: "Salmon Sushi 🍣" } }), 300);
        if (u.includes("instagram.com/p/OKpost")) return setTimeout(() => send(200, { result: { hasRecipe: true, reason: "", dishName: "떡볶이", recipe: make("인스타 캡션 떡볶이", { type: "instagram", url: u, channel: "cook_mom" }) }, via: "instagram_caption", provider: "mock", model: "mock" }), 700);
        if (u.includes("instagram.com")) return send(422, { error: "인스타그램이 이 게시물 내용을 보여 주지 않았어요. 캡션을 복사해 붙여넣거나, 영상을 화면 녹화해 올려 주세요.", code: "instagram" });
        if (u.includes("noRecipe")) return setTimeout(() => send(200, { result: { hasRecipe: false, reason: "설명란에 레시피가 없어요", dishName: "김치볶음밥", recipe: null }, via: "youtube_description", provider: "mock", model: "mock" }), 500);
        if (u.includes("youtu")) {
          const id = /([\w-]{11})/.exec(u.split("/").pop().replace("watch?v=", ""))?.[1] ?? "mockRecipe1";
          return setTimeout(() => send(200, { result: { hasRecipe: true, reason: "", dishName: "김치찌개", recipe: make("유튜브 김치찌개", { type: "youtube", url: `https://www.youtube.com/watch?v=${id}`, channel: "엄마손", title: "10분 김치찌개" }) }, via: "youtube_description", provider: "mock", model: "mock" }), 700);
        }
        return setTimeout(() => send(200, { result: { hasRecipe: true, reason: "", dishName: "된장찌개", recipe: make("블로그 된장찌개", { type: "web", url: u, title: "된장찌개 황금레시피" }) }, via: "jsonld", provider: "mock", model: "mock" }), 700);
      }
      if (!(b.text && b.text.trim()) && !(b.images?.length)) return send(400, { error: "글이나 사진이 필요합니다" });
      // 영상에서 뽑은 장면: 앱이 frames 표시와 함께 여러 장을 보낸다
      if (b.frames) {
        // 릴스 영상 장면: 캡션과 게시물 주소가 함께 와야 한다
        const reel = String(b.url ?? "").includes("REELvideo");
        const title = reel ? `릴스 연어초밥 ${b.images.length}장 ${b.text === "Salmon Sushi 🍣" ? "캡션있음" : "캡션없음"}` : `영상 장면 떡볶이 ${b.images.length}장`;
        return setTimeout(() => send(200, { result: { hasRecipe: (b.images?.length ?? 0) >= 2, reason: "", dishName: "떡볶이", recipe: make(title, reel ? { type: "instagram", url: b.url } : { type: "photo" }) }, via: "photo", provider: "mock", model: "mock" }), 700);
      }
      const insta = String(b.url ?? "").includes("instagram.com");
      return setTimeout(() => send(200, { result: { hasRecipe: true, reason: "", dishName: "떡볶이", recipe: make(insta ? "인스타 떡볶이" : "메모 떡볶이", insta ? { type: "instagram", url: b.url } : { type: b.text ? "text" : "photo" }) }, via: b.text ? "caption" : "photo", provider: "mock", model: "mock" }), 700);
    }
    if (req.url === "/ask" || req.url === "/adapt" || req.url === "/substitute") {
      const b = JSON.parse(body || "{}");
      console.log("mock " + req.url, JSON.stringify({ q: b.question, step: b.step, instruction: b.instruction, missing: b.missing, history: b.history?.length }));
      const out = req.url === "/ask"
        ? { answer: `(${b.step ?? "-"}단계) 중불에서 1분 더 익히세요. 질문: ${b.question}`, followups: ["면수는 얼마나?", "소금은 언제?"] }
        : req.url === "/adapt"
          ? { summary: "고춧가루를 줄이고 단맛을 조금 더했어요", recipe: { ...recipe, title: `${b.recipe.title} (${b.instruction})`, servingsBase: b.servings } }
          : { items: [{ ingredient: b.missing[0].name, skippable: true, options: [{ name: b.fridge[0] ?? "고춧가루", fromFridge: !!b.fridge[0], amount: "조금", how: "매운맛을 대신해요" }] }] };
      setTimeout(() => { res.writeHead(200, { ...cors, "content-type": "application/json" }); res.end(JSON.stringify({ ...out, provider: "mock", model: "mock" })); }, 500);
      return;
    }
    // 오늘의 인기 레시피: 가족 ID 머리글이 함께 와야 한다 (허용 목록 밖 가족도 쓰게 하는 확인에 쓴다)
    if (req.url.startsWith("/trending")) {
      if (!req.headers["x-family-id"]) { res.writeHead(403, { ...cors, "content-type": "application/json" }); return res.end(JSON.stringify({ error: "가족 ID 없음", code: "not_allowed" })); }
      const v = (i, region, title) => ({ id: `vid${String(i).padStart(8, "0")}`, url: `https://www.youtube.com/shorts/vid${String(i).padStart(8, "0")}`, title, channel: `채널${i}`,
        likes: 120000 - i * 5000, views: 900000, thumbnail: "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==", publishedAt: "2026-10-20T00:00:00Z", seconds: 45, region, vertical: true });
      const videos = [v(1, "kr", "초간단 계란말이 레시피"), v(2, "kr", "대파 듬뿍 김치찌개"), v(3, "us", "Easy garlic pasta"), v(4, "jp", "親子丼の作り方"),
        v(5, "es", "Tortilla de patatas"), v(6, "kr", "두부조림 황금레시피"), v(7, "us", "Crispy potatoes")];
      res.writeHead(200, { ...cors, "content-type": "application/json" }); return res.end(JSON.stringify({ day: new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10), minLikes: 10000, videos }));
    }
    if (req.url === "/usage") { res.writeHead(200, { ...cors, "content-type": "application/json" }); return res.end(JSON.stringify({ today: { used: 3.25, limit: 40, familyUsed: 10, familyLimit: 150, remaining: 36.75 } })); }
    if (req.url === "/suggest") {
      const b = JSON.parse(body || "{}");
      console.log("mock /suggest", JSON.stringify({ items: b.items?.length, mustUse: b.mustUse, exclude: b.exclude, mood: b.mood, avoid: b.avoid }));
      const names = (b.items ?? []).map((i) => i.name);
      const second = (b.avoid ?? []).length > 0;
      const titles = second ? ["고등어 김치찜", "두부 부침", "계란말이", "대파 라면", "삼겹살 숙주볶음"] : ["고등어 구이", "두부 된장찌개", "삼겹살 김치볶음", "우유 계란찜", "만두 전골"];
      const suggestions = titles.map((title, i) => ({
        title, reason: `꼭 쓰기: ${(b.mustUse ?? []).join(",")} / 분위기: ${b.mood ?? ""} / 빼기: ${(b.exclude ?? []).join(",")}`,
        uses: names.slice(i, i + 2), missing: i === 1 ? ["애호박"] : [], timeMinutes: 15, difficulty: "쉬움", tags: ["집밥"],
      }));
      setTimeout(() => { res.writeHead(200, { ...cors, "content-type": "application/json" }); res.end(JSON.stringify({ suggestions, dropped: 0, provider: "mock", model: "mock" })); }, 600);
      return;
    }
    if (req.url === "/normalize") {
      const b = JSON.parse(body || "{}");
      const dict = { "스파게티면": "spaghetti", "깐마늘": "garlic", "올리브유": "olive_oil", "대파": "green_onion", "두부": "tofu", "소금": "salt", "우유": "milk" };
      const items = (b.names ?? []).map((name) => ({ name, key: dict[name.replace(/\s/g, "")] ?? name }));
      console.log("mock /normalize", JSON.stringify(items));
      res.writeHead(200, { ...cors, "content-type": "application/json" });
      return res.end(JSON.stringify({ items, provider: "mock", model: "mock" }));
    }
    if (req.url === "/pantry/receipt") {
      const b = JSON.parse(body || "{}");
      const ok = Array.isArray(b.images) && b.images.length > 0 && b.images.every((im) => im.mediaType === "image/jpeg" && typeof im.data === "string" && im.data.length > 1000 && !im.data.startsWith("data:"));
      console.log("mock /pantry/receipt", JSON.stringify({ mode: b.mode, images: b.images?.length, sizes: b.images?.map((im) => im.data.length), today: b.today, ok }));
      if (!ok) { res.writeHead(400, { ...cors, "content-type": "application/json" }); return res.end(JSON.stringify({ error: "사진 형식 오류 (mock)" })); }
      const photoItems = [
        { name: "양배추", key: "cabbage", rawText: "랩에 싼 양배추 반 통", qty: 0.5, unit: "포기", location: "냉장", category: "채소", emoji: "🥬", shelfLifeDays: 14, memo: "", isFood: true },
        { name: "달걀", key: "egg", rawText: "달걀 10구 판", qty: 10, unit: "개", location: "냉장", category: "달걀", emoji: "🥚", shelfLifeDays: 13, dateFromPackage: true, memo: "유통기한 10/25", isFood: true },
        { name: "요거트", key: "yogurt", rawText: "플레인 요거트 컵", qty: 4, unit: "개", location: "냉장", category: "유제품", emoji: "🥛", shelfLifeDays: null, memo: "확인 필요", isFood: true },
      ];
      const scan = b.mode === "photo" ? { store: null, purchasedAt: null, items: photoItems } : { store: "이마트 성수점", purchasedAt: minusDays(b.today, 1), items: receiptItems };
      setTimeout(() => { res.writeHead(200, { ...cors, "content-type": "application/json" }); res.end(JSON.stringify({ scan, provider: "mock", model: "mock", usage: { input: 1, output: 1 } })); }, 1200);
      return;
    }
    res.writeHead(404, cors); res.end();
  });
}).listen(8787, "127.0.0.1", () => console.log("mock worker on 8787"));
