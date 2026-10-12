import { useState } from "react";
import type { Ingredient } from "@cook/shared";
import { callWorker, ApiError } from "../../lib/api";

type Option = { name: string; fromFridge: boolean; amount: string; how: string };
type SubResponse = { items: { ingredient: string; options: Option[]; skippable: boolean }[] };

/** 없는 재료를 무엇으로 대신할지 (Claude). 냉장고에 있는 것을 먼저 */
export function SubstitutePanel({ title, all, missing, fridge, staples }: {
  title: string; all: string[]; missing: Pick<Ingredient, "name" | "qty" | "unit">; fridge: string[]; staples: string[];
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<SubResponse["items"][number] | null>(null);
  const run = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await callWorker<SubResponse>("/substitute", { title, all, missing: [missing], fridge: fridge.slice(0, 150), staples });
      setRes(r.items[0] ?? { ingredient: missing.name, options: [], skippable: false });
    } catch (e) { setErr(e instanceof ApiError ? e.message : "찾지 못했어요"); }
    finally { setBusy(false); }
  };
  if (!res) {
    return (
      <div className="flex flex-col gap-1">
        <button type="button" onClick={run} disabled={busy} className="rounded-xl bg-orange-50 py-2.5 text-sm font-semibold text-orange-800 disabled:opacity-50" data-testid="substitute-button">
          {busy ? "대신 쓸 재료를 찾는 중…" : `✨ "${missing.name}" 대신 쓸 재료 찾기`}
        </button>
        {err && <p className="text-xs text-red-600">{err}</p>}
      </div>
    );
  }
  return (
    <div className="rounded-xl bg-orange-50 p-3 text-sm" data-testid="substitute-result">
      {res.options.length === 0 ? <p className="text-gray-600">마땅히 대신할 재료가 없어요.</p> : (
        <ul className="flex flex-col gap-1.5">
          {res.options.map((o) => (
            <li key={o.name}>
              <span className="font-semibold">{o.name}</span> <span className="text-gray-600">{o.amount}</span>
              {o.fromFridge && <span className="ml-1 rounded-full bg-emerald-100 px-1.5 text-[11px] font-semibold text-emerald-800">냉장고에 있음</span>}
              <p className="text-xs text-gray-600">{o.how}</p>
            </li>
          ))}
        </ul>
      )}
      {res.skippable && <p className="mt-1.5 text-xs text-gray-600">빼고 만들어도 괜찮아요.</p>}
    </div>
  );
}
