/** 체험판 예시 레시피 (처음 데이터와 가짜 AI가 함께 쓴다) */
import type { Ingredient, RecipeDraft, Step } from "@cook/shared";

const ing = (name: string, key: string, qty: number | null, unit: Ingredient["unit"], group: Ingredient["group"] = "주재료", extra: Partial<Ingredient> = {}): Ingredient => ({
  name, key, qty, unit, group, scalable: qty != null, optional: false, ...extra,
});
const step = (order: number, text: string, minutes: number | null, ingredientKeys: string[] = []): Step => ({ order, text, minutes, ingredientKeys });
const NOTE = "체험판: 실제 AI 대신 미리 준비한 예시 레시피예요";

export const DEMO_RECIPES: (RecipeDraft & { match: RegExp })[] = [
  {
    match: /알리오|올리오|파스타|스파게티/,
    title: "알리오올리오", source: { type: "generated" }, servingsBase: 2, timeMinutes: 20, difficulty: "쉬움", tags: ["파스타", "20분요리"],
    ingredients: [
      ing("스파게티면", "spaghetti", 200, "g"),
      ing("마늘", "garlic", 8, "쪽", "주재료", { note: "편으로 썬 것" }),
      ing("올리브오일", "olive_oil", 4, "큰술", "양념"),
      ing("페페론치노", "chili_flakes", 1, "작은술", "양념", { optional: true }),
      ing("소금", "salt", null, "기타", "양념", { scalable: false, note: "약간" }),
      ing("파슬리", "parsley", null, "기타", "고명", { scalable: false, optional: true, note: "약간" }),
    ],
    steps: [
      step(1, "큰 냄비에 물 2L를 끓이고 소금 1큰술을 넣은 뒤 면을 봉지 표기보다 1분 짧게 삶는다.", 9, ["spaghetti", "salt"]),
      step(2, "팬에 올리브오일을 두르고 약불에서 편마늘을 노릇해질 때까지 천천히 볶는다.", 4, ["olive_oil", "garlic"]),
      step(3, "페페론치노를 넣고 10초 볶은 뒤 면수 한 국자를 넣고 빠르게 저어 오일과 섞는다.", null, ["chili_flakes"]),
      step(4, "삶은 면을 넣고 중불에서 면수를 조금씩 더하며 소스가 면에 코팅될 때까지 1분간 뒤적인다.", 1),
      step(5, "불을 끄고 파슬리를 뿌려 바로 낸다.", null, ["parsley"]),
    ],
    tips: [NOTE, "면수의 전분이 오일과 섞여야 소스가 겉돌지 않아요.", "마늘은 타기 직전 색에서 멈추세요."],
  },
  {
    match: /김치찌개|김치 찌개/,
    title: "돼지고기 김치찌개", source: { type: "generated" }, servingsBase: 2, timeMinutes: 30, difficulty: "쉬움", tags: ["찌개", "집밥"],
    ingredients: [
      ing("신김치", "kimchi", 300, "g"),
      ing("돼지고기 앞다리살", "pork", 200, "g"),
      ing("두부", "tofu", 0.5, "모"),
      ing("양파", "onion", 0.5, "개", "부재료"),
      ing("대파", "green_onion", 1, "대", "부재료"),
      ing("고춧가루", "chili_powder", 1, "큰술", "양념"),
      ing("다진 마늘", "garlic", 1, "큰술", "양념"),
      ing("국간장", "soy_sauce", 1, "큰술", "양념"),
      ing("물", "water", 600, "ml", "기타"),
    ],
    steps: [
      step(1, "냄비에 돼지고기를 넣고 중불에서 기름이 나올 때까지 볶는다.", 3, ["pork"]),
      step(2, "김치를 넣고 고기와 함께 5분 볶아 신맛을 날린다.", 5, ["kimchi"]),
      step(3, "물, 고춧가루, 다진 마늘을 넣고 끓어오르면 중약불로 줄여 끓인다.", 10, ["water", "chili_powder", "garlic"]),
      step(4, "양파와 두부를 넣고 국간장으로 간을 맞춘다.", 5, ["onion", "tofu", "soy_sauce"]),
      step(5, "대파를 넣고 한소끔 더 끓여 낸다.", 1, ["green_onion"]),
    ],
    tips: [NOTE, "김치가 덜 시었으면 설탕을 반 작은술 넣어 맛을 둥글게 해요."],
  },
  {
    match: /된장/,
    title: "애호박 된장찌개", source: { type: "generated" }, servingsBase: 2, timeMinutes: 25, difficulty: "쉬움", tags: ["찌개", "집밥"],
    ingredients: [
      ing("된장", "doenjang", 2, "큰술", "양념"),
      ing("애호박", "zucchini", 0.5, "개"),
      ing("두부", "tofu", 0.5, "모"),
      ing("감자", "potato", 1, "개"),
      ing("양파", "onion", 0.5, "개", "부재료"),
      ing("대파", "green_onion", 0.5, "대", "부재료"),
      ing("청양고추", "chili_pepper", 1, "개", "부재료", { optional: true }),
      ing("물", "water", 500, "ml", "기타"),
    ],
    steps: [
      step(1, "물에 된장을 풀고 깍둑썬 감자를 넣어 끓인다.", 8, ["water", "doenjang", "potato"]),
      step(2, "애호박과 양파를 넣고 5분 더 끓인다.", 5, ["zucchini", "onion"]),
      step(3, "두부를 넣고 한소끔 끓인다.", 3, ["tofu"]),
      step(4, "대파와 청양고추를 넣고 불을 끈다.", null, ["green_onion", "chili_pepper"]),
    ],
    tips: [NOTE, "쌀뜨물을 쓰면 국물이 더 구수해요."],
  },
  {
    match: /계란|달걀/,
    title: "계란말이", source: { type: "generated" }, servingsBase: 2, timeMinutes: 15, difficulty: "보통", tags: ["반찬", "아이 반찬"],
    ingredients: [
      ing("달걀", "egg", 4, "개"),
      ing("대파", "green_onion", 0.3, "대", "부재료"),
      ing("당근", "carrot", 20, "g", "부재료", { optional: true }),
      ing("소금", "salt", null, "기타", "양념", { scalable: false, note: "두 꼬집" }),
      ing("식용유", "cooking_oil", 1, "큰술", "양념"),
    ],
    steps: [
      step(1, "달걀을 풀고 잘게 썬 대파·당근과 소금을 넣어 섞는다.", null, ["egg", "green_onion", "carrot", "salt"]),
      step(2, "약불로 달군 팬에 기름을 얇게 두르고 달걀물의 1/3을 붓는다.", 1, ["cooking_oil"]),
      step(3, "반쯤 익으면 한쪽 끝부터 돌돌 말고, 남은 달걀물을 이어 부어 다시 만다.", 5),
      step(4, "한 김 식힌 뒤 썰어 낸다.", null),
    ],
    tips: [NOTE, "불을 약하게 유지해야 겉이 타지 않고 속까지 부드러워요."],
  },
  {
    match: /고등어/,
    title: "고등어구이", source: { type: "generated" }, servingsBase: 2, timeMinutes: 20, difficulty: "쉬움", tags: ["생선", "집밥"],
    ingredients: [
      ing("고등어", "mackerel", 1, "마리"),
      ing("밀가루", "flour", 1, "큰술", "부재료", { optional: true }),
      ing("식용유", "cooking_oil", 2, "큰술", "양념"),
      ing("소금", "salt", null, "기타", "양념", { scalable: false, note: "약간" }),
    ],
    steps: [
      step(1, "고등어 물기를 키친타월로 닦고 앞뒤로 밀가루를 얇게 묻힌다.", null, ["mackerel", "flour"]),
      step(2, "팬에 기름을 두르고 껍질 쪽부터 중불에서 굽는다.", 5, ["cooking_oil"]),
      step(3, "뒤집어서 4분 더 굽고 소금을 살짝 뿌린다.", 4, ["salt"]),
    ],
    tips: [NOTE, "자주 뒤집지 않아야 살이 부서지지 않아요."],
  },
  {
    match: /볶음밥/,
    title: "김치볶음밥", source: { type: "generated" }, servingsBase: 2, timeMinutes: 15, difficulty: "쉬움", tags: ["한그릇", "15분요리"],
    ingredients: [
      ing("밥", "rice", 400, "g"),
      ing("신김치", "kimchi", 150, "g"),
      ing("달걀", "egg", 2, "개"),
      ing("대파", "green_onion", 0.5, "대", "부재료"),
      ing("고춧가루", "chili_powder", 0.5, "큰술", "양념"),
      ing("참기름", "sesame_oil", 1, "큰술", "양념"),
    ],
    steps: [
      step(1, "팬에 기름을 두르고 대파를 볶아 파기름을 낸다.", 2, ["green_onion"]),
      step(2, "김치를 넣고 3분 볶은 뒤 고춧가루를 넣는다.", 3, ["kimchi", "chili_powder"]),
      step(3, "밥을 넣고 고루 볶은 뒤 참기름을 두른다.", 3, ["rice", "sesame_oil"]),
      step(4, "달걀 프라이를 올려 낸다.", 3, ["egg"]),
    ],
    tips: [NOTE],
  },
];

/** 음식 이름에 맞는 예시 레시피 (없으면 비슷한 기본 레시피를 그 이름으로) */
export function demoRecipeFor(dish: string, servings: number): RecipeDraft {
  const base = DEMO_RECIPES.find((r) => r.match.test(dish)) ?? DEMO_RECIPES[DEMO_RECIPES.length - 1];
  const f = servings / base.servingsBase;
  const { match: _m, ...draft } = base;
  return {
    ...draft,
    title: dish.trim() || base.title,
    servingsBase: servings,
    ingredients: base.ingredients.map((i) => ({ ...i, qty: i.qty == null || !i.scalable ? i.qty : Math.round(i.qty * f * 10) / 10 })),
  };
}
