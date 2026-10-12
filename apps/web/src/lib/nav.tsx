import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import type { Tab } from "../components/TabBar";
import type { SharedPayload } from "./share";

/** 탭 사이 이동: 장보기에서 냉장고로 넣은 뒤 냉장고 탭에서 떨어지는 애니메이션을 보여 주는 등 */
type NavState = {
  tab: Tab;
  setTab: (t: Tab) => void;
  /** 냉장고 탭으로 가서 이 id 들이 떨어지는 애니메이션을 보여 준다 */
  dropIntoFridge: (ids: string[], message?: string) => void;
  /** 아직 처리하지 않은 떨어뜨리기 요청 (냉장고 탭이 처리하고 consume 한다) */
  fridgeDrop: { ids: string[]; message?: string } | null;
  consumeFridgeDrop: () => void;
  /** 냉장고 탭으로 가서 영수증 입력을 연다 */
  openReceipt: () => void;
  pendingReceipt: boolean;
  consumeReceipt: () => void;
  /** 레시피 탭으로 가서 링크·글 가져오기를 연다 (공유로 들어온 경우 등) */
  openImport: (p: SharedPayload) => void;
  pendingImport: SharedPayload | null;
  consumeImport: () => void;
};

const NavCtx = createContext<NavState | null>(null);

export function NavProvider({ initialTab, children }: { initialTab: Tab; children: ReactNode }) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [fridgeDrop, setFridgeDrop] = useState<NavState["fridgeDrop"]>(null);
  const [pendingReceipt, setPendingReceipt] = useState(false);
  const dropIntoFridge = useCallback((ids: string[], message?: string) => { setFridgeDrop({ ids, message }); setTab("fridge"); }, []);
  const consumeFridgeDrop = useCallback(() => setFridgeDrop(null), []);
  const openReceipt = useCallback(() => { setPendingReceipt(true); setTab("fridge"); }, []);
  const consumeReceipt = useCallback(() => setPendingReceipt(false), []);
  const [pendingImport, setPendingImport] = useState<SharedPayload | null>(null);
  const openImport = useCallback((p: SharedPayload) => { setPendingImport(p); setTab("recipes"); }, []);
  const consumeImport = useCallback(() => setPendingImport(null), []);
  return (
    <NavCtx.Provider value={{ tab, setTab, dropIntoFridge, fridgeDrop, consumeFridgeDrop, openReceipt, pendingReceipt, consumeReceipt, openImport, pendingImport, consumeImport }}>
      {children}
    </NavCtx.Provider>
  );
}

export function useNav(): NavState {
  const v = useContext(NavCtx);
  if (!v) throw new Error("useNav must be inside NavProvider");
  return v;
}
