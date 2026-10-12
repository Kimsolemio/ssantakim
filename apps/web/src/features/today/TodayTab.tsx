import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { DEFAULT_STAPLES, daysUntil, rankRecipesByFridge, type MenuSuggestion } from "@cook/shared";
import { useAuth } from "../../lib/auth";
import { useFamily } from "../../lib/family";
import { useNav } from "../../lib/nav";
import { callWorker, getWorker, workerConfigured, ApiError } from "../../lib/api";
import { loadPending, savePending } from "../../lib/drafts";
import { normalizeKeysInBackground } from "../../lib/normalize";
import { AiNotice } from "../../components/AiNotice";
import { Sheet } from "../../components/Sheet";
import { useFridge, type FridgeDoc } from "../fridge/useFridge";
import { itemLook } from "../fridge/FridgeVisual";
import { useRecipes } from "../recipes/useRecipes";
import { ServingsStepper } from "../recipes/RecipeDetail";
import { useShopping, addShoppingItems } from "../shopping/useShopping";

type SuggestResponse = { suggestions: MenuSuggestion[]; dropped: number };
type Saved = { suggestions: MenuSuggestion[]; at: number; shown: string[]; added: string[] };

const MOODS = ["⚡ 15분 안에", "🍲 국물 요리", "🍚 든든한 한 끼", "🥗 가볍게", "👶 아이 반찬", "🍺 술안주", "🍱 도시락", "🥘 한 그릇"];
const WAITING = ["냉장고를 둘러보는 중…", "임박 재료를 챙기는 중…", "메뉴를 고르는 중…", "살 것을 줄이는 중…", "거의 다 됐어요…"];

function ago(at: number): string {
  const m = Math.round((Date.now() - at) / 60000);
  if (m < 1) return "방금";
  if (m < 60) return `${m}분 전`;
  if (m < 60 * 24) return `${Math.round(m / 60)}시간 전`;
  return `${Math.round(m / 1440)}일 전`;
}

function dLabel(d: number | null): string {
  if (d == null) return "";
  return d <= 0 ? "오늘까지" : `D-${d}`;
}

export function TodayTab() {
  const { user } = useAuth();
  const { familyId, family } = useFamily();
  const { items: fridge, loading: fridgeLoading } = useFridge(familyId);
  const { recipes } = useRecipes(familyId);
  const { items: shopping } = useShopping(familyId);
  const { openGenerate, openRecipe, setTab } = useNav();
  const profile = family?.profile ?? null;
  const staples = useMemo(() => profile?.staples ?? [...DEFAULT_STAPLES], [profile]);

  const [mustUse, setMustUse] = useState<string[]>([]);
  const [moods, setMoods] = useState<string[]>([]);
  const [moodText, setMoodText] = useState("");
  const [exclude, setExclude] = useState<string[]>([]);
  const [excludeText, setExcludeText] = useState("");
  const [servings, setServings] = useState(profile?.defaultServings ?? 2);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const savedName = `today:${familyId ?? ""}`;
  const [saved, setSaved] = useState<Saved | null>(() => loadPending<Saved>(savedName));
  const abort = useRef<AbortController | null>(null);

  useEffect(() => { setSaved(loadPending<Saved>(`today:${familyId ?? ""}`)); }, [familyId]);
  // 오늘 남은 AI 사용량 (Worker에 하루 한도가 켜져 있을 때만)
  const [left, setLeft] = useState<number | null>(null);
  const refreshUsage = () => {
    if (!workerConfigured) return;
    getWorker<{ today: { used: number; limit: number } | null }>("/usage")
      .then((r) => setLeft(r.today ? Math.max(0, Math.floor(r.today.limit - r.today.used)) : null))
      .catch(() => setLeft(null));
  };
  useEffect(refreshUsage, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    if (!busy) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [busy]);

  const withDays = useMemo(() => fridge.map((f) => ({ f, d: daysUntil(f.expiresAt) })), [fridge]);
  const fresh = withDays.filter((x) => x.d == null || x.d >= 0);
  const expired = withDays.filter((x) => x.d != null && x.d < 0);
  const expiring = fresh.filter((x) => x.d != null && x.d <= 3).sort((a, b) => (a.d ?? 0) - (b.d ?? 0));
  const daysOf = useMemo(() => new Map(withDays.map((x) => [x.f.name, x.d])), [withDays]);
  const fits = useMemo(() => rankRecipesByFridge(recipes, fridge, { staples }).slice(0, 5), [recipes, fridge, staples]);

  if (!familyId || !user) return null;

  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const say = (m: string) => { setNotice(m); setTimeout(() => setNotice((x) => (x === m ? null : x)), 3000); };

  const suggest = async (another: boolean) => {
    setErr(null); setBusy(true); setTick(0);
    abort.current = new AbortController();
    const weekAgo = Date.now() - 7 * 86400000;
    const recent = recipes.filter((r) => r.cookedLog.some((c) => new Date(c.date).getTime() > weekAgo)).map((r) => r.title).slice(0, 20);
    const shown = another && saved ? [...new Set([...saved.shown, ...saved.suggestions.map((s) => s.title)])].slice(-30) : [];
    const items = [...fresh]
      .sort((a, b) => (a.d ?? 9999) - (b.d ?? 9999))
      .slice(0, 200)
      .map(({ f, d }) => ({ name: f.name, qty: f.qty, unit: f.unit, daysLeft: d, estimated: f.expiresEstimated === true, location: f.location }));
    const mood = [...moods.map((m) => m.replace(/^\S+\s/, "")), moodText.trim()].filter(Boolean).join(", ") || null;
    try {
      const res = await callWorker<SuggestResponse>("/suggest", {
        items, mustUse, exclude, mood, servings, profile, recent, avoid: shown, count: 5,
      }, abort.current.signal);
      const next: Saved = { suggestions: res.suggestions, at: Date.now(), shown, added: [] };
      setSaved(next); savePending(savedName, next);
      if (res.suggestions.length === 0) setErr("조건에 맞는 메뉴를 찾지 못했어요. 꼭 쓰기·빼기 재료를 줄여 보세요");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "추천을 받지 못했어요");
    } finally { setBusy(false); refreshUsage(); }
  };

  const make = (s: MenuSuggestion) => {
    const mood = [...moods.map((m) => m.replace(/^\S+\s/, "")), moodText.trim()].filter(Boolean).join(", ");
    const parts = [
      s.uses.length ? `냉장고에 있는 ${s.uses.join(", ")}을(를) 활용` : "",
      s.missing.length ? `더 살 재료는 ${s.missing.join(", ")} 정도로` : "",
      mood,
    ].filter(Boolean);
    openGenerate({ dish: s.title, notes: parts.join(". ").slice(0, 480), auto: true });
  };

  const addMissing = async (s: MenuSuggestion) => {
    const res = await addShoppingItems(familyId, user.uid, s.missing.map((name) => ({ name, qty: null, unit: "기타", recipeTitle: s.title })), shopping);
    void normalizeKeysInBackground(familyId, "shopping_items", res.added);
    if (saved) { const next = { ...saved, added: [...saved.added, s.title] }; setSaved(next); savePending(savedName, next); }
    say(`🛒 ${s.title} 재료 ${s.missing.length}개를 장보기에 담았어요`);
  };

  const addExclude = (e?: FormEvent) => {
    e?.preventDefault();
    const words = excludeText.split(/[,，]/).map((x) => x.trim()).filter(Boolean);
    if (words.length) setExclude((l) => [...new Set([...l, ...words])]);
    setExcludeText("");
  };

  const chip = (on: boolean) => `shrink-0 rounded-full px-3 py-1.5 text-sm ${on ? "bg-orange-500 text-white" : "bg-white text-gray-700 ring-1 ring-orange-100"}`;

  return (
    <div className="flex flex-col gap-4 p-4 pb-28">
      <header>
        <h1 className="text-2xl font-bold">오늘 뭐 먹지?</h1>
        <p className="text-sm text-gray-500">냉장고 {fresh.length}개{expiring.length ? <span className="text-red-600"> · 임박 {expiring.length}</span> : ""}</p>
      </header>

      {expired.length > 0 && (
        <button type="button" onClick={() => setTab("fridge")} className="rounded-2xl bg-gray-100 p-3 text-left text-sm text-gray-600" data-testid="expired-note">
          🗑️ 기한이 지난 재료 {expired.length}개({expired.slice(0, 3).map((x) => x.f.name).join(", ")}{expired.length > 3 ? " …" : ""})는 추천에 쓰지 않아요. 냉장고에서 확인해 주세요 ›
        </button>
      )}

      <section>
        <h2 className="mb-2 font-bold">⏰ 빨리 먹어야 해요</h2>
        {fridgeLoading ? <p className="text-sm text-gray-500">냉장고 확인 중…</p>
          : expiring.length === 0 ? <p className="rounded-2xl bg-white p-3 text-sm text-gray-500">3일 안에 기한이 끝나는 재료가 없어요 👍</p>
          : (
            <>
              <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
                {expiring.map(({ f, d }) => {
                  const on = mustUse.includes(f.name);
                  return (
                    <button key={f.id} type="button" data-testid="expiring-card" aria-pressed={on} onClick={() => setMustUse((l) => toggle(l, f.name))}
                      className={`flex w-24 shrink-0 flex-col items-center gap-0.5 rounded-2xl bg-white p-2 ${on ? "ring-2 ring-orange-500" : "ring-1 ring-orange-100"}`}>
                      <span className="text-3xl" aria-hidden>{itemLook(f).emoji}</span>
                      <span className="w-full truncate text-center text-sm font-semibold">{f.name}</span>
                      <span className={`rounded-full px-1.5 text-[11px] font-bold ${d != null && d <= 1 ? "bg-red-500 text-white" : "bg-red-100 text-red-700"}`}>{dLabel(d)}{f.expiresEstimated ? " 추정" : ""}</span>
                      <span className={`text-[11px] ${on ? "font-semibold text-orange-600" : "text-gray-400"}`}>{on ? "✓ 꼭 쓰기" : "눌러서 꼭 쓰기"}</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
      </section>

      {fits.length > 0 && (
        <section>
          <h2 className="mb-2 font-bold">📖 내 레시피로 바로</h2>
          <ul className="overflow-hidden rounded-2xl bg-white divide-y divide-orange-50">
            {fits.map((x) => (
              <li key={x.recipe.id}>
                <button type="button" data-testid="fit-row" onClick={() => openRecipe(x.recipe.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-orange-50">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{x.recipe.title}</p>
                    <p className="truncate text-xs text-gray-500">
                      {x.missing.length === 0 ? <span className="text-emerald-700">재료가 다 있어요</span> : <>없는 것: {x.missing.join(", ")}</>}
                      {x.expiring.length > 0 && <span className="text-red-600"> · 임박 {x.expiring.join(", ")} 사용</span>}
                    </p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${x.missing.length === 0 ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>{x.have}/{x.needed}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-3 rounded-2xl bg-white p-4">
        <h2 className="font-bold">✨ AI에게 메뉴 추천받기</h2>
        <div>
          <p className="mb-1 text-xs text-gray-500">꼭 쓸 재료</p>
          <div className="flex flex-wrap gap-1.5">
            {mustUse.map((n) => (
              <button key={n} type="button" onClick={() => setMustUse((l) => l.filter((x) => x !== n))} className="rounded-full bg-orange-100 px-2.5 py-1 text-sm text-orange-800" aria-label={`${n} 꼭 쓰기 빼기`}>{n} ✕</button>
            ))}
            <button type="button" onClick={() => setPicking(true)} disabled={fresh.length === 0} className="rounded-full border border-dashed border-orange-300 px-2.5 py-1 text-sm text-orange-700 disabled:opacity-40">+ 냉장고에서 고르기</button>
          </div>
        </div>
        <div>
          <p className="mb-1 text-xs text-gray-500">어떤 게 당겨요? (여러 개 골라도 돼요)</p>
          <div className="flex flex-wrap gap-1.5">
            {MOODS.map((m) => <button key={m} type="button" aria-pressed={moods.includes(m)} onClick={() => setMoods((l) => toggle(l, m))} className={chip(moods.includes(m))}>{m}</button>)}
          </div>
          <input className="mt-2 w-full rounded-xl border border-orange-200 px-3 py-2 text-base" placeholder="직접 적기 (예: 에어프라이어로, 비 오는 날)" value={moodText} onChange={(e) => setMoodText(e.target.value)} maxLength={80} />
        </div>
        <form onSubmit={addExclude}>
          <p className="mb-1 text-xs text-gray-500">빼고 싶은 재료 <span className="text-gray-400">(알레르기·싫어하는 재료는 가족 설정대로 늘 빠져요)</span></p>
          <div className="flex gap-2">
            <input className="min-w-0 flex-1 rounded-xl border border-orange-200 px-3 py-2 text-base" placeholder="예: 오이, 가지" value={excludeText} onChange={(e) => setExcludeText(e.target.value)} aria-label="빼고 싶은 재료" />
            <button className="shrink-0 rounded-xl bg-orange-100 px-3 font-semibold text-orange-800">추가</button>
          </div>
          {(exclude.length > 0 || (profile && profile.allergies.length + profile.dislikes.length > 0)) && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {profile?.allergies.map((n) => <span key={`a-${n}`} className="rounded-full bg-red-50 px-2.5 py-1 text-sm text-red-700" title="가족 설정의 알레르기">🔒 {n}</span>)}
              {profile?.dislikes.map((n) => <span key={`d-${n}`} className="rounded-full bg-gray-50 px-2.5 py-1 text-sm text-gray-500" title="가족 설정의 싫어하는 재료">🔒 {n}</span>)}
              {exclude.map((n) => <button key={n} type="button" onClick={() => setExclude((l) => l.filter((x) => x !== n))} className="rounded-full bg-gray-100 px-2.5 py-1 text-sm text-gray-700" aria-label={`${n} 빼기 취소`}>🚫 {n} ✕</button>)}
            </div>
          )}
        </form>
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-600">인분</span>
          <ServingsStepper value={servings} onChange={setServings} />
        </div>
        {busy ? (
          <div className="flex items-center justify-between rounded-xl bg-orange-50 px-4 py-3 text-sm text-orange-800">
            <span>🍳 {WAITING[Math.min(Math.floor(tick / 4), WAITING.length - 1)]} ({tick}초)</span>
            <button type="button" className="text-gray-500" onClick={() => abort.current?.abort()}>취소</button>
          </div>
        ) : (
          <button type="button" disabled={!workerConfigured || fridgeLoading} onClick={() => suggest(false)} className="rounded-xl bg-orange-500 py-3 text-lg font-semibold text-white disabled:opacity-40">✨ 메뉴 5개 추천받기</button>
        )}
        {left != null && <p className="-mt-1 text-center text-xs text-gray-500" data-testid="usage-left">오늘 남은 AI 사용 {left}회</p>}
        {fresh.length === 0 && !fridgeLoading && <p className="text-xs text-gray-500">냉장고가 비어 있어요. 늘 있는 양념과 흔한 재료로 만들 메뉴를 추천해요.</p>}
        <AiNotice what="냉장고 목록과 가족 취향(알레르기 포함)" />
      </section>

      {err && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{err}</p>}

      {saved && saved.suggestions.length > 0 && (
        <section data-testid="suggestions">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-bold">추천 메뉴 <span className="text-sm font-normal text-gray-500">{ago(saved.at)}</span></h2>
            <button type="button" disabled={busy} onClick={() => suggest(true)} className="rounded-full bg-white px-3 py-1.5 text-sm font-semibold text-orange-700 ring-1 ring-orange-200 disabled:opacity-40">🔄 다른 메뉴로</button>
          </div>
          <ul className="flex flex-col gap-2">
            {saved.suggestions.map((s) => {
              const added = saved.added.includes(s.title);
              return (
                <li key={s.title} data-testid="suggest-card" className="rounded-2xl bg-white p-4">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-lg font-bold">{s.title}</p>
                    <span className="shrink-0 text-xs text-gray-500">{s.timeMinutes != null ? `⏱ ${s.timeMinutes}분 · ` : ""}{s.difficulty}</span>
                  </div>
                  {s.reason && <p className="mt-0.5 text-sm text-gray-600">{s.reason}</p>}
                  {s.uses.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {s.uses.map((u) => {
                        const d = daysOf.get(u) ?? null;
                        const urgent = d != null && d <= 3;
                        return <span key={u} className={`rounded-full px-2 py-0.5 text-xs ${urgent ? "bg-red-100 font-semibold text-red-700" : "bg-emerald-50 text-emerald-800"}`}>🧊 {u}{urgent ? ` ${dLabel(d)}` : ""}</span>;
                      })}
                    </div>
                  )}
                  <p className={`mt-1.5 text-xs ${s.missing.length ? "text-amber-800" : "text-emerald-700"}`} data-testid="suggest-missing">
                    {s.missing.length ? `🛒 살 것: ${s.missing.join(", ")}` : "✅ 더 살 것 없어요"}
                  </p>
                  <div className="mt-3 flex gap-2">
                    <button type="button" onClick={() => make(s)} className="flex-1 rounded-xl bg-orange-500 py-2.5 font-semibold text-white">✨ 레시피 만들기</button>
                    {s.missing.length > 0 && (
                      <button type="button" disabled={added} onClick={() => void addMissing(s)} className="rounded-xl bg-white px-3 py-2.5 text-sm font-semibold text-gray-700 ring-1 ring-orange-200 disabled:opacity-50">{added ? "✓ 담았어요" : "🛒 살 것 담기"}</button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {picking && (
        <PickSheet items={fresh.map((x) => x.f)} selected={mustUse} onClose={() => setPicking(false)} onChange={setMustUse} />
      )}
      {notice && (
        <div role="status" className="pointer-events-none fixed inset-x-0 z-50 mx-auto w-fit max-w-[90%] rounded-full bg-slate-900/90 px-4 py-2 text-sm text-white shadow-lg"
          style={{ bottom: "calc(var(--safe-bottom) + 84px)" }}>{notice}</div>
      )}
    </div>
  );
}

/** 냉장고에서 꼭 쓸 재료 고르기 */
function PickSheet({ items, selected, onClose, onChange }: { items: FridgeDoc[]; selected: string[]; onClose: () => void; onChange: (v: string[]) => void }) {
  const names = [...new Set(items.map((i) => i.name))];
  const [q, setQ] = useState("");
  const list = names.filter((n) => !q.trim() || n.includes(q.trim()));
  return (
    <Sheet title="꼭 쓸 재료 고르기" onClose={onClose}>
      <div className="flex max-h-[65vh] flex-col gap-2">
        <input className="rounded-xl border border-orange-200 bg-white px-3 py-2 text-base" placeholder="냉장고에서 찾기" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="flex flex-wrap gap-1.5 overflow-y-auto">
          {list.map((n) => {
            const on = selected.includes(n);
            return <button key={n} type="button" aria-pressed={on} onClick={() => onChange(on ? selected.filter((x) => x !== n) : [...selected, n].slice(0, 10))}
              className={`rounded-full px-3 py-1.5 text-sm ${on ? "bg-orange-500 text-white" : "bg-white text-gray-700 ring-1 ring-orange-100"}`}>{on ? "✓ " : ""}{n}</button>;
          })}
        </div>
        <button type="button" onClick={onClose} className="rounded-xl bg-orange-500 py-3 font-semibold text-white">{selected.length}개 골랐어요</button>
      </div>
    </Sheet>
  );
}
