import { WifiOff } from "lucide-react";
import { useOnline } from "../lib/online";
import { useToast } from "./ui/Toast";

/** 탭 머리 왼쪽: 인터넷이 끊겼을 때만 보인다. 누르면 무엇이 되고 안 되는지 한 줄로 */
export function OfflinePill() {
  const online = useOnline();
  const toast = useToast();
  if (online) return null;
  return (
    <button type="button" data-testid="offline-pill"
      onClick={() => toast.show("인터넷이 끊겼어요 · 보고 고치는 건 되고, 연결되면 저장돼요. AI는 연결된 뒤에 써 주세요")}
      className="inline-flex h-11 items-center px-1 active:opacity-70">
      <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-warning-soft px-3 text-caption font-semibold text-warning">
        <WifiOff size={14} aria-hidden />오프라인
      </span>
    </button>
  );
}
