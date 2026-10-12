import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, ChevronRight, Receipt, Refrigerator, Search, SquarePen } from "lucide-react";
import { StorageLocation, daysUntil, formatAmount } from "@cook/shared";
import { useAuth } from "../../lib/auth";
import { useFamily } from "../../lib/family";
import { useFridge, addFridgeItem, addFridgeItems, updateFridgeItem, deleteFridgeItem, type FridgeDoc } from "./useFridge";
import { FridgeVisual, expiryInfo, itemLook } from "./FridgeVisual";
import { ReceiptImport, type ScanMode } from "./ReceiptImport";
import { useNav } from "../../lib/nav";
import { normalizeKeysInBackground } from "../../lib/normalize";
import { useShopping, addShoppingItems } from "../shopping/useShopping";
import { writeErrorMessage } from "../../lib/write";
import { sameFood } from "@cook/shared";
import { FridgeItemForm } from "./FridgeItemForm";
import { TabHeader } from "../family/FamilyScreen";
import { Sheet } from "../../components/Sheet";
import { useToast } from "../../components/ui/Toast";
import { ExtendedFab } from "../../components/ui/Bars";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { IconButton } from "../../components/ui/IconButton";
import { SearchField } from "../../components/ui/Field";
import { Banner } from "../../components/ui/Banner";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { FoodThumb, IconThumb } from "../../components/ui/FoodThumb";
import { EmptyState, Skeleton } from "../../components/ui/EmptyState";
import { Card, GroupLabel, rowLine, rowLineInset } from "../../components/ui/Section";

/** "사과" → "사과를", "삼겹살" → "삼겹살을" (받침을 모르면 "을(를)") */
function withObject(word: string): string {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  if (code < 0 || code >= 11172) return `${word}을(를)`;
  return `${word}${code % 28 ? "을" : "를"}`;
}

type View = "visual" | "list";

/** 냉장고 채우기 시트의 한 줄 */
function FillRow({ icon, title, sub, onClick, testId }: { icon: React.ReactNode; title: string; sub: string; onClick: () => void; testId?: string }) {
  return (
    <li className={`${rowLine} before:left-[72px]`}>
      <button type="button" onClick={onClick} data-testid={testId}
        className="flex min-h-[72px] w-full items-center gap-3 px-5 py-3 text-left transition-colors active:bg-surface-2">
        <IconThumb>{icon}</IconThumb>
        <span className="min-w-0 flex-1">
          <span className="block text-body text-ink">{title}</span>
          <span className="mt-0.5 block text-caption text-ink-3">{sub}</span>
        </span>
        <ChevronRight size={20} aria-hidden className="shrink-0 text-ink-3" />
      </button>
    </li>
  );
}

export function FridgeTab() {
  const { user } = useAuth();
  const { familyId } = useFamily();
  const { items, loading, error } = useFridge(familyId);
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [searching, setSearching] = useState(false);
  const [editing, setEditing] = useState<FridgeDoc | null>(null);
  const [adding, setAdding] = useState(false);
  const [filling, setFilling] = useState(false);
  const [view, setView] = useState<View>(() => (localStorageGet("fridge-view") === "list" ? "list" : "visual"));
  const [importing, setImporting] = useState<ScanMode | null>(null);
  const [recent, setRecent] = useState<Set<string>>(new Set());
  const [openSignal, setOpenSignal] = useState(0);
  const searchWrap = useRef<HTMLDivElement>(null);

  const { fridgeDrop, consumeFridgeDrop, pendingReceipt, consumeReceipt } = useNav();
  const { items: shopping } = useShopping(familyId);
  // 토스트의 "장보기에 담기"는 시트가 닫힌 뒤에 눌리므로 그때의 장보기 목록을 쓴다
  const shoppingRef = useRef(shopping);
  shoppingRef.current = shopping;

  const closeSearch = () => { setSearch(""); setSearching(false); };

  useEffect(() => { localStorageSet("fridge-view", view); }, [view]);
  useEffect(() => { if (searching) searchWrap.current?.querySelector("input")?.focus(); }, [searching]);
  // 다른 탭(장보기)에서 넣은 품목도 떨어지는 애니메이션으로 보여 준다
  useEffect(() => {
    if (!fridgeDrop) return;
    consumeFridgeDrop();
    closeSearch(); setView("visual"); setRecent(new Set(fridgeDrop.ids)); setOpenSignal((n) => n + 1);
    if (fridgeDrop.message) toast.show(fridgeDrop.message, { kind: "done" });
  }, [fridgeDrop]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!pendingReceipt) return;
    consumeReceipt();
    setImporting("receipt");
  }, [pendingReceipt]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (recent.size === 0) return;
    const t = setTimeout(() => setRecent(new Set()), 7000);
    return () => clearTimeout(t);
  }, [recent]);

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

  const dimmed = useMemo(() => {
    if (!search.trim()) return undefined;
    const keep = new Set(filtered.map((i) => i.id));
    return new Set(items.filter((i) => !keep.has(i.id)).map((i) => i.id));
  }, [items, filtered, search]);

  if (!familyId || !user) return null;

  const empty = !loading && items.length === 0;
  const openFill = (what: ScanMode | "manual") => {
    setFilling(false);
    if (what === "manual") setAdding(true); else setImporting(what);
  };
  // 빈 냉장고: 가운데 안내 + 바로 채우기 (FAB는 숨긴다)
  const emptyState = (
    <EmptyState icon={<Refrigerator size={28} />} title="냉장고가 비어 있어요" className="px-6! py-8!">
      <Button size="md" onClick={() => setImporting("receipt")} data-testid="open-receipt">영수증으로 채우기</Button>
      <Button size="md" variant="secondary" onClick={() => setAdding(true)}>직접 추가</Button>
    </EmptyState>
  );

  return (
    <div className="pb-[calc(var(--safe-bottom)+56px+96px)]">
      <TabHeader title="냉장고" />

      {/* 도구 줄: 보기 전환 + 검색 (검색을 누르면 같은 줄이 검색칸으로 바뀐다) */}
      <div ref={searchWrap} className="flex min-h-11 items-center gap-2 px-5 pb-3">
        {searching ? (
          <>
            <SearchField value={search} onChange={setSearch} placeholder="재료 검색" label="재료 검색" onCanvas className="min-w-0 flex-1" />
            <button type="button" onClick={closeSearch} className="-mr-2 h-11 shrink-0 px-2 text-callout font-semibold text-accent active:opacity-60">취소</button>
          </>
        ) : (
          <>
            <SegmentedControl role="tab" label="보기 방식" className="w-[168px]" value={view} onChange={setView}
              options={[{ value: "visual", label: "냉장고" }, { value: "list", label: "목록" }]} />
            <span className="flex-1" />
            <IconButton aria-label="재료 검색" className="bg-surface" onClick={() => setSearching(true)}><Search size={20} /></IconButton>
          </>
        )}
      </div>

      {error && <Banner kind="danger" className="mx-5 mb-3">{error}</Banner>}
      {loading && <Skeleton rows={3} className="px-4" />}

      {view === "visual" && !loading && (
        <div className="relative px-4">
          <FridgeVisual items={items} recentIds={recent} dimmedIds={dimmed} onItemClick={setEditing} openSignal={openSignal} />
          {empty && (
            <div className="pointer-events-none absolute inset-x-0 top-20 z-[1] flex justify-center">
              <div className="pointer-events-auto mx-6 w-full max-w-[340px] rounded-card bg-surface/85 backdrop-blur-sm">{emptyState}</div>
            </div>
          )}
        </div>
      )}

      {view === "list" && !loading && (empty ? emptyState : (
        <>
          {StorageLocation.options.map((loc) => grouped[loc].length > 0 && (
            <section key={loc}>
              <GroupLabel>{loc} <span className="tabular-nums">{grouped[loc].length}</span></GroupLabel>
              <Card className="mx-4 overflow-hidden">
                <ul>
                  {grouped[loc].map((it) => {
                    const exp = expiryInfo(it.expiresAt, it.expiresEstimated);
                    const amount = formatAmount({ qty: it.qty, unit: it.unit });
                    return (
                      <li key={it.id} className={rowLineInset}>
                        <button type="button" onClick={() => setEditing(it)} className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left transition-colors active:bg-surface-2">
                          <FoodThumb emoji={itemLook(it).emoji} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-body text-ink">{it.name}</span>
                            {it.memo && <span className="mt-0.5 block truncate text-caption text-ink-3">{it.memo}</span>}
                          </span>
                          {amount && <span className="shrink-0 text-callout text-ink-2 tabular-nums">{amount}</span>}
                          {exp && <Badge tone={exp.tone}>{exp.label}{it.expiresEstimated && <span className="sr-only"> 추정</span>}</Badge>}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            </section>
          ))}
          {filtered.length === 0 && <p className="px-5 py-12 text-center text-callout text-ink-3">찾는 재료가 없어요</p>}
        </>
      ))}

      {!loading && !empty && <ExtendedFab onClick={() => setFilling(true)}>채우기</ExtendedFab>}

      {filling && (
        <Sheet title="냉장고 채우기" onClose={() => setFilling(false)} flush>
          <ul className="pb-2">
            <FillRow testId="open-receipt" icon={<Receipt size={20} />} title="영수증·주문내역" sub="찍거나 캡처를 골라요, 4장까지" onClick={() => openFill("receipt")} />
            <FillRow icon={<Camera size={20} />} title="식재료 사진" sub="장본 것이나 냉장고 안을 찍어요" onClick={() => openFill("photo")} />
            <FillRow icon={<SquarePen size={20} />} title="직접 추가" sub="이름과 기한만 적어요" onClick={() => openFill("manual")} />
          </ul>
        </Sheet>
      )}

      {importing && (
        <ReceiptImport initialMode={importing} onClose={() => setImporting(null)} existing={items}
          onConfirm={async (inputs, mode) => {
            try {
              // 영수증이면 장보기 목록에서 이번에 산 것을 지운다 (사진은 산 것인지 원래 있던 것인지 몰라 건드리지 않는다)
              const bought = mode === "receipt" ? shopping.filter((sh) => inputs.some((i) => sameFood(sh, { key: i.key, name: i.name }))) : [];
              const ids = await addFridgeItems(familyId, user.uid, inputs, (ids) => {
                closeSearch();
                setView("visual");
                setRecent(new Set(ids));
                setOpenSignal((n) => n + 1);
              }, bought.map((b) => b.id));
              // 저장이 끝난 뒤에 닫는다 (실패하면 영수증 화면에 남아 결과를 지킨다)
              setImporting(null);
              toast.show(`냉장고에 ${ids.length}개 넣었어요${bought.length ? ` · 장보기 ${bought.length}개 완료` : ""}`, { kind: "done" });
              void normalizeKeysInBackground(familyId, "fridge_items", ids.map((id, i) => ({ id, name: inputs[i].name, key: inputs[i].key })));
            } catch (e) {
              setRecent(new Set());
              throw new Error(writeErrorMessage(e));
            }
          }} />
      )}
      {adding && (
        <FridgeItemForm title="재료 추가" onClose={() => setAdding(false)}
          onSubmit={async (v) => {
            const id = await addFridgeItem(familyId, user.uid, v);
            void normalizeKeysInBackground(familyId, "fridge_items", [{ id, name: v.name }]);
          }} />
      )}
      {editing && (
        <FridgeItemForm key={editing.id} title={editing.name} emoji={itemLook(editing).emoji} initial={editing} onClose={() => setEditing(null)}
          onSubmit={async (v) => {
            const renamed = await updateFridgeItem(familyId, editing.id, v, editing);
            if (renamed) void normalizeKeysInBackground(familyId, "fridge_items", [{ id: editing.id, name: v.name }]);
          }}
          onUsedUp={async () => {
            const item = editing;
            await deleteFridgeItem(familyId, item.id);
            // 다 먹으면 바로 빼고, 다시 살지는 토스트에서 고른다
            toast.show(`${withObject(item.name)} 냉장고에서 뺐어요`, {
              action: {
                label: "장보기에 담기",
                onClick: () => {
                  void (async () => {
                    try {
                      const res = await addShoppingItems(familyId, user.uid, [{ name: item.name, key: item.key, qty: null, unit: item.unit, category: item.category, emoji: item.emoji }], shoppingRef.current);
                      void normalizeKeysInBackground(familyId, "shopping_items", res.added);
                      toast.show(`${withObject(item.name)} 장보기에 담았어요`, { kind: "done" });
                    } catch (e) {
                      toast.show(writeErrorMessage(e), { kind: "error" });
                    }
                  })();
                },
              },
            });
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
