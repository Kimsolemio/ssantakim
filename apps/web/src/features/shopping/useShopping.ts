import { useEffect, useState } from "react";
import { collection, doc, onSnapshot, orderBy, query, writeBatch, updateDoc, deleteDoc } from "firebase/firestore";
import { ShoppingItem, convertQty, guessFood, provisionalKey, roundQty, sameFood } from "@cook/shared";
import { getDb } from "../../lib/firebase";

export type ShoppingDoc = ShoppingItem & { id: string };
export type ShoppingInput = Pick<ShoppingItem, "name" | "qty" | "unit"> & Partial<Pick<ShoppingItem, "key" | "fromRecipeId" | "recipeTitle" | "memo" | "category" | "emoji">>;

const col = (familyId: string) => collection(getDb(), "families", familyId, "shopping_items");

export function useShopping(familyId: string | null) {
  const [items, setItems] = useState<ShoppingDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!familyId) { setItems([]); setLoading(false); return; }
    setLoading(true);
    return onSnapshot(query(col(familyId), orderBy("addedAt", "asc")), (snap) => {
      const list: ShoppingDoc[] = [];
      snap.forEach((d) => { const p = ShoppingItem.safeParse(d.data()); if (p.success) list.push({ id: d.id, ...p.data }); });
      setItems(list); setLoading(false); setError(null);
    }, (e) => { setError(e.message); setLoading(false); });
  }, [familyId]);
  return { items, loading, error };
}

/**
 * 장보기에 담는다. 아직 안 산 같은 재료가 있으면 새로 만들지 않고 양을 더한다.
 * 새로 만든 문서의 id 목록을 돌려준다 (이름 정리용).
 */
export async function addShoppingItems(familyId: string, uid: string, inputs: ShoppingInput[], existing: ShoppingDoc[]): Promise<{ added: { id: string; name: string }[]; merged: number }> {
  const db = getDb();
  const batch = writeBatch(db);
  const now = new Date().toISOString();
  const added: { id: string; name: string }[] = [];
  let merged = 0;
  const pending = existing.filter((e) => !e.checked).map((e) => ({ ...e }));
  for (const input of inputs) {
    const key = input.key?.trim() || provisionalKey(input.name);
    const same = pending.find((e) => sameFood(e, { key, name: input.name }));
    if (same) {
      if (same.qty != null && input.qty != null) {
        const c = convertQty(input.qty, input.unit, same.unit);
        if (c != null) { same.qty = roundQty(same.qty + c, same.unit); batch.update(doc(col(familyId), same.id), { qty: same.qty }); }
      }
      merged++;
      continue;
    }
    const ref = doc(col(familyId));
    const guess = guessFood(input.name);
    const data = ShoppingItem.parse({
      name: input.name.trim(), key, qty: input.qty, unit: input.unit,
      fromRecipeId: input.fromRecipeId ?? null, checked: false, addedBy: uid, addedAt: now,
      recipeTitle: input.recipeTitle, memo: input.memo,
      category: input.category ?? guess.category, emoji: input.emoji ?? guess.emoji,
    });
    batch.set(ref, data);
    pending.push({ id: ref.id, ...data });
    added.push({ id: ref.id, name: data.name });
  }
  await batch.commit();
  return { added, merged };
}

export async function setShoppingChecked(familyId: string, id: string, checked: boolean) {
  await updateDoc(doc(col(familyId), id), { checked });
}
export async function updateShoppingItem(familyId: string, id: string, patch: Partial<ShoppingItem>) {
  await updateDoc(doc(col(familyId), id), patch);
}
export async function deleteShoppingItem(familyId: string, id: string) {
  await deleteDoc(doc(col(familyId), id));
}
export async function deleteShoppingItems(familyId: string, ids: string[]) {
  if (ids.length === 0) return;
  const batch = writeBatch(getDb());
  for (const id of ids) batch.delete(doc(col(familyId), id));
  await batch.commit();
}
