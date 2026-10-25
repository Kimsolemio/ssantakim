import { guessFood, type Recipe } from "@cook/shared";

/** 목록 썸네일: 요리 이름이나 주재료로 짐작한 음식 그림 (모르면 첫 글자) */
export function recipeEmoji(r: Pick<Recipe, "title" | "ingredients">): string | null {
  const t = guessFood(r.title);
  if (t.category !== "기타") return t.emoji;
  for (const i of r.ingredients.filter((x) => x.group === "주재료")) {
    const g = guessFood(i.name);
    if (g.category !== "기타") return g.emoji;
  }
  return null;
}
