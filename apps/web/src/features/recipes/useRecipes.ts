import { useEffect, useState } from "react";
import {
  collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, query, orderBy,
} from "firebase/firestore";
import { Recipe, RecipeDraft } from "@cook/shared";
import { getDb } from "../../lib/firebase";

export type RecipeDoc = Recipe & { id: string };
export type Folder = { name: string; createdAt: string };
export type FolderDoc = Folder & { id: string };

export function useRecipes(familyId: string | null) {
  const [recipes, setRecipes] = useState<RecipeDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!familyId) { setRecipes([]); setLoading(false); return; }
    setLoading(true);
    const q = query(collection(getDb(), "families", familyId, "recipes"), orderBy("createdAt", "desc"));
    return onSnapshot(q, (snap) => {
      const list: RecipeDoc[] = [];
      snap.forEach((d) => {
        const parsed = Recipe.safeParse(d.data());
        if (parsed.success) list.push({ id: d.id, ...parsed.data });
        else console.warn("recipe parse failed", d.id, parsed.error.issues[0]);
      });
      setRecipes(list); setLoading(false); setError(null);
    }, (e) => { setError(e.message); setLoading(false); });
  }, [familyId]);

  return { recipes, loading, error };
}

export function useFolders(familyId: string | null) {
  const [folders, setFolders] = useState<FolderDoc[]>([]);
  useEffect(() => {
    if (!familyId) { setFolders([]); return; }
    const q = query(collection(getDb(), "families", familyId, "folders"), orderBy("createdAt", "asc"));
    return onSnapshot(q, (snap) => {
      const list: FolderDoc[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...(d.data() as Folder) }));
      setFolders(list);
    });
  }, [familyId]);
  return folders;
}

export async function createRecipe(familyId: string, uid: string, draft: RecipeDraft, folderId: string | null = null): Promise<string> {
  const recipe: Recipe = Recipe.parse({
    ...draft, folderId, favorite: false, photoUrl: null, cookedLog: [],
    createdAt: new Date().toISOString(), createdBy: uid,
  });
  const ref = await addDoc(collection(getDb(), "families", familyId, "recipes"), recipe);
  return ref.id;
}

export async function updateRecipe(familyId: string, id: string, patch: Partial<Recipe>) {
  await updateDoc(doc(getDb(), "families", familyId, "recipes", id), patch);
}

export async function deleteRecipe(familyId: string, id: string) {
  await deleteDoc(doc(getDb(), "families", familyId, "recipes", id));
}

export async function createFolder(familyId: string, name: string): Promise<string> {
  const ref = await addDoc(collection(getDb(), "families", familyId, "folders"), { name: name.trim(), createdAt: new Date().toISOString() } satisfies Folder);
  return ref.id;
}

export async function deleteFolder(familyId: string, id: string) {
  await deleteDoc(doc(getDb(), "families", familyId, "folders", id));
}
