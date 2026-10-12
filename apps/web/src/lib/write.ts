import { isOffline } from "./online";

/**
 * Firestore 쓰기는 기기 사본에 바로 반영되고, 서버 확인은 연결되면 온다.
 * 인터넷이 약한 곳(마트 지하)에서 "저장 중…"에 멈추지 않도록, 서버 확인을 잠깐만 기다리고 넘어간다.
 * 그 뒤에 난 오류는 콘솔에 남긴다 (Firestore가 연결되면 다시 보낸다).
 */
export async function settle<T>(write: Promise<T>, ms = 2500): Promise<void> {
  // 끊긴 동안은 기다릴 서버가 없다: 기기 사본에 이미 들어갔으니 바로 넘어간다 (연결되면 Firestore가 보낸다)
  if (isOffline()) ms = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = write.then(() => undefined);
  const timeout = new Promise<"timeout">((r) => { timer = setTimeout(() => r("timeout"), ms); });
  try {
    const r = await Promise.race([late, timeout]);
    if (r === "timeout") late.catch((e) => {
      console.warn("저장이 늦게 실패했어요", e);
      window.dispatchEvent(new CustomEvent("cook:write-failed", { detail: writeErrorMessage(e) }));
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Firestore 오류를 가족이 알아듣는 말로 */
export function writeErrorMessage(e: unknown): string {
  const code = (e as { code?: string })?.code ?? "";
  if (code === "not-found") return "다른 가족이 먼저 지운 항목이 있어요. 화면을 확인해 주세요";
  if (code === "permission-denied") return "이 가족 데이터에 쓸 권한이 없어요. 다시 로그인해 주세요";
  if (code === "unavailable") return "인터넷이 끊겼어요. 연결되면 다시 시도해 주세요";
  return e instanceof Error ? e.message : String(e);
}
