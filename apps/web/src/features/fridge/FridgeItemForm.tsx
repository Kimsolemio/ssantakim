import { useId, useState, type FormEvent } from "react";
import { ChevronDown, CircleAlert } from "lucide-react";
import { Unit, StorageLocation, FoodCategory, CATEGORY_EMOJI, guessFood, addDays as addDaysTo, localDate } from "@cook/shared";
import type { FridgeInput } from "./useFridge";
import { Sheet } from "../../components/Sheet";
import { Button } from "../../components/ui/Button";
import { FoodThumb } from "../../components/ui/FoodThumb";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { DateField, Select, TextField } from "../../components/ui/Field";

type Props = {
  initial?: Partial<FridgeInput>;
  title: string;
  /** 수정일 때 제목 왼쪽 접시 */
  emoji?: string;
  onSubmit: (v: FridgeInput) => Promise<void>;
  onDelete?: () => Promise<void>;
  /** 다 먹었어요: 냉장고에서 뺀다 (장보기에 담기는 토스트 행동으로) */
  onUsedUp?: (toShopping: boolean) => Promise<void>;
  onClose: () => void;
};

/** 오늘(현지 날짜) + n일. toISOString 은 UTC라 한국 새벽에 하루가 어긋난다 */
function addDays(n: number): string {
  return addDaysTo(localDate(), n);
}

/* ---------- 품목 시트 칸 (냉장고 품목 시트와 영수증 확인의 품목 시트가 함께 쓴다) ---------- */

/** 수량 + 단위 한 줄 */
export function AmountFields({ qty, unit, onQty, onUnit }: { qty: string; unit: Unit; onQty: (v: string) => void; onUnit: (u: Unit) => void }) {
  return (
    <div className="grid grid-cols-[1fr_112px] gap-2">
      <TextField label="수량" type="number" inputMode="decimal" min="0" step="any" placeholder="수량" value={qty}
        onChange={(e) => onQty(e.target.value)} className="tabular-nums" />
      <Select label="단위" value={unit} onChange={(e) => onUnit(e.target.value as Unit)}>
        {Unit.options.map((u) => <option key={u} value={u}>{u}</option>)}
      </Select>
    </div>
  );
}

/** 보관 위치 (냉장/냉동/실온) */
export function LocationField({ value, onChange }: { value: StorageLocation; onChange: (v: StorageLocation) => void }) {
  return (
    <div>
      <p aria-hidden className="mb-2 text-caption font-semibold text-ink-2">보관</p>
      <SegmentedControl label="보관" value={value} onChange={onChange} options={StorageLocation.options.map((l) => ({ value: l, label: l }))} />
    </div>
  );
}

const quick = "inline-flex h-11 shrink-0 items-center rounded-full border border-line bg-surface px-3.5 text-callout font-medium text-ink-2 tabular-nums transition-colors active:bg-surface-2";

/** 유통기한: 날짜 + 빠른 칩. value 가 "" 이면 기한 없음 */
export function ExpiryField({ value, onChange, estimated }: { value: string; onChange: (v: string) => void; estimated?: boolean }) {
  const today = localDate();
  return (
    <div>
      <DateField label="유통기한" aria-label="유통기한" value={value} onChange={onChange} today={today} estimated={estimated}
        helper={estimated && value ? "보통 보관 기간으로 어림했어요" : undefined} />
      <div className="mt-2 flex flex-wrap gap-2">
        {[3, 7, 14, 30].map((n) => (
          <button type="button" key={n} onClick={() => onChange(addDays(n))} className={quick}>+{n}일</button>
        ))}
        <button type="button" onClick={() => onChange("")} className={quick}>없음</button>
      </div>
    </div>
  );
}

/** 시트 제목: 수정이면 접시 + 이름 */
export function ItemTitle({ name, emoji }: { name: string; emoji?: string }) {
  if (!emoji) return <>{name}</>;
  return <span className="flex min-w-0 items-center gap-2.5"><FoodThumb emoji={emoji} size="sm" /><span className="truncate">{name}</span></span>;
}

export function FridgeItemForm({ initial, title, emoji, onSubmit, onDelete, onUsedUp, onClose }: Props) {
  const formId = useId();
  const [name, setName] = useState(initial?.name ?? "");
  const [qty, setQty] = useState(initial?.qty != null ? String(initial.qty) : "");
  const [unit, setUnit] = useState<Unit>(initial?.unit ?? "개");
  const [location, setLocation] = useState<StorageLocation>(initial?.location ?? "냉장");
  const [expiresAt, setExpiresAt] = useState(initial?.expiresAt ?? "");
  const [memo, setMemo] = useState(initial?.memo ?? "");
  const [category, setCategory] = useState<FoodCategory | "auto">(initial?.category ?? "auto");
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState<null | "save" | "usedUp" | "delete">(null);
  const [nameErr, setNameErr] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!name.trim()) { setNameErr("재료 이름을 입력하세요"); return; }
    setBusy("save"); setErr(null); setNameErr(null);
    try {
      const n = name.trim();
      const guess = guessFood(n);
      const cat: FoodCategory = category === "auto" ? guess.category : category;
      // 이름·분류가 그대로면 기존 이모지(영수증에서 AI가 고른 것)를 유지한다
      const keepEmoji = initial?.emoji && initial.name === n && (category === "auto" || category === initial.category);
      const emoji = keepEmoji ? initial!.emoji! : guess.category === cat ? guess.emoji : CATEGORY_EMOJI[cat];
      await onSubmit({
        name: n,
        qty: qty.trim() === "" ? null : Number(qty),
        unit, location,
        expiresAt: expiresAt || null,
        // 날짜를 그대로 두면 추정 여부도 그대로, 사람이 고르면 추정이 아니다
        expiresEstimated: (expiresAt || null) === (initial?.expiresAt ?? null) ? (initial?.expiresEstimated ?? false) && !!expiresAt : false,
        memo: memo.trim(),
        category: cat,
        emoji,
        source: initial?.source ?? "manual",
        purchasedAt: initial?.purchasedAt ?? null,
      });
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "저장에 실패했습니다");
      setBusy(null);
    }
  };

  // 다 먹었어요: 바로 빼고 닫는다. 장보기에 담을지는 토스트에서 고른다
  const usedUp = async () => {
    if (!onUsedUp) return;
    setBusy("usedUp"); setErr(null);
    try { await onUsedUp(false); onClose(); }
    catch (e) { setErr(e instanceof Error ? e.message : "저장에 실패했습니다"); setBusy(null); }
  };

  const remove = async () => {
    if (!onDelete || !confirm("잘못 넣은 품목인가요? 삭제할까요?")) return;
    setBusy("delete"); setErr(null);
    try { await onDelete(); onClose(); }
    catch (e) { setErr(e instanceof Error ? e.message : "삭제하지 못했습니다"); setBusy(null); }
  };

  const estimated = !!initial?.expiresEstimated && !!expiresAt && expiresAt === (initial.expiresAt ?? "");
  const autoCategory = guessFood(name.trim() || " ").category;
  const summary = `${category === "auto" ? autoCategory : category} · ${memo.trim() || "메모 없음"}`;

  const save = (
    <Button type="submit" form={formId} block={!onUsedUp} className={onUsedUp ? "min-w-0 flex-1" : ""} disabled={!!busy} loading={busy === "save"}>
      {busy === "save" ? "저장 중…" : "저장"}
    </Button>
  );
  const footer = onUsedUp ? (
    <div className="flex gap-2">
      <Button variant="secondary" className="shrink-0" disabled={!!busy} loading={busy === "usedUp"} onClick={usedUp}>다 먹었어요</Button>
      {save}
    </div>
  ) : save;

  return (
    <Sheet title={<ItemTitle name={title} emoji={emoji} />} onClose={onClose} footer={footer}>
      <form id={formId} onSubmit={submit} className="flex flex-col gap-5 pb-2 pt-2">
        <TextField label="이름" placeholder="재료 이름 (예: 대파)" value={name} error={nameErr}
          onChange={(e) => { setName(e.target.value); if (nameErr) setNameErr(null); }} autoFocus={!initial} />
        <AmountFields qty={qty} unit={unit} onQty={setQty} onUnit={setUnit} />
        <LocationField value={location} onChange={setLocation} />
        <ExpiryField value={expiresAt} onChange={setExpiresAt} estimated={estimated} />

        {/* 자주 안 쓰는 칸은 접어 둔다 */}
        <div className="-mt-1">
          <button type="button" aria-expanded={more} onClick={() => setMore((v) => !v)}
            className="-mx-2 flex min-h-12 w-[calc(100%+16px)] items-center gap-3 rounded-control px-2 text-left transition-colors active:bg-surface-2">
            <span className="shrink-0 text-callout font-semibold text-ink-2">분류·메모</span>
            <span className="min-w-0 flex-1 truncate text-right text-callout text-ink-3">{more ? "" : summary}</span>
            <ChevronDown size={20} aria-hidden className={`shrink-0 text-ink-3 transition-transform ${more ? "rotate-180" : ""}`} />
          </button>
          {more && (
            <div className="mt-3 flex flex-col gap-5">
              <Select label="분류" value={category} onChange={(e) => setCategory(e.target.value as FoodCategory | "auto")}>
                <option value="auto">자동: {autoCategory}</option>
                {FoodCategory.options.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
              <TextField label="메모" placeholder="예: 반만 남음" value={memo} onChange={(e) => setMemo(e.target.value)} />
            </div>
          )}
        </div>

        {err && <p role="alert" className="flex items-center gap-1 text-caption text-danger"><CircleAlert size={14} aria-hidden />{err}</p>}

        {onDelete && (
          <button type="button" disabled={!!busy} onClick={remove}
            className="mx-auto h-12 rounded-control px-4 text-callout font-semibold text-ink-3 transition-colors active:bg-surface-2 disabled:text-ink-disabled">
            잘못 넣었어요 · 삭제
          </button>
        )}
      </form>
    </Sheet>
  );
}
