import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ChevronRight, Plus, Receipt, ShoppingBasket, X } from "lucide-react";
import {
  DEFAULT_SHELF_DAYS, FoodCategory, StorageLocation, Unit, addDays, defaultLocation, formatAmount, guessFood, localDate, provisionalKey,
} from "@cook/shared";
import { useAuth } from "../../lib/auth";
import { useFamily } from "../../lib/family";
import { useNav } from "../../lib/nav";
import { normalizeKeysInBackground } from "../../lib/normalize";
import { Sheet } from "../../components/Sheet";
import { Banner } from "../../components/ui/Banner";
import { BottomBar } from "../../components/ui/Bars";
import { Button } from "../../components/ui/Button";
import { EmptyState, Skeleton } from "../../components/ui/EmptyState";
import { Select, TextField, inputBase } from "../../components/ui/Field";
import { FoodThumb } from "../../components/ui/FoodThumb";
import { IconButton } from "../../components/ui/IconButton";
import { Card, GroupLabel, rowLine } from "../../components/ui/Section";
import { useToast } from "../../components/ui/Toast";
import { Checkbox } from "../../components/ui/Toggle";
import { TabHeader } from "../family/FamilyScreen";
import { FridgeItemForm } from "../fridge/FridgeItemForm";
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

/** "2026-10-18" → "10월 18일" */
const monthDay = (iso: string) => {
  const [, m, d] = iso.split("-").map(Number);
  return m && d ? `${m}월 ${d}일` : iso;
};

export function ShoppingTab() {
  const { user } = useAuth();
  const { familyId } = useFamily();
  const { items, loading, error } = useShopping(familyId);
  const { dropIntoFridge, openReceipt } = useNav();
  const toast = useToast();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [moving, setMoving] = useState(false);
  const [editing, setEditing] = useState<ShoppingDoc | null>(null);
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

  // 하단 버튼이 떠 있으면 토스트를 그 위로
  const raised = done.length > 0 ? "aboveTabs" as const : false;
  // 지운 것 되돌리기 (확인 창 대신)
  const removeWithUndo = (list: ShoppingDoc[], label: string) => {
    if (list.length === 0) return;
    const barStays = done.some((d) => !list.some((x) => x.id === d.id));
    void (list.length === 1 ? deleteShoppingItem(familyId, list[0].id) : deleteShoppingItems(familyId, list.map((x) => x.id)));
    toast.show(label, {
      raised: barStays ? "aboveTabs" : false,
      action: {
        label: "되돌리기",
        onClick: () => {
          Promise.all(list.map((x) => restoreShoppingItem(familyId, x)))
            .catch(() => toast.show("되돌리지 못했어요. 다시 담아 주세요", { kind: "error", raised }));
        },
      },
    });
  };

  const add = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = parseQuickAdd(text);
    if (!parsed.name || busy) return;
    setBusy(true);
    try {
      const res = await addShoppingItems(familyId, user.uid, [parsed], items);
      void normalizeKeysInBackground(familyId, "shopping_items", res.added);
      setText("");
      if (res.merged) toast.show(`이미 있는 ${parsed.name}에 양을 더했어요`, { kind: "done", raised });
    } finally { setBusy(false); }
  };

  const row = (it: ShoppingDoc) => {
    const amount = formatAmount({ qty: it.qty, unit: it.unit });
    return (
      <li key={it.id} data-testid="shopping-row" className={`${rowLine} before:left-[100px] flex items-center pl-2 pr-1`}>
        <label className="grid size-11 shrink-0 cursor-pointer place-items-center">
          <Checkbox round aria-label={`${it.name} 담음`} checked={it.checked} onChange={(e) => toggle(it, e.target.checked)} />
        </label>
        <button type="button" onClick={() => setEditing(it)} className="flex min-h-14 min-w-0 flex-1 items-center gap-3 py-2 pl-1 pr-2 text-left transition-colors active:bg-surface-2">
          <FoodThumb size="sm" emoji={it.emoji ?? guessFood(it.name).emoji} />
          <span className="min-w-0 flex-1">
            <span className={`block truncate text-body ${it.checked ? "text-ink-3 line-through" : "text-ink"}`}>{it.name}</span>
            {it.recipeTitle && <span className="mt-0.5 block truncate text-caption text-ink-3">{it.recipeTitle}</span>}
          </span>
          {amount && <span className={`shrink-0 text-callout tabular-nums ${it.checked ? "text-ink-3" : "text-ink-2"}`}>{amount}</span>}
        </button>
        <IconButton aria-label={`${it.name} 지우기`} onClick={() => removeWithUndo([it], `${it.name}을(를) 지웠어요`)}>
          <X size={18} aria-hidden className="text-ink-3" />
        </IconButton>
      </li>
    );
  };

  return (
    <div style={{ paddingBottom: `calc(var(--safe-bottom) + 56px + ${done.length > 0 ? 96 : 32}px)` }}>
      <TabHeader title="장보기" right={
        <button type="button" onClick={openReceipt} className="inline-flex h-11 items-center gap-1.5 rounded-full px-3 text-callout font-semibold text-ink-2 transition-colors active:bg-surface-2">
          <Receipt size={20} aria-hidden />영수증
        </button>
      } />

      <form onSubmit={add} className="relative mx-5">
        <Plus size={20} aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3" />
        <input className={`${inputBase} h-12 bg-surface pl-11 ${text.trim() ? "pr-16" : ""}`} enterKeyHint="done"
          placeholder="살 것 추가 (예: 우유 2, 삼겹살 600g)" value={text} onChange={(e) => setText(e.target.value)} aria-label="장볼 것 추가" />
        {text.trim() && (
          <button type="submit" disabled={busy} className="absolute right-1 top-1/2 h-11 -translate-y-1/2 rounded-control px-3 text-callout font-semibold text-accent active:opacity-60 disabled:text-ink-disabled">추가</button>
        )}
      </form>

      {error && <Banner kind="danger" className="mx-5 mt-4">{error}</Banner>}
      {loading && <Skeleton className="mx-5 mt-5" />}
      {!loading && items.length === 0 && (
        <EmptyState icon={<ShoppingBasket size={28} />} title="살 것이 없어요" body="레시피에서 담거나 위에 적어 보세요" />
      )}

      {groups.map((g) => (
        <section key={g.category}>
          <GroupLabel>{g.category}</GroupLabel>
          <Card className="mx-5 overflow-hidden"><ul>{g.list.map(row)}</ul></Card>
        </section>
      ))}

      {done.length > 0 && (
        <section>
          <div className="flex items-end justify-between gap-3 px-5 pb-2 pt-8">
            {/* 숫자 앞 띄어쓰기는 읽기·검색용 ("담은 것 2") */}
            <h2 className="text-headline text-ink">담은 것 <span className="ml-0.5 text-callout font-medium text-ink-3 tabular-nums">{done.length}</span></h2>
            <button type="button" onClick={() => removeWithUndo(done, `담은 것 ${done.length}개를 지웠어요`)}
              className="-my-2.5 -mr-2 h-11 px-2 text-callout font-semibold text-ink-3 active:opacity-60">모두 지우기</button>
          </div>
          <Card className="mx-5 overflow-hidden"><ul>{done.map(row)}</ul></Card>
        </section>
      )}

      {done.length > 0 && !moving && (
        <BottomBar aboveTabs>
          <Button block data-testid="move-to-fridge" onClick={() => setMoving(true)}>담은 {done.length}개 냉장고에 넣기</Button>
        </BottomBar>
      )}

      {moving && (
        <MoveToFridgeSheet items={done} onClose={() => setMoving(false)}
          onConfirm={async (inputs, movedIds) => {
            // 냉장고에 넣기와 장보기에서 지우기를 한 묶음으로. 시트를 연 뒤 다른 가족이 새로 체크한 항목은 지우지 않는다
            const ids = await addFridgeItems(familyId, user.uid, inputs, (ids) => dropIntoFridge(ids, `장본 것 ${ids.length}개를 냉장고에 넣었어요`), movedIds);
            void normalizeKeysInBackground(familyId, "fridge_items", ids.map((id, i) => ({ id, name: inputs[i].name, key: inputs[i].key })));
          }} />
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

/** 장본 것을 냉장고로: 보관 위치별로 보여 주고, 행을 누르면 품목 시트에서 고친다 */
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
  const [edit, setEdit] = useState<string | null>(null);
  const set = (id: string, p: Partial<MoveRow>) => setRows((l) => l.map((r) => (r.id === id ? { ...r, ...p } : r)));
  const editingRow = rows.find((r) => r.id === edit) ?? null;
  const byLocation = StorageLocation.options.map((loc) => ({ loc, list: rows.filter((r) => r.location === loc) })).filter((g) => g.list.length > 0);

  const confirm = async () => {
    setBusy(true); setErr(null);
    try {
      await onConfirm(rows.map((r) => ({ name: r.name, key: r.key, qty: r.qty, unit: r.unit, location: r.location, expiresAt: r.expiresAt, expiresEstimated: r.estimated && !!r.expiresAt,
        memo: r.memo, category: r.category, emoji: r.emoji, source: "manual", purchasedAt: today })), rows.map((r) => r.id));
      onClose();
    } catch (e) { setErr(e instanceof Error ? e.message : "넣지 못했어요"); setBusy(false); }
  };

  return (
    <>
      <Sheet title="냉장고에 넣기" onClose={onClose} flush footer={
        <>
          {err && <p role="alert" className="mb-2 text-caption text-danger">{err}</p>}
          <Button block loading={busy} onClick={() => void confirm()}>{rows.length}개 넣기</Button>
        </>
      }>
        <p className="px-5 text-caption text-ink-3">기한은 어림값이에요. 눌러서 고칠 수 있어요</p>
        {byLocation.map((g) => (
          <section key={g.loc}>
            <GroupLabel>{g.loc}</GroupLabel>
            <ul>
              {g.list.map((r) => {
                const amount = formatAmount({ qty: r.qty, unit: r.unit });
                const when = r.expiresAt ? `${r.estimated ? "~" : ""}${monthDay(r.expiresAt)}` : "기한 없음";
                return (
                  <li key={r.id} data-testid="move-row" className={`${rowLine} before:left-[72px]`}>
                    <button type="button" onClick={() => setEdit(r.id)} className="flex min-h-14 w-full items-center gap-3 px-5 py-3 text-left transition-colors active:bg-surface-2">
                      <FoodThumb emoji={r.emoji} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-body text-ink">{r.name}</span>
                        <span className="mt-0.5 block truncate text-caption text-ink-3 tabular-nums">{[amount, when].filter(Boolean).join(" · ")}</span>
                      </span>
                      <ChevronRight size={20} aria-hidden className="shrink-0 text-ink-3" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </Sheet>
      {editingRow && (
        <FridgeItemForm title="품목 수정" emoji={editingRow.emoji} onClose={() => setEdit(null)}
          initial={{ name: editingRow.name, qty: editingRow.qty, unit: editingRow.unit, location: editingRow.location, expiresAt: editingRow.expiresAt,
            expiresEstimated: editingRow.estimated, memo: editingRow.memo, category: editingRow.category, emoji: editingRow.emoji, source: "manual", purchasedAt: today }}
          onSubmit={async (v) => set(editingRow.id, {
            name: v.name, key: v.name === editingRow.name ? editingRow.key : provisionalKey(v.name), qty: v.qty, unit: v.unit, location: v.location,
            expiresAt: v.expiresAt, estimated: !!v.expiresEstimated && !!v.expiresAt, category: v.category ?? editingRow.category, emoji: v.emoji ?? editingRow.emoji, memo: v.memo || undefined,
          })} />
      )}
    </>
  );
}

function EditShoppingSheet({ item, onClose, onSave }: { item: ShoppingDoc; onClose: () => void; onSave: (p: { name: string; qty: number | null; unit: Unit; memo?: string }) => Promise<void> }) {
  const [name, setName] = useState(item.name);
  const [qty, setQty] = useState(item.qty != null ? String(item.qty) : "");
  const [unit, setUnit] = useState<Unit>(item.unit);
  const [memo, setMemo] = useState(item.memo ?? "");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { await onSave({ name: name.trim(), qty: qty === "" ? null : Number(qty), unit, memo: memo.trim() }); onClose(); }
    finally { setBusy(false); }
  };
  return (
    <Sheet title="장볼 것 수정" onClose={onClose} footer={<Button block disabled={!name.trim()} loading={busy} onClick={() => void save()}>저장</Button>}>
      <div className="flex flex-col gap-4 pt-2">
        <TextField label="이름" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="grid grid-cols-2 gap-3">
          <TextField label="수량" type="number" inputMode="decimal" min={0} step="any" placeholder="수량" value={qty} onChange={(e) => setQty(e.target.value)} />
          <Select label="단위" value={unit} onChange={(e) => setUnit(e.target.value as Unit)}>{Unit.options.map((u) => <option key={u}>{u}</option>)}</Select>
        </div>
        <TextField label="메모" placeholder="브랜드, 가게 등" value={memo} onChange={(e) => setMemo(e.target.value)} />
      </div>
    </Sheet>
  );
}
