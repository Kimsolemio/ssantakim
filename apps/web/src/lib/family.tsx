import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  doc, getDoc, updateDoc, onSnapshot, arrayUnion, writeBatch,
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
  updateProfile: (profile: FamilyProfile) => Promise<void>;
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
    setFamilyId(null);
    setFamily(null);
    setLoading(true);
    return onSnapshot(doc(getDb(), "users", user.uid), (snap) => {
      setFamilyId((snap.data()?.familyId as string | undefined) ?? null);
      setLoading(false);
    }, () => setLoading(false));
  }, [user]);

  // families/{familyId}
  useEffect(() => {
    if (!familyId) { setFamily(null); return; }
    setFamily(null);
    return onSnapshot(doc(getDb(), "families", familyId), (snap) => {
      if (!snap.exists()) { setFamily(null); return; }
      const parsed = Family.safeParse(snap.data());
      setFamily(parsed.success ? parsed.data : null);
    }, () => setFamily(null));
  }, [familyId, user?.uid]);

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
    const batch = writeBatch(db);
    batch.set(doc(db, "families", id), fam);
    batch.set(doc(db, "invites", inviteCode), { familyId: id });
    batch.set(doc(db, "users", user.uid), { familyId: id, name: user.displayName ?? "", updatedAt: new Date().toISOString() }, { merge: true });
    await batch.commit();
  };

  const joinFamily = async (codeRaw: string) => {
    if (!user) throw new Error("로그인이 필요합니다");
    const code = codeRaw.trim().toUpperCase();
    if (!/^[A-Z2-9]{6}$/.test(code)) throw new Error("올바른 초대 코드를 입력해주세요");
    const db = getDb();
    const inv = await getDoc(doc(db, "invites", code));
    if (!inv.exists()) throw new Error("초대 코드를 찾을 수 없습니다");
    const id = inv.data().familyId as string;
    if (typeof id !== "string" || !id || id.includes("/")) throw new Error("유효하지 않은 초대 코드입니다");
    // Rules validate this proof against the live invite, in the same atomic commit.
    // No family read is needed before joining (non-members cannot read it).
    const batch = writeBatch(db);
    batch.set(doc(db, "families", id, "joinProofs", user.uid), { code });
    batch.update(doc(db, "families", id), { members: arrayUnion(user.uid) });
    batch.set(doc(db, "users", user.uid), { familyId: id, name: user.displayName ?? "", updatedAt: new Date().toISOString() }, { merge: true });
    await batch.commit();
  };

  const leaveToSwitch = async () => {
    if (!user) return;
    await updateDoc(doc(getDb(), "users", user.uid), { familyId: null });
  };

  const updateProfile = async (profile: FamilyProfile) => {
    if (!familyId) throw new Error("가족이 없습니다");
    await updateDoc(doc(getDb(), "families", familyId), { profile: FamilyProfile.parse(profile) });
  };

  return (
    <FamilyCtx.Provider value={{ familyId, family, loading, createFamily, joinFamily, leaveToSwitch, updateProfile }}>
      {children}
    </FamilyCtx.Provider>
  );
}

export function useFamily(): FamilyState {
  const ctx = useContext(FamilyCtx);
  if (!ctx) throw new Error("useFamily must be inside FamilyProvider");
  return ctx;
}
