import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeftRight, ChevronRight, Copy, LogOut, Share2, UserRound } from "lucide-react";
import { FamilyProfile } from "@cook/shared";
import { useFamily } from "../../lib/family";
import { useAuth } from "../../lib/auth";
import { getWorker, workerConfigured } from "../../lib/api";
import { settle, writeErrorMessage } from "../../lib/write";
import { FullScreen } from "../../components/FullScreen";
import { Sheet } from "../../components/Sheet";
import { Button } from "../../components/ui/Button";
import { Card, GroupLabel, rowLinePlain } from "../../components/ui/Section";
import { Stepper } from "../../components/ui/Stepper";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { Switch } from "../../components/ui/Toggle";
import { TextField } from "../../components/ui/Field";
import { FamilyAvatar, LargeTitleBar } from "../../components/ui/Bars";
import { useToast } from "../../components/ui/Toast";
import { OfflinePill } from "../../components/OfflinePill";

/** 탭 화면 머리 (큰 제목 + 오른쪽 버튼 + 가족 단추) */
export function TabHeader({ title, right }: { title: string; right?: ReactNode }) {
  return <LargeTitleBar title={title} left={<OfflinePill />} right={<>{right}<FamilyButton /></>} />;
}

export function FamilyButton() {
  const { family } = useFamily();
  const [open, setOpen] = useState(false);
  if (!family) return null;
  return (
    <>
      <FamilyAvatar name={family.name} onClick={() => setOpen(true)} />
      {open && <FamilyScreen onClose={() => setOpen(false)} />}
    </>
  );
}

const split = (s: string) => [...new Set(s.split(/[,，、\n]/).map((x) => x.trim()).filter(Boolean))];
const summary = (xs: string[], n = 2) => (xs.length === 0 ? "없음" : xs.length <= n ? xs.join(", ") : `${xs.slice(0, n).join(", ")} 외 ${xs.length - n}개`);

function Row({ title, sub, right, onClick, danger, icon }: { title: ReactNode; sub?: ReactNode; right?: ReactNode; onClick?: () => void; danger?: boolean; icon?: ReactNode }) {
  const body = (
    <>
      {icon && <span aria-hidden className={`shrink-0 ${danger ? "text-danger" : "text-ink-2"}`}>{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className={`block text-body ${danger ? "text-danger" : "text-ink"}`}>{title}</span>
        {sub && <span className="mt-0.5 block truncate text-caption text-ink-3">{sub}</span>}
      </span>
      {right}
    </>
  );
  return (
    <li className={rowLinePlain}>
      {onClick
        ? <button type="button" onClick={onClick} className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left transition-colors active:bg-surface-2">{body}</button>
        : <div className="flex min-h-14 items-center gap-3 px-4 py-2">{body}</div>}
    </li>
  );
}

type ListKey = "dislikes" | "staples";
const LIST_INFO: Record<ListKey, { title: string; placeholder: string; helper: string }> = {
  dislikes: { title: "싫어하는 재료", placeholder: "쉼표로: 고수, 오이", helper: "AI 레시피·추천에서 늘 빠져요" },
  staples: { title: "늘 있는 양념", placeholder: "소금, 설탕, 간장", helper: "냉장고에 없어도 있는 것으로 봐요" },
};

/** 우리 가족: 초대 코드, AI 취향(바뀔 때마다 저장), 사용량, 계정 */
export function FamilyScreen({ onClose }: { onClose: () => void }) {
  const { family, leaveToSwitch, updateProfile } = useFamily();
  const { signOut, user } = useAuth();
  const toast = useToast();
  const [p, setP] = useState<FamilyProfile | null>(family?.profile ?? null);
  const [editing, setEditing] = useState<ListKey | null>(null);
  const [left, setLeft] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // 아직 보내지 않은 변경 (인분 +를 누르고 곧바로 닫아도 저장되게)
  const pending = useRef<FamilyProfile | null>(null);

  useEffect(() => {
    if (!workerConfigured) return;
    let alive = true;
    getWorker<{ today: { remaining: number } | null }>("/usage")
      .then((r) => { if (alive) setLeft(r.today ? Math.floor(r.today.remaining) : null); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  useEffect(() => () => {
    clearTimeout(timer.current);
    if (pending.current) void settle(updateProfile(pending.current)).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!family || !p) return null;

  const save = (next: FamilyProfile, wait = 0) => {
    setP(next);
    clearTimeout(timer.current);
    pending.current = next;
    timer.current = setTimeout(() => {
      pending.current = null;
      settle(updateProfile(next))
        .then(() => toast.show("저장했어요", { kind: "done" }))
        .catch((e) => toast.show(`저장하지 못했어요: ${writeErrorMessage(e)}`, { kind: "error" }));
    }, wait);
  };

  const copy = async () => {
    try { await navigator.clipboard.writeText(family.inviteCode); toast.show("초대 코드를 복사했어요", { kind: "done" }); }
    catch { toast.show("복사하지 못했어요. 코드를 직접 알려 주세요", { kind: "error" }); }
  };
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const share = () => navigator.share({ text: `우리집 요리 초대 코드: ${family.inviteCode}` }).catch(() => {});

  return (
    <FullScreen title="우리 가족" onClose={onClose} canvas>
      <div className="px-5 pb-4 pt-2">
        <p className="text-title1 text-ink">{family.name}</p>
        <p className="text-caption text-ink-3">구성원 {family.members.length}명</p>
      </div>

      <Card className="mx-5 p-4">
        <p className="text-caption font-semibold text-ink-3">초대 코드</p>
        <p className="mt-1 text-title1 tracking-[0.2em] tabular-nums" data-testid="invite-code">{family.inviteCode}</p>
        <p className="mt-1 text-caption text-ink-3">가족에게 알려 주면 같은 냉장고를 써요</p>
        <div className={`mt-3 grid gap-2 ${canShare ? "grid-cols-2" : "grid-cols-1"}`}>
          <Button variant="secondary" size="md" icon={<Copy size={20} aria-hidden />} onClick={copy}>복사</Button>
          {canShare && <Button variant="secondary" size="md" icon={<Share2 size={20} aria-hidden />} onClick={share}>보내기</Button>}
        </div>
      </Card>

      <GroupLabel className="pt-7">AI 레시피 취향</GroupLabel>
      <Card className="mx-5 overflow-hidden">
        <ul>
          <Row title="기본 인분" right={<Stepper value={p.defaultServings} min={1} max={20} onChange={(v) => save({ ...p, defaultServings: v }, 600)} />} />
          <Row title="맵기" right={
            <SegmentedControl label="맵기" className="w-[204px]" value={p.spicyLevel}
              options={(["순한맛", "보통", "매운맛"] as const).map((v) => ({ value: v, label: v }))}
              onChange={(v) => save({ ...p, spicyLevel: v })} />} />
          <Row title="아이와 함께 먹어요" right={<Switch label="아이와 함께 먹어요" checked={p.kidsFriendly} onChange={(v) => save({ ...p, kidsFriendly: v })} />} />
          <Row title="싫어하는 재료" onClick={() => setEditing("dislikes")}
            right={<><span className="max-w-[45%] truncate text-callout text-ink-2">{summary(p.dislikes)}</span><ChevronRight size={20} aria-hidden className="shrink-0 text-ink-3" /></>} />
          <Row title="늘 있는 양념" onClick={() => setEditing("staples")}
            right={<><span className="max-w-[45%] truncate text-callout text-ink-2">{summary(p.staples)}</span><ChevronRight size={20} aria-hidden className="shrink-0 text-ink-3" /></>} />
        </ul>
      </Card>

      {left != null && (
        <>
          <GroupLabel className="pt-7">사용량</GroupLabel>
          <Card className="mx-5 overflow-hidden">
            <ul><Row title="오늘 남은 AI 사용" right={<span className="text-callout text-ink-2 tabular-nums" data-testid="usage-left">{left}회</span>} /></ul>
          </Card>
        </>
      )}

      <GroupLabel className="pt-7">계정</GroupLabel>
      <Card className="mx-5 overflow-hidden">
        <ul>
          <Row icon={<UserRound size={20} />} title={user?.displayName ?? "나"} sub={user?.email} />
          <Row icon={<ArrowLeftRight size={20} />} title="다른 가족으로 전환" onClick={async () => {
            if (!window.confirm("다른 가족으로 바꿀까요? 데이터는 그대로 남아요")) return;
            await leaveToSwitch();
            onClose();
          }} />
          <Row icon={<LogOut size={20} />} title="로그아웃" danger onClick={signOut} />
        </ul>
      </Card>

      {editing && <ListSheet k={editing} initial={p[editing]} onClose={() => setEditing(null)} onSave={(xs) => { save({ ...p, [editing]: xs }); setEditing(null); }} />}
    </FullScreen>
  );
}

function ListSheet({ k, initial, onClose, onSave }: { k: ListKey; initial: string[]; onClose: () => void; onSave: (xs: string[]) => void }) {
  const info = LIST_INFO[k];
  const [text, setText] = useState(initial.join(", "));
  return (
    <Sheet title={info.title} onClose={onClose} footer={<Button block onClick={() => onSave(split(text))}>저장</Button>}>
      <TextField aria-label={info.title} placeholder={info.placeholder} helper={info.helper} value={text} autoFocus
        onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) onSave(split(text)); }} />
    </Sheet>
  );
}
