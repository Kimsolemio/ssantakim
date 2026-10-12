import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  onAuthStateChanged, signInWithPopup, signInWithRedirect, getRedirectResult, signOut as fbSignOut, type User,
} from "firebase/auth";
import { firebaseConfigured, getAuthInstance, googleProvider } from "./firebase";

type AuthState = {
  user: User | null;
  loading: boolean;
  error: string | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthCtx = createContext<AuthState | null>(null);

function isStandalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches
    || (navigator as unknown as { standalone?: boolean }).standalone === true;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(firebaseConfigured);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!firebaseConfigured) return;
    const auth = getAuthInstance();
    getRedirectResult(auth).catch((e: unknown) => setError(authMessage(e)));
    return onAuthStateChanged(auth, (u) => { setUser(u); setLoading(false); });
  }, []);

  const signIn = async () => {
    setError(null);
    const auth = getAuthInstance();
    try {
      // 홈 화면에 설치된 PWA(iOS)에서는 팝업이 막히므로 리다이렉트를 사용한다.
      if (isStandalone()) await signInWithRedirect(auth, googleProvider);
      else await signInWithPopup(auth, googleProvider);
    } catch (e) {
      const code = (e as { code?: string }).code ?? "";
      // 팝업이 막혔을 때만 리다이렉트로 다시 시도한다. 사용자가 창을 닫은 것은 취소로 본다
      if (code === "auth/popup-blocked" || code === "auth/operation-not-supported-in-this-environment") await signInWithRedirect(auth, googleProvider);
      else if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request" || code === "auth/user-cancelled") return;
      else setError(authMessage(e));
    }
  };

  const signOut = async () => { await fbSignOut(getAuthInstance()); };

  return <AuthCtx.Provider value={{ user, loading, error, signIn, signOut }}>{children}</AuthCtx.Provider>;
}

/** 로그인 오류를 가족이 알아듣는 말로 */
function authMessage(e: unknown): string {
  const code = (e as { code?: string })?.code ?? "";
  if (code === "auth/unauthorized-domain") return "이 주소에서는 로그인이 허용되지 않았어요. 앱을 설치한 사람에게 알려 주세요 (Firebase 승인된 도메인).";
  if (code === "auth/network-request-failed") return "인터넷 연결을 확인하고 다시 시도해 주세요.";
  if (code === "auth/too-many-requests") return "잠시 뒤에 다시 시도해 주세요.";
  if (code === "auth/web-storage-unsupported") return "이 브라우저 설정(사생활 보호 모드 등)에서는 로그인할 수 없어요. 일반 모드로 열어 주세요.";
  console.warn("login error", e);
  return "로그인하지 못했어요. 다시 시도해 주세요.";
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth must be inside AuthProvider");
  return ctx;
}
