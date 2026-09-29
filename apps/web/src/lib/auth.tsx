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
    getRedirectResult(auth).catch((e: Error) => setError(e.message));
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
      const msg = e instanceof Error ? e.message : String(e);
      if (/popup/i.test(msg)) await signInWithRedirect(auth, googleProvider);
      else setError(msg);
    }
  };

  const signOut = async () => { await fbSignOut(getAuthInstance()); };

  return <AuthCtx.Provider value={{ user, loading, error, signIn, signOut }}>{children}</AuthCtx.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth must be inside AuthProvider");
  return ctx;
}
