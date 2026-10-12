// 2단계 e2e용 가짜 Worker: Authorization 헤더만 확인하고 고정 레시피를 돌려준다.
import { createServer } from "node:http";
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
  const cors = { "Access-Control-Allow-Origin": req.headers.origin ?? "*", "Access-Control-Allow-Headers": "Content-Type,Authorization", "Access-Control-Allow-Methods": "GET,POST,OPTIONS" };
  if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
  if (req.url === "/health") { res.writeHead(200, { ...cors, "content-type": "application/json" }); return res.end(JSON.stringify({ ok: true, ai: { provider: process.env.MOCK_PROVIDER ?? "gemini", model: "mock" } })); }
  let body = ""; req.on("data", (c) => (body += c)); req.on("end", () => {
    const auth = req.headers.authorization ?? "";
    if (!auth.startsWith("Bearer ") || auth.length < 40) { res.writeHead(401, { ...cors, "content-type": "application/json" }); return res.end(JSON.stringify({ error: "로그인이 필요합니다" })); }
    if (req.url === "/recipe") {
      calls++; const b = JSON.parse(body || "{}");
      console.log("mock /recipe", JSON.stringify({ dish: b.dish, servings: b.servings, profile: b.profile, notes: b.notes }));
      if (b.dish === "실패테스트") { res.writeHead(502, { ...cors, "content-type": "application/json" }); return res.end(JSON.stringify({ error: "AI 호출 실패 (테스트)" })); }
      const f = (b.servings ?? 2) / 2; // 실제 AI처럼 요청 인분 기준 분량으로
      const r = { ...recipe, title: b.dish, servingsBase: b.servings, ingredients: recipe.ingredients.map((i) => ({ ...i, qty: i.qty == null ? null : i.qty * f })) };
      setTimeout(() => { res.writeHead(200, { ...cors, "content-type": "application/json" }); res.end(JSON.stringify({ recipe: r, model: "mock", usage: { input: 1, output: 1 } })); }, 800);
      return;
    }
    if (req.url === "/import/url" || req.url === "/import/text") {
      const b = JSON.parse(body || "{}");
      console.log("mock " + req.url, JSON.stringify({ url: b.url, text: b.text?.slice(0, 40), images: b.images?.length }));
      const send = (status, data) => { res.writeHead(status, { ...cors, "content-type": "application/json" }); res.end(JSON.stringify(data)); };
      const make = (title, source) => ({ ...recipe, title, servingsBase: 2, source });
      if (req.url === "/import/url") {
        const u = String(b.url ?? "");
        if (u.includes("instagram.com")) return send(422, { error: "인스타그램은 링크만으로 내용을 볼 수 없어요. 캡션을 복사해 붙여넣거나 스크린샷을 올려 주세요.", code: "instagram" });
        if (u.includes("noRecipe")) return setTimeout(() => send(200, { result: { hasRecipe: false, reason: "설명란에 레시피가 없어요", dishName: "김치볶음밥", recipe: null }, via: "youtube_description", provider: "mock", model: "mock" }), 500);
        if (u.includes("youtu")) {
          const id = /([\w-]{11})/.exec(u.split("/").pop().replace("watch?v=", ""))?.[1] ?? "mockRecipe1";
          return setTimeout(() => send(200, { result: { hasRecipe: true, reason: "", dishName: "김치찌개", recipe: make("유튜브 김치찌개", { type: "youtube", url: `https://www.youtube.com/watch?v=${id}`, channel: "엄마손", title: "10분 김치찌개" }) }, via: "youtube_description", provider: "mock", model: "mock" }), 700);
        }
        return setTimeout(() => send(200, { result: { hasRecipe: true, reason: "", dishName: "된장찌개", recipe: make("블로그 된장찌개", { type: "web", url: u, title: "된장찌개 황금레시피" }) }, via: "jsonld", provider: "mock", model: "mock" }), 700);
      }
      if (!(b.text && b.text.trim()) && !(b.images?.length)) return send(400, { error: "글이나 사진이 필요합니다" });
      const insta = String(b.url ?? "").includes("instagram.com");
      return setTimeout(() => send(200, { result: { hasRecipe: true, reason: "", dishName: "떡볶이", recipe: make(insta ? "인스타 떡볶이" : "메모 떡볶이", insta ? { type: "instagram", url: b.url } : { type: b.text ? "text" : "photo" }) }, via: b.text ? "caption" : "photo", provider: "mock", model: "mock" }), 700);
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
