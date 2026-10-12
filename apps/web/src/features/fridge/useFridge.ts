import { useEffect, useState } from "react";
import {
  collection, onSnapshot, setDoc, updateDoc, deleteDoc, deleteField, doc, query, orderBy, writeBatch, increment,
} from "firebase/firestore";
import { FridgeItem, provisionalKey } from "@cook/shared";
import { getDb } from "../../lib/firebase";
import { settle } from "../../lib/write";

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
        const raw = d.data();
        // 두 기기가 동시에 빼면 수량이 0 밑으로 내려갈 수 있다: 0 으로 보여 준다 (검증에서 떨어져 사라지지 않게)
        if (typeof raw.qty === "number" && raw.qty < 0) raw.qty = 0;
        const parsed = FridgeItem.safeParse(raw);
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
  const ref = doc(collection(getDb(), "families", familyId, "fridge_items"));
  await settle(setDoc(ref, item));
  return ref.id;
}

export type FridgeUpdate = { id: string; /** 쓴 양 (품목 단위) */ use?: number; remove?: boolean };

/**
 * 요리 후 차감. 남은 양을 덮어쓰지 않고 "쓴 만큼 빼기"(increment)로 보내서,
 * 그사이 다른 가족이 같은 품목을 고쳐도 서로 지우지 않는다. 다 쓴 것은 지운다.
 */
export async function applyFridgeUpdates(familyId: string, updates: FridgeUpdate[]) {
  if (updates.length === 0) return;
  const db = getDb();
  // 지우기는 한 묶음으로 (이미 없는 문서를 지워도 실패하지 않는다).
  // 빼기(update)는 하나씩: 그사이 다른 기기에서 지운 품목이 섞여 있어도 나머지가 함께 취소되지 않게
  const batch = writeBatch(db);
  const writes: Promise<void>[] = [];
  for (const u of updates) {
    const ref = doc(db, "families", familyId, "fridge_items", u.id);
    if (u.remove) batch.delete(ref);
    else if (u.use && u.use > 0) writes.push(updateDoc(ref, { qty: increment(-u.use) }).catch((e) => console.warn("차감 건너뜀", u.id, e)));
  }
  writes.push(batch.commit());
  await settle(Promise.all(writes));
}

/**
 * 품목 고치기. 이름이 실제로 바뀐 경우에만 key 를 새로 만든다 (그대로면 AI가 정리한 key 를 지킨다).
 * 지운 메모는 필드째 지운다 (undefined 는 Firestore가 무시하므로).
 * 돌려주는 값: 이름이 바뀌었는가 (이름 정리를 다시 할지)
 */
export async function updateFridgeItem(familyId: string, id: string, input: Partial<FridgeInput>, current: Partial<FridgeItem> & Pick<FridgeItem, "name">): Promise<boolean> {
  // 바뀐 칸만 보낸다: 그사이 다른 가족이 고친 다른 칸(예: 요리 후 줄어든 수량)을 덮어쓰지 않게
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input) as [keyof FridgeInput, unknown][]) {
    const before = current[k as keyof FridgeItem];
    if (k === "memo") { if ((v || "") !== (before || "")) patch.memo = v ? v : deleteField(); continue; }
    if (JSON.stringify(v ?? null) !== JSON.stringify(before ?? null)) patch[k] = v;
  }
  const renamed = typeof input.name === "string" && provisionalKey(input.name) !== provisionalKey(current.name);
  if (renamed) patch.key = provisionalKey(input.name!);
  if (Object.keys(patch).length === 0) return false;
  await settle(updateDoc(doc(getDb(), "families", familyId, "fridge_items", id), patch));
  return renamed;
}

export async function deleteFridgeItem(familyId: string, id: string) {
  await settle(deleteDoc(doc(getDb(), "families", familyId, "fridge_items", id)));
}

/** 영수증 등에서 여러 개를 한 번에 넣는다. 새 문서 id 목록을 돌려준다 (애니메이션용) */
export async function addFridgeItems(
  familyId: string, uid: string, inputs: (FridgeInput & { key?: string })[],
  /** 저장 직전에 새 id 를 알려준다. 화면에 나타나기 전에 애니메이션을 준비할 수 있다 */
  onIds?: (ids: string[]) => void,
  /** 같은 묶음으로 지울 장보기 항목 (장본 것). 앱이 중간에 꺼져도 "냉장고엔 들어갔는데 장보기엔 남음"이 없게 */
  doneShoppingIds: string[] = [],
): Promise<string[]> {
  const db = getDb();
  const col = collection(db, "families", familyId, "fridge_items");
  const now = new Date().toISOString();
  // Firestore batch 는 500개까지. 영수증 한 번에 그만큼 나올 일은 없지만 나눠서 안전하게
  const batches: ReturnType<typeof writeBatch>[] = [];
  const ids: string[] = [];
  batches.push(writeBatch(db));
  doneShoppingIds.slice(0, 100).forEach((id) => batches[0].delete(doc(db, "families", familyId, "shopping_items", id)));
  inputs.forEach((input, i) => {
    if (i > 0 && i % 380 === 0) batches.push(writeBatch(db));
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
  await settle(Promise.all(batches.map((b) => b.commit())));
  return ids;
}

/** 냉장고 품목의 key 를 바꾼다 (레시피 재료와 직접 연결할 때) */
export async function setFridgeItemKey(familyId: string, id: string, key: string) {
  await updateDoc(doc(getDb(), "families", familyId, "fridge_items", id), { key });
}
