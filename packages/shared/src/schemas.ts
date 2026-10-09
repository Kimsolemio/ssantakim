import { z } from "zod";

/** 재료 표준 단위. "약간/적당량" 같은 비계량 표현은 unit="기타" + scalable=false 로 저장한다. */
export const Unit = z.enum(["g", "kg", "ml", "L", "개", "큰술", "작은술", "컵", "줌", "쪽", "장", "봉", "팩", "캔", "기타"]);
export type Unit = z.infer<typeof Unit>;

export const StorageLocation = z.enum(["냉장", "냉동", "실온"]);
export type StorageLocation = z.infer<typeof StorageLocation>;

export const IngredientGroup = z.enum(["주재료", "부재료", "양념", "고명", "기타"]);
export type IngredientGroup = z.infer<typeof IngredientGroup>;

export const SourceType = z.enum(["generated", "youtube", "instagram", "photo", "text", "manual"]);
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
});
export type FridgeItem = z.infer<typeof FridgeItem>;

export const ShoppingItem = z.object({
  name: z.string().min(1),
  key: z.string().min(1),
  qty: z.number().nonnegative().nullable(),
  unit: Unit,
  fromRecipeId: z.string().nullable().default(null),
  checked: z.boolean().default(false),
  addedBy: z.string(),
  addedAt: z.string(),
});
export type ShoppingItem = z.infer<typeof ShoppingItem>;

export const FamilyProfile = z.object({
  members: z.number().int().positive().default(2),
  spicyLevel: z.enum(["순한맛", "보통", "매운맛"]).default("보통"),
  allergies: z.array(z.string()).default([]),
  dislikes: z.array(z.string()).default([]),
  kidsFriendly: z.boolean().default(false),
  defaultServings: z.number().positive().default(2),
});
export type FamilyProfile = z.infer<typeof FamilyProfile>;

export const Family = z.object({
  name: z.string().min(1),
  inviteCode: z.string().length(6),
  members: z.array(z.string()).min(1),
  createdAt: z.string(),
  profile: FamilyProfile.default(() => FamilyProfile.parse({})),
});
export type Family = z.infer<typeof Family>;

export const MealPlanEntry = z.object({
  date: z.string(),
  slot: z.enum(["아침", "점심", "저녁"]),
  recipeId: z.string(),
});
export type MealPlanEntry = z.infer<typeof MealPlanEntry>;
