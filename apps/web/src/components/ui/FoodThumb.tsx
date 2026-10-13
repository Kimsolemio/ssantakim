/** 음식 이모지는 이 "접시" 안에서만 쓴다 */
export function FoodThumb({ emoji, size = "md", className = "" }: { emoji: string; size?: "sm" | "md" | "lg"; className?: string }) {
  const s = size === "sm" ? "size-8 text-[18px]" : size === "lg" ? "size-14 text-[30px]" : "size-10 text-[22px]";
  return <span aria-hidden className={`food-emoji grid shrink-0 place-items-center rounded-control bg-surface-2 ${s} ${className}`}>{emoji}</span>;
}

/** 아이콘 접시 (목록 행 왼쪽) */
export function IconThumb({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <span aria-hidden className={`grid size-10 shrink-0 place-items-center rounded-full bg-surface-2 text-ink-2 ${className}`}>{children}</span>;
}
