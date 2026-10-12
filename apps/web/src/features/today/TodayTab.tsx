import { useEffect, useRef, useState } from "react";
import type { MenuSuggestion } from "@cook/shared";
import { workerConfigured } from "../../lib/api";
import { AiNotice } from "../../components/AiNotice";
import { Sheet } from "../../components/Sheet";
import type { FridgeDoc } from "../fridge/useFridge";
import { itemLook } from "../fridge/FridgeVisual";
import { ServingsStepper } from "../recipes/RecipeDetail";
import { MOODS, useToday } from "./useToday";

const WAITING = ["냉장고를 둘러보는 중…", "임박 재료를 챙기는 중…", "메뉴를 고르는 중…", "살 것을 줄이는 중…", "거의 다 됐어요…"];

function ago(at: number): string {
  const m = Math.round((Date.now() - at) / 60000);
  if (m < 1) return "방금";
  if (m < 60) return `${m}분 전`;
  if (m < 60 * 24) return `${Math.round(m / 60)}시간 전`;
  return `${Math.round(m / 1440)}일 전`;
}

const dLabel = (d: number | null) => (d == null ? "" : d <= 0 ? "오늘까지" : `D-${d}`);

export function TodayTab() {
  const t = useToday();
  const [picking, setPicking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const resultsRef = useRef<HTMLElement | null>(null);
  const lastAt = useRef<number | null>(t.saved?.at ?? null);

  useEffect(() => {
    if (!t.run.busy) return;
    setTick(0);
    const id = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, [t.run.busy]);
  // 새 추천이 오면 결과로 화면을 내린다
  useEffect(() => {
    if (t.saved && t.saved.at !== lastAt.current) {
      lastAt.current = t.saved.at;
      resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [t.saved]);

  if (!t.ready) return null;
  const say = (m: string) => { setNotice(m); setTimeout(() => setNotice((x) => (x === m ? null : x)), 3500); };
  const addMissing = async (s: MenuSuggestion) => {
    if (adding) return;
    setAdding(s.title);
    try { say(`🛒 ${await t.addMissing(s)}`); }
    catch (e) { say(`담지 못했어요: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setAdding(null); }
  };
  const chip = (on: boolean) => `shrink-0 rounded-full px-3 py-1.5 text-sm ${on ? "bg-orange-500 text-white" : "bg-white text-gray-700 ring-1 ring-orange-100"}`;
  const { inputs, profile } = t;

  return (
    <div className="flex flex-col gap-4 p-4 pb-28">
      <header>
        <h1 className="text-2xl font-bold">오늘 뭐 먹지?</h1>
        <p className="text-sm text-gray-500">냉장고 {t.fresh.length}개{t.expiring.length ? <span className="text-red-600"> · 임박 {t.expiring.length}</span> : ""}</p>
      </header>

      {t.expired.length > 0 && (
        <button type="button" onClick={t.goFridge} className="rounded-2xl bg-gray-100 p-3 text-left text-sm text-gray-600" data-testid="expired-note">
          🗑️ 기한이 지난 재료 {t.expired.length}개({t.expired.slice(0, 3).map((x) => x.f.name).join(", ")}{t.expired.length > 3 ? " …" : ""})는 추천에 쓰지 않아요. 냉장고에서 확인해 주세요 ›
        </button>
      )}

      <section>
        <h2 className="mb-2 font-bold">⏰ 빨리 먹어야 해요</h2>
        {t.fridgeLoading ? <p className="text-sm text-gray-500">냉장고 확인 중…</p>
          : t.fresh.length === 0 ? (
            <div className="flex items-center gap-3 rounded-2xl bg-white p-3 text-sm text-gray-600">
              <span className="flex-1">냉장고가 비어 있어요. 장본 것을 넣으면 임박 재료부터 챙겨 드려요.</span>
              <button type="button" onClick={t.fillFridge} className="shrink-0 rounded-xl bg-orange-500 px-3 py-2 font-semibold text-white">채우기</button>
            </div>
          ) : t.expiring.length === 0 ? (
            <p className="rounded-2xl bg-white p-3 text-sm text-gray-500">3일 안에 기한이 끝나는 재료는 없어요.{t.unknownDate > 0 ? ` (기한을 모르는 재료 ${t.unknownDate}개는 냉장고에서 확인해 주세요)` : ""}</p>
          ) : (
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
              {t.expiring.map(({ f, d, check }) => {
                const on = inputs.mustUse.includes(f.name);
                return (
                  <button key={f.id} type="button" data-testid="expiring-card" aria-pressed={on} onClick={() => t.toggleMustUse(f.name)}
                    className={`flex w-24 shrink-0 flex-col items-center gap-0.5 rounded-2xl bg-white p-2 ${on ? "ring-2 ring-orange-500" : "ring-1 ring-orange-100"}`}>
                    <span className="text-3xl" aria-hidden>{itemLook(f).emoji}</span>
                    <span className="w-full truncate text-center text-sm font-semibold">{f.name}</span>
                    <span className={`rounded-full px-1.5 text-xs font-bold ${d != null && d <= 1 ? "bg-red-500 text-white" : "bg-red-100 text-red-700"}`}>{check ? "확인 필요" : `${dLabel(d)}${f.expiresEstimated ? " 추정" : ""}`}</span>
                    <span className={`text-xs ${on ? "font-semibold text-orange-600" : "text-gray-400"}`}>{on ? "✓ 꼭 쓰기" : "눌러서 꼭 쓰기"}</span>
                  </button>
                );
              })}
            </div>
          )}
      </section>

      <section>
        <h2 className="mb-2 font-bold">📖 내 레시피로 바로</h2>
        {t.fits.length > 0 ? (
          <ul className="overflow-hidden rounded-2xl bg-white divide-y divide-orange-50">
            {t.fits.map((x) => (
              <li key={x.recipe.id}>
                <button type="button" data-testid="fit-row" onClick={() => t.openRecipe(x.recipe.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-orange-50">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{x.recipe.title}</p>
                    <p className="truncate text-xs text-gray-500">
                      {x.missing.length === 0 ? <span className="text-emerald-700">재료가 다 있어요{x.unsure ? ` · 양 확인 ${x.unsure}개` : ""}</span> : <>없는 것: {x.missing.join(", ")}</>}
                      {x.expiring.length > 0 && <span className="text-red-600"> · 임박 {x.expiring.join(", ")} 사용</span>}
                    </p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${x.missing.length === 0 ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>{x.have}/{x.needed}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-2xl bg-white p-3 text-sm text-gray-500">{t.recipesCount === 0 ? "레시피를 저장해 두면 지금 냉장고로 만들 수 있는 것을 여기서 바로 보여 드려요 (AI 없이)." : "저장한 레시피 중 지금 냉장고로 만들 수 있는 게 없어요."}</p>
        )}
      </section>

      <section className="flex flex-col gap-3 rounded-2xl bg-white p-4">
        <h2 className="font-bold">✨ AI에게 메뉴 추천받기</h2>
        <div>
          <p className="mb-1 text-xs text-gray-500">꼭 쓸 재료</p>
          <div className="flex flex-wrap gap-1.5">
            {inputs.mustUse.map((n) => (
              <button key={n} type="button" onClick={() => t.toggleMustUse(n)} className="rounded-full bg-orange-100 px-2.5 py-1 text-sm text-orange-800" aria-label={`${n} 꼭 쓰기 빼기`}>{n} ✕</button>
            ))}
            <button type="button" onClick={() => setPicking(true)} disabled={t.fresh.length === 0} className="rounded-full border border-dashed border-orange-300 px-2.5 py-1 text-sm text-orange-700 disabled:opacity-40">+ 냉장고에서 고르기</button>
          </div>
        </div>
        <div>
          <p className="mb-1 text-xs text-gray-500">어떤 게 당겨요? (여러 개 골라도 돼요)</p>
          <div className="flex flex-wrap gap-1.5">
            {MOODS.map((m) => <button key={m} type="button" aria-pressed={inputs.moods.includes(m)} onClick={() => t.toggleMood(m)} className={chip(inputs.moods.includes(m))}>{m}</button>)}
          </div>
          <input className="mt-2 w-full rounded-xl border border-orange-200 px-3 py-2 text-base" placeholder="직접 적기 (예: 에어프라이어로, 비 오는 날)" value={inputs.moodText} onChange={(e) => t.update({ moodText: e.target.value })} maxLength={60} />
        </div>
        <form onSubmit={(e) => { e.preventDefault(); t.commitExclude(); }}>
          <p className="mb-1 text-xs text-gray-500">빼고 싶은 재료 <span className="text-gray-400">(가족 설정의 싫어하는 재료도 피해요)</span></p>
          <div className="flex gap-2">
            <input className="min-w-0 flex-1 rounded-xl border border-orange-200 px-3 py-2 text-base" placeholder="예: 오이, 가지" value={inputs.excludeText} onChange={(e) => t.update({ excludeText: e.target.value })} aria-label="빼고 싶은 재료" maxLength={60} />
            <button className="shrink-0 rounded-xl bg-orange-100 px-3 font-semibold text-orange-800">추가</button>
          </div>
          {(inputs.exclude.length > 0 || (profile && profile.dislikes.length > 0)) && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {profile?.dislikes.map((n) => <span key={`d-${n}`} className="rounded-full bg-gray-50 px-2.5 py-1 text-sm text-gray-500" title="가족 설정의 싫어하는 재료">🔒 {n}</span>)}
              {inputs.exclude.map((n) => <button key={n} type="button" onClick={() => t.update({ exclude: inputs.exclude.filter((x) => x !== n) })} className="rounded-full bg-gray-100 px-2.5 py-1 text-sm text-gray-700" aria-label={`${n} 빼기 취소`}>🚫 {n} ✕</button>)}
            </div>
          )}
        </form>
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-600">인분</span>
          <ServingsStepper value={t.servings} onChange={(v) => t.update({ servings: v })} />
        </div>
        {t.run.busy ? (
          <div className="flex items-center justify-between rounded-xl bg-orange-50 px-4 py-3 text-sm text-orange-800">
            <span>🍳 {WAITING[Math.min(Math.floor(tick / 4), WAITING.length - 1)]} ({tick}초 · 보통 10~20초)</span>
            <button type="button" className="text-gray-500" onClick={t.cancel}>취소</button>
          </div>
        ) : (
          <button type="button" disabled={!workerConfigured || t.fridgeLoading} onClick={() => t.suggest(false)} className="rounded-xl bg-orange-500 py-3 text-lg font-semibold text-white disabled:opacity-40">✨ 메뉴 5개 추천받기</button>
        )}
        {t.left != null && <p className="-mt-1 text-center text-xs text-gray-500" data-testid="usage-left">오늘 남은 AI 사용 {t.left}회 (추천 1회씩, 사진은 2회)</p>}
        <AiNotice what="냉장고 목록과 가족 취향" />
      </section>

      {t.run.error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{t.run.error}</p>}

      {t.saved && t.saved.suggestions.length > 0 && (
        <section data-testid="suggestions" ref={resultsRef} className="scroll-mt-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-bold">추천 메뉴 <span className="text-sm font-normal text-gray-500">{ago(t.saved.at)}</span></h2>
            <button type="button" disabled={t.run.busy} onClick={() => t.suggest(true)} className="rounded-full bg-white px-3 py-1.5 text-sm font-semibold text-orange-700 ring-1 ring-orange-200 disabled:opacity-40">🔄 다른 메뉴로</button>
          </div>
          {(t.saved.dropped ?? 0) > 0 && <p className="mb-2 text-xs text-gray-500" data-testid="dropped-note">빼기·싫어하는 재료가 들어간 메뉴 {t.saved.dropped}개는 빼고 보여 드려요.</p>}
          <ul className="flex flex-col gap-2">
            {t.saved.suggestions.map((s) => {
              const added = t.saved!.added.includes(s.title);
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
                        const d = t.daysOf.get(u) ?? null;
                        const urgent = d != null && d <= 3;
                        return <span key={u} className={`rounded-full px-2 py-0.5 text-xs ${urgent ? "bg-red-100 font-semibold text-red-700" : "bg-emerald-50 text-emerald-800"}`}>🧊 {u}{urgent ? ` ${dLabel(d)}` : ""}</span>;
                      })}
                    </div>
                  )}
                  <p className={`mt-1.5 text-xs ${s.missing.length ? "text-amber-800" : "text-emerald-700"}`} data-testid="suggest-missing">
                    {s.missing.length ? `🛒 살 것: ${s.missing.join(", ")}` : "✅ 늘 있는 양념 말고는 따로 살 게 없어요 (양은 확인해 주세요)"}
                  </p>
                  <div className="mt-3 flex gap-2">
                    <button type="button" disabled={t.run.busy} onClick={() => t.make(s)} className="flex-1 rounded-xl bg-orange-500 py-2.5 font-semibold text-white disabled:opacity-40">✨ 레시피 만들기</button>
                    {s.missing.length > 0 && (
                      <button type="button" disabled={added || adding === s.title} onClick={() => void addMissing(s)} className="rounded-xl bg-white px-3 py-2.5 text-sm font-semibold text-gray-700 ring-1 ring-orange-200 disabled:opacity-50">{added ? "✓ 담았어요" : "🛒 살 것 담기"}</button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {picking && <PickSheet items={t.fresh.map((x) => x.f)} selected={inputs.mustUse} onClose={() => setPicking(false)} onChange={(v) => t.update({ mustUse: v })} />}
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
      <div className="flex flex-col gap-2">
        <input className="rounded-xl border border-orange-200 bg-white px-3 py-2 text-base" placeholder="냉장고에서 찾기" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="flex flex-wrap gap-1.5">
          {list.map((n) => {
            const on = selected.includes(n);
            return <button key={n} type="button" aria-pressed={on} onClick={() => onChange(on ? selected.filter((x) => x !== n) : [...selected, n].slice(0, 10))}
              className={`rounded-full px-3 py-1.5 text-sm ${on ? "bg-orange-500 text-white" : "bg-white text-gray-700 ring-1 ring-orange-100"}`}>{on ? "✓ " : ""}{n}</button>;
          })}
        </div>
        <button type="button" onClick={onClose} className="rounded-xl bg-orange-500 py-3 font-semibold text-white">{selected.length}개 골랐어요 (최대 10개)</button>
      </div>
    </Sheet>
  );
}
