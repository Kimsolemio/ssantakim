/** 체험판 전용: firebase/auth 흉내. 누르면 바로 '체험' 계정으로 들어간다 */
import { seedDemo } from "./seed";

export type User = {
  uid: string; displayName: string | null; email: string | null; emailVerified: boolean;
  getIdToken: () => Promise<string>;
};
export type Auth = { currentUser: User | null };

const KEY = "cook-demo-user-v1";
const makeUser = (uid: string): User => ({
  uid, displayName: "나", email: "체험판", emailVerified: true,
  getIdToken: async () => `demo-token-${uid}-${"x".repeat(40)}`,
});
function loadUser(): User | null {
  try { const uid = localStorage.getItem(KEY); return uid ? makeUser(uid) : null; } catch { return null; }
}
const auth: Auth = { currentUser: loadUser() };
const subs = new Set<(u: User | null) => void>();
const notify = () => { for (const cb of [...subs]) cb(auth.currentUser); };

export function getAuth(..._args: unknown[]): Auth { return auth; }
export class GoogleAuthProvider { static credential(..._args: unknown[]) { return {}; } }
export function connectAuthEmulator(..._args: unknown[]) { /* 없음 */ }

export function onAuthStateChanged(_a: Auth, cb: (u: User | null) => void) {
  subs.add(cb);
  setTimeout(() => { if (subs.has(cb)) cb(auth.currentUser); }, 0);
  return () => { subs.delete(cb); };
}
async function signIn() {
  let uid = "demo-me";
  try { uid = localStorage.getItem(KEY) ?? uid; localStorage.setItem(KEY, uid); } catch { /* 메모리로만 */ }
  await seedDemo(uid);
  auth.currentUser = makeUser(uid);
  notify();
  return { user: auth.currentUser };
}
export const signInWithPopup = (..._args: unknown[]) => signIn();
export const signInWithRedirect = (..._args: unknown[]) => signIn();
export const signInWithCredential = (..._args: unknown[]) => signIn();
export async function getRedirectResult(..._args: unknown[]) { return null; }
export async function signOut(..._args: unknown[]) {
  auth.currentUser = null;
  try { localStorage.removeItem(KEY); } catch { /* 무시 */ }
  notify();
}

/** 체험 데이터를 지우고 처음 화면으로 */
export function resetDemo() {
  void import("./firestore").then(({ resetDemoStore }) => {
    resetDemoStore();
    try { localStorage.removeItem(KEY); } catch { /* 무시 */ }
    auth.currentUser = null;
    notify();
  });
}
