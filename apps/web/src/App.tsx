import { firebaseConfigured } from "./lib/firebase";
import { AuthProvider, useAuth } from "./lib/auth";
import { FamilyProvider, useFamily } from "./lib/family";
import { TabBar, type Tab } from "./components/TabBar";
import { FridgeTab } from "./features/fridge/FridgeTab";
import { RecipesTab } from "./features/recipes/RecipesTab";
import { ShoppingTab } from "./features/shopping/ShoppingTab";
import { NavProvider, useNav } from "./lib/nav";
import { FamilySetup } from "./features/family/FamilySetup";
import { FamilyMenu } from "./features/family/FamilyBar";
import { Placeholder } from "./pages/Placeholder";
import { SetupScreen } from "./pages/SetupScreen";
import { SignInScreen } from "./pages/SignInScreen";

function Tabs() {
  const { tab, setTab } = useNav();
  return (
    <div className="mx-auto max-w-lg" style={{ paddingTop: "var(--safe-top)" }}>
      <FamilyMenu />
      {tab === "fridge" && <FridgeTab />}
      {tab === "recipes" && <RecipesTab />}
      {tab === "shopping" && <ShoppingTab />}
      {tab === "today" && <Placeholder title="오늘 뭐 먹지" stage="6단계" />}
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
