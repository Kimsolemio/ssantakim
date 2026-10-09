import { useEffect, useState } from "react";
import {
  collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, query, orderBy,
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
