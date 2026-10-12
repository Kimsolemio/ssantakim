import { useEffect, useState } from "react";

/** 지금 인터넷에 연결돼 있는가 (브라우저가 아는 만큼) */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);
  return online;
}

export const isOffline = () => typeof navigator !== "undefined" && navigator.onLine === false;
