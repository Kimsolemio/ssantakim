import { useAuth } from "../lib/auth";

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
    </div>
  );
}
