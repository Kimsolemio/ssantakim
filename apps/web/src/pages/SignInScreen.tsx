import { useAuth } from "../lib/auth";
import { authDomainMismatch } from "../lib/firebase";

export function SignInScreen() {
  const { signIn, error } = useAuth();
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 p-6">
      <img src="/icon.svg" alt="" className="h-24 w-24 rounded-3xl" />
      <div className="text-center">
        <h1 className="text-3xl font-bold">우리집 요리</h1>
        <p className="mt-1 text-gray-500">레시피 · 냉장고 · 장보기를 가족과 함께</p>
      </div>
      <button onClick={signIn} className="w-full max-w-xs rounded-xl bg-orange-500 py-3 font-semibold text-white">Google로 시작하기</button>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {authDomainMismatch() && (
        <p className="max-w-xs text-center text-xs text-amber-700">
          설치하는 분께: 이 주소({location.host})와 로그인 주소({authDomainMismatch()})가 달라서 아이폰 홈 화면 앱에서는 로그인이 안 될 수 있어요. README "아이폰 로그인"을 확인해 주세요.
        </p>
      )}
    </div>
  );
}
