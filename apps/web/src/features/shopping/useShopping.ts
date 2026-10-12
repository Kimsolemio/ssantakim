import { useEffect, useState } from "react";
import { collection, doc, onSnapshot, orderBy, query, writeBatch, updateDoc, deleteDoc, deleteField, setDoc, increment } from "firebase/firestore";
import { ShoppingItem, convertQty, guessFood, provisionalKey, roundQty, sameFood } from "@cook/shared";
import { getDb } from "../../lib/firebase";
import { settle } from "../../lib/write";

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
  // 양 합치기(update)는 따로: 합칠 줄을 다른 기기에서 지웠어도 새로 담는 품목까지 취소되지 않게
  const merges: Promise<void>[] = [];
  const now = new Date().toISOString();
  const added: { id: string; name: string }[] = [];
  let merged = 0;
  const pending = existing.filter((e) => !e.checked).map((e) => ({ ...e }));
  for (const input of inputs) {
    const key = input.key?.trim() || provisionalKey(input.name);
    const found = pending.find((e) => sameFood(e, { key, name: input.name }));
    // 양을 둘 다 아는데 단위를 바꿀 수 없으면(두부 1모 + 두부 150g) 합치지 않고 새 줄로 둔다 (양이 사라지지 않게)
    const same = found && found.qty != null && input.qty != null && convertQty(input.qty, input.unit, found.unit) == null ? undefined : found;
    if (same) {
      if (same.qty != null && input.qty != null) {
        const c = convertQty(input.qty, input.unit, same.unit);
        // 덮어쓰지 않고 더한다 (그사이 다른 가족이 같은 줄의 양을 바꿔도 둘 다 반영)
        if (c != null) {
          same.qty = roundQty(same.qty + c, same.unit);
          merges.push(updateDoc(doc(col(familyId), same.id), { qty: increment(roundQty(c, same.unit)) }).catch((e) => console.warn("양 합치기 건너뜀", same.id, e)));
        }
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
  await settle(Promise.all([batch.commit(), ...merges]));
  return { added, merged };
}

export async function setShoppingChecked(familyId: string, id: string, checked: boolean) {
  await settle(updateDoc(doc(col(familyId), id), { checked }));
}
/** 고치기. 이름이 바뀌면 key 를 새로 만들고, 지운 메모는 필드째 지운다. 돌려주는 값: 이름이 바뀌었는가 */
export async function updateShoppingItem(familyId: string, id: string, patch: Partial<ShoppingItem>, current?: Pick<ShoppingItem, "name">): Promise<boolean> {
  const data: Record<string, unknown> = { ...patch };
  const renamed = !!current && typeof patch.name === "string" && provisionalKey(patch.name) !== provisionalKey(current.name);
  if (renamed) data.key = provisionalKey(patch.name!);
  if ("memo" in patch && !patch.memo) data.memo = deleteField();
  await settle(updateDoc(doc(col(familyId), id), data));
  return renamed;
}
export async function deleteShoppingItem(familyId: string, id: string) {
  await settle(deleteDoc(doc(col(familyId), id)));
}

/** 지운 것 되돌리기: 같은 id 로 다시 쓴다 */
export async function restoreShoppingItem(familyId: string, item: ShoppingDoc) {
  const { id, ...data } = item;
  await settle(setDoc(doc(col(familyId), id), data));
}
export async function deleteShoppingItems(familyId: string, ids: string[]) {
  if (ids.length === 0) return;
  const batch = writeBatch(getDb());
  for (const id of ids) batch.delete(doc(col(familyId), id));
  await settle(batch.commit());
}
