import { useMemo, useState } from "react";
import type { RecipeDraft } from "@cook/shared";
import { useAuth } from "../../lib/auth";
import { useFamily } from "../../lib/family";
import { useRecipes, useFolders, createRecipe, updateRecipe, deleteRecipe, createFolder, deleteFolder, type RecipeDoc } from "./useRecipes";
import { GenerateSheet } from "./GenerateSheet";
import { RecipeEditor } from "./RecipeEditor";
import { RecipeDetail, SOURCE_LABEL } from "./RecipeDetail";
import { Sheet } from "../../components/Sheet";

type Filter = { kind: "all" } | { kind: "fav" } | { kind: "folder"; id: string };

export function RecipesTab() {
  const { user } = useAuth();
  const { familyId, family } = useFamily();
  const { recipes, loading, error } = useRecipes(familyId);
  const folders = useFolders(familyId);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>({ kind: "all" });
  const [generating, setGenerating] = useState(false);
  const [draft, setDraft] = useState<RecipeDraft | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<RecipeDoc | null>(null);
  const [folderMenu, setFolderMenu] = useState(false);

  const open = openId ? recipes.find((r) => r.id === openId) ?? null : null;

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return recipes.filter((r) => {
      if (filter.kind === "fav" && !r.favorite) return false;
      if (filter.kind === "folder" && r.folderId !== filter.id) return false;
      if (!s) return true;
      return r.title.toLowerCase().includes(s) || r.tags.some((t) => t.toLowerCase().includes(s)) || r.ingredients.some((i) => i.name.toLowerCase().includes(s));
    });
  }, [recipes, search, filter]);

  if (!familyId || !user) return null;

  const chip = (active: boolean) => `shrink-0 rounded-full px-3 py-1.5 text-sm ${active ? "bg-orange-500 text-white" : "bg-white text-gray-700"}`;

  return (
    <div className="flex flex-col gap-3 p-4 pb-28">
      <header>
        <h1 className="text-2xl font-bold">레시피</h1>
        <p className="text-sm text-gray-500">{family?.name ?? ""} · {recipes.length}개</p>
      </header>
      <input className="w-full rounded-xl border border-orange-200 bg-white px-3 py-2.5 outline-none focus:border-orange-400"
        placeholder="요리 이름, 재료, 태그 검색" value={search} onChange={(e) => setSearch(e.target.value)} />
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        <button className={chip(filter.kind === "all")} onClick={() => setFilter({ kind: "all" })}>전체</button>
        <button className={chip(filter.kind === "fav")} onClick={() => setFilter({ kind: "fav" })}>★ 즐겨찾기</button>
        {folders.map((f) => (
          <button key={f.id} className={chip(filter.kind === "folder" && filter.id === f.id)} onClick={() => setFilter({ kind: "folder", id: f.id })}>{f.name}</button>
        ))}
        <button className="shrink-0 rounded-full border border-dashed border-orange-300 px-3 py-1.5 text-sm text-orange-700" onClick={() => setFolderMenu(true)}>폴더 관리</button>
      </div>

      {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {loading && <p className="text-sm text-gray-500">불러오는 중…</p>}
      {!loading && recipes.length === 0 && (
        <div className="rounded-2xl bg-white p-6 text-center text-gray-500">
          아직 레시피가 없어요.<br />오른쪽 아래 ✨ 버튼으로 음식 이름만 입력해 보세요.
        </div>
      )}
      {!loading && recipes.length > 0 && filtered.length === 0 && <p className="text-center text-sm text-gray-500">조건에 맞는 레시피가 없어요.</p>}

      <ul className="flex flex-col gap-2">
        {filtered.map((r) => (
          <li key={r.id}>
            <button onClick={() => setOpenId(r.id)} className="flex w-full items-center gap-3 rounded-2xl bg-white px-4 py-3 text-left active:bg-orange-50">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-semibold">{r.title}</span>
                  {r.favorite && <span className="text-orange-500">★</span>}
                </div>
                <p className="truncate text-xs text-gray-500">
                  {SOURCE_LABEL[r.source.type]}{r.timeMinutes != null ? ` · ${r.timeMinutes}분` : ""} · {r.servingsBase}인분{r.tags.length ? ` · ${r.tags.slice(0, 3).map((t) => `#${t}`).join(" ")}` : ""}
                </p>
              </div>
              <span className="text-gray-300">›</span>
            </button>
          </li>
        ))}
      </ul>

      <button onClick={() => setGenerating(true)} aria-label="AI 레시피 만들기"
        className="fixed right-5 z-20 flex h-14 w-14 items-center justify-center rounded-full bg-orange-500 text-2xl text-white shadow-lg active:scale-95"
        style={{ bottom: "calc(var(--safe-bottom) + 84px)" }}>✨</button>

      {generating && (
        <GenerateSheet profile={family?.profile ?? null} onClose={() => setGenerating(false)}
          onResult={(d) => { setGenerating(false); setDraft(d); }} />
      )}
      {draft && (
        <RecipeEditor title="레시피 확인·수정" initial={draft} onClose={() => setDraft(null)}
          onSave={async (d) => { const id = await createRecipe(familyId, user.uid, d, filter.kind === "folder" ? filter.id : null); setDraft(null); setOpenId(id); }} />
      )}
      {open && (
        <RecipeDetail recipe={open} folders={folders} onClose={() => setOpenId(null)}
          onEdit={() => setEditing(open)}
          onToggleFavorite={() => updateRecipe(familyId, open.id, { favorite: !open.favorite })}
          onMoveFolder={(fid) => updateRecipe(familyId, open.id, { folderId: fid })}
          onDelete={() => deleteRecipe(familyId, open.id)} />
      )}
      {editing && (
        <RecipeEditor title="레시피 수정" initial={editing} onClose={() => setEditing(null)}
          onSave={async (d) => { await updateRecipe(familyId, editing.id, d); setEditing(null); }} />
      )}
      {folderMenu && (
        <FolderSheet familyId={familyId} folders={folders} onClose={() => setFolderMenu(false)}
          onDeleted={(id) => { if (filter.kind === "folder" && filter.id === id) setFilter({ kind: "all" }); }} />
      )}
    </div>
  );
}

function FolderSheet({ familyId, folders, onClose, onDeleted }: { familyId: string; folders: { id: string; name: string }[]; onClose: () => void; onDeleted: (id: string) => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Sheet title="폴더 관리" onClose={onClose}>
      <div className="flex flex-col gap-2">
        <div className="flex gap-2">
          <input className="min-w-0 flex-1 rounded-xl border border-orange-200 bg-white px-3 py-2.5 outline-none focus:border-orange-400" placeholder="새 폴더 이름 (예: 평일 저녁)" value={name} onChange={(e) => setName(e.target.value)} />
          <button disabled={busy || !name.trim()} className="rounded-xl bg-orange-500 px-4 font-semibold text-white disabled:opacity-50"
            onClick={async () => { setBusy(true); try { await createFolder(familyId, name); setName(""); } finally { setBusy(false); } }}>추가</button>
        </div>
        <ul className="overflow-hidden rounded-2xl bg-white divide-y divide-orange-50">
          {folders.length === 0 && <li className="p-3 text-sm text-gray-500">폴더가 없어요.</li>}
          {folders.map((f) => (
            <li key={f.id} className="flex items-center justify-between px-4 py-2.5">
              <span>{f.name}</span>
              <button className="text-sm text-red-500" onClick={async () => { if (confirm(`"${f.name}" 폴더를 삭제할까요? (레시피는 남습니다)`)) { await deleteFolder(familyId, f.id); onDeleted(f.id); } }}>삭제</button>
            </li>
          ))}
        </ul>
      </div>
    </Sheet>
  );
}
