import { useEffect, useMemo, useRef, useState } from "react";
import { StorageLocation, daysUntil } from "@cook/shared";
import { useAuth } from "../../lib/auth";
import { useFamily } from "../../lib/family";
import { useFridge, addFridgeItem, addFridgeItems, updateFridgeItem, deleteFridgeItem, type FridgeDoc } from "./useFridge";
import { FridgeVisual, itemLook } from "./FridgeVisual";
import { ReceiptImport } from "./ReceiptImport";
import { useNav } from "../../lib/nav";
import { normalizeKeysInBackground } from "../../lib/normalize";
import { useShopping, addShoppingItems } from "../shopping/useShopping";
import { writeErrorMessage } from "../../lib/write";
import { sameFood } from "@cook/shared";
import { FridgeItemForm } from "./FridgeItemForm";

function ExpiryBadge({ expiresAt, estimated }: { expiresAt: string | null; estimated?: boolean }) {
  const d = daysUntil(expiresAt);
  if (d === null) return null;
  let cls = "bg-gray-100 text-gray-600";
  let label = `D-${d}`;
  if (d < 0) { cls = "bg-gray-200 text-gray-500 line-through"; label = `${-d}일 지남`; }
  else if (d === 0) { cls = "bg-red-500 text-white"; label = "오늘까지"; }
  else if (d <= 3) { cls = "bg-red-100 text-red-700"; }
  else if (d <= 7) { cls = "bg-amber-100 text-amber-700"; }
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cls}`} title={estimated ? "보통 보관 기간으로 추정한 날짜" : undefined}>{label}{estimated ? " · 추정" : ""}</span>;
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

  const { fridgeDrop, consumeFridgeDrop, pendingReceipt, consumeReceipt } = useNav();
  const { items: shopping } = useShopping(familyId);

  useEffect(() => { localStorageSet("fridge-view", view); }, [view]);
  // 다른 탭(장보기)에서 넣은 품목도 떨어지는 애니메이션으로 보여 준다
  useEffect(() => {
    if (!fridgeDrop) return;
    consumeFridgeDrop();
    setSearch(""); setView("visual"); setRecent(new Set(fridgeDrop.ids)); setOpenSignal((n) => n + 1);
    if (fridgeDrop.message) showToast(fridgeDrop.message);
  }, [fridgeDrop]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!pendingReceipt) return;
    consumeReceipt();
    setImporting(true);
  }, [pendingReceipt]); // eslint-disable-line react-hooks/exhaustive-deps
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
          className="flex-1 rounded-xl bg-orange-500 py-3 font-semibold text-white shadow active:scale-[0.99]">🧾 영수증·사진으로 채우기</button>
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
                      <ExpiryBadge expiresAt={it.expiresAt} estimated={it.expiresEstimated} />
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
        <ReceiptImport onClose={() => setImporting(false)} existing={items}
          onConfirm={async (inputs, mode) => {
            try {
              // 영수증이면 장보기 목록에서 이번에 산 것을 지운다 (사진은 산 것인지 원래 있던 것인지 몰라 건드리지 않는다)
              const bought = mode === "receipt" ? shopping.filter((sh) => inputs.some((i) => sameFood(sh, { key: i.key, name: i.name }))) : [];
              const ids = await addFridgeItems(familyId, user.uid, inputs, (ids) => {
                setSearch("");
                setView("visual");
                setRecent(new Set(ids));
                setOpenSignal((n) => n + 1);
              }, bought.map((b) => b.id));
              // 저장이 끝난 뒤에 닫는다 (실패하면 영수증 화면에 남아 결과를 지킨다)
              setImporting(false);
              showToast(`🎉 ${ids.length}개를 냉장고에 넣었어요${bought.length ? ` · 장보기 ${bought.length}개 완료` : ""}`);
              void normalizeKeysInBackground(familyId, "fridge_items", ids.map((id, i) => ({ id, name: inputs[i].name, key: inputs[i].key })));
            } catch (e) {
              setRecent(new Set());
              throw new Error(writeErrorMessage(e));
            }
          }} />
      )}
      {toast && (
        <div role="status" className="pointer-events-none fixed inset-x-0 z-30 mx-auto w-fit max-w-[90%] rounded-full bg-slate-900/90 px-4 py-2 text-sm text-white shadow-lg"
          style={{ bottom: "calc(var(--safe-bottom) + 150px)" }}>{toast}</div>
      )}
      {adding && (
        <FridgeItemForm title="재료 추가" onClose={() => setAdding(false)}
          onSubmit={async (v) => {
            const id = await addFridgeItem(familyId, user.uid, v);
            void normalizeKeysInBackground(familyId, "fridge_items", [{ id, name: v.name }]);
          }} />
      )}
      {editing && (
        <FridgeItemForm title="재료 수정" initial={editing} onClose={() => setEditing(null)}
          onSubmit={async (v) => {
            const renamed = await updateFridgeItem(familyId, editing.id, v, editing);
            if (renamed) void normalizeKeysInBackground(familyId, "fridge_items", [{ id: editing.id, name: v.name }]);
          }}
          onUsedUp={async (toShopping) => {
            await deleteFridgeItem(familyId, editing.id);
            if (toShopping) {
              const res = await addShoppingItems(familyId, user.uid, [{ name: editing.name, key: editing.key, qty: null, unit: editing.unit, category: editing.category, emoji: editing.emoji }], shopping);
              void normalizeKeysInBackground(familyId, "shopping_items", res.added);
            }
            showToast(toShopping ? `🛒 ${editing.name}을(를) 다 써서 장보기에 담았어요` : `${editing.name}을(를) 냉장고에서 뺐어요`);
          }}
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
