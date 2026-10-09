export type Tab = "recipes" | "fridge" | "shopping" | "today";

const tabs: { id: Tab; label: string; icon: string }[] = [
  { id: "recipes", label: "레시피", icon: "📖" },
  { id: "fridge", label: "냉장고", icon: "🧊" },
  { id: "shopping", label: "장보기", icon: "🛒" },
  { id: "today", label: "뭐 먹지", icon: "🍳" },
];

export function TabBar({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-orange-100 bg-white/95 backdrop-blur"
      style={{ paddingBottom: "var(--safe-bottom)" }}>
      <ul className="mx-auto flex max-w-lg">
        {tabs.map((t) => (
          <li key={t.id} className="flex-1">
            <button onClick={() => onChange(t.id)}
              className={`flex w-full flex-col items-center gap-0.5 py-2 text-xs ${active === t.id ? "text-orange-600 font-semibold" : "text-gray-500"}`}>
              <span className="text-xl">{t.icon}</span><span>{t.label}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
