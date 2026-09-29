/**
 * 임시 재료 키 생성 (1단계). 4단계에서 AI 정규화(/normalize)로 교체되지만,
 * 오프라인·실패 시 폴백으로 계속 사용한다.
 * 규칙: 소문자화, 공백/특수문자 제거. 한글은 그대로 두어 "대파"와 "대파 " 정도만 합쳐진다.
 */
export function provisionalKey(name: string): string {
  return name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();
}

/** 6자리 초대 코드 (혼동되는 문자 제외) */
export function makeInviteCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 6; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

/** YYYY-MM-DD 기준 D-day (음수면 지남). null이면 유통기한 없음 */
export function daysUntil(dateStr: string | null, today = new Date()): number | null {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split("-").map(Number);
  const target = new Date(y, m - 1, d);
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((target.getTime() - base.getTime()) / 86400000);
}
