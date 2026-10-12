/**
 * 싫어하는 재료·빼고 싶은 재료가 이름에 들어 있는지 본다 (메뉴 추천을 거를 때).
 * 한 글자("파", "무")는 다른 재료 이름의 일부일 때가 많아(양파·파프리카, 무화과) 이름이 정확히 같을 때만 본다.
 */
import { provisionalKey } from "./keys";

export type WordHit = { word: string; ingredient: string };

export function findDislikes(ingredients: { name: string }[], dislikes: readonly string[]): WordHit[] {
  const hits: WordHit[] = [];
  for (const raw of dislikes) {
    const d = provisionalKey(raw);
    if (d.length === 0) continue;
    for (const ing of ingredients) {
      const n = provisionalKey(ing.name);
      const hit = d.length === 1 ? n === d || n === `대${d}` || n === `생${d}` : n.includes(d);
      if (hit) hits.push({ word: raw.trim(), ingredient: ing.name });
    }
  }
  return hits;
}
