import { useState } from "react";
import { ChevronLeft } from "lucide-react";
import { useFamily } from "../../lib/family";
import { useAuth } from "../../lib/auth";
import { Button } from "../../components/ui/Button";
import { IconButton } from "../../components/ui/IconButton";
import { TextField, inputBase } from "../../components/ui/Field";
import { Banner } from "../../components/ui/Banner";

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
  const back = () => { setMode("pick"); setValue(""); setErr(null); };

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col bg-canvas px-6" style={{ paddingTop: "var(--safe-top)" }}>
      <div className="-mx-4 h-12">{mode !== "pick" && <IconButton aria-label="뒤로" onClick={back}><ChevronLeft size={26} /></IconButton>}</div>
      <div className="flex flex-1 flex-col justify-center">
        {mode === "pick" && (
          <div className="text-center">
            <img src="/icon.svg" alt="" className="mx-auto size-[72px] rounded-[18px] shadow-raised" />
            <h1 className="mt-6 text-title1 text-ink">안녕하세요, {user?.displayName ?? "가족"}님</h1>
            <p className="mt-2 text-body text-ink-2">가족을 새로 만들거나 초대 코드로 참여하세요</p>
          </div>
        )}
        {mode === "create" && (
          <form onSubmit={(e) => { e.preventDefault(); void run(() => createFamily(value)); }} className="flex flex-col gap-4">
            <h1 className="text-title1 text-ink">가족 이름</h1>
            <TextField big onCanvas aria-label="가족 이름" placeholder="가족 이름 (예: 김씨네)" value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
            <Button type="submit" block loading={busy} disabled={!value.trim()}>만들기</Button>
          </form>
        )}
        {mode === "join" && (
          <form onSubmit={(e) => { e.preventDefault(); void run(() => joinFamily(value)); }} className="flex flex-col gap-4">
            <h1 className="text-title1 text-ink">초대 코드</h1>
            <input aria-label="초대 코드" className={`${inputBase} h-16 bg-surface text-center text-title1 uppercase tracking-[0.3em] placeholder:text-callout placeholder:tracking-normal`}
              placeholder="초대 코드 6자리" maxLength={6} value={value} onChange={(e) => setValue(e.target.value)} autoFocus autoCapitalize="characters" autoComplete="off" />
            <Button type="submit" block loading={busy} disabled={value.trim().length < 6}>참여하기</Button>
          </form>
        )}
        {err && <Banner kind="danger" className="mt-4">{err}</Banner>}
      </div>
      <div className="flex flex-col gap-2" style={{ paddingBottom: "calc(var(--safe-bottom) + 24px)" }}>
        {mode === "pick" && (
          <>
            <Button block onClick={() => setMode("create")}>새 가족 만들기</Button>
            <Button block variant="secondary" onClick={() => setMode("join")}>초대 코드로 참여</Button>
          </>
        )}
        <Button block variant="ghost" size="md" onClick={signOut}>로그아웃</Button>
      </div>
    </div>
  );
}
