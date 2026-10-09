import { initializeApp, type FirebaseApp } from "firebase/app";
import {
  getAuth, GoogleAuthProvider, connectAuthEmulator, signInWithCredential, type Auth,
} from "firebase/auth";
import { initializeFirestore, connectFirestoreEmulator, type Firestore } from "firebase/firestore";

const env = import.meta.env;
const config = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};

export const firebaseConfigured = Boolean(config.apiKey && config.projectId && config.appId);
/** 로컬 Firebase 에뮬레이터 사용 (개발·테스트 전용) */
export const useEmulators = env.VITE_USE_EMULATORS === "1";

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;

if (firebaseConfigured) {
  app = initializeApp(config);
  auth = getAuth(app);
  // undefined 필드(예: 비어 있는 note)를 저장 시 자동으로 건너뛴다
  db = initializeFirestore(app, { ignoreUndefinedProperties: true });
  if (useEmulators) {
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    connectFirestoreEmulator(db, "127.0.0.1", 8080);
    // 자동 테스트용: 에뮬레이터는 가짜 Google 토큰(JSON)을 받아준다
    const a = auth;
    (window as unknown as { __cookTest: unknown }).__cookTest = {
      signInAs: (email: string, name: string) =>
        signInWithCredential(a, GoogleAuthProvider.credential(JSON.stringify({ sub: email, email, email_verified: true, name }))),
    };
  }
}

export function getDb(): Firestore {
  if (!db) throw new Error("Firebase가 설정되지 않았습니다 (.env 확인)");
  return db;
}
export function getAuthInstance(): Auth {
  if (!auth) throw new Error("Firebase가 설정되지 않았습니다 (.env 확인)");
  return auth;
}
export const googleProvider = new GoogleAuthProvider();
