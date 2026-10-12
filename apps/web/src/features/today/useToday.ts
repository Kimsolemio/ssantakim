import { useEffect, useMemo, useState } from "react";
import { DEFAULT_STAPLES, daysUntil, provisionalKey, rankRecipesByFridge, safeStaples, type MenuSuggestion } from "@cook/shared";
import { useAuth } from "../../lib/auth";
import { useFamily } from "../../lib/family";
import { useNav } from "../../lib/nav";
import { getWorker, workerConfigured } from "../../lib/api";
import { normalizeKeysInBackground } from "../../lib/normalize";
import { writeErrorMessage } from "../../lib/write";
import { useFridge } from "../fridge/useFridge";
import { useRecipes } from "../recipes/useRecipes";
import { useShopping, addShoppingItems } from "../shopping/useShopping";
import { cancelSuggest, getInputs, loadSaved, setInputs, startSuggest, useSuggestRun, writeSaved, type Inputs } from "./suggestStore";

export const MOODS = ["⚡ 15분 안에", "🍲 국물 요리", "🍚 든든한 한 끼", "🥗 가볍게", "👶 아이 반찬", "🍺 술안주", "🍱 도시락", "🥘 한 그릇"];
const moodWord = (m: string) => m.replace(/^\S+\s/, "");
const splitWords = (t: string) => t.split(/[,，]/).map((x) => x.trim()).filter(Boolean);

/** "오늘 뭐 먹지" 화면의 데이터와 동작 (화면 모양과 분리) */
export function useToday() {
  const { user } = useAuth();
  const { familyId, family } = useFamily();
  const { items: fridge, loading: fridgeLoading } = useFridge(familyId);
  const { recipes } = useRecipes(familyId);
  const { items: shopping } = useShopping(familyId);
  const { openGenerate, openRecipe, setTab, openReceipt } = useNav();
  const profile = family?.profile ?? null;
  const staples = useMemo(() => safeStaples(profile?.staples ?? [...DEFAULT_STAPLES], profile?.allergies ?? []), [profile]);

  // 고른 조건은 탭을 옮겨도 기억한다
  const [inputs, setLocal] = useState<Inputs>(() => getInputs());
  const update = (patch: Partial<Inputs>) => { setInputs(patch); setLocal(getInputs()); };
  const servings = inputs.servings ?? profile?.defaultServings ?? 2;

  const run = useSuggestRun();
  const saved = useMemo(() => (familyId ? loadSaved(familyId) : null), [familyId, run.version]); // eslint-disable-line react-hooks/exhaustive-deps

  const [left, setLeft] = useState<number | null>(null);
  const refreshUsage = () => {
    if (!workerConfigured) return;
    getWorker<{ today: { remaining: number } | null }>("/usage")
      .then((r) => setLeft(r.today ? Math.floor(r.today.remaining) : null))
      .catch(() => setLeft(null));
  };
  useEffect(refreshUsage, [run.busy]); // eslint-disable-line react-hooks/exhaustive-deps

  // 추정 기한이 조금 지난 것(사흘 이내)은 실제로는 멀쩡할 수 있어 "오늘까지·확인 필요"로 남긴다
  const withDays = useMemo(() => fridge.map((f) => {
    const d = daysUntil(f.expiresAt);
    return { f, d: d != null && d < 0 && d >= -3 && f.expiresEstimated ? 0 : d, check: d != null && d < 0 && f.expiresEstimated === true };
  }), [fridge]);
  const fresh = withDays.filter((x) => x.d == null || x.d >= 0);
  const expired = withDays.filter((x) => x.d != null && x.d < 0);
  const unknownDate = fresh.filter((x) => x.d == null).length;
  const expiring = fresh.filter((x) => x.d != null && x.d <= 3).sort((a, b) => (a.d ?? 0) - (b.d ?? 0));
  // 같은 이름이 여럿이면 남은 날이 가장 적은 것 (기한 지난 것은 추천에 안 쓰므로 빼고)
  const daysOf = useMemo(() => {
    const m = new Map<string, number | null>();
    for (const x of withDays) {
      if (x.d != null && x.d < 0) continue;
      const prev = m.get(x.f.name);
      if (prev === undefined || (x.d != null && (prev == null || x.d < prev))) m.set(x.f.name, x.d);
    }
    return m;
  }, [withDays]);
  const fits = useMemo(() => rankRecipesByFridge(recipes, fridge, { staples }).slice(0, 5), [recipes, fridge, staples]);

  const toggleMustUse = (name: string) => update({ mustUse: inputs.mustUse.includes(name) ? inputs.mustUse.filter((x) => x !== name) : [...inputs.mustUse, name].slice(0, 10) });
  const toggleMood = (m: string) => update({ moods: inputs.moods.includes(m) ? inputs.moods.filter((x) => x !== m) : [...inputs.moods, m] });
  /** 빼기 칸에 적어 두고 "추가"를 안 눌렀어도 반영한다 */
  const excludeAll = () => [...new Set([...inputs.exclude, ...splitWords(inputs.excludeText)])];
  const commitExclude = () => update({ exclude: excludeAll(), excludeText: "" });
  const moodText = () => [...inputs.moods.map(moodWord), inputs.moodText.trim()].filter(Boolean).join(", ");

  const suggest = (another: boolean) => {
    if (!familyId) return;
    const exclude = excludeAll();
    if (inputs.excludeText.trim()) update({ exclude, excludeText: "" });
    const weekAgo = Date.now() - 7 * 86400000;
    const recent = recipes.filter((r) => r.cookedLog.some((c) => new Date(c.date).getTime() > weekAgo)).map((r) => r.title).slice(0, 20);
    const shown = another && saved ? [...new Set([...saved.shown, ...saved.suggestions.map((s) => s.title)])].slice(-30) : [];
    const items = [...fresh]
      .sort((a, b) => (a.d ?? 9999) - (b.d ?? 9999))
      .slice(0, 200)
      .map(({ f, d }) => ({ name: f.name, qty: f.qty, unit: f.unit, daysLeft: d, estimated: f.expiresEstimated === true, location: f.location }));
    void startSuggest(familyId, { items, mustUse: inputs.mustUse, exclude, mood: moodText() || null, servings, profile, recent, avoid: shown, count: 5 }, shown);
  };

  /** 고른 메뉴로 레시피: 같은 이름의 저장 레시피가 있으면 그걸 열고, 없으면 인분·빼기 재료까지 넘겨 AI로 만든다 */
  const make = (s: MenuSuggestion) => {
    const same = recipes.find((r) => provisionalKey(r.title) === provisionalKey(s.title));
    if (same) { openRecipe(same.id); return; }
    const exclude = excludeAll();
    const parts = [
      s.uses.length ? `냉장고에 있는 ${s.uses.join(", ")}을(를) 활용` : "",
      s.missing.length ? `더 살 재료는 ${s.missing.join(", ")} 정도로` : "",
      exclude.length ? `${exclude.join(", ")}은(는) 넣지 않기` : "",
      moodText(),
    ].filter(Boolean);
    openGenerate({ dish: s.title, notes: parts.join(". ").slice(0, 480), auto: true, servings });
  };

  const addMissing = async (s: MenuSuggestion): Promise<string> => {
    if (!familyId || !user) return "";
    try {
      const res = await addShoppingItems(familyId, user.uid, s.missing.map((name) => ({ name, qty: null, unit: "기타", recipeTitle: s.title })), shopping);
      void normalizeKeysInBackground(familyId, "shopping_items", res.added);
      if (saved) writeSaved(familyId, { ...saved, added: [...saved.added, s.title] });
      return `${s.title} 재료 ${s.missing.length}개를 장보기에 담았어요`;
    } catch (e) {
      throw new Error(writeErrorMessage(e));
    }
  };

  return {
    ready: !!familyId && !!user, profile, fridgeLoading, recipesCount: recipes.length,
    fresh, expired, expiring, unknownDate, daysOf, fits,
    inputs, update, servings, toggleMustUse, toggleMood, commitExclude,
    run, saved, left, suggest, cancel: cancelSuggest, make, addMissing,
    openRecipe, goFridge: () => setTab("fridge"), fillFridge: openReceipt,
  };
}
