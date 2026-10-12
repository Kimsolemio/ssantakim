import { BookOpen, ChefHat, Refrigerator, ShoppingBasket, type LucideIcon } from "lucide-react";

export type Tab = "recipes" | "fridge" | "shopping" | "today";

const tabs: { id: Tab; label: string; Icon: LucideIcon }[] = [
  { id: "recipes", label: "레시피", Icon: BookOpen },
  { id: "fridge", label: "냉장고", Icon: Refrigerator },
  { id: "shopping", label: "장보기", Icon: ShoppingBasket },
  { id: "today", label: "뭐 먹지", Icon: ChefHat },
];

export function TabBar({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/90 backdrop-blur-xl" style={{ paddingBottom: "var(--safe-bottom)" }}>
      <ul className="mx-auto grid max-w-lg grid-cols-4">
        {tabs.map(({ id, label, Icon }) => {
          const on = active === id;
          return (
            <li key={id}>
              <button type="button" onClick={() => onChange(id)} aria-current={on ? "page" : undefined}
                className={`flex h-14 w-full flex-col items-center justify-center gap-0.5 text-micro transition-colors ${on ? "text-accent" : "text-ink-3"}`}>
                <Icon size={24} strokeWidth={on ? 2.25 : 1.75} aria-hidden />
                <span>{label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
