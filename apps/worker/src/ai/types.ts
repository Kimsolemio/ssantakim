/** AI 제공자 공통 인터페이스. 제공자를 바꿔도 나머지 코드는 그대로 둔다. */

export class GenerationError extends Error {
  /** code: 화면이 다르게 반응해야 하는 경우 (예: instagram → 캡션 입력으로 전환) */
  constructor(message: string, public status: number, public code?: string) { super(message); }
  /** AI가 이미 답을 만들어 요금이 나간 실패 (잘림·거절·형식 오류). 하루 사용량을 돌려주지 않는다 */
  billed = false;
}

/** 요금이 나간 실패로 표시 */
export function billedError(message: string, status: number): GenerationError {
  const e = new GenerationError(message, status);
  e.billed = true;
  return e;
}

export type ImageMediaType = "image/jpeg" | "image/png" | "image/webp" | "image/gif";

/** 사용자 메시지 조각: 글 또는 사진(base64). 사진은 5·6단계(스크린샷·냉장고 사진)에서 쓴다. */
export type AiPart =
  | { type: "text"; text: string }
  | { type: "image"; mediaType: ImageMediaType; data: string }
  /** 유튜브 영상 자체 (Gemini만 이해할 수 있다) */
  | { type: "youtube"; url: string };

export type JsonRequest = {
  system: string;
  parts: AiPart[];
  /** 응답이 따라야 할 JSON 스키마 (sanitizeSchemaForAi 를 거친 것) */
  schema: Record<string, unknown>;
  /** 생각의 깊이. 간단한 작업(재료 정리 등)은 low */
  effort?: "low" | "medium" | "high";
  maxTokens?: number;
  /**
   * 같은 지시문(system)을 짧은 간격으로 여러 번 보내는 기능(물어보기 대화, 다른 메뉴로, 이름 정리)이면 true.
   * Claude 프롬프트 캐시로 지시문 입력 비용을 크게 줄인다 (5분 유지).
   */
  cache?: boolean;
};

/** 웹에서 자료 찾기 (Claude 웹 검색·웹 읽기 도구). 결과는 자유 글 + 출처 */
export type ResearchRequest = {
  system: string;
  prompt: string;
  /** 웹 검색 최대 횟수 (0 이면 검색하지 않음) */
  searches: number;
  /** 웹 페이지 읽기 최대 횟수 (0 이면 읽지 않음). 주소는 prompt 에 들어 있어야 읽을 수 있다 */
  fetches: number;
  maxTokens?: number;
};
export type ResearchResult = {
  text: string;
  sources: { url: string; title: string | null }[];
  searches: number;
  model: string;
  usage: { input: number; output: number };
};

export type JsonResult = {
  text: string;
  /** 실제로 응답한 모델 (대체 모델이 응답했을 수도 있다) */
  model: string;
  usage: { input: number; output: number };
};

export type ProviderName = "claude" | "gemini";

export interface AiProvider {
  name: ProviderName;
  model: string;
  generateJson(req: JsonRequest): Promise<JsonResult>;
  /** Claude만: 웹 검색·웹 읽기로 자료를 모은다 */
  research?(req: ResearchRequest): Promise<ResearchResult>;
}

/** 무거운 일(레시피·영수증·가져오기)은 main, 가볍고 잦은 일(이름 정리·물어보기·대체 재료)은 fast */
export type AiTier = "main" | "fast";

/** 전역 fetch를 호출 시점에 찾는다 (테스트에서 바꿔 끼우기 쉽게) */
export const lazyFetch: typeof fetch = (input, init) => globalThis.fetch(input, init);
