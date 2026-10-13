import { useEffect, useState } from "react";

type WakeLockSentinelLike = { release: () => Promise<void>; addEventListener?: (t: string, cb: () => void) => void };

/** 요리 중 화면 꺼짐 방지. 탭을 다시 보면 자동으로 다시 요청한다. */
export function useWakeLock(active: boolean): "on" | "off" | "unsupported" {
  const [state, setState] = useState<"on" | "off" | "unsupported">("off");
  useEffect(() => {
    if (!active) return;
    const nav = navigator as unknown as { wakeLock?: { request: (t: "screen") => Promise<WakeLockSentinelLike> } };
    if (!nav.wakeLock) { setState("unsupported"); return; }
    let sentinel: WakeLockSentinelLike | null = null;
    let cancelled = false;
    const request = async () => {
      try {
        sentinel = await nav.wakeLock!.request("screen");
        if (cancelled) { await sentinel.release(); return; }
        setState("on");
        sentinel.addEventListener?.("release", () => setState("off"));
      } catch { setState("off"); }
    };
    const onVis = () => { if (document.visibilityState === "visible") void request(); };
    void request();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVis);
      sentinel?.release().catch(() => {});
    };
  }, [active]);
  return state;
}
