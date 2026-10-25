import { z } from "zod";
import { FoodCategory } from "./food";

export const DEFAULT_STAPLES = ["소금", "설탕", "후춧가루", "간장", "식용유", "참기름", "식초", "참깨", "고춧가루"] as const;

/** 재료 표준 단위. "약간/적당량" 같은 비계량 표현은 unit="기타" + scalable=false 로 저장한다. */
export const Unit = z.enum([
  "g", "kg", "ml", "L", "개", "큰술", "작은술", "컵", "줌", "쪽", "장", "봉", "팩", "캔",
  // 한국 장보기·요리에서 흔한 셈 단위 (두부 1모, 대파 1단·1대, 생선 1마리, 배추 1포기, 소금 1꼬집 …)
  "모", "단", "대", "마리", "송이", "포기", "알", "병", "꼬집",
  "기타",
]);
export type Unit = z.infer<typeof Unit>;

export const StorageLocation = z.enum(["냉장", "냉동", "실온"]);
export type StorageLocation = z.infer<typeof StorageLocation>;

export const IngredientGroup = z.enum(["주재료", "부재료", "양념", "고명", "기타"]);
export type IngredientGroup = z.infer<typeof IngredientGroup>;

export const SourceType = z.enum(["generated", "youtube", "instagram", "photo", "text", "manual", "web"]);
export type SourceType = z.infer<typeof SourceType>;

/** 사람이 읽는 이름과 매칭용 표준 키를 항상 함께 가진다. key는 영문 snake_case (예: green_onion). */
export const Ingredient = z.object({
  name: z.string().min(1),
  key: z.string().min(1),
  qty: z.number().nonnegative().nullable(),
  unit: Unit,
  scalable: z.boolean().default(true),
  optional: z.boolean().default(false),
  group: IngredientGroup.default("주재료"),
  note: z.string().optional(),
});
export type Ingredient = z.infer<typeof Ingredient>;

export const Step = z.object({
  order: z.number().int().positive(),
  text: z.string().min(1),
  minutes: z.number().positive().nullable().default(null),
  ingredientKeys: z.array(z.string()).default([]),
});
export type Step = z.infer<typeof Step>;

export const RecipeSource = z.object({
  type: SourceType,
  url: z.string().url().optional(),
  channel: z.string().optional(),
  title: z.string().optional(),
  /** 웹 검색으로 참고한 레시피들 (AI 생성 + "인기 레시피 찾아보기") */
  refs: z.array(z.object({ url: z.string().url(), title: z.string().nullable() })).optional(),
});
export type RecipeSource = z.infer<typeof RecipeSource>;

export const CookedLogEntry = z.object({
  date: z.string(),
  by: z.string(),
  servings: z.number().positive(),
});

export const Recipe = z.object({
  title: z.string().min(1),
  source: RecipeSource,
  servingsBase: z.number().positive(),
  timeMinutes: z.number().nonnegative().nullable().default(null),
  difficulty: z.enum(["쉬움", "보통", "어려움"]).default("보통"),
  folderId: z.string().nullable().default(null),
  tags: z.array(z.string()).default([]),
  favorite: z.boolean().default(false),
  photoUrl: z.string().url().nullable().default(null),
  ingredients: z.array(Ingredient).min(1),
  steps: z.array(Step).min(1),
  tips: z.array(z.string()).default([]),
  cookedLog: z.array(CookedLogEntry).default([]),
  createdAt: z.string(),
  createdBy: z.string(),
});
export type Recipe = z.infer<typeof Recipe>;

/** AI가 생성하는 부분만 떼어낸 스키마 (createdAt/createdBy/folderId 등 앱 메타데이터 제외). Worker의 구조화 출력에 사용. */
export const RecipeDraft = Recipe.omit({
  folderId: true, favorite: true, photoUrl: true, cookedLog: true, createdAt: true, createdBy: true,
});
export type RecipeDraft = z.infer<typeof RecipeDraft>;

export const FridgeItem = z.object({
  name: z.string().min(1),
  key: z.string().min(1),
  qty: z.number().nonnegative().nullable(),
  unit: Unit,
  location: StorageLocation,
  expiresAt: z.string().nullable(), // YYYY-MM-DD
  addedBy: z.string(),
  addedAt: z.string(), // ISO
  photoUrl: z.string().url().nullable().default(null),
  memo: z.string().optional(),
  // 가상 냉장고(영수증 입력)에서 추가된 필드. 옛 데이터에는 없을 수 있다 → guessFood 로 추정
  category: FoodCategory.optional(),
  emoji: z.string().optional(),
  source: z.enum(["manual", "receipt", "photo"]).optional(),
  purchasedAt: z.string().nullable().optional(), // YYYY-MM-DD
  /** 유통기한이 포장 표시가 아니라 보통 보관 기간으로 추정한 값인가 */
  expiresEstimated: z.boolean().optional(),
});
export type FridgeItem = z.infer<typeof FridgeItem>;

/** 영수증·주문내역 캡처 한 줄을 AI가 읽은 결과 */
export const ReceiptItem = z.object({
  name: z.string().min(1),          // 브랜드·용량을 뺀 일반 재료 이름 (예: 깐마늘)
  key: z.string().min(1),           // 레시피 재료와 같은 규칙의 영문 snake_case (예: garlic)
  rawText: z.string(),              // 영수증에 적힌 원래 글자
  qty: z.number().nonnegative().nullable(),
  unit: Unit,
  location: StorageLocation,
  category: FoodCategory,
  emoji: z.string(),
  shelfLifeDays: z.number().int().nonnegative().nullable(), // 산 날부터 보통 며칠 (추정)
  /** shelfLifeDays 가 포장에 적힌 유통기한·소비기한을 읽어서 낸 값인가 (아니면 보통 보관 기간으로 어림) */
  dateFromPackage: z.boolean().default(false),
  memo: z.string(),                 // 브랜드·용량 등 (없으면 빈 문자열)
  isFood: z.boolean(),              // 봉투·세제 등은 false
});
export type ReceiptItem = z.infer<typeof ReceiptItem>;

export const ReceiptScan = z.object({
  store: z.string().nullable(),
  purchasedAt: z.string().nullable(), // YYYY-MM-DD, 영수증에 날짜가 있을 때만
  items: z.array(ReceiptItem),
});
export type ReceiptScan = z.infer<typeof ReceiptScan>;

export const ShoppingItem = z.object({
  name: z.string().min(1),
  key: z.string().min(1),
  qty: z.number().nonnegative().nullable(),
  unit: Unit,
  fromRecipeId: z.string().nullable().default(null),
  checked: z.boolean().default(false),
  addedBy: z.string(),
  addedAt: z.string(),
  // 4단계에서 추가 (선택)
  recipeTitle: z.string().optional(),
  category: FoodCategory.optional(),
  emoji: z.string().optional(),
  memo: z.string().optional(),
});
export type ShoppingItem = z.infer<typeof ShoppingItem>;

/** 재료 이름 → 표준 영문 key (AI 정리 결과) */
export const NormalizedNames = z.object({
  items: z.array(z.object({ name: z.string(), key: z.string().min(1) })),
});
export type NormalizedNames = z.infer<typeof NormalizedNames>;

export const FamilyProfile = z.object({
  members: z.number().int().positive().default(2),
  spicyLevel: z.enum(["순한맛", "보통", "매운맛"]).default("보통"),
  dislikes: z.array(z.string()).default([]),
  kidsFriendly: z.boolean().default(false),
  defaultServings: z.number().positive().default(2),
  /** 늘 집에 있는 양념. 냉장고에 등록하지 않아도 "있음"으로 보고 장보기에 넣지 않는다 */
  staples: z.array(z.string()).default(() => [...DEFAULT_STAPLES]),
});
export type FamilyProfile = z.infer<typeof FamilyProfile>;

export const Family = z.object({
  name: z.string().min(1),
  inviteCode: z.string().length(6),
  members: z.array(z.string()).min(1),
  createdAt: z.string(),
  profile: FamilyProfile.default(() => FamilyProfile.parse({})),
  /** uid → 그 사람의 인증된 구글 이메일. 각자 자기 칸만 적을 수 있다 (AI 서버가 "설치한 사람이 있는 가족인가"를 본다) */
  memberEmails: z.record(z.string(), z.string()).optional(),
});
export type Family = z.infer<typeof Family>;

export const MealSlot = z.enum(["아침", "점심", "저녁"]);
export type MealSlot = z.infer<typeof MealSlot>;

/** 이번 주 식단의 한 칸 (families/{id}/meal_plans) */
export const MealPlanEntry = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  slot: MealSlot,
  recipeId: z.string(),
  /** 레시피를 지워도 무엇이었는지 보이게 이름을 함께 둔다 */
  title: z.string().default(""),
  servings: z.number().int().positive().max(20).default(2),
  createdBy: z.string().optional(),
  createdAt: z.string().optional(),
});
export type MealPlanEntry = z.infer<typeof MealPlanEntry>;

/** 링크·캡션·사진에서 레시피를 가져온 결과 */
export const ImportResult = z.object({
  hasRecipe: z.boolean(),           // 자료에 레시피가 있었는가
  reason: z.string(),               // 못 찾았으면 이유, 찾았으면 짧은 설명
  dishName: z.string().nullable(),  // 요리 이름 추정 (못 찾았을 때 AI 레시피 만들기에 쓴다)
  recipe: RecipeDraft.nullable(),
});
export type ImportResult = z.infer<typeof ImportResult>;

/** "오늘 뭐 먹지" 메뉴 추천 한 개 */
export const MenuSuggestion = z.object({
  title: z.string().min(1),          // 요리 이름 (예: "두부 김치찌개")
  reason: z.string(),                // 왜 추천하는지 한 문장 (예: "내일까지인 두부와 김치를 함께 써요")
  uses: z.array(z.string()),         // 냉장고에서 쓰는 품목 (보낸 이름 그대로)
  missing: z.array(z.string()),      // 더 사야 하는 재료 (늘 있는 양념 제외)
  timeMinutes: z.number().int().positive().nullable(),
  difficulty: z.enum(["쉬움", "보통", "어려움"]),
  tags: z.array(z.string()),
});
export type MenuSuggestion = z.infer<typeof MenuSuggestion>;

export const SuggestResult = z.object({
  suggestions: z.array(MenuSuggestion),
});
export type SuggestResult = z.infer<typeof SuggestResult>;

/** 요리하다 AI 셰프에게 물어본 답 */
export const AskResult = z.object({
  answer: z.string().min(1),          // 짧고 바로 쓸 수 있는 답 (2~5문장)
  followups: z.array(z.string()),     // 이어서 물어볼 만한 질문 2~3개 (짧게)
});
export type AskResult = z.infer<typeof AskResult>;

/** 레시피 바꾸기 결과 */
export const AdaptResult = z.object({
  summary: z.string(),                // 무엇을 바꿨는지 한두 문장
  recipe: RecipeDraft,
});
export type AdaptResult = z.infer<typeof AdaptResult>;

/** 없는 재료 대체 제안 */
export const SubstituteResult = z.object({
  items: z.array(z.object({
    ingredient: z.string(),           // 원래 재료 이름
    options: z.array(z.object({
      name: z.string().min(1),        // 대신 쓸 재료
      fromFridge: z.boolean(),        // 지금 냉장고에 있는 것인가
      amount: z.string(),             // 얼마나 (예: "1큰술", "반 개")
      how: z.string(),                // 쓰는 법·맛 차이 한 문장
    })),
    skippable: z.boolean(),           // 빼고 만들어도 되는가
  })),
});
export type SubstituteResult = z.infer<typeof SubstituteResult>;
