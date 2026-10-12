import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  DEFAULT_SHELF_DAYS, FoodCategory, StorageLocation, Unit, addDays, defaultLocation, formatAmount, guessFood, localDate,
} from "@cook/shared";
import { useAuth } from "../../lib/auth";
import { useFamily } from "../../lib/family";
import { useNav } from "../../lib/nav";
import { normalizeKeysInBackground } from "../../lib/normalize";
import { Sheet } from "../../components/Sheet";
import { addFridgeItems, type FridgeInput } from "../fridge/useFridge";
import {
  useShopping, addShoppingItems, setShoppingChecked, deleteShoppingItem, deleteShoppingItems, updateShoppingItem, restoreShoppingItem, type ShoppingDoc,
} from "./useShopping";

/** "우유 2", "삼겹살 600g", "두부 1모" → 이름·수량·단위. 숫자 앞에 띄어쓰기가 있을 때만 수량으로 본다 ("비타500"은 이름) */
export function parseQuickAdd(text: string): { name: string; qty: number | null; unit: Unit } {
  const t = text.trim().replace(/\s+/g, " ");
  const m = /^(.*?)\s+(\d+(?:\.\d+)?)\s*(kg|g|ml|L|l|개|봉|팩|캔|장|줌|쪽|컵|모|단|대|마리|송이|포기|알|병)?$/.exec(t);
  if (!m || !m[1]) return { name: t, qty: null, unit: "개" };
  const raw = m[3] ?? "개";
  const unit: Unit = raw === "l" ? "L" : (raw as Unit);
  return { name: m[1].trim(), qty: Number(m[2]), unit };
}

export function ShoppingTab() {
  const { user } = useAuth();
  const { familyId } = useFamily();
  const { items, loading, error } = useShopping(familyId);
  const { dropIntoFridge, openReceipt } = useNav();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [moving, setMoving] = useState(false);
  const [editing, setEditing] = useState<ShoppingDoc | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // 지운 것 되돌리기 (확인 창 대신)
  const [undo, setUndo] = useState<{ items: ShoppingDoc[]; label: string } | null>(null);
  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(() => setUndo(null), 6000);
    return () => clearTimeout(t);
  }, [undo]);
  const removeWithUndo = (list: ShoppingDoc[], label: string) => {
    if (!familyId || list.length === 0) return;
    setUndo({ items: list, label });
    void (list.length === 1 ? deleteShoppingItem(familyId, list[0].id) : deleteShoppingItems(familyId, list.map((x) => x.id)));
  };
  // 체크하면 서버 반영을 기다리지 않고 바로 화면에 보인다 (반영되면 서버 값으로 돌아간다)
  const [optimistic, setOptimistic] = useState<Record<string, boolean>>({});
  const view = useMemo(() => items.map((i) => (i.id in optimistic ? { ...i, checked: optimistic[i.id] } : i)), [items, optimistic]);
  useEffect(() => {
    setOptimistic((o) => {
      const next = { ...o };
      let changed = false;
      for (const i of items) if (i.id in next && next[i.id] === i.checked) { delete next[i.id]; changed = true; }
      return changed ? next : o;
    });
  }, [items]);
  const toggle = (it: ShoppingDoc, checked: boolean) => {
    if (!familyId) return;
    setOptimistic((o) => ({ ...o, [it.id]: checked }));
    setShoppingChecked(familyId, it.id, checked).catch(() => setOptimistic((o) => { const n = { ...o }; delete n[it.id]; return n; }));
  };

  const todo = useMemo(() => view.filter((i) => !i.checked), [view]);
  const done = useMemo(() => view.filter((i) => i.checked), [view]);
  const groups = useMemo(() => {
    const m = new Map<FoodCategory, ShoppingDoc[]>();
    for (const it of todo) { const c = it.category ?? guessFood(it.name).category; m.set(c, [...(m.get(c) ?? []), it]); }
    return FoodCategory.options.filter((c) => m.has(c)).map((c) => ({ category: c, list: m.get(c)! }));
  }, [todo]);

  if (!familyId || !user) return null;

  const add = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = parseQuickAdd(text);
    if (!parsed.name) return;
    setBusy(true);
    try {
      const res = await addShoppingItems(familyId, user.uid, [parsed], items);
      void normalizeKeysInBackground(familyId, "shopping_items", res.added);
      setText("");
      if (res.merged) { setNotice(`이미 있는 ${parsed.name}에 양을 더했어요`); setTimeout(() => setNotice(null), 2500); }
    } finally { setBusy(false); }
  };

  const row = (it: ShoppingDoc) => (
    <li key={it.id} data-testid="shopping-row" className="flex items-center gap-3 px-4 py-3">
      <input type="checkbox" className="h-6 w-6 accent-orange-500" aria-label={`${it.name} 담음`} checked={it.checked}
        onChange={(e) => toggle(it, e.target.checked)} />
      <button type="button" onClick={() => setEditing(it)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
        <span aria-hidden>{it.emoji ?? guessFood(it.name).emoji}</span>
        <span className={`min-w-0 flex-1 truncate ${it.checked ? "text-gray-400 line-through" : "font-medium"}`}>
          {it.name}
          {it.recipeTitle && <span className="ml-1 text-xs font-normal text-gray-400">· {it.recipeTitle}</span>}
        </span>
        <span className={`shrink-0 text-sm ${it.checked ? "text-gray-400" : "text-gray-600"}`}>{formatAmount({ qty: it.qty, unit: it.unit })}</span>
      </button>
      <button type="button" aria-label={`${it.name} 지우기`} onClick={() => removeWithUndo([it], `${it.name}을(를) 지웠어요`)} className="px-2 py-1 text-gray-400">✕</button>
    </li>
  );

  return (
    <div className="flex flex-col gap-3 p-4 pb-40">
      <header>
        <h1 className="text-2xl font-bold">장보기</h1>
        <p className="text-sm text-gray-500">살 것 {todo.length}개{done.length ? ` · 담음 ${done.length}개` : ""}</p>
      </header>
      <form onSubmit={add} className="flex gap-2">
        <input className="min-w-0 flex-1 rounded-xl border border-orange-200 bg-white px-3 py-2.5 outline-none focus:border-orange-400"
          placeholder="예: 우유 2, 삼겹살 600g" value={text} onChange={(e) => setText(e.target.value)} aria-label="장볼 것 추가" />
        <button disabled={busy || !text.trim()} className="rounded-xl bg-orange-500 px-4 font-semibold text-white disabled:opacity-40">추가</button>
      </form>
      {notice && <p className="text-sm text-gray-500">{notice}</p>}
      {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {loading && <p className="text-sm text-gray-500">불러오는 중…</p>}
      {!loading && items.length === 0 && (
        <div className="rounded-2xl bg-white p-6 text-center text-gray-500">살 것이 없어요.<br />레시피에서 "장보기에 담기"를 누르거나 위에 직접 적어 보세요.</div>
      )}

      {groups.map((g) => (
        <section key={g.category}>
          <h2 className="mb-1 text-sm font-semibold text-gray-500">{g.category}</h2>
          <ul className="overflow-hidden rounded-2xl bg-white divide-y divide-orange-50">{g.list.map(row)}</ul>
        </section>
      ))}

      {done.length > 0 && (
        <section>
          <div className="mb-1 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-500">장바구니에 담음 {done.length}</h2>
            <button type="button" className="text-xs text-gray-400 underline" onClick={() => removeWithUndo(done, `담은 항목 ${done.length}개를 지웠어요`)}>냉장고에 안 넣고 지우기</button>
          </div>
          <ul className="overflow-hidden rounded-2xl bg-white divide-y divide-orange-50">{done.map(row)}</ul>
        </section>
      )}

      <div className="fixed inset-x-0 z-10 mx-auto flex max-w-lg gap-2 px-4" style={{ bottom: "calc(var(--safe-bottom) + 76px)" }}>
        <button type="button" onClick={openReceipt} className="rounded-xl bg-white px-3 py-3 text-sm font-semibold text-gray-700 shadow">🧾 영수증으로</button>
        <button type="button" disabled={done.length === 0} onClick={() => setMoving(true)} data-testid="move-to-fridge"
          className="flex-1 rounded-xl bg-orange-500 py-3 font-semibold text-white shadow disabled:bg-orange-300">🧊 담은 것 냉장고에 넣기 ({done.length})</button>
      </div>

      {moving && (
        <MoveToFridgeSheet items={done} onClose={() => setMoving(false)}
          onConfirm={async (inputs, movedIds) => {
            // 냉장고에 넣기와 장보기에서 지우기를 한 묶음으로. 시트를 연 뒤 다른 가족이 새로 체크한 항목은 지우지 않는다
            const ids = await addFridgeItems(familyId, user.uid, inputs, (ids) => dropIntoFridge(ids, `🎉 장본 것 ${ids.length}개를 냉장고에 넣었어요`), movedIds);
            void normalizeKeysInBackground(familyId, "fridge_items", ids.map((id, i) => ({ id, name: inputs[i].name, key: inputs[i].key })));
          }} />
      )}
      {undo && (
        <div role="status" className="fixed inset-x-0 z-30 mx-auto flex w-fit max-w-[92%] items-center gap-3 rounded-full bg-slate-900/90 py-2 pl-4 pr-2 text-sm text-white shadow-lg"
          style={{ bottom: "calc(var(--safe-bottom) + 140px)" }}>
          <span>{undo.label}</span>
          <button type="button" className="rounded-full bg-white/15 px-3 py-1 font-semibold" onClick={() => {
            const items = undo.items; setUndo(null);
            void Promise.all(items.map((x) => restoreShoppingItem(familyId, x)));
          }}>되돌리기</button>
        </div>
      )}
      {editing && (
        <EditShoppingSheet item={editing} onClose={() => setEditing(null)}
          onSave={async (patch) => {
            const renamed = await updateShoppingItem(familyId, editing.id, patch, editing);
            if (renamed) void normalizeKeysInBackground(familyId, "shopping_items", [{ id: editing.id, name: patch.name }]);
          }} />
      )}
    </div>
  );
}

type MoveRow = { id: string; name: string; key: string; qty: number | null; unit: Unit; location: StorageLocation; expiresAt: string | null; estimated: boolean; category: FoodCategory; emoji: string; memo?: string };

/** 장본 것을 냉장고로: 보관 위치와 유통기한만 확인 */
function MoveToFridgeSheet({ items, onClose, onConfirm }: { items: ShoppingDoc[]; onClose: () => void; onConfirm: (inputs: (FridgeInput & { key: string })[], movedIds: string[]) => Promise<void> }) {
  const today = localDate();
  const [rows, setRows] = useState<MoveRow[]>(() => items.map((it) => {
    const guess = guessFood(it.name);
    const category = it.category ?? guess.category;
    const days = DEFAULT_SHELF_DAYS[category];
    return { id: it.id, name: it.name, key: it.key, qty: it.qty, unit: it.unit, location: defaultLocation(category),
      expiresAt: days != null ? addDays(today, days) : null, estimated: days != null, category, emoji: it.emoji ?? guess.emoji, memo: it.memo };
  }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (i: number, p: Partial<MoveRow>) => setRows((l) => l.map((r, j) => (j === i ? { ...r, ...p } : r)));
  return (
    <Sheet title="냉장고에 넣기" onClose={onClose}>
      <div className="flex max-h-[70vh] flex-col gap-2 overflow-y-auto">
        <p className="text-xs text-gray-500">유통기한은 보통 보관 기간으로 채웠어요. 포장에 적힌 날짜가 있으면 고쳐 주세요.</p>
        <ul className="flex flex-col gap-1.5">
          {rows.map((r, i) => (
            <li key={r.id} data-testid="move-row" className="rounded-xl bg-white px-3 py-2">
              <div className="flex items-center gap-2"><span aria-hidden>{r.emoji}</span><span className="flex-1 font-medium">{r.name}</span><span className="text-sm text-gray-600">{formatAmount({ qty: r.qty, unit: r.unit })}</span></div>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
                <div className="flex overflow-hidden rounded-lg border border-orange-200">
                  {StorageLocation.options.map((loc) => (
                    <button key={loc} type="button" onClick={() => set(i, { location: loc })} className={`px-2.5 py-1 ${r.location === loc ? "bg-orange-500 text-white" : "bg-white text-gray-600"}`}>{loc}</button>
                  ))}
                </div>
                <label className="flex items-center gap-1 text-gray-500">기한
                  <input type="date" className="rounded-lg border border-orange-200 px-2 py-1" value={r.expiresAt ?? ""} onChange={(e) => set(i, { expiresAt: e.target.value || null, estimated: false })} />
                </label>
                {r.estimated && r.expiresAt && <span className="rounded-full bg-gray-100 px-1.5 text-[11px] text-gray-500">추정</span>}
              </div>
            </li>
          ))}
        </ul>
        {err && <p className="text-sm text-red-600">{err}</p>}
        <button disabled={busy} className="rounded-xl bg-orange-500 py-3 font-semibold text-white disabled:opacity-40"
          onClick={async () => {
            setBusy(true); setErr(null);
            try {
              await onConfirm(rows.map((r) => ({ name: r.name, key: r.key, qty: r.qty, unit: r.unit, location: r.location, expiresAt: r.expiresAt, expiresEstimated: r.estimated && !!r.expiresAt,
                memo: r.memo, category: r.category, emoji: r.emoji, source: "manual", purchasedAt: today })), rows.map((r) => r.id));
              onClose();
            } catch (e) { setErr(e instanceof Error ? e.message : "넣지 못했습니다"); setBusy(false); }
          }}>🧊 {rows.length}개 넣기</button>
      </div>
    </Sheet>
  );
}

function EditShoppingSheet({ item, onClose, onSave }: { item: ShoppingDoc; onClose: () => void; onSave: (p: { name: string; qty: number | null; unit: Unit; memo?: string }) => Promise<void> }) {
  const [name, setName] = useState(item.name);
  const [qty, setQty] = useState(item.qty != null ? String(item.qty) : "");
  const [unit, setUnit] = useState<Unit>(item.unit);
  const [memo, setMemo] = useState(item.memo ?? "");
  const field = "w-full rounded-xl border border-orange-200 bg-white px-3 py-2.5 outline-none focus:border-orange-400";
  return (
    <Sheet title="장볼 것 수정" onClose={onClose}>
      <div className="flex flex-col gap-2">
        <input className={field} value={name} onChange={(e) => setName(e.target.value)} aria-label="이름" />
        <div className="flex gap-2">
          <input className={field} type="number" inputMode="decimal" min={0} step="any" placeholder="수량" value={qty} onChange={(e) => setQty(e.target.value)} />
          <select className={field} value={unit} onChange={(e) => setUnit(e.target.value as Unit)}>{Unit.options.map((u) => <option key={u}>{u}</option>)}</select>
        </div>
        <input className={field} placeholder="메모 (브랜드, 가게 등)" value={memo} onChange={(e) => setMemo(e.target.value)} />
        <button className="rounded-xl bg-orange-500 py-3 font-semibold text-white" disabled={!name.trim()}
          onClick={async () => { await onSave({ name: name.trim(), qty: qty === "" ? null : Number(qty), unit, memo: memo.trim() }); onClose(); }}>저장</button>
      </div>
    </Sheet>
  );
}
