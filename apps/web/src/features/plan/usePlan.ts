import { useEffect, useState } from "react";
import { addDoc, collection, deleteDoc, doc, onSnapshot, query, where } from "firebase/firestore";
import { MealPlanEntry, addDays, type MealSlot } from "@cook/shared";
import { getDb } from "../../lib/firebase";
import { settle } from "../../lib/write";

export type PlanDoc = MealPlanEntry & { id: string };

const col = (familyId: string) => collection(getDb(), "families", familyId, "meal_plans");
export const SLOTS: MealSlot[] = ["아침", "점심", "저녁"];

/** 한 주(월~일)의 식단 */
export function usePlan(familyId: string | null, start: string) {
  const [entries, setEntries] = useState<PlanDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!familyId) { setEntries([]); setLoading(false); return; }
    setLoading(true);
    const q = query(col(familyId), where("date", ">=", start), where("date", "<=", addDays(start, 6)));
    return onSnapshot(q, (snap) => {
      const list: PlanDoc[] = [];
      snap.forEach((d) => { const p = MealPlanEntry.safeParse(d.data()); if (p.success) list.push({ id: d.id, ...p.data }); });
      list.sort((a, b) => a.date.localeCompare(b.date) || SLOTS.indexOf(a.slot) - SLOTS.indexOf(b.slot) || (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));
      setEntries(list); setLoading(false); setError(null);
    }, (e) => { setError(e.message); setLoading(false); });
  }, [familyId, start]);
  return { entries, loading, error };
}

export async function addPlanEntry(familyId: string, uid: string, e: Pick<MealPlanEntry, "date" | "slot" | "recipeId" | "title" | "servings">) {
  const data = MealPlanEntry.parse({ ...e, createdBy: uid, createdAt: new Date().toISOString() });
  await settle(addDoc(col(familyId), data));
}

export async function removePlanEntry(familyId: string, id: string) {
  await settle(deleteDoc(doc(col(familyId), id)));
}
