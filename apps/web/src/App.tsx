import { firebaseConfigured } from "./lib/firebase";
import { AuthProvider, useAuth } from "./lib/auth";
import { FamilyProvider, useFamily } from "./lib/family";
import { TabBar, type Tab } from "./components/TabBar";
import { FridgeTab } from "./features/fridge/FridgeTab";
import { RecipesTab } from "./features/recipes/RecipesTab";
import { ShoppingTab } from "./features/shopping/ShoppingTab";
import { NavProvider, useNav } from "./lib/nav";
import { takePendingShare } from "./lib/share";
import { useEffect, useState } from "react";
import { FamilySetup } from "./features/family/FamilySetup";
import { FamilyMenu } from "./features/family/FamilyBar";
import { TodayTab } from "./features/today/TodayTab";
import { SetupScreen } from "./pages/SetupScreen";
import { SignInScreen } from "./pages/SignInScreen";

/** 잠깐 기다렸다 넘어간 저장이 나중에 실패하면 알린다 (lib/write.ts) */
function WriteFailureToast() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const on = (e: Event) => {
      setMsg(`저장하지 못한 내용이 있어요: ${(e as CustomEvent<string>).detail}`);
      clearTimeout(t); t = setTimeout(() => setMsg(null), 6000);
    };
    window.addEventListener("cook:write-failed", on);
    return () => { window.removeEventListener("cook:write-failed", on); clearTimeout(t); };
  }, []);
  if (!msg) return null;
  return (
    <div role="alert" className="fixed inset-x-0 top-0 z-[60] mx-auto mt-2 w-fit max-w-[92%] rounded-2xl bg-red-600 px-4 py-2 text-sm text-white shadow-lg"
      style={{ marginTop: "calc(var(--safe-top) + 8px)" }} onClick={() => setMsg(null)}>{msg}</div>
  );
}

function Tabs() {
  const { tab, setTab, openImport } = useNav();
  // 공유로 들어온 링크가 있으면 가져오기 화면을 연다 (로그인을 거친 뒤에도)
  useEffect(() => {
    const shared = takePendingShare();
    if (shared) openImport(shared);
  }, [openImport]);
  return (
    <div className="relative mx-auto max-w-lg" style={{ paddingTop: "var(--safe-top)" }}>
      <FamilyMenu />
      <WriteFailureToast />
      {tab === "fridge" && <FridgeTab />}
      {tab === "recipes" && <RecipesTab />}
      {tab === "shopping" && <ShoppingTab />}
      {tab === "today" && <TodayTab />}
      <TabBar active={tab} onChange={setTab} />
    </div>
  );
}

function Shell() {
  const { user, loading } = useAuth();
  const { familyId, loading: famLoading } = useFamily();

  if (loading || (user && famLoading)) {
    return <div className="flex min-h-dvh items-center justify-center text-gray-500">불러오는 중…</div>;
  }
  if (!user) return <SignInScreen />;
  if (!familyId) return <FamilySetup />;

  return <NavProvider initialTab={"recipes" satisfies Tab}><Tabs /></NavProvider>;
}

export default function App() {
  if (!firebaseConfigured) return <SetupScreen />;
  return (
    <AuthProvider>
      <FamilyProvider>
        <Shell />
      </FamilyProvider>
    </AuthProvider>
  );
}
