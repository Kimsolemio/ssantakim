import { useState } from "react";
import { Lock } from "lucide-react";
import { useAiInfo } from "../lib/aiInfo";
import { Sheet } from "./Sheet";

/** "사진" → "사진은", "글(유튜브 포함)" → "글(유튜브 포함)은" (괄호 앞 글자로 받침을 본다) */
function withTopic(word: string): string {
  const base = word.replace(/\([^)]*\)\s*$/, "").trim();
  const code = base.charCodeAt(base.length - 1) - 0xac00;
  const batchim = code >= 0 && code < 11172 && code % 28 !== 0;
  return `${word}${batchim ? "은" : "는"}`;
}

type Kind = "default" | "link" | "fridge";

/** AI로 무엇이 가는지 1줄로 알린다. "자세히"에 긴 설명. 주 버튼 바로 위 한 곳에만 둔다 */
export function AiNotice({ what, kind = "default", webSearch, video, extra, className = "" }: {
  /** 보내는 것 (자세히 안내에 씀) */
  what: string; kind?: Kind; webSearch?: boolean;
  /** 유튜브 영상 분석 경로가 있으면 (영상은 Gemini로만 볼 수 있다) */
  video?: boolean;
  /** 짧은 문구 뒤에 붙일 한 마디 (예: "사진은 저장하지 않아요.") */
  extra?: string; className?: string;
}) {
  const { provider, gemini } = useAiInfo();
  const [more, setMore] = useState(false);
  const short = provider === "gemini"
    ? "Google 무료 AI로 보내요. 사람이 볼 수 있으니 개인정보는 가려 주세요."
    : provider === "claude"
      ? kind === "link" ? "주소를 Claude에게 보내 페이지를 직접 읽어요. 학습에는 쓰이지 않아요."
        : kind === "fridge" ? "냉장고 목록과 함께 Claude에게 보내요. 학습에는 쓰이지 않아요."
          : `Anthropic AI(Claude)로 보내요. 학습에는 쓰이지 않아요.${webSearch ? " 웹 검색도 함께 해요." : ""}`
      : "AI 서버로 보내요. 앱에는 결과만 저장해요.";
  const subject = withTopic(what);
  const long = provider === "gemini"
    ? `${subject} 분석을 위해 Google(Gemini 무료 등급)로 보내져요. 무료 등급은 Google이 서비스 개선에 쓸 수 있고 사람이 볼 수도 있으니, 이름·주소·카드번호 같은 개인정보는 가리고 올려 주세요.`
    : provider === "claude"
      ? `${subject} 분석을 위해 Anthropic(Claude)으로 보내져요. API로 보낸 내용은 AI 학습에 쓰이지 않아요. 앱에는 결과만 저장해요.`
      : `${subject} 분석을 위해 AI 회사 서버로 보내져요. 앱에는 결과만 저장해요.`;
  const videoNote = video && provider === "claude" && gemini
    ? "설명란에 레시피가 없는 유튜브 영상은 Google(Gemini 무료 등급)이 영상을 보고 정리해요." : null;
  const searchNote = webSearch && provider === "claude"
    ? "웹 검색을 켜면 Claude가 요리 이름으로 인기 레시피를 찾아보고, 참고한 곳을 레시피에 함께 남겨요." : null;
  return (
    <>
      <p className={`flex items-start gap-1.5 text-caption text-ink-3 ${className}`} data-testid="ai-notice">
        <Lock size={14} aria-hidden className="mt-0.5 shrink-0" />
        <span>{short}{extra ? ` ${extra}` : ""} <button type="button" onClick={() => setMore(true)} className="font-semibold text-ink-2 active:opacity-60">자세히</button></span>
      </p>
      {more && (
        <Sheet title="AI로 보내는 내용" onClose={() => setMore(false)} top>
          <div className="space-y-3 text-body text-ink-2">
            <p>{long}</p>
            {searchNote && <p>{searchNote}</p>}
            {videoNote && <p>{videoNote}</p>}
          </div>
        </Sheet>
      )}
    </>
  );
}
