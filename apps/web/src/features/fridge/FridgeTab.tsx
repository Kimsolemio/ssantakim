import { useEffect, useMemo, useRef, useState } from "react";
import { StorageLocation, daysUntil } from "@cook/shared";
import { useAuth } from "../../lib/auth";
import { useFamily } from "../../lib/family";
import { useFridge, addFridgeItem, addFridgeItems, updateFridgeItem, deleteFridgeItem, type FridgeDoc } from "./useFridge";
import { FridgeVisual, itemLook } from "./FridgeVisual";
import { ReceiptImport } from "./ReceiptImport";
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
  const [view, setView] = useState<"visual" | "list">(() => (localStorageGet("fridge-view") === "list" ? "list" : "visual"));
  const [importing, setImporting] = useState(false);
  const [recent, setRecent] = useState<Set<string>>(new Set());
  const [openSignal, setOpenSignal] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);

  useEffect(() => { localStorageSet("fridge-view", view); }, [view]);
  useEffect(() => {
    if (recent.size === 0) return;
    const t = setTimeout(() => setRecent(new Set()), 7000);
    return () => clearTimeout(t);
  }, [recent]);
  const showToast = (msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3500);
  };

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
  const dimmed = useMemo(() => {
    if (!search.trim()) return undefined;
    const keep = new Set(filtered.map((i) => i.id));
    return new Set(items.filter((i) => !keep.has(i.id)).map((i) => i.id));
  }, [items, filtered, search]);

  if (!familyId || !user) return null;

  return (
    <div className="flex flex-col gap-3 p-4 pb-28">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold">냉장고</h1>
          <p className="text-sm text-gray-500">{family?.name ?? ""} · {items.length}개{expiringSoon > 0 && <span className="ml-1 text-red-600">· 임박 {expiringSoon}</span>}</p>
        </div>
      </header>
      <div className="flex gap-2">
        <button onClick={() => setImporting(true)} data-testid="open-receipt"
          className="flex-1 rounded-xl bg-orange-500 py-3 font-semibold text-white shadow active:scale-[0.99]">🧾 영수증·캡처로 채우기</button>
        <div className="flex overflow-hidden rounded-xl border border-orange-200 bg-white text-sm" role="tablist" aria-label="보기 방식">
          <button role="tab" aria-selected={view === "visual"} onClick={() => setView("visual")} className={`px-3 ${view === "visual" ? "bg-orange-100 font-semibold text-orange-800" : "text-gray-500"}`}>🧊 냉장고</button>
          <button role="tab" aria-selected={view === "list"} onClick={() => setView("list")} className={`px-3 ${view === "list" ? "bg-orange-100 font-semibold text-orange-800" : "text-gray-500"}`}>☰ 목록</button>
        </div>
      </div>
      <input className="w-full rounded-xl border border-orange-200 bg-white px-3 py-2.5 outline-none focus:border-orange-400"
        placeholder="재료 검색" value={search} onChange={(e) => setSearch(e.target.value)} />

      {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {loading && <p className="text-sm text-gray-500">불러오는 중…</p>}
      {!loading && items.length === 0 && view === "list" && (
        <div className="rounded-2xl bg-white p-6 text-center text-gray-500">
          아직 재료가 없어요.<br />영수증을 올리거나 오른쪽 아래 + 버튼으로 추가해 보세요.
        </div>
      )}

      {view === "visual" && !loading && (
        <>
          {items.length === 0 && <p className="text-center text-sm text-gray-500">텅 빈 냉장고예요. 장본 영수증을 올려 채워 보세요!</p>}
          <FridgeVisual items={items} recentIds={recent} dimmedIds={dimmed} onItemClick={setEditing} openSignal={openSignal} />
        </>
      )}

      {view === "list" && StorageLocation.options.map((loc) => grouped[loc].length > 0 && (
        <section key={loc}>
          <h2 className="mb-1 mt-2 text-sm font-semibold text-gray-500">{loc} · {grouped[loc].length}</h2>
          <ul className="overflow-hidden rounded-2xl bg-white divide-y divide-orange-50">
            {grouped[loc].map((it) => (
              <li key={it.id}>
                <button onClick={() => setEditing(it)} className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-orange-50">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span aria-hidden>{itemLook(it).emoji}</span>
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

      {importing && (
        <ReceiptImport onClose={() => setImporting(false)}
          onConfirm={async (inputs) => {
            try {
              await addFridgeItems(familyId, user.uid, inputs, (ids) => {
                setSearch("");
                setView("visual");
                setRecent(new Set(ids));
                setOpenSignal((n) => n + 1);
                setImporting(false);
                showToast(`🎉 ${ids.length}개를 냉장고에 넣었어요`);
              });
            } catch (e) {
              setRecent(new Set());
              showToast(`저장하지 못했어요: ${e instanceof Error ? e.message : String(e)}`);
            }
          }} />
      )}
      {toast && (
        <div role="status" className="fixed inset-x-0 z-30 mx-auto w-fit max-w-[90%] rounded-full bg-slate-900/90 px-4 py-2 text-sm text-white shadow-lg"
          style={{ bottom: "calc(var(--safe-bottom) + 150px)" }}>{toast}</div>
      )}
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

function localStorageGet(k: string): string | null {
  try { return localStorage.getItem(k); } catch { return null; }
}
function localStorageSet(k: string, v: string) {
  try { localStorage.setItem(k, v); } catch { /* 사생활 보호 모드 등 */ }
}
