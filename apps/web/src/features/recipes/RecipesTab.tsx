import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { BookOpen, ChevronRight, FolderPlus, Link as LinkIcon, Sparkles, Star } from "lucide-react";
import type { RecipeDraft } from "@cook/shared";
import { recipeEmoji } from "./recipeLook";
import { useAuth } from "../../lib/auth";
import { useFamily } from "../../lib/family";
import { useRecipes, useFolders, createRecipe, updateRecipe, deleteRecipe, createFolder, deleteFolder, addCookedLog, type RecipeDoc } from "./useRecipes";
import { GenerateSheet } from "./GenerateSheet";
import { ImportSheet } from "./ImportSheet";
import { useNav } from "../../lib/nav";
import type { SharedPayload } from "../../lib/share";
import { RecipeEditor } from "./RecipeEditor";
import { RecipeDetail, SOURCE_LABEL } from "./RecipeDetail";
import { Sheet } from "../../components/Sheet";
import { Banner } from "../../components/ui/Banner";
import { Button } from "../../components/ui/Button";
import { FilterChip } from "../../components/ui/Chip";
import { EmptyState, Skeleton } from "../../components/ui/EmptyState";
import { SearchField, TextField } from "../../components/ui/Field";
import { IconButton } from "../../components/ui/IconButton";
import { IconThumb } from "../../components/ui/FoodThumb";
import { Card, rowLine } from "../../components/ui/Section";
import { ExtendedFab } from "../../components/ui/Bars";
import { TabHeader } from "../family/FamilyScreen";
import { fixRecipeKeysInBackground } from "../../lib/normalize";
import { loadPending, savePending, clearPending } from "../../lib/drafts";

type PendingDraft = { id: string; draft: RecipeDraft; note: string | null };
const MAX_DRAFTS = 5;

type Filter = { kind: "all" } | { kind: "fav" } | { kind: "folder"; id: string };

/** 목록 보조 줄: "20분 · 3인분 · 유튜브" (태그는 빼고, 출처는 AI 생성이 아닐 때만) */
function metaLine(r: RecipeDoc): string {
  return [r.timeMinutes != null ? `${r.timeMinutes}분` : null, `${r.servingsBase}인분`, r.source.type === "generated" ? null : SOURCE_LABEL[r.source.type]]
    .filter(Boolean).join(" · ");
}

/** 추가 시트의 한 줄 (아이콘 접시 + 제목 + 보조) */
function AddRow({ icon, title, sub, onClick, testId }: { icon: ReactNode; title: string; sub: string; onClick: () => void; testId?: string }) {
  return (
    <li className={`${rowLine} before:left-[72px]`}>
      <button type="button" onClick={onClick} data-testid={testId} className="flex min-h-[72px] w-full items-center gap-3 px-5 py-3 text-left transition-colors active:bg-surface-2">
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

export function RecipesTab() {
  const { user } = useAuth();
  const { familyId, family } = useFamily();
  const { recipes, loading, error } = useRecipes(familyId);
  const [adding, setAdding] = useState(false);
  const folders = useFolders(familyId);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>({ kind: "all" });
  const [generating, setGenerating] = useState<false | { dish?: string; notes?: string; auto?: boolean; servings?: number }>(false);
  const [importing, setImporting] = useState<false | { initial: SharedPayload | null }>(false);
  const [draftNote, setDraftNote] = useState<string | null>(null);
  const { pendingImport, consumeImport, pendingGenerate, consumeGenerate, pendingRecipe, consumeRecipe } = useNav();
  useEffect(() => {
    if (!pendingImport) return;
    consumeImport();
    setImporting({ initial: pendingImport });
  }, [pendingImport]); // eslint-disable-line react-hooks/exhaustive-deps
  // "오늘 뭐 먹지"에서 고른 메뉴 → AI 레시피 만들기, 저장된 레시피 → 상세
  useEffect(() => {
    if (!pendingGenerate) return;
    consumeGenerate();
    setGenerating(pendingGenerate);
  }, [pendingGenerate]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!pendingRecipe) return;
    consumeRecipe();
    setOpenId(pendingRecipe);
  }, [pendingRecipe]); // eslint-disable-line react-hooks/exhaustive-deps
  const [draft, setDraftState] = useState<RecipeDraft | null>(null);
  // 저장하지 않은 AI 초안은 이 기기에 여러 개(최대 5개) 보관해 두었다가 다시 열 수 있게 한다
  const pendingName = `drafts:${familyId ?? ""}`;
  const [draftId, setDraftId] = useState<string | null>(null);
  const [stored, setStored] = useState<PendingDraft[]>(() => loadPending<PendingDraft[]>(pendingName) ?? []);
  useEffect(() => { setStored(loadPending<PendingDraft[]>(`drafts:${familyId ?? ""}`) ?? []); }, [familyId]);
  const writeStored = (list: PendingDraft[]) => {
    setStored(list);
    if (list.length) savePending(pendingName, list); else clearPending(pendingName);
  };
  const upsertStored = (entry: PendingDraft) => {
    const cur = loadPending<PendingDraft[]>(pendingName) ?? [];
    writeStored([entry, ...cur.filter((x) => x.id !== entry.id)].slice(0, MAX_DRAFTS));
  };
  const removeStored = (id: string) => writeStored((loadPending<PendingDraft[]>(pendingName) ?? []).filter((x) => x.id !== id));
  /** 새 AI 결과: 보관함에 넣고 편집기를 연다 */
  const setDraft = (d: RecipeDraft, note: string | null = null) => {
    const id = crypto.randomUUID();
    upsertStored({ id, draft: d, note });
    setDraftId(id); setDraftState(d);
  };
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

  const empty = !loading && recipes.length === 0;
  const startGenerate = () => { setAdding(false); setGenerating({}); };
  const startImport = () => { setAdding(false); setImporting({ initial: null }); };

  return (
    <div className="pb-[calc(var(--safe-bottom)+56px+96px)]">
      <TabHeader title="레시피" />
      {!empty && (
        <>
          <SearchField onCanvas className="mx-5" value={search} onChange={setSearch} placeholder="요리 이름이나 재료로 찾기" label="레시피 검색" />
          <div className="flex items-center gap-2 overflow-x-auto px-5 pt-3 [scrollbar-width:none]">
            <FilterChip on={filter.kind === "all"} onClick={() => setFilter({ kind: "all" })}>전체</FilterChip>
            <FilterChip on={filter.kind === "fav"} onClick={() => setFilter({ kind: "fav" })}>즐겨찾기</FilterChip>
            {folders.map((f) => (
              <FilterChip key={f.id} on={filter.kind === "folder" && filter.id === f.id} onClick={() => setFilter({ kind: "folder", id: f.id })}>{f.name}</FilterChip>
            ))}
            <IconButton tone="filled" aria-label="폴더 관리" onClick={() => setFolderMenu(true)}><FolderPlus size={20} /></IconButton>
          </div>
        </>
      )}

      {error && <Banner kind="danger" className="mx-5 mt-4" title="레시피를 불러오지 못했어요">{error}</Banner>}
      {/* 저장하지 않은 AI 초안 (이 기기에 최대 5개) */}
      {!draft && stored.length > 0 && (
        <Banner kind="info" onCanvas className="mx-5 mt-4" title="저장 안 한 초안">
          <ul className="-mr-2 mt-1">
            {stored.map((p) => (
              <li key={p.id} data-testid="pending-draft" className="flex items-center gap-1">
                <span className="min-w-0 flex-1 truncate text-callout text-ink">{p.draft.title}</span>
                <button type="button" className="h-11 shrink-0 px-2 text-callout font-semibold text-accent active:opacity-60"
                  onClick={() => { setDraftNote(p.note); setDraftId(p.id); setDraftState(p.draft); }}>이어서</button>
                <button type="button" className="h-11 shrink-0 px-2 text-callout text-ink-3 active:opacity-60"
                  onClick={() => { if (confirm(`"${p.draft.title}" 초안을 버릴까요?`)) removeStored(p.id); }}>버리기</button>
              </li>
            ))}
          </ul>
        </Banner>
      )}

      {loading ? <Skeleton rows={4} className="mx-5 mt-4" />
        : empty ? (
          <EmptyState icon={<BookOpen size={28} />} title="아직 레시피가 없어요" body="음식 이름만 적으면 AI가 써 줘요">
            <Button size="md" onClick={startGenerate} data-testid="open-generate">음식 이름으로 만들기</Button>
            <Button size="md" variant="secondary" onClick={startImport} data-testid="open-import">링크·사진에서 가져오기</Button>
          </EmptyState>
        ) : filtered.length === 0 ? (
          <p className="px-5 py-12 text-center text-caption text-ink-3">조건에 맞는 레시피가 없어요.</p>
        ) : (
          <Card className="mx-5 mt-4 overflow-hidden">
            <ul>
              {filtered.map((r) => (
                <li key={r.id} data-favorite={r.favorite || undefined} className={`${rowLine} before:left-[76px]`}>
                  <button type="button" onClick={() => setOpenId(r.id)} className="flex min-h-[72px] w-full items-center gap-3 px-4 py-3 text-left transition-colors active:bg-surface-2">
                    {(() => { const e = recipeEmoji(r); return e
                      ? <span aria-hidden className="food-emoji grid size-12 shrink-0 place-items-center rounded-control bg-surface-2 text-[26px]">{e}</span>
                      : <span aria-hidden className="grid size-12 shrink-0 place-items-center rounded-control bg-surface-2 text-title2 text-ink-2">{[...r.title.trim()][0] ?? ""}</span>; })()}
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1">
                        <span className="truncate text-headline text-ink">{r.title}</span>
                        {r.favorite && <><Star size={14} fill="currentColor" aria-hidden className="shrink-0 text-ink-2" /><span className="sr-only">즐겨찾기</span></>}
                      </span>
                      <span className="mt-0.5 block truncate text-caption text-ink-3 tabular-nums">{metaLine(r)}</span>
                    </span>
                    <ChevronRight size={20} aria-hidden className="shrink-0 text-ink-3" />
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        )}

      {!loading && !empty && <ExtendedFab onClick={() => setAdding(true)}>레시피 추가</ExtendedFab>}

      {adding && (
        <Sheet title="레시피 추가" onClose={() => setAdding(false)} flush>
          <ul>
            <AddRow icon={<Sparkles size={20} strokeWidth={2} />} title="음식 이름으로 만들기" sub="가족 취향에 맞춰 AI가 써 줘요" onClick={startGenerate} testId="open-generate" />
            <AddRow icon={<LinkIcon size={20} />} title="링크·사진에서 가져오기" sub="유튜브, 블로그, 인스타 캡션, 요리책 사진" onClick={startImport} testId="open-import" />
          </ul>
        </Sheet>
      )}
      {generating && (
        <GenerateSheet profile={family?.profile ?? null} initialDish={generating.dish} initialNotes={generating.notes} initialServings={generating.servings} autoStart={generating.auto}
          onClose={() => setGenerating(false)}
          onResult={(d) => { setGenerating(false); setDraftNote(null); setDraft(d); }} />
      )}
      {importing && (
        <ImportSheet initial={importing.initial} onClose={() => setImporting(false)}
          onResult={(d, note) => { setImporting(false); setDraftNote(note); setDraft(d, note); }}
          onMakeWithAi={(dish) => { setImporting(false); setGenerating({ dish }); }} />
      )}
      {open && (
        <RecipeDetail recipe={open} recipeId={open.id} folders={folders} onClose={() => setOpenId(null)}
          onEdit={() => setEditing(open)}
          onToggleFavorite={() => updateRecipe(familyId, open.id, { favorite: !open.favorite })}
          onMoveFolder={(fid) => updateRecipe(familyId, open.id, { folderId: fid })}
          onDelete={() => deleteRecipe(familyId, open.id)}
          onCooked={(servings) => addCookedLog(familyId, open.id, { date: new Date().toISOString(), by: user.uid, servings })}
          onAdapted={(d, summary) => { setDraftNote(`AI가 바꿨어요: ${summary}`); setDraft(d, `AI가 바꿨어요: ${summary}`); }} />
      )}
      {/* 상세 위에 뜨도록 상세 다음에 둔다 (레시피 바꾸기 결과) */}
      {draft && (
        <RecipeEditor title="레시피 확인·수정" initial={draft} note={draftNote} fresh
          onChange={(d) => { if (draftId) upsertStored({ id: draftId, draft: d, note: draftNote }); }}
          onClose={() => { setDraftState(null); setDraftId(null); setStored(loadPending<PendingDraft[]>(pendingName) ?? []); }}
          onSave={async (d) => {
            const id = await createRecipe(familyId, user.uid, d, filter.kind === "folder" ? filter.id : null);
            if (draftId) removeStored(draftId);
            setDraftState(null); setDraftId(null); setOpenId(id);
            void fixRecipeKeysInBackground(familyId, id, d);
          }} />
      )}
      {editing && (
        <RecipeEditor title="레시피 수정" initial={editing} onClose={() => setEditing(null)}
          onSave={async (d) => {
            const id = editing.id;
            // 바뀐 칸만 보낸다: 그사이 다른 가족이 즐겨찾기·폴더·요리 기록을 바꿨어도 덮지 않게
            const patch = Object.fromEntries(Object.entries(d).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify((editing as Record<string, unknown>)[k])));
            if (Object.keys(patch).length) await updateRecipe(familyId, id, patch);
            setEditing(null);
            void fixRecipeKeysInBackground(familyId, id, d);
          }} />
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
  const add = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true); try { await createFolder(familyId, name); setName(""); } finally { setBusy(false); }
  };
  return (
    <Sheet title="폴더 관리" onClose={onClose} flush>
      <form onSubmit={add} className="flex items-start gap-2 px-5">
        <TextField wrapClass="min-w-0 flex-1" placeholder="새 폴더 이름" aria-label="새 폴더 이름" maxLength={30} value={name} onChange={(e) => setName(e.target.value)} />
        <Button type="submit" size="md" disabled={!name.trim()} loading={busy}>추가</Button>
      </form>
      <ul className="pt-3">
        {folders.length === 0 && <li className="px-5 py-6 text-center text-caption text-ink-3">아직 폴더가 없어요</li>}
        {folders.map((f) => (
          <li key={f.id} className={`${rowLine} before:left-5 flex min-h-14 items-center gap-3 pl-5 pr-2`}>
            <span className="min-w-0 flex-1 truncate text-body text-ink">{f.name}</span>
            <button type="button" className="h-11 shrink-0 rounded-control px-3 text-callout font-semibold text-danger active:bg-danger-soft"
              onClick={async () => { if (confirm(`"${f.name}" 폴더를 삭제할까요? (레시피는 남습니다)`)) { await deleteFolder(familyId, f.id); onDeleted(f.id); } }}>삭제</button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
