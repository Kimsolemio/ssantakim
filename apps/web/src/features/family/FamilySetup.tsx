import { useState } from "react";
import { useFamily } from "../../lib/family";
import { useAuth } from "../../lib/auth";

export function FamilySetup() {
  const { createFamily, joinFamily } = useFamily();
  const { signOut, user } = useAuth();
  const [mode, setMode] = useState<"pick" | "create" | "join">("pick");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setErr(null);
    try { await fn(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };

  const field = "w-full rounded-xl border border-orange-200 bg-white px-3 py-3 text-base outline-none focus:border-orange-400";

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-4 p-6">
      <h1 className="text-2xl font-bold">안녕하세요, {user?.displayName ?? "가족"}님</h1>
      <p className="text-gray-600">가족을 새로 만들거나 초대 코드로 참여하세요.</p>
      {mode === "pick" && (
        <div className="flex flex-col gap-2">
          <button onClick={() => setMode("create")} className="rounded-xl bg-orange-500 py-3 font-semibold text-white">새 가족 만들기</button>
          <button onClick={() => setMode("join")} className="rounded-xl border border-orange-300 bg-white py-3 font-semibold">초대 코드로 참여</button>
        </div>
      )}
      {mode === "create" && (
        <div className="flex flex-col gap-2">
          <input className={field} placeholder="가족 이름 (예: 김씨네)" value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
          <button disabled={busy} onClick={() => run(() => createFamily(value))} className="rounded-xl bg-orange-500 py-3 font-semibold text-white disabled:opacity-50">만들기</button>
          <button onClick={() => setMode("pick")} className="py-2 text-sm text-gray-500">뒤로</button>
        </div>
      )}
      {mode === "join" && (
        <div className="flex flex-col gap-2">
          <input className={`${field} uppercase tracking-widest`} placeholder="초대 코드 6자리" maxLength={6} value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
          <button disabled={busy} onClick={() => run(() => joinFamily(value))} className="rounded-xl bg-orange-500 py-3 font-semibold text-white disabled:opacity-50">참여하기</button>
          <button onClick={() => setMode("pick")} className="py-2 text-sm text-gray-500">뒤로</button>
        </div>
      )}
      {err && <p className="text-sm text-red-600">{err}</p>}
      <button onClick={signOut} className="mt-6 text-sm text-gray-400">로그아웃</button>
    </div>
  );
}
