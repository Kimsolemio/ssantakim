/** AI 제공자 공통 인터페이스. 제공자를 바꿔도 나머지 코드는 그대로 둔다. */

export class GenerationError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export type ImageMediaType = "image/jpeg" | "image/png" | "image/webp" | "image/gif";

/** 사용자 메시지 조각: 글 또는 사진(base64). 사진은 5·6단계(스크린샷·냉장고 사진)에서 쓴다. */
export type AiPart =
  | { type: "text"; text: string }
  | { type: "image"; mediaType: ImageMediaType; data: string };

export type JsonRequest = {
  system: string;
  parts: AiPart[];
  /** 응답이 따라야 할 JSON 스키마 (sanitizeSchemaForAi 를 거친 것) */
  schema: Record<string, unknown>;
  /** 생각의 깊이. 간단한 작업(재료 정리 등)은 low */
  effort?: "low" | "medium" | "high";
  maxTokens?: number;
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
}

/** 전역 fetch를 호출 시점에 찾는다 (테스트에서 바꿔 끼우기 쉽게) */
export const lazyFetch: typeof fetch = (input, init) => globalThis.fetch(input, init);
