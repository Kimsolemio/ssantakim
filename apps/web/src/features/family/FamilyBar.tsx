import { useState } from "react";
import { useFamily } from "../../lib/family";
import { useAuth } from "../../lib/auth";
import { Sheet } from "../../components/Sheet";

export function FamilyMenu() {
  const { family, leaveToSwitch } = useFamily();
  const { signOut, user } = useAuth();
  const [open, setOpen] = useState(false);
  if (!family) return null;
  return (
    <>
      <button onClick={() => setOpen(true)} className="fixed right-4 z-20 rounded-full bg-white/90 px-3 py-1.5 text-sm shadow"
        style={{ top: "calc(var(--safe-top) + 12px)" }}>👨‍👩‍👧 {family.name}</button>
      {open && (
        <Sheet title={family.name} onClose={() => setOpen(false)}>
          <div className="flex flex-col gap-3">
            <div className="rounded-xl bg-white p-4">
              <p className="text-sm text-gray-500">초대 코드</p>
              <p className="text-2xl font-bold tracking-widest">{family.inviteCode}</p>
              <p className="mt-1 text-xs text-gray-500">가족에게 알려주면 같은 냉장고를 함께 씁니다. 구성원 {family.members.length}명</p>
            </div>
            <p className="text-sm text-gray-500">{user?.displayName} ({user?.email})</p>
            <button onClick={async () => { if (confirm("다른 가족으로 바꿀까요? (데이터는 유지됩니다)")) { await leaveToSwitch(); setOpen(false); } }}
              className="rounded-xl border border-orange-200 bg-white py-2 text-sm">다른 가족으로 전환</button>
            <button onClick={signOut} className="py-2 text-sm text-red-600">로그아웃</button>
          </div>
        </Sheet>
      )}
    </>
  );
}
