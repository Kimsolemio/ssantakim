import { useEffect, useState } from "react";
import {
  collection, onSnapshot, addDoc, updateDoc, deleteDoc, deleteField, doc, query, orderBy, writeBatch,
} from "firebase/firestore";
import { FridgeItem, provisionalKey } from "@cook/shared";
import { getDb } from "../../lib/firebase";

export type FridgeDoc = FridgeItem & { id: string };

export function useFridge(familyId: string | null) {
  const [items, setItems] = useState<FridgeDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!familyId) { setItems([]); setLoading(false); return; }
    setLoading(true);
    const q = query(collection(getDb(), "families", familyId, "fridge_items"), orderBy("addedAt", "desc"));
    return onSnapshot(q, (snap) => {
      const list: FridgeDoc[] = [];
      snap.forEach((d) => {
        const parsed = FridgeItem.safeParse(d.data());
        if (parsed.success) list.push({ id: d.id, ...parsed.data });
      });
      setItems(list);
      setLoading(false);
      setError(null);
    }, (e) => { setError(e.message); setLoading(false); });
  }, [familyId]);

  return { items, loading, error };
}

export type FridgeInput = Omit<FridgeItem, "key" | "addedBy" | "addedAt" | "photoUrl">;

export async function addFridgeItem(familyId: string, uid: string, input: FridgeInput): Promise<string> {
  const item: FridgeItem = FridgeItem.parse({
    ...input,
    memo: input.memo || undefined,
    key: provisionalKey(input.name),
    addedBy: uid,
    addedAt: new Date().toISOString(),
    photoUrl: null,
  });
  const ref = await addDoc(collection(getDb(), "families", familyId, "fridge_items"), item);
  return ref.id;
}

/** 요리 후 차감: 남은 양을 고치거나 다 쓴 것은 지운다 */
export async function applyFridgeUpdates(familyId: string, updates: { id: string; qty?: number | null; remove?: boolean }[]) {
  if (updates.length === 0) return;
  const db = getDb();
  const batch = writeBatch(db);
  for (const u of updates) {
    const ref = doc(db, "families", familyId, "fridge_items", u.id);
    if (u.remove) batch.delete(ref);
    else if (u.qty !== undefined) batch.update(ref, { qty: u.qty });
  }
  await batch.commit();
}

/**
 * 품목 고치기. 이름이 실제로 바뀐 경우에만 key 를 새로 만든다 (그대로면 AI가 정리한 key 를 지킨다).
 * 지운 메모는 필드째 지운다 (undefined 는 Firestore가 무시하므로).
 * 돌려주는 값: 이름이 바뀌었는가 (이름 정리를 다시 할지)
 */
export async function updateFridgeItem(familyId: string, id: string, input: Partial<FridgeInput>, current: Pick<FridgeItem, "name">): Promise<boolean> {
  const patch: Record<string, unknown> = { ...input };
  const renamed = typeof input.name === "string" && provisionalKey(input.name) !== provisionalKey(current.name);
  if (renamed) patch.key = provisionalKey(input.name!);
  if ("memo" in input && !input.memo) patch.memo = deleteField();
  await updateDoc(doc(getDb(), "families", familyId, "fridge_items", id), patch);
  return renamed;
}

export async function deleteFridgeItem(familyId: string, id: string) {
  await deleteDoc(doc(getDb(), "families", familyId, "fridge_items", id));
}

/** 영수증 등에서 여러 개를 한 번에 넣는다. 새 문서 id 목록을 돌려준다 (애니메이션용) */
export async function addFridgeItems(
  familyId: string, uid: string, inputs: (FridgeInput & { key?: string })[],
  /** 저장 직전에 새 id 를 알려준다. 화면에 나타나기 전에 애니메이션을 준비할 수 있다 */
  onIds?: (ids: string[]) => void,
): Promise<string[]> {
  const db = getDb();
  const col = collection(db, "families", familyId, "fridge_items");
  const now = new Date().toISOString();
  // Firestore batch 는 500개까지. 영수증 한 번에 그만큼 나올 일은 없지만 나눠서 안전하게
  const batches: ReturnType<typeof writeBatch>[] = [];
  const ids: string[] = [];
  inputs.forEach((input, i) => {
    if (i % 400 === 0) batches.push(writeBatch(db));
    const ref = doc(col);
    ids.push(ref.id);
    batches[batches.length - 1].set(ref, FridgeItem.parse({
      ...input,
      key: input.key?.trim() || provisionalKey(input.name),
      addedBy: uid,
      addedAt: now,
      photoUrl: null,
    }));
  });
  onIds?.(ids);
  for (const b of batches) await b.commit();
  return ids;
}

/** 냉장고 품목의 key 를 바꾼다 (레시피 재료와 직접 연결할 때) */
export async function setFridgeItemKey(familyId: string, id: string, key: string) {
  await updateDoc(doc(getDb(), "families", familyId, "fridge_items", id), { key });
}
