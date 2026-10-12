import { doc, runTransaction } from "firebase/firestore";
import { getDb } from "./firebase";
import { callWorker, workerConfigured } from "./api";

const isStandardKey = (k: string) => /^[a-z][a-z0-9_]*$/.test(k);

/**
 * 한글 임시 key 를 가진 문서들을 AI로 표준 영문 key 로 바꾼다. 실패해도 앱 동작에는 영향이 없다.
 * AI를 기다리는 사이 이름을 고쳤으면 그 문서는 건드리지 않는다 (트랜잭션으로 지금 값을 다시 읽어 확인).
 */
export async function normalizeKeysInBackground(
  familyId: string,
  collectionName: "fridge_items" | "shopping_items",
  docs: { id: string; name: string; key?: string }[],
): Promise<void> {
  const targets = docs.filter((d) => !d.key || !isStandardKey(d.key)).slice(0, 40);
  if (!workerConfigured || targets.length === 0) return;
  try {
    const res = await callWorker<{ items: { name: string; key: string }[] }>("/normalize", { names: targets.map((t) => t.name) });
    const db = getDb();
    await Promise.all(targets.map((t, i) => {
      const key = res.items[i]?.key;
      if (!key || !isStandardKey(key)) return Promise.resolve();
      const ref = doc(db, "families", familyId, collectionName, t.id);
      return runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        const cur = snap.data() as { name?: string; key?: string } | undefined;
        if (!snap.exists() || cur?.name !== t.name || (cur?.key && isStandardKey(cur.key))) return;
        tx.update(ref, { key });
      });
    }));
  } catch (e) {
    console.warn("재료 이름 정리 실패 (나중에 다시 시도됩니다)", e);
  }
}

/** 재료 key 가 바뀌면 조리 단계의 ingredientKeys 도 같이 바꾼다 (요리 모드의 "이 단계 재료" 표시용) */
export function remapStepKeys<S extends { ingredientKeys: string[] }>(steps: S[], map: Map<string, string>): S[] {
  if (map.size === 0) return steps;
  return steps.map((s) => ({ ...s, ingredientKeys: [...new Set(s.ingredientKeys.map((k) => map.get(k) ?? k))] }));
}

type KeyFix = { name: string; from: string; to: string };

/** 레시피 재료 중 임시 key 만 골라 AI가 정한 표준 key 목록을 받는다 */
async function recipeKeyFixes(ingredients: { name: string; key: string }[]): Promise<KeyFix[]> {
  const idx = ingredients.map((g, i) => (isStandardKey(g.key) ? -1 : i)).filter((i) => i >= 0).slice(0, 40);
  if (!workerConfigured || idx.length === 0) return [];
  const res = await callWorker<{ items: { name: string; key: string }[] }>("/normalize", { names: idx.map((i) => ingredients[i].name) });
  return idx.flatMap((i, j) => {
    const to = res.items[j]?.key;
    return to && isStandardKey(to) && to !== ingredients[i].key ? [{ name: ingredients[i].name, from: ingredients[i].key, to }] : [];
  });
}

/**
 * 저장한 레시피의 임시 key 를 뒤에서 정리한다. AI를 기다리는 사이 다시 고쳐 저장했을 수 있으므로,
 * 트랜잭션으로 지금 문서를 읽어 이름·key 가 그대로인 재료만 바꾸고 나머지 수정은 건드리지 않는다.
 * 조리 단계의 key 는 그 key 를 쓰던 재료가 더 남지 않을 때만 새 key 로 옮긴다.
 */
export async function fixRecipeKeysInBackground(familyId: string, recipeId: string, saved: { ingredients: { name: string; key: string }[] }): Promise<void> {
  try {
    const fixes = await recipeKeyFixes(saved.ingredients);
    if (fixes.length === 0) return;
    const db = getDb();
    const ref = doc(db, "families", familyId, "recipes", recipeId);
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) return;
      const cur = snap.data() as { ingredients: { name: string; key: string }[]; steps: { ingredientKeys: string[] }[] };
      let changed = false;
      const ingredients = cur.ingredients.map((g) => {
        const f = fixes.find((x) => x.name === g.name && x.from === g.key);
        if (!f) return g;
        changed = true;
        return { ...g, key: f.to };
      });
      if (!changed) return;
      const stillUsed = new Set(ingredients.map((g) => g.key));
      const map = new Map(fixes.filter((f) => !stillUsed.has(f.from)).map((f) => [f.from, f.to]));
      tx.update(ref, { ingredients, steps: remapStepKeys(cur.steps, map) });
    });
  } catch (e) {
    console.warn("레시피 재료 이름 정리 실패", e);
  }
}
