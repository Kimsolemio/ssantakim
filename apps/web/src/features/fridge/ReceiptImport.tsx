import { useEffect, useMemo, useRef, useState } from "react";
import { StorageLocation, Unit, addDays, daysUntil, localDate, provisionalKey, type ReceiptScan, type ReceiptItem } from "@cook/shared";
import { FullScreen } from "../../components/FullScreen";
import { AiNotice } from "../../components/AiNotice";
import { callWorker, workerConfigured, ApiError } from "../../lib/api";
import { prepareImage, type PreparedImage } from "../../lib/image";
import type { FridgeInput } from "./useFridge";
import { useFamily } from "../../lib/family";
import { loadPending, savePending, clearPending } from "../../lib/drafts";

type PendingReceipt = { scan: ReceiptScan; cands: Candidate[] };

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
};

const MAX_IMAGES = 4;
const WAITING = ["영수증을 읽는 중…", "품목을 하나씩 확인하는 중…", "보관 위치를 정하는 중…", "유통기한을 계산하는 중…", "거의 다 됐어요…"];

/** 영수증 날짜가 오늘 이후거나 너무 오래되면 오늘 기준으로 계산한다 */
export function purchaseBase(purchasedAt: string | null, today: string): string {
  if (!purchasedAt || !/^\d{4}-\d{2}-\d{2}$/.test(purchasedAt)) return today;
  const d = daysUntil(purchasedAt, new Date(`${today}T12:00:00`));
  return d !== null && d <= 0 && d >= -60 ? purchasedAt : today;
}

export function toCandidates(scan: ReceiptScan, today: string): Candidate[] {
  const base = purchaseBase(scan.purchasedAt, today);
  return scan.items.map((it, i) => ({
    id: `c${i}`,
    checked: it.isFood,
    name: it.name, key: it.key, qty: it.qty, unit: it.unit, location: it.location,
    expiresAt: it.shelfLifeDays != null ? addDays(base, it.shelfLifeDays) : null,
    estimated: it.shelfLifeDays != null,
    emoji: it.emoji || "📦", category: it.category, memo: it.memo, rawText: it.rawText, isFood: it.isFood,
    aiName: it.name, aiKey: it.key,
  }));
}

type Props = {
  onClose: () => void;
  /** 고른 품목을 냉장고에 넣는다 */
  onConfirm: (items: (FridgeInput & { key: string })[]) => Promise<void>;
};

export function ReceiptImport({ onClose, onConfirm }: Props) {
  const [images, setImages] = useState<PreparedImage[]>([]);
  const [step, setStep] = useState<"pick" | "loading" | "review">("pick");
  const [err, setErr] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [scan, setScan] = useState<ReceiptScan | null>(null);
  const [cands, setCands] = useState<Candidate[]>([]);
  const [tick, setTick] = useState(0);
  const [saving, setSaving] = useState(false);
  const [showNonFood, setShowNonFood] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const today = useMemo(() => localDate(), []);
  // 인식 결과는 이 기기에 보관해 두었다가, 넣기 전에 닫아도 다시 열면 이어서 볼 수 있게 한다
  const { familyId } = useFamily();
  const pendingName = `receipt:${familyId ?? ""}`;
  const [stored, setStored] = useState<PendingReceipt | null>(() => loadPending<PendingReceipt>(pendingName));
  useEffect(() => { if (step === "review" && scan) savePending<PendingReceipt>(pendingName, { scan, cands }); }, [step, scan, cands, pendingName]);

  useEffect(() => () => { abort.current?.abort(); images.forEach((im) => URL.revokeObjectURL(im.previewUrl)); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (step !== "loading") return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [step]);

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
    setErr(null); setStep("loading"); setTick(0);
    abort.current = new AbortController();
    try {
      const res = await callWorker<ScanResponse>("/pantry/receipt", {
        today, images: images.map((im) => ({ mediaType: im.mediaType, data: im.data })),
      }, abort.current.signal);
      setScan(res.scan);
      setCands(toCandidates(res.scan, today));
      setStored(null);
      setStep("review");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "영수증을 읽지 못했습니다");
      setStep("pick");
    }
  };

  const set = (id: string, patch: Partial<Candidate>) => setCands((l) => l.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  const food = cands.filter((c) => c.isFood), nonFood = cands.filter((c) => !c.isFood);
  const chosen = cands.filter((c) => c.checked && c.name.trim());

  const confirm = async () => {
    setSaving(true); setErr(null);
    try {
      clearPending(pendingName);
      await onConfirm(chosen.map((c) => ({
        name: c.name.trim(), key: c.key, qty: c.qty, unit: c.unit, location: c.location, expiresAt: c.expiresAt, expiresEstimated: c.estimated && !!c.expiresAt,
        memo: c.memo.trim() || undefined, category: c.category, emoji: c.emoji, source: "receipt",
        purchasedAt: scan ? purchaseBase(scan.purchasedAt, today) : today,
      })));
    } catch (e) {
      if (scan) savePending<PendingReceipt>(pendingName, { scan, cands });
      setErr(e instanceof Error ? e.message : "저장하지 못했습니다");
      setSaving(false);
    }
  };

  const small = "rounded-lg border border-orange-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-orange-400";

  const row = (c: Candidate) => (
    <li key={c.id} data-testid="receipt-row" className={`rounded-2xl bg-white p-3 ${c.checked ? "" : "opacity-50"}`}>
      <div className="flex items-center gap-2">
        <input type="checkbox" aria-label={`${c.name} 넣기`} checked={c.checked} onChange={(e) => set(c.id, { checked: e.target.checked })} className="h-5 w-5 accent-orange-500" />
        <span className="text-2xl" aria-hidden>{c.emoji}</span>
        <input className={small + " min-w-0 flex-1 font-medium"} value={c.name} aria-label="이름"
          onChange={(e) => set(c.id, { name: e.target.value, ...(provisionalKey(e.target.value) !== provisionalKey(c.aiName) ? { key: provisionalKey(e.target.value) } : { key: c.aiKey }) })} />
        <input className={small + " w-16"} type="number" inputMode="decimal" min={0} step="any" value={c.qty ?? ""} aria-label="수량"
          onChange={(e) => set(c.id, { qty: e.target.value === "" ? null : Number(e.target.value) })} />
        <select className={small + " w-16"} value={c.unit} onChange={(e) => set(c.id, { unit: e.target.value as Unit })} aria-label="단위">
          {Unit.options.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 pl-7 text-xs">
        <div className="flex overflow-hidden rounded-lg border border-orange-200">
          {StorageLocation.options.map((loc) => (
            <button key={loc} type="button" onClick={() => set(c.id, { location: loc })}
              className={`px-2.5 py-1 ${c.location === loc ? "bg-orange-500 text-white" : "bg-white text-gray-600"}`}>{loc}</button>
          ))}
        </div>
        <label className="flex items-center gap-1 text-gray-500">기한
          <input className={small + " py-1"} type="date" value={c.expiresAt ?? ""} onChange={(e) => set(c.id, { expiresAt: e.target.value || null, estimated: false })} />
          {c.estimated && c.expiresAt && <span className="rounded-full bg-gray-100 px-1.5 text-[11px] text-gray-500">추정</span>}
        </label>
      </div>
      <p className="mt-1 truncate pl-7 text-[11px] text-gray-400">영수증: {c.rawText}{c.memo ? ` · ${c.memo}` : ""}</p>
    </li>
  );

  return (
    <FullScreen title="영수증으로 채우기" onClose={() => { abort.current?.abort(); onClose(); }}
      confirmClose={step === "review" && !saving ? "읽은 품목을 냉장고에 넣지 않고 닫을까요? (다음에 열면 이어서 볼 수 있어요)" : step === "loading" ? "영수증을 읽는 중이에요. 그만둘까요?" : null}>
      {step === "pick" && (
        <div className="flex flex-col gap-4 p-4">
          {stored && (
            <div className="flex items-center gap-2 rounded-2xl bg-amber-50 p-3 text-sm text-amber-900" data-testid="pending-receipt">
              <span className="min-w-0 flex-1">🧾 넣지 않은 영수증 결과 {stored.cands.filter((c) => c.isFood).length}개가 남아 있어요{stored.scan.store ? ` (${stored.scan.store})` : ""}</span>
              <button type="button" className="shrink-0 rounded-lg bg-orange-500 px-3 py-1.5 font-semibold text-white"
                onClick={() => { setScan(stored.scan); setCands(stored.cands); setStored(null); setStep("review"); }}>이어서</button>
              <button type="button" className="shrink-0 px-1 text-amber-700 underline" onClick={() => { clearPending(pendingName); setStored(null); }}>버리기</button>
            </div>
          )}
          <p className="text-sm text-gray-600">장본 영수증 사진이나 쿠팡·마켓컬리 같은 주문내역 캡처를 올리면 AI가 품목을 읽어 냉장고에 넣어 드려요. 긴 영수증은 나눠 찍어 최대 {MAX_IMAGES}장까지 올릴 수 있어요.</p>
          {!workerConfigured && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">AI 서버 주소(VITE_WORKER_URL)가 설정되지 않았습니다.</p>}
          <div className="grid grid-cols-2 gap-2">
            <button type="button" disabled={preparing || images.length >= MAX_IMAGES} onClick={() => cameraRef.current?.click()} className="rounded-2xl bg-white py-5 text-center font-semibold disabled:opacity-40">📷<br />영수증 찍기</button>
            <button type="button" disabled={preparing || images.length >= MAX_IMAGES} onClick={() => galleryRef.current?.click()} className="rounded-2xl bg-white py-5 text-center font-semibold disabled:opacity-40">🖼️<br />사진·캡처 고르기</button>
          </div>
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => addFiles(e.target.files)} data-testid="receipt-camera" />
          <input ref={galleryRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => addFiles(e.target.files)} data-testid="receipt-files" />
          {preparing && <p className="text-sm text-gray-500">사진 준비 중…</p>}
          {images.length > 0 && (
            <ul className="grid grid-cols-4 gap-2" data-testid="receipt-thumbs">
              {images.map((im, i) => (
                <li key={im.previewUrl} className="relative aspect-[3/4] overflow-hidden rounded-xl bg-white">
                  <img src={im.previewUrl} alt={`사진 ${i + 1}`} className="h-full w-full object-cover" />
                  <button type="button" aria-label={`사진 ${i + 1} 빼기`} onClick={() => { URL.revokeObjectURL(im.previewUrl); setImages((l) => l.filter((x) => x !== im)); }}
                    className="absolute right-1 top-1 h-6 w-6 rounded-full bg-black/60 text-xs text-white">✕</button>
                </li>
              ))}
            </ul>
          )}
          {err && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{err}</p>}
          <button disabled={images.length === 0 || preparing || !workerConfigured} onClick={analyze}
            className="rounded-xl bg-orange-500 py-3.5 text-lg font-semibold text-white disabled:opacity-40">🧾 분석하기</button>
          <AiNotice what="영수증 사진" />
          <p className="text-center text-xs text-gray-400">사진은 앱에 저장하지 않아요. 카드번호·적립번호 부분은 가리고 찍으면 더 안전해요.</p>
        </div>
      )}

      {step === "loading" && (
        <div className="flex flex-col items-center justify-center gap-4 p-10 text-center">
          <div className="text-6xl motion-safe:animate-bounce">🧾</div>
          <p className="text-lg font-semibold">{WAITING[Math.min(Math.floor(tick / 6), WAITING.length - 1)]}</p>
          <p className="text-sm text-gray-500">{tick}초 · 보통 15~40초 걸려요</p>
          <button onClick={() => abort.current?.abort()} className="text-sm text-gray-500 underline">취소</button>
        </div>
      )}

      {step === "review" && (
        <div className="flex flex-col gap-3 p-4 pb-28">
          <div className="rounded-2xl bg-orange-50 p-3 text-sm text-orange-900">
            {scan?.store ?? "가게 정보 없음"}{scan?.purchasedAt ? ` · ${scan.purchasedAt}` : ""} · 식품 {food.length}개 찾음
            <p className="mt-1 text-xs text-orange-800/80">유통기한은 AI가 보통 보관 기간으로 추정한 값이에요. 포장에 적힌 날짜가 있으면 고쳐 주세요.</p>
          </div>
          {cands.length === 0 && <p className="rounded-2xl bg-white p-6 text-center text-gray-500">사진에서 장본 품목을 찾지 못했어요. 더 밝고 가깝게 찍어 다시 시도해 보세요.</p>}
          <ul className="flex flex-col gap-2">{food.map(row)}</ul>
          {nonFood.length > 0 && (
            <div>
              <button type="button" onClick={() => setShowNonFood((v) => !v)} className="text-sm text-gray-500">{showNonFood ? "▾" : "▸"} 식품이 아닌 항목 {nonFood.length}개</button>
              {showNonFood && <ul className="mt-2 flex flex-col gap-2">{nonFood.map(row)}</ul>}
            </div>
          )}
          {err && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{err}</p>}
          <div className="fixed inset-x-0 bottom-0 z-10 mx-auto flex max-w-lg gap-2 bg-[#FFF8F0]/95 px-4 pt-2 backdrop-blur" style={{ paddingBottom: "calc(var(--safe-bottom) + 12px)" }}>
            <button type="button" onClick={() => { setStep("pick"); setErr(null); }} className="rounded-xl bg-white px-4 py-3.5 font-semibold text-gray-600">다시 찍기</button>
            <button type="button" disabled={saving || chosen.length === 0} onClick={confirm}
              className="flex-1 rounded-xl bg-orange-500 py-3.5 text-lg font-semibold text-white disabled:opacity-40">{saving ? "넣는 중…" : `🧊 냉장고에 넣기 (${chosen.length}개)`}</button>
          </div>
        </div>
      )}
    </FullScreen>
  );
}
