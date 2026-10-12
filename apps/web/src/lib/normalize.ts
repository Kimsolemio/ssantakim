import { doc, updateDoc } from "firebase/firestore";
import { getDb } from "./firebase";
import { callWorker, workerConfigured } from "./api";

const isStandardKey = (k: string) => /^[a-z][a-z0-9_]*$/.test(k);

/** 한글 임시 key 를 가진 문서들을 AI로 표준 영문 key 로 바꾼다. 실패해도 앱 동작에는 영향이 없다 */
export async function normalizeKeysInBackground(
  familyId: string,
  collectionName: "fridge_items" | "shopping_items",
  docs: { id: string; name: string; key?: string }[],
): Promise<void> {
  const targets = docs.filter((d) => !d.key || !isStandardKey(d.key)).slice(0, 40);
  if (!workerConfigured || targets.length === 0) return;
  try {
    const res = await callWorker<{ items: { name: string; key: string }[] }>("/normalize", { names: targets.map((t) => t.name) });
    await Promise.all(targets.map((t, i) => {
      const key = res.items[i]?.key;
      if (!key || !isStandardKey(key)) return Promise.resolve();
      return updateDoc(doc(getDb(), "families", familyId, collectionName, t.id), { key });
    }));
  } catch (e) {
    console.warn("재료 이름 정리 실패 (나중에 다시 시도됩니다)", e);
  }
}

/** 레시피 재료 중 임시 key 만 골라 정리한 새 재료 배열 (바뀐 게 없으면 null) */
export async function normalizeIngredientKeys<T extends { name: string; key: string }>(ingredients: T[]): Promise<T[] | null> {
  const idx = ingredients.map((g, i) => (isStandardKey(g.key) ? -1 : i)).filter((i) => i >= 0).slice(0, 40);
  if (!workerConfigured || idx.length === 0) return null;
  try {
    const res = await callWorker<{ items: { name: string; key: string }[] }>("/normalize", { names: idx.map((i) => ingredients[i].name) });
    const next = ingredients.map((g) => ({ ...g }));
    let changed = false;
    idx.forEach((i, j) => { const k = res.items[j]?.key; if (k && isStandardKey(k)) { next[i].key = k; changed = true; } });
    return changed ? next : null;
  } catch (e) {
    console.warn("레시피 재료 이름 정리 실패", e);
    return null;
  }
}
