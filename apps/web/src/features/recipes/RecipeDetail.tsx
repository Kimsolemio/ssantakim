import { useState } from "react";
import type { Recipe } from "@cook/shared";
import { FullScreen } from "../../components/FullScreen";
import { Sheet } from "../../components/Sheet";
import { IngredientList } from "./IngredientList";
import type { FolderDoc } from "./useRecipes";

type Props = {
  recipe: Recipe;
  folders: FolderDoc[];
  onClose: () => void;
  onEdit: () => void;
  onToggleFavorite: () => Promise<void>;
  onMoveFolder: (folderId: string | null) => Promise<void>;
  onDelete: () => Promise<void>;
};

export const SOURCE_LABEL: Record<Recipe["source"]["type"], string> = {
  generated: "AI 생성", youtube: "유튜브", instagram: "인스타그램", photo: "사진", text: "텍스트", manual: "직접 입력",
};

export function ServingsStepper({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const btn = "h-9 w-9 rounded-full bg-orange-100 text-lg font-bold text-orange-700 active:bg-orange-200 disabled:opacity-40";
  return (
    <div className="flex items-center gap-2">
      <button type="button" className={btn} disabled={value <= 1} onClick={() => onChange(value - 1)} aria-label="인분 줄이기">−</button>
      <span className="w-14 text-center font-semibold">{value}인분</span>
      <button type="button" className={btn} disabled={value >= 20} onClick={() => onChange(value + 1)} aria-label="인분 늘리기">+</button>
    </div>
  );
}

export function RecipeDetail({ recipe, folders, onClose, onEdit, onToggleFavorite, onMoveFolder, onDelete }: Props) {
  const [servings, setServings] = useState(recipe.servingsBase);
  const [menu, setMenu] = useState(false);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => { setBusy(true); try { await fn(); } finally { setBusy(false); } };

  return (
    <FullScreen title={recipe.title} onClose={onClose}
      right={<>
        <button onClick={() => run(onToggleFavorite)} aria-label="즐겨찾기" className="px-2 py-2 text-2xl">{recipe.favorite ? "★" : "☆"}</button>
        <button onClick={() => setMenu(true)} aria-label="더보기" className="px-2 py-2 text-xl">⋯</button>
      </>}>
      <div className="flex flex-col gap-4 p-4">
        <div className="flex flex-wrap items-center gap-2 text-sm text-gray-600">
          <span className="rounded-full bg-orange-100 px-2 py-0.5 text-orange-800">{SOURCE_LABEL[recipe.source.type]}</span>
          {recipe.timeMinutes != null && <span>⏱ {recipe.timeMinutes}분</span>}
          <span>난이도 {recipe.difficulty}</span>
          {recipe.source.url && <a className="text-orange-600 underline" href={recipe.source.url} target="_blank" rel="noreferrer">원본 보기</a>}
        </div>
        {recipe.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">{recipe.tags.map((t) => <span key={t} className="rounded-full bg-white px-2 py-0.5 text-xs text-gray-600">#{t}</span>)}</div>
        )}

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-lg font-bold">재료</h2>
            <ServingsStepper value={servings} onChange={setServings} />
          </div>
          {servings !== recipe.servingsBase && <p className="mb-2 text-xs text-gray-500">기준 {recipe.servingsBase}인분에서 자동 환산했어요. "약간"은 그대로 둡니다.</p>}
          <IngredientList ingredients={recipe.ingredients} servingsBase={recipe.servingsBase} servings={servings} />
        </section>

        <section>
          <h2 className="mb-2 text-lg font-bold">조리 순서</h2>
          <ol className="flex flex-col gap-2">
            {recipe.steps.map((s) => (
              <li key={s.order} className="flex gap-3 rounded-2xl bg-white p-4">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-orange-500 text-sm font-bold text-white">{s.order}</span>
                <div className="min-w-0 flex-1">
                  <p className="leading-relaxed">{s.text}</p>
                  {s.minutes != null && <p className="mt-1 text-xs text-orange-700">⏱ {s.minutes}분</p>}
                </div>
              </li>
            ))}
          </ol>
        </section>

        {recipe.tips.length > 0 && (
          <section>
            <h2 className="mb-2 text-lg font-bold">팁</h2>
            <ul className="flex flex-col gap-1 rounded-2xl bg-white p-4 text-sm leading-relaxed">
              {recipe.tips.map((t, i) => <li key={i} className="flex gap-2"><span>💡</span><span>{t}</span></li>)}
            </ul>
          </section>
        )}
        <p className="text-center text-xs text-gray-400">쿡 모드(단계별 화면·타이머)는 3단계에서 추가됩니다</p>
      </div>

      {menu && (
        <Sheet title="레시피 관리" onClose={() => setMenu(false)}>
          <div className="flex flex-col gap-2">
            <button disabled={busy} onClick={() => { setMenu(false); onEdit(); }} className="rounded-xl bg-white py-3 font-medium">수정하기</button>
            <label className="rounded-xl bg-white p-3 text-sm">
              <span className="mb-1 block text-gray-500">폴더</span>
              <select className="w-full rounded-lg border border-orange-200 bg-white px-2 py-2" value={recipe.folderId ?? ""}
                onChange={(e) => run(() => onMoveFolder(e.target.value || null))}>
                <option value="">(없음)</option>
                {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </label>
            <button disabled={busy} onClick={async () => { if (confirm("이 레시피를 삭제할까요?")) { await run(onDelete); setMenu(false); onClose(); } }}
              className="py-2 text-sm text-red-600">삭제</button>
          </div>
        </Sheet>
      )}
    </FullScreen>
  );
}
