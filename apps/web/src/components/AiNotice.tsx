import { useAiInfo } from "../lib/aiInfo";

/** "사진" → "사진은", "글(유튜브 포함)" → "글(유튜브 포함)은" (괄호 앞 글자로 받침을 본다) */
function withTopic(word: string): string {
  const base = word.replace(/\([^)]*\)\s*$/, "").trim();
  const code = base.charCodeAt(base.length - 1) - 0xac00;
  const batchim = code >= 0 && code < 11172 && code % 28 !== 0;
  return `${word}${batchim ? "은" : "는"}`;
}

/** AI에 무엇이 보내지는지 알린다. Gemini 무료 등급은 Google이 내용을 서비스 개선에 쓸 수 있어 더 분명히 알린다 */
export function AiNotice({ what, video }: { what: string; /** 유튜브 영상 분석 경로가 있으면 (영상은 Gemini로만 볼 수 있다) */ video?: boolean }) {
  const { provider, gemini } = useAiInfo();
  const subject = withTopic(what);
  const text = provider === "gemini"
    ? `${subject} 분석을 위해 Google(Gemini 무료 등급)로 보내져요. 무료 등급은 Google이 서비스 개선에 쓸 수 있고 사람이 볼 수도 있으니, 이름·주소·카드번호 같은 개인정보는 가리고 올려 주세요.`
    : provider === "claude"
      ? `${subject} 분석을 위해 Anthropic(Claude)으로 보내져요. API로 보낸 내용은 AI 학습에 쓰이지 않아요. 앱에는 결과만 저장해요.`
      : `${subject} 분석을 위해 AI 회사 서버로 보내져요. 앱에는 결과만 저장해요.`;
  const videoNote = video && provider === "claude" && gemini
    ? " 단, 설명란에 레시피가 없는 유튜브 영상은 Google(Gemini 무료 등급)이 영상을 보고 정리해요." : "";
  return <p className="text-center text-xs leading-relaxed text-gray-400" data-testid="ai-notice">🔒 {text}{videoNote}</p>;
}
