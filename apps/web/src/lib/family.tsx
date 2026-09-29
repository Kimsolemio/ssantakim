import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  doc, getDoc, setDoc, updateDoc, onSnapshot, arrayUnion, runTransaction,
} from "firebase/firestore";
import { Family, FamilyProfile, makeInviteCode } from "@cook/shared";
import { getDb } from "./firebase";
import { useAuth } from "./auth";

type FamilyState = {
  familyId: string | null;
  family: Family | null;
  loading: boolean;
  createFamily: (name: string) => Promise<void>;
  joinFamily: (code: string) => Promise<void>;
  leaveToSwitch: () => Promise<void>;
};

const FamilyCtx = createContext<FamilyState | null>(null);

export function FamilyProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [familyId, setFamilyId] = useState<string | null>(null);
  const [family, setFamily] = useState<Family | null>(null);
  const [loading, setLoading] = useState(true);

  // users/{uid} → familyId
  useEffect(() => {
    if (!user) { setFamilyId(null); setFamily(null); setLoading(false); return; }
    setLoading(true);
    return onSnapshot(doc(getDb(), "users", user.uid), (snap) => {
      setFamilyId((snap.data()?.familyId as string | undefined) ?? null);
      setLoading(false);
    }, () => setLoading(false));
  }, [user]);

  // families/{familyId}
  useEffect(() => {
    if (!familyId) { setFamily(null); return; }
    return onSnapshot(doc(getDb(), "families", familyId), (snap) => {
      if (!snap.exists()) { setFamily(null); return; }
      const parsed = Family.safeParse(snap.data());
      setFamily(parsed.success ? parsed.data : null);
    });
  }, [familyId]);

  const createFamily = async (name: string) => {
    if (!user) throw new Error("로그인이 필요합니다");
    const db = getDb();
    const id = crypto.randomUUID();
    const inviteCode = makeInviteCode();
    const fam: Family = {
      name: name.trim() || "우리집",
      inviteCode,
      members: [user.uid],
      createdAt: new Date().toISOString(),
      profile: FamilyProfile.parse({}),
    };
    await setDoc(doc(db, "families", id), fam);
    await setDoc(doc(db, "invites", inviteCode), { familyId: id });
    await setDoc(doc(db, "users", user.uid), { familyId: id, name: user.displayName ?? "", updatedAt: new Date().toISOString() }, { merge: true });
  };

  const joinFamily = async (codeRaw: string) => {
    if (!user) throw new Error("로그인이 필요합니다");
    const code = codeRaw.trim().toUpperCase();
    const db = getDb();
    const inv = await getDoc(doc(db, "invites", code));
    if (!inv.exists()) throw new Error("초대 코드를 찾을 수 없습니다");
    const id = inv.data().familyId as string;
    await runTransaction(db, async (tx) => {
      tx.update(doc(db, "families", id), { members: arrayUnion(user.uid) });
      tx.set(doc(db, "users", user.uid), { familyId: id, name: user.displayName ?? "", updatedAt: new Date().toISOString() }, { merge: true });
    });
  };

  const leaveToSwitch = async () => {
    if (!user) return;
    await updateDoc(doc(getDb(), "users", user.uid), { familyId: null });
  };

  return (
    <FamilyCtx.Provider value={{ familyId, family, loading, createFamily, joinFamily, leaveToSwitch }}>
      {children}
    </FamilyCtx.Provider>
  );
}

export function useFamily(): FamilyState {
  const ctx = useContext(FamilyCtx);
  if (!ctx) throw new Error("useFamily must be inside FamilyProvider");
  return ctx;
}
