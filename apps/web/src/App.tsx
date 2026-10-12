import { firebaseConfigured } from "./lib/firebase";
import { AuthProvider, useAuth } from "./lib/auth";
import { FamilyProvider, useFamily } from "./lib/family";
import { TabBar, type Tab } from "./components/TabBar";
import { FridgeTab } from "./features/fridge/FridgeTab";
import { RecipesTab } from "./features/recipes/RecipesTab";
import { ShoppingTab } from "./features/shopping/ShoppingTab";
import { NavProvider, useNav } from "./lib/nav";
import { takePendingShare } from "./lib/share";
import { useEffect } from "react";
import { ToastProvider, useToast } from "./components/ui/Toast";
import { FamilySetup } from "./features/family/FamilySetup";
import { TodayTab } from "./features/today/TodayTab";
import { SetupScreen } from "./pages/SetupScreen";
import { SignInScreen } from "./pages/SignInScreen";

/** 잠깐 기다렸다 넘어간 저장이 나중에 실패하면 알린다 (lib/write.ts) */
function WriteFailureToast() {
  const toast = useToast();
  useEffect(() => {
    const on = (e: Event) => toast.show(`저장하지 못한 내용이 있어요: ${(e as CustomEvent<string>).detail}`, { kind: "error" });
    window.addEventListener("cook:write-failed", on);
    return () => window.removeEventListener("cook:write-failed", on);
  }, [toast]);
  return null;
}

function Tabs() {
  const { tab, setTab, openImport } = useNav();
  // 공유로 들어온 링크가 있으면 가져오기 화면을 연다 (로그인을 거친 뒤에도)
  useEffect(() => {
    const shared = takePendingShare();
    if (shared) openImport(shared);
  }, [openImport]);
  return (
    <div className="relative mx-auto min-h-dvh max-w-lg">
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
    return <div className="flex min-h-dvh items-center justify-center text-callout text-ink-3" role="status">불러오는 중…</div>;
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
        <ToastProvider>
          <Shell />
        </ToastProvider>
      </FamilyProvider>
    </AuthProvider>
  );
}
