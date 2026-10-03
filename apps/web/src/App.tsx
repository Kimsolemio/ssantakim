import { useState } from "react";
import { firebaseConfigured } from "./lib/firebase";
import { AuthProvider, useAuth } from "./lib/auth";
import { FamilyProvider, useFamily } from "./lib/family";
import { TabBar, type Tab } from "./components/TabBar";
import { FridgeTab } from "./features/fridge/FridgeTab";
import { RecipesTab } from "./features/recipes/RecipesTab";
import { FamilySetup } from "./features/family/FamilySetup";
import { FamilyMenu } from "./features/family/FamilyBar";
import { Placeholder } from "./pages/Placeholder";
import { SetupScreen } from "./pages/SetupScreen";
import { SignInScreen } from "./pages/SignInScreen";

function Shell() {
  const { user, loading } = useAuth();
  const { familyId, loading: famLoading } = useFamily();
  const [tab, setTab] = useState<Tab>("recipes");

  if (loading || (user && famLoading)) {
    return <div className="flex min-h-dvh items-center justify-center text-gray-500">불러오는 중…</div>;
  }
  if (!user) return <SignInScreen />;
  if (!familyId) return <FamilySetup />;

  return (
    <div className="mx-auto max-w-lg" style={{ paddingTop: "var(--safe-top)" }}>
      <FamilyMenu />
      {tab === "fridge" && <FridgeTab />}
      {tab === "recipes" && <RecipesTab />}
      {tab === "shopping" && <Placeholder title="장보기" stage="4단계" />}
      {tab === "today" && <Placeholder title="오늘 뭐 먹지" stage="6단계" />}
      <TabBar active={tab} onChange={setTab} />
    </div>
  );
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
