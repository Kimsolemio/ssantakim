import { useState, type FormEvent } from "react";
import { Unit, StorageLocation } from "@cook/shared";
import type { FridgeInput } from "./useFridge";
import { Sheet } from "../../components/Sheet";

type Props = {
  initial?: Partial<FridgeInput>;
  title: string;
  onSubmit: (v: FridgeInput) => Promise<void>;
  onDelete?: () => Promise<void>;
  onClose: () => void;
};

function addDays(n: number): string {
  const d = new Date(); d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

export function FridgeItemForm({ initial, title, onSubmit, onDelete, onClose }: Props) {
  const [name, setName] = useState(initial?.name ?? "");
  const [qty, setQty] = useState(initial?.qty != null ? String(initial.qty) : "");
  const [unit, setUnit] = useState<Unit>(initial?.unit ?? "개");
  const [location, setLocation] = useState<StorageLocation>(initial?.location ?? "냉장");
  const [expiresAt, setExpiresAt] = useState(initial?.expiresAt ?? "");
  const [memo, setMemo] = useState(initial?.memo ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setErr("재료 이름을 입력하세요"); return; }
    setBusy(true); setErr(null);
    try {
      await onSubmit({
        name: name.trim(),
        qty: qty.trim() === "" ? null : Number(qty),
        unit, location,
        expiresAt: expiresAt || null,
        memo: memo.trim() || undefined,
      });
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "저장에 실패했습니다");
    } finally { setBusy(false); }
  };

  const field = "w-full rounded-xl border border-orange-200 bg-white px-3 py-3 text-base outline-none focus:border-orange-400";

  return (
    <Sheet title={title} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <input className={field} placeholder="재료 이름 (예: 대파)" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        <div className="flex gap-2">
          <input className={field} type="number" inputMode="decimal" min="0" step="any" placeholder="수량" value={qty} onChange={(e) => setQty(e.target.value)} />
          <select className={field} value={unit} onChange={(e) => setUnit(e.target.value as Unit)}>
            {Unit.options.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {StorageLocation.options.map((loc) => (
            <button type="button" key={loc} onClick={() => setLocation(loc)}
              className={`rounded-xl py-3 font-medium ${location === loc ? "bg-orange-500 text-white" : "bg-white border border-orange-200"}`}>
              {loc}
            </button>
          ))}
        </div>
        <div>
          <input className={field} type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
          <div className="mt-2 flex gap-2 text-sm">
            {[3, 7, 14, 30].map((n) => (
              <button type="button" key={n} onClick={() => setExpiresAt(addDays(n))} className="rounded-full bg-orange-100 px-3 py-1">+{n}일</button>
            ))}
            <button type="button" onClick={() => setExpiresAt("")} className="rounded-full bg-gray-100 px-3 py-1">없음</button>
          </div>
        </div>
        <input className={field} placeholder="메모 (선택)" value={memo} onChange={(e) => setMemo(e.target.value)} />
        {err && <p className="text-sm text-red-600">{err}</p>}
        <button disabled={busy} className="rounded-xl bg-orange-500 py-3 font-semibold text-white disabled:opacity-50">
          {busy ? "저장 중…" : "저장"}
        </button>
        {onDelete && (
          <button type="button" disabled={busy} onClick={async () => { if (confirm("삭제할까요?")) { setBusy(true); await onDelete(); onClose(); } }}
            className="py-2 text-sm text-red-600">삭제</button>
        )}
      </form>
    </Sheet>
  );
}
