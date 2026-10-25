import { useEffect, useState } from "react";
import { addDoc, collection, deleteDoc, doc, onSnapshot, query, where } from "firebase/firestore";
import { MealPlanEntry, addDays, type MealSlot } from "@cook/shared";
import { getDb } from "../../lib/firebase";
import { settle } from "../../lib/write";

export type PlanDoc = MealPlanEntry & { id: string };

const col = (familyId: string) => collection(getDb(), "families", familyId, "meal_plans");
export const SLOTS: MealSlot[] = ["아침", "점심", "저녁"];

/** start 부터 days 일 동안의 식단 (기본 한 주) */
export function usePlan(familyId: string | null, start: string, days = 7) {
  const [entries, setEntries] = useState<PlanDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!familyId) { setEntries([]); setLoading(false); return; }
    setLoading(true);
    const q = query(col(familyId), where("date", ">=", start), where("date", "<=", addDays(start, days - 1)));
    return onSnapshot(q, (snap) => {
      const list: PlanDoc[] = [];
      snap.forEach((d) => { const p = MealPlanEntry.safeParse(d.data()); if (p.success) list.push({ id: d.id, ...p.data }); });
      list.sort((a, b) => a.date.localeCompare(b.date) || SLOTS.indexOf(a.slot) - SLOTS.indexOf(b.slot) || (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));
      setEntries(list); setLoading(false); setError(null);
    }, (e) => { setError(e.message); setLoading(false); });
  }, [familyId, start, days]);
  return { entries, loading, error };
}

export async function addPlanEntry(familyId: string, uid: string, e: Pick<MealPlanEntry, "date" | "slot" | "recipeId" | "title" | "servings">) {
  const p = MealPlanEntry.safeParse({ ...e, servings: Math.min(20, Math.max(1, Math.round(e.servings))), createdBy: uid, createdAt: new Date().toISOString() });
  if (!p.success) throw new Error("식단에 넣을 수 없는 값이에요 (날짜·끼니를 다시 골라 주세요)");
  const data = p.data;
  await settle(addDoc(col(familyId), data));
}

export async function removePlanEntry(familyId: string, id: string) {
  await settle(deleteDoc(doc(col(familyId), id)));
}
