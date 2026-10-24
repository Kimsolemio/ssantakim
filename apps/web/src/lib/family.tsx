import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import {
  doc, getDoc, updateDoc, onSnapshot, arrayUnion, writeBatch, deleteField,
} from "firebase/firestore";
import { Family, FamilyProfile, makeInviteCode } from "@cook/shared";
import { getDb } from "./firebase";
import { setApiFamily } from "./api";
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
    if (!user) { setApiFamily(null); setFamilyId(null); setFamily(null); setLoading(false); return; }
    setFamilyId(null);
    setFamily(null);
    setLoading(true);
    // 가족 만들기·참여는 한 번에(batch) 저장된다. 로컬에 먼저 반영된(아직 서버 확정 전) 값으로
    // 가족 데이터를 읽기 시작하면 보안 규칙이 거절하고 그 구독은 다시 시도하지 않으므로,
    // 서버가 저장을 확정한 스냅샷만 사용한다.
    return onSnapshot(doc(getDb(), "users", user.uid), { includeMetadataChanges: true }, (snap) => {
      if (snap.metadata.hasPendingWrites) return;
      const id = (snap.data()?.familyId as string | undefined) ?? null;
      // AI 서버에 지금 가족을 알려 준다 (허용 목록 밖 가족도 설치한 사람의 권한으로 AI를 쓰게). 화면보다 먼저
      setApiFamily(id);
      setFamilyId(id);
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

  // 내 인증된 이메일을 가족 문서에 적어 둔다 (규칙상 자기 칸, 로그인 토큰의 이메일 그대로만).
  // 같은 사람·가족·이메일은 한 번만 시도한다: 규칙이 거절하면 스냅샷이 되돌아와도 다시 쓰지 않게
  const recorded = user ? family?.memberEmails?.[user.uid] : undefined;
  const isMember = !!user && !!family?.members.includes(user.uid);
  const tried = useRef(new Set<string>());
  /** 지금 떠나는 가족: 내 칸을 지우는 동안 다시 적지 않게 */
  const leaving = useRef<string | null>(null);
  useEffect(() => {
    if (!user || !familyId || !isMember || !user.emailVerified || leaving.current === familyId) return;
    let cancelled = false;
    void user.getIdTokenResult().then((r) => {
      const email = typeof r.claims.email === "string" ? r.claims.email : null;
      if (cancelled || !email || r.claims.email_verified !== true || recorded === email) return;
      const key = `${user.uid}|${familyId}|${email}`;
      if (tried.current.has(key)) return;
      tried.current.add(key);
      return updateDoc(doc(getDb(), "families", familyId), { [`memberEmails.${user.uid}`]: email });
    }).catch((e: unknown) => console.warn("memberEmails", e));
    return () => { cancelled = true; };
  }, [user, familyId, isMember, recorded]);

  /** 새 가족을 만들거나 들어갈 때: 예전 시도 기록을 지워 다시 적을 수 있게 */
  const freshStart = () => { leaving.current = null; tried.current.clear(); };

  const createFamily = async (name: string) => {
    if (!user) throw new Error("로그인이 필요합니다");
    freshStart();
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
    freshStart();
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
    // 떠나는 가족에서 내 이메일 칸을 지운다 (내 권한으로 그 가족이 AI를 계속 쓰지 않게). 실패해도 떠나기는 한다.
    // 지우는 동안 위의 등록이 다시 적지 않게 먼저 표시해 둔다
    if (familyId) {
      leaving.current = familyId;
      await updateDoc(doc(getDb(), "families", familyId), { [`memberEmails.${user.uid}`]: deleteField() })
        .catch((e: unknown) => console.warn("memberEmails", e));
    }
    await updateDoc(doc(getDb(), "users", user.uid), { familyId: null });
    tried.current.clear();
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
