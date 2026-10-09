import { useMemo, useState } from "react";
import { StorageLocation, daysUntil } from "@cook/shared";
import { useAuth } from "../../lib/auth";
import { useFamily } from "../../lib/family";
import { useFridge, addFridgeItem, updateFridgeItem, deleteFridgeItem, type FridgeDoc } from "./useFridge";
import { FridgeItemForm } from "./FridgeItemForm";

function ExpiryBadge({ expiresAt }: { expiresAt: string | null }) {
  const d = daysUntil(expiresAt);
  if (d === null) return null;
  let cls = "bg-gray-100 text-gray-600";
  let label = `D-${d}`;
  if (d < 0) { cls = "bg-gray-200 text-gray-500 line-through"; label = `${-d}일 지남`; }
  else if (d === 0) { cls = "bg-red-500 text-white"; label = "오늘까지"; }
  else if (d <= 3) { cls = "bg-red-100 text-red-700"; }
  else if (d <= 7) { cls = "bg-amber-100 text-amber-700"; }
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{label}</span>;
}

export function FridgeTab() {
  const { user } = useAuth();
  const { familyId, family } = useFamily();
  const { items, loading, error } = useFridge(familyId);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<FridgeDoc | null>(null);
  const [adding, setAdding] = useState(false);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return s ? items.filter((i) => i.name.toLowerCase().includes(s) || (i.memo ?? "").toLowerCase().includes(s)) : items;
  }, [items, search]);

  const grouped = useMemo(() => {
    const g: Record<StorageLocation, FridgeDoc[]> = { 냉장: [], 냉동: [], 실온: [] };
    for (const it of filtered) g[it.location].push(it);
    for (const loc of StorageLocation.options) {
      g[loc].sort((a, b) => {
        const da = daysUntil(a.expiresAt) ?? 9999, db = daysUntil(b.expiresAt) ?? 9999;
        return da - db;
      });
    }
    return g;
  }, [filtered]);

  const expiringSoon = items.filter((i) => { const d = daysUntil(i.expiresAt); return d !== null && d <= 3; }).length;

  if (!familyId || !user) return null;

  return (
    <div className="flex flex-col gap-3 p-4 pb-28">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold">냉장고</h1>
          <p className="text-sm text-gray-500">{family?.name ?? ""} · {items.length}개{expiringSoon > 0 && <span className="ml-1 text-red-600">· 임박 {expiringSoon}</span>}</p>
        </div>
      </header>
      <input className="w-full rounded-xl border border-orange-200 bg-white px-3 py-2.5 outline-none focus:border-orange-400"
        placeholder="재료 검색" value={search} onChange={(e) => setSearch(e.target.value)} />

      {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {loading && <p className="text-sm text-gray-500">불러오는 중…</p>}
      {!loading && items.length === 0 && (
        <div className="rounded-2xl bg-white p-6 text-center text-gray-500">
          아직 재료가 없어요.<br />오른쪽 아래 + 버튼으로 추가해 보세요.
        </div>
      )}

      {StorageLocation.options.map((loc) => grouped[loc].length > 0 && (
        <section key={loc}>
          <h2 className="mb-1 mt-2 text-sm font-semibold text-gray-500">{loc} · {grouped[loc].length}</h2>
          <ul className="overflow-hidden rounded-2xl bg-white divide-y divide-orange-50">
            {grouped[loc].map((it) => (
              <li key={it.id}>
                <button onClick={() => setEditing(it)} className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-orange-50">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{it.name}</span>
                      <ExpiryBadge expiresAt={it.expiresAt} />
                    </div>
                    {it.memo && <p className="truncate text-xs text-gray-500">{it.memo}</p>}
                  </div>
                  <span className="shrink-0 text-sm text-gray-600">{it.qty != null ? `${it.qty} ${it.unit}` : it.unit !== "기타" ? it.unit : ""}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <button onClick={() => setAdding(true)} aria-label="재료 추가"
        className="fixed right-5 z-20 h-14 w-14 rounded-full bg-orange-500 text-3xl leading-none text-white shadow-lg active:scale-95"
        style={{ bottom: "calc(var(--safe-bottom) + 84px)" }}>+</button>

      {adding && (
        <FridgeItemForm title="재료 추가" onClose={() => setAdding(false)}
          onSubmit={(v) => addFridgeItem(familyId, user.uid, v)} />
      )}
      {editing && (
        <FridgeItemForm title="재료 수정" initial={editing} onClose={() => setEditing(null)}
          onSubmit={(v) => updateFridgeItem(familyId, editing.id, v)}
          onDelete={() => deleteFridgeItem(familyId, editing.id)} />
      )}
    </div>
  );
}
