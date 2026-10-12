import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, ChevronDown, ChevronRight, Images, LoaderCircle, ScanLine, X } from "lucide-react";
import { StorageLocation, Unit, addDays, daysUntil, formatAmount, localDate, provisionalKey, sameFood, type ReceiptScan, type ReceiptItem } from "@cook/shared";
import { FullScreen } from "../../components/FullScreen";
import { Sheet } from "../../components/Sheet";
import { AiNotice } from "../../components/AiNotice";
import { Button } from "../../components/ui/Button";
import { Banner } from "../../components/ui/Banner";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { AiProgress } from "../../components/ui/Ai";
import { FoodThumb } from "../../components/ui/FoodThumb";
import { Checkbox } from "../../components/ui/Toggle";
import { EmptyState } from "../../components/ui/EmptyState";
import { TextAction, rowLine } from "../../components/ui/Section";
import { TextField } from "../../components/ui/Field";
import { callWorker, workerConfigured, ApiError } from "../../lib/api";
import { prepareImage, type PreparedImage } from "../../lib/image";
import type { FridgeInput } from "./useFridge";
import { useFamily } from "../../lib/family";
import { loadPending, savePending, clearPending } from "../../lib/drafts";
import { AmountFields, ExpiryField, ItemTitle, LocationField } from "./FridgeItemForm";

type PendingReceipt = { scan: ReceiptScan; cands: Candidate[]; mode?: ScanMode };
export type ScanMode = "receipt" | "photo";

type ScanResponse = { scan: ReceiptScan; provider: string; model: string; usage: { input: number; output: number } };

/** 확인 화면에서 고치는 한 줄 */
export type Candidate = {
  id: string;
  checked: boolean;
  name: string;
  key: string;
  qty: number | null;
  unit: Unit;
  location: StorageLocation;
  expiresAt: string | null;
  /** 기한이 AI 추정값인가 (사람이 고치면 false) */
  estimated: boolean;
  emoji: string;
  category: ReceiptItem["category"];
  memo: string;
  rawText: string;
  isFood: boolean;
  /** AI가 읽은 이름과 key. 이름을 고치면 key 를 새로 만들고, 되돌리면 AI key 로 돌아간다 */
  aiName: string;
  aiKey: string;
  /** 사진 모드: 냉장고에 이미 같은 품목이 있다 (냉장고 속 사진이면 다시 넣으면 중복) */
  already?: boolean;
};

const MAX_IMAGES = 4;
const WAITING: Record<ScanMode, string[]> = {
  receipt: ["영수증을 읽는 중…", "품목을 하나씩 확인하는 중…", "보관 위치를 정하는 중…", "유통기한을 계산하는 중…", "거의 다 됐어요…"],
  photo: ["사진 속 식재료를 찾는 중…", "포장 글자를 읽는 중…", "개수를 세는 중…", "보관 위치를 정하는 중…", "거의 다 됐어요…"],
};

/** 영수증 날짜가 오늘 이후거나 너무 오래되면 오늘 기준으로 계산한다 */
export function purchaseBase(purchasedAt: string | null, today: string): string {
  if (!purchasedAt || !/^\d{4}-\d{2}-\d{2}$/.test(purchasedAt)) return today;
  const d = daysUntil(purchasedAt, new Date(`${today}T12:00:00`));
  return d !== null && d <= 0 && d >= -60 ? purchasedAt : today;
}

export function toCandidates(scan: ReceiptScan, today: string, mode: ScanMode = "receipt"): Candidate[] {
  const base = purchaseBase(scan.purchasedAt, today);
  return scan.items.map((it, i) => ({
    id: `c${i}`,
    checked: it.isFood,
    name: it.name, key: it.key, qty: it.qty, unit: it.unit, location: it.location,
    expiresAt: it.shelfLifeDays != null ? addDays(base, it.shelfLifeDays) : null,
    // 사진에서 포장의 유통기한을 실제로 읽었으면 추정이 아니다
    estimated: it.shelfLifeDays != null && !(mode === "photo" && it.dateFromPackage),
    emoji: it.emoji || "📦", category: it.category, memo: it.memo, rawText: it.rawText, isFood: it.isFood,
    aiName: it.name, aiKey: it.key,
  }));
}

/** "2026-10-21" → "10월 21일" */
function monthDay(iso: string): string {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${Number(m[1])}월 ${Number(m[2])}일` : iso;
}

type Props = {
  onClose: () => void;
  /** 고른 품목을 냉장고에 넣는다. mode: 영수증이면 장보기 정리도 한다 */
  onConfirm: (items: (FridgeInput & { key: string })[], mode: ScanMode) => Promise<void>;
  /** 지금 냉장고 품목 (사진 모드에서 중복 표시용) */
  existing?: { name: string; key: string }[];
  /** 처음 고를 탭 (채우기 시트에서 "식재료 사진"으로 들어오면 photo) */
  initialMode?: ScanMode;
};

export function ReceiptImport({ onClose, onConfirm, existing = [], initialMode = "receipt" }: Props) {
  const [images, setImages] = useState<PreparedImage[]>([]);
  const [step, setStep] = useState<"pick" | "loading" | "review">("pick");
  const [err, setErr] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [scan, setScan] = useState<ReceiptScan | null>(null);
  const [cands, setCands] = useState<Candidate[]>([]);
  const [saving, setSaving] = useState(false);
  const [showNonFood, setShowNonFood] = useState(false);
  const [mode, setMode] = useState<ScanMode>(initialMode);
  const [editId, setEditId] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const today = useMemo(() => localDate(), []);
  // 인식 결과는 이 기기에 보관해 두었다가, 넣기 전에 닫아도 다시 열면 이어서 볼 수 있게 한다
  const { familyId } = useFamily();
  const pendingName = `receipt:${familyId ?? ""}`;
  const [stored, setStored] = useState<PendingReceipt | null>(() => loadPending<PendingReceipt>(pendingName));
  useEffect(() => { if (step === "review" && scan) savePending<PendingReceipt>(pendingName, { scan, cands, mode }); }, [step, scan, cands, mode, pendingName]);

  useEffect(() => () => { abort.current?.abort(); images.forEach((im) => URL.revokeObjectURL(im.previewUrl)); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const addFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setErr(null); setPreparing(true);
    try {
      const room = MAX_IMAGES - images.length;
      if (files.length > room) setErr(`사진은 ${MAX_IMAGES}장까지예요. 앞의 ${room}장만 넣었어요.`);
      const prepared: PreparedImage[] = [];
      for (const f of Array.from(files).slice(0, room)) prepared.push(await prepareImage(f));
      setImages((cur) => [...cur, ...prepared]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "사진을 처리하지 못했습니다");
    } finally {
      setPreparing(false);
      if (cameraRef.current) cameraRef.current.value = "";
      if (galleryRef.current) galleryRef.current.value = "";
    }
  };

  const analyze = async () => {
    setErr(null); setStep("loading");
    abort.current = new AbortController();
    try {
      const res = await callWorker<ScanResponse>("/pantry/receipt", {
        today, mode, images: images.map((im) => ({ mediaType: im.mediaType, data: im.data })),
      }, abort.current.signal);
      setScan(res.scan);
      // 사진(특히 냉장고 속)에서 찾은 것 중 이미 냉장고에 있는 것은 기본으로 빼 둔다
      setCands(toCandidates(res.scan, today, mode).map((c) => {
        const already = mode === "photo" && existing.some((e) => sameFood(e, { key: c.key, name: c.name }));
        return already ? { ...c, already, checked: false } : c;
      }));
      setStored(null);
      setStep("review");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "영수증을 읽지 못했습니다");
      setStep("pick");
    }
  };

  const set = (id: string, patch: Partial<Candidate>) => setCands((l) => l.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  const rename = (c: Candidate, name: string) => set(c.id, { name, ...(provisionalKey(name) !== provisionalKey(c.aiName) ? { key: provisionalKey(name) } : { key: c.aiKey }) });
  const food = cands.filter((c) => c.isFood), nonFood = cands.filter((c) => !c.isFood);
  const chosen = cands.filter((c) => c.checked && c.name.trim());
  const editing = editId ? cands.find((c) => c.id === editId) ?? null : null;

  const confirm = async () => {
    setSaving(true); setErr(null);
    try {
      await onConfirm(chosen.map((c) => ({
        name: c.name.trim(), key: c.key, qty: c.qty, unit: c.unit, location: c.location, expiresAt: c.expiresAt, expiresEstimated: c.estimated && !!c.expiresAt,
        memo: c.memo.trim() || undefined, category: c.category, emoji: c.emoji, source: mode === "photo" ? "photo" : "receipt",
        // 사진은 언제 샀는지 모른다
        purchasedAt: mode === "photo" ? null : scan ? purchaseBase(scan.purchasedAt, today) : today,
      })), mode);
      clearPending(pendingName);
    } catch (e) {
      if (scan) savePending<PendingReceipt>(pendingName, { scan, cands, mode });
      setErr(e instanceof Error ? e.message : "저장하지 못했습니다");
      setSaving(false);
    }
  };

  /** 1줄 행: [넣기 체크] [접시] [이름 / 양 · 기한] [›]. 누르면 품목 시트 */
  const row = (c: Candidate) => {
    const amount = formatAmount({ qty: c.qty, unit: c.unit });
    const sub = [
      c.already ? "이미 냉장고에 있음" : null,
      amount || null,
      c.expiresAt ? `${c.estimated ? "~" : ""}${monthDay(c.expiresAt)}` : null,
    ].filter(Boolean).join(" · ");
    return (
      <li key={c.id} data-testid="receipt-row" className={`${rowLine} before:left-[108px]`}>
        <div className="flex min-h-14 items-center">
          <label className="flex h-14 shrink-0 cursor-pointer items-center pl-5 pr-3">
            <Checkbox aria-label={`${c.name} 넣기`} checked={c.checked} onChange={(e) => set(c.id, { checked: e.target.checked })} />
          </label>
          <button type="button" onClick={() => setEditId(c.id)} className="flex min-h-14 min-w-0 flex-1 items-center gap-3 py-2 pr-4 text-left transition-colors active:bg-surface-2">
            <FoodThumb emoji={c.emoji} />
            <span className="min-w-0 flex-1">
              <span className={`block truncate text-body ${c.name.trim() ? "text-ink" : "text-ink-3"}`}>{c.name.trim() || "이름 없음"}</span>
              {sub && <span className="mt-0.5 block truncate text-caption text-ink-3 tabular-nums">{sub}</span>}
            </span>
            <ChevronRight size={20} aria-hidden className="shrink-0 text-ink-3" />
          </button>
        </div>
      </li>
    );
  };

  const groups = StorageLocation.options.map((loc) => ({ loc, list: food.filter((c) => c.location === loc) })).filter((g) => g.list.length > 0);
  const anyEstimated = food.some((c) => c.estimated && c.expiresAt);
  const meta = mode === "photo"
    ? ["개수는 눈대중이에요", anyEstimated ? "기한은 어림값이에요" : null]
    : [scan?.store ?? null, scan?.purchasedAt ? monthDay(scan.purchasedAt) : null, anyEstimated ? "기한은 어림값이에요" : null];

  const footer = step === "pick" ? (
    <>
      <AiNotice what={mode === "photo" ? "식재료 사진" : "영수증 사진"} extra="사진은 저장하지 않아요." className="mb-3" />
      <Button ai block disabled={images.length === 0 || preparing || !workerConfigured} onClick={analyze}>
        {mode === "photo" ? "식재료 찾기" : "분석하기"}{images.length > 0 ? ` (${images.length}장)` : ""}
      </Button>
    </>
  ) : step === "review" ? (
    <div className="flex gap-2">
      <Button variant="secondary" className="shrink-0" disabled={saving} onClick={() => { setStep("pick"); setErr(null); }}>다시 찍기</Button>
      <Button className="min-w-0 flex-1" disabled={saving || chosen.length === 0} loading={saving} onClick={confirm}>
        {saving ? "넣는 중…" : `냉장고에 넣기 (${chosen.length}개)`}
      </Button>
    </div>
  ) : undefined;

  return (
    <FullScreen title={mode === "photo" ? "사진으로 채우기" : "영수증으로 채우기"} onClose={() => { abort.current?.abort(); onClose(); }}
      confirmClose={step === "loading" ? (mode === "photo" ? "사진을 보는 중이에요. 그만둘까요?" : "영수증을 읽는 중이에요. 그만둘까요?") : null}
      footer={footer}>
      {step === "pick" && (
        <div className="pb-4">
          {stored && (
            <Banner testId="pending-receipt" className="mx-5 mt-2"
              title={`넣지 않은 ${stored.mode === "photo" ? "사진" : "영수증"} 결과 ${stored.cands.filter((c) => c.isFood).length}개가 있어요${stored.scan.store ? ` (${stored.scan.store})` : ""}`}
              action={{ label: "이어서", onClick: () => { setScan(stored.scan); setCands(stored.cands); setMode(stored.mode ?? "receipt"); setStored(null); setStep("review"); } }}>
              <button type="button" className="-my-2.5 inline-flex h-11 items-center font-semibold active:opacity-60"
                onClick={() => { if (window.confirm("이 영수증 결과를 버릴까요?")) { clearPending(pendingName); setStored(null); } }}>버리기</button>
            </Banner>
          )}
          <SegmentedControl role="tab" label="무엇을 찍었나요" className="mx-5 mt-2" value={mode} onChange={setMode}
            options={[{ value: "receipt", label: "영수증·주문내역" }, { value: "photo", label: "식재료 사진" }]} />
          <p className="mt-4 px-5 text-callout text-ink-2">
            {mode === "receipt" ? `영수증이나 주문내역 캡처를 올려 주세요. ${MAX_IMAGES}장까지 돼요.` : "장본 것이나 냉장고 안을 찍어 주세요."}
          </p>
          {!workerConfigured && (
            <Banner kind="warning" className="mx-5 mt-4" title="AI 서버가 연결되지 않았어요">앱을 설치한 사람에게 알려 주세요</Banner>
          )}
          <div className="mx-5 mt-4 grid grid-cols-2 gap-3">
            {([[cameraRef, Camera, "찍기"], [galleryRef, Images, "앨범에서 고르기"]] as const).map(([ref, Icon, label]) => (
              <button key={label} type="button" disabled={preparing || images.length >= MAX_IMAGES} onClick={() => ref.current?.click()}
                className="flex h-[120px] flex-col items-center justify-center gap-2 rounded-card bg-surface-2 text-headline text-ink transition-colors active:bg-fill-pressed disabled:text-ink-disabled">
                <Icon size={28} aria-hidden />{label}
              </button>
            ))}
          </div>
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => addFiles(e.target.files)} data-testid="receipt-camera" />
          <input ref={galleryRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => addFiles(e.target.files)} data-testid="receipt-files" />
          {preparing && (
            <p role="status" className="mx-5 mt-3 flex items-center gap-2 text-caption text-ink-3"><LoaderCircle size={16} aria-hidden className="animate-spin" />사진 준비 중…</p>
          )}
          {images.length > 0 && (
            <ul className="mx-5 mt-4 grid grid-cols-4 gap-2" data-testid="receipt-thumbs">
              {images.map((im, i) => (
                <li key={im.previewUrl} className="relative aspect-[3/4] overflow-hidden rounded-control bg-surface-2">
                  <img src={im.previewUrl} alt={`사진 ${i + 1}`} className="h-full w-full object-cover" />
                  <button type="button" aria-label={`사진 ${i + 1} 빼기`} onClick={() => { URL.revokeObjectURL(im.previewUrl); setImages((l) => l.filter((x) => x !== im)); }}
                    className="absolute right-0 top-0 grid size-11 place-items-center">
                    <span aria-hidden className="grid size-6 place-items-center rounded-full bg-ink/70 text-surface"><X size={14} strokeWidth={2.5} /></span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {err && <Banner kind="danger" className="mx-5 mt-4">{err}</Banner>}
        </div>
      )}

      {step === "loading" && (
        <AiProgress className="py-24!" messages={WAITING[mode]} typical="보통 15~40초" onCancel={() => abort.current?.abort()}
          icon={<span aria-hidden className="mb-1 grid size-24 place-items-center rounded-full bg-accent-soft text-accent"><ScanLine size={44} className="motion-safe:animate-pulse" /></span>} />
      )}

      {step === "review" && (
        <div className="pb-4">
          {cands.length === 0 ? (
            <EmptyState icon={<ScanLine size={28} />} title="찾은 품목이 없어요" body="더 밝고 가깝게 찍어 보세요" />
          ) : (
            <div className="px-5 pb-2 pt-4">
              <h2 className="text-title2 text-ink tabular-nums">{food.length}개를 찾았어요</h2>
              {meta.some(Boolean) && <p className="mt-0.5 text-caption text-ink-3 tabular-nums">{meta.filter(Boolean).join(" · ")}</p>}
            </div>
          )}
          {groups.map(({ loc, list }) => {
            const all = list.every((c) => c.checked);
            return (
              <section key={loc}>
                <div className="flex items-end justify-between gap-3 px-5 pb-1 pt-5">
                  <h3 className="text-headline text-ink">{loc}<span className="ml-1.5 text-callout font-medium text-ink-3 tabular-nums">{list.length}</span></h3>
                  <TextAction onClick={() => setCands((l) => l.map((c) => (c.isFood && c.location === loc ? { ...c, checked: !all } : c)))}>
                    {all ? "모두 해제" : "모두 선택"}
                  </TextAction>
                </div>
                <ul>{list.map(row)}</ul>
              </section>
            );
          })}
          {nonFood.length > 0 && (
            <div className="mt-3">
              <button type="button" aria-expanded={showNonFood} onClick={() => setShowNonFood((v) => !v)}
                className="flex h-14 w-full items-center gap-2 px-5 text-left text-callout text-ink-2 transition-colors active:bg-surface-2">
                {showNonFood ? <ChevronDown size={20} aria-hidden className="text-ink-3" /> : <ChevronRight size={20} aria-hidden className="text-ink-3" />}
                식품이 아닌 항목 {nonFood.length}개
              </button>
              {showNonFood && <ul>{nonFood.map(row)}</ul>}
            </div>
          )}
          {err && <Banner kind="danger" className="mx-5 mt-4">{err}</Banner>}
        </div>
      )}

      {/* 품목 시트: 고치면 바로 그 행에 반영된다 (위치를 바꾸면 그 그룹으로 옮겨진다) */}
      {editing && (
        <Sheet top title={<ItemTitle name={editing.name.trim() || "품목"} emoji={editing.emoji} />} onClose={() => setEditId(null)}
          footer={<Button block onClick={() => setEditId(null)}>완료</Button>}>
          <div className="flex flex-col gap-5 pb-2 pt-2">
            <TextField label="이름" placeholder="재료 이름" value={editing.name} onChange={(e) => rename(editing, e.target.value)} />
            <AmountFields qty={editing.qty != null ? String(editing.qty) : ""} unit={editing.unit}
              onQty={(v) => set(editing.id, { qty: v.trim() === "" ? null : Number(v) })} onUnit={(u) => set(editing.id, { unit: u })} />
            <LocationField value={editing.location} onChange={(loc) => set(editing.id, { location: loc })} />
            <ExpiryField value={editing.expiresAt ?? ""} estimated={editing.estimated}
              onChange={(v) => set(editing.id, { expiresAt: v || null, estimated: false })} />
            <p className="text-caption text-ink-3">
              {mode === "photo" ? "사진에서 본 것" : "영수증 글자"}: {editing.rawText}{editing.memo ? ` · ${editing.memo}` : ""}
            </p>
          </div>
        </Sheet>
      )}
    </FullScreen>
  );
}
