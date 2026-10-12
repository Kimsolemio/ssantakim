import { useEffect, useState } from "react";
import {
  collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, query, orderBy, writeBatch,
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

export async function addFridgeItem(familyId: string, uid: string, input: FridgeInput) {
  const item: FridgeItem = FridgeItem.parse({
    ...input,
    key: provisionalKey(input.name),
    addedBy: uid,
    addedAt: new Date().toISOString(),
    photoUrl: null,
  });
  await addDoc(collection(getDb(), "families", familyId, "fridge_items"), item);
}

export async function updateFridgeItem(familyId: string, id: string, input: Partial<FridgeInput>) {
  const patch: Record<string, unknown> = { ...input };
  if (typeof input.name === "string") patch.key = provisionalKey(input.name);
  await updateDoc(doc(getDb(), "families", familyId, "fridge_items", id), patch);
}

export async function deleteFridgeItem(familyId: string, id: string) {
  await deleteDoc(doc(getDb(), "families", familyId, "fridge_items", id));
}

/** 영수증 등에서 여러 개를 한 번에 넣는다. 새 문서 id 목록을 돌려준다 (애니메이션용) */
export async function addFridgeItems(familyId: string, uid: string, inputs: (FridgeInput & { key?: string })[]): Promise<string[]> {
  const db = getDb();
  const col = collection(db, "families", familyId, "fridge_items");
  const now = new Date().toISOString();
  const ids: string[] = [];
  // Firestore batch 는 500개까지. 영수증 한 번에 그만큼 나올 일은 없지만 나눠서 안전하게
  for (let i = 0; i < inputs.length; i += 400) {
    const batch = writeBatch(db);
    for (const input of inputs.slice(i, i + 400)) {
      const ref = doc(col);
      ids.push(ref.id);
      batch.set(ref, FridgeItem.parse({
        ...input,
        key: input.key?.trim() || provisionalKey(input.name),
        addedBy: uid,
        addedAt: now,
        photoUrl: null,
      }));
    }
    await batch.commit();
  }
  return ids;
}
