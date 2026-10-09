import { useState } from "react";
import { FamilyProfile } from "@cook/shared";

type Props = { initial: FamilyProfile; onSave: (p: FamilyProfile) => Promise<void> };

/** 가족 취향: AI 레시피 생성 시 함께 보내진다 */
export function ProfileForm({ initial, onSave }: Props) {
  const [p, setP] = useState<FamilyProfile>(initial);
  const [allergies, setAllergies] = useState(initial.allergies.join(", "));
  const [dislikes, setDislikes] = useState(initial.dislikes.join(", "));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const small = "rounded-lg border border-orange-200 bg-white px-2 py-2 text-sm outline-none focus:border-orange-400";
  const split = (s: string) => s.split(/[,，]/).map((x) => x.trim()).filter(Boolean);

  return (
    <div className="flex flex-col gap-2 rounded-xl bg-white p-3 text-sm">
      <p className="font-semibold">가족 취향 (AI 레시피에 반영)</p>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs text-gray-500">기본 인분
          <input className={small + " mt-1 w-full"} type="number" inputMode="numeric" min={1} value={p.defaultServings} onChange={(e) => setP({ ...p, defaultServings: Math.max(1, Number(e.target.value) || 1) })} /></label>
        <label className="text-xs text-gray-500">맵기
          <select className={small + " mt-1 w-full"} value={p.spicyLevel} onChange={(e) => setP({ ...p, spicyLevel: e.target.value as FamilyProfile["spicyLevel"] })}>
            {["순한맛", "보통", "매운맛"].map((x) => <option key={x}>{x}</option>)}
          </select></label>
      </div>
      <label className="flex items-center gap-2"><input type="checkbox" checked={p.kidsFriendly} onChange={(e) => setP({ ...p, kidsFriendly: e.target.checked })} />아이가 함께 먹어요</label>
      <input className={small} placeholder="알레르기 (쉼표로: 땅콩, 새우)" value={allergies} onChange={(e) => setAllergies(e.target.value)} />
      <input className={small} placeholder="싫어하는 재료 (쉼표로: 고수, 오이)" value={dislikes} onChange={(e) => setDislikes(e.target.value)} />
      {msg && <p className="text-xs text-gray-500">{msg}</p>}
      <button disabled={busy} className="rounded-lg bg-orange-500 py-2 font-semibold text-white disabled:opacity-50"
        onClick={async () => {
          setBusy(true); setMsg(null);
          try { await onSave({ ...p, members: p.members, allergies: split(allergies), dislikes: split(dislikes) }); setMsg("저장했어요"); }
          catch (e) { setMsg(e instanceof Error ? e.message : "저장 실패"); }
          finally { setBusy(false); }
        }}>취향 저장</button>
    </div>
  );
}
