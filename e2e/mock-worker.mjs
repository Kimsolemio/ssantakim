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
let calls = 0;
createServer((req, res) => {
  const cors = { "Access-Control-Allow-Origin": req.headers.origin ?? "*", "Access-Control-Allow-Headers": "Content-Type,Authorization", "Access-Control-Allow-Methods": "GET,POST,OPTIONS" };
  if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
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
    res.writeHead(404, cors); res.end();
  });
}).listen(8787, "127.0.0.1", () => console.log("mock worker on 8787"));
