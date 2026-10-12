import { useEffect, useRef, useState } from "react";
import { formatAmount, type Ingredient } from "@cook/shared";
import { callWorker, ApiError } from "../../lib/api";
import { Sheet } from "../../components/Sheet";
import { AiNotice } from "../../components/AiNotice";
import { AiProgress } from "../../components/ui/Ai";
import { Banner } from "../../components/ui/Banner";
import { Button } from "../../components/ui/Button";
import { GroupLabel, TextAction, rowLine } from "../../components/ui/Section";

type Option = { name: string; fromFridge: boolean; amount: string; how: string };
type SubResponse = { items: { ingredient: string; options: Option[]; skippable: boolean }[] };
type Missing = Pick<Ingredient, "name" | "qty" | "unit">;

/** 재료 시트 맨 위의 입구 (누르면 "대체 재료" 시트로 바뀐다) */
export function SubstitutePanel({ onFind }: { onFind: () => void }) {
  return <Button variant="secondary" size="md" block ai onClick={onFind} data-testid="substitute-button">냉장고 재료로 대체 찾기</Button>;
}

const row = `${rowLine} before:left-5 px-5 py-3`;

/** 없는 재료를 무엇으로 대신할지 (Claude). 냉장고에 있는 것을 먼저. 열자마자 찾는다 */
export function SubstituteSheet({ title, all, missing, fridge, staples, onClose, onShop }: {
  title: string; all: string[]; missing: Missing[]; fridge: string[]; staples: string[];
  onClose: () => void;
  /** 대신할 게 없을 때 "장보기에 담기" */
  onShop?: () => void;
}) {
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<SubResponse["items"] | null>(null);
  const abort = useRef<AbortController | null>(null);
  const run = async () => {
    setBusy(true); setErr(null);
    abort.current = new AbortController();
    try {
      const r = await callWorker<SubResponse>("/substitute", { title, all, missing, fridge: fridge.slice(0, 150), staples }, abort.current.signal);
      setRes(r.items.length ? r.items : missing.map((m) => ({ ingredient: m.name, options: [], skippable: false })));
    } catch (e) {
      if (abort.current?.signal.aborted) return;
      setErr(e instanceof ApiError ? e.message : "찾지 못했어요");
    } finally { setBusy(false); }
  };
  // StrictMode 의 두 번 실행에도 한 번만 부르도록 예약 후 정리한다
  useEffect(() => { const t = setTimeout(() => { void run(); }, 0); return () => clearTimeout(t); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => abort.current?.abort(), []);
  const close = () => { abort.current?.abort(); onClose(); };
  const amountOf = (name: string) => {
    const m = missing.find((x) => x.name === name);
    return m ? formatAmount(m) : "";
  };

  return (
    <Sheet title="대체 재료" onClose={close} flush>
      {busy ? (
        <AiProgress messages={["냉장고를 살펴보는 중…", "어울리는 재료를 고르는 중…"]} onCancel={close} />
      ) : err ? (
        <div className="px-5 pt-2">
          <Banner kind="danger" title="대체 재료를 찾지 못했어요" action={{ label: "다시 시도", onClick: () => void run() }}>{err}</Banner>
        </div>
      ) : res && (
        <div data-testid="substitute-result">
          {res.map((it) => (
            <section key={it.ingredient}>
              <GroupLabel className="pt-2">{[it.ingredient, amountOf(it.ingredient)].filter(Boolean).join(" ")} 대신</GroupLabel>
              {it.options.length === 0 && !it.skippable ? (
                <div className="flex items-center gap-2 px-5 pb-3">
                  <p className="min-w-0 flex-1 text-callout text-ink-3">냉장고에 대신할 게 없어요</p>
                  {onShop && <TextAction onClick={onShop}>장보기에 담기</TextAction>}
                </div>
              ) : (
                <ul className="pb-2">
                  {it.options.map((o) => (
                    <li key={o.name} className={row}>
                      <p className="text-body text-ink">{o.name} <span className="text-ink-2 tabular-nums">{o.amount}</span></p>
                      <p className="mt-0.5 text-caption text-ink-3"><span>{o.how}</span>{o.fromFridge && " · 냉장고에 있어요"}</p>
                    </li>
                  ))}
                  {it.skippable && (
                    <li className={row}>
                      <p className="text-body text-ink">이번엔 빼기</p>
                      <p className="mt-0.5 text-caption text-ink-3">빼고 만들어도 괜찮아요</p>
                    </li>
                  )}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}
      <AiNotice what="레시피 재료와 냉장고 목록" kind="fridge" className="px-5 pt-4" />
    </Sheet>
  );
}
