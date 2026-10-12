import { webcrypto } from "node:crypto";

export const PROJECT = "test-project";
const b64url = (buf: ArrayBuffer | Uint8Array | string) => Buffer.from(typeof buf === "string" ? buf : new Uint8Array(buf as ArrayBuffer)).toString("base64url");

/** 테스트용 RSA 키로 Firebase 형식의 ID 토큰을 만든다 */
export async function makeSigner() {
  const { publicKey, privateKey } = await webcrypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const jwk = await webcrypto.subtle.exportKey("jwk", publicKey);
  const kid = "kid-1";
  const jwks = [{ kty: jwk.kty!, n: jwk.n!, e: jwk.e!, kid, alg: "RS256", use: "sig" }];
  const now = Math.floor(Date.now() / 1000);
  async function token(overrides: Record<string, unknown> = {}, opts: { kid?: string; badSig?: boolean } = {}) {
    const header = { alg: "RS256", kid: opts.kid ?? kid, typ: "JWT" };
    const payload = { iss: `https://securetoken.google.com/${PROJECT}`, aud: PROJECT, auth_time: now - 10, sub: "uid-1",
      iat: now - 10, exp: now + 3600, email: "me@example.com", name: "Tester", ...overrides };
    const h = b64url(JSON.stringify(header)), p = b64url(JSON.stringify(payload));
    const sig = await webcrypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, new TextEncoder().encode(`${h}.${p}`));
    return `${h}.${p}.${opts.badSig ? b64url(new Uint8Array(256)) : b64url(sig)}`;
  }
  return { jwks, token, now };
}

export const SAMPLE_RECIPE = {
  title: "알리오올리오", source: { type: "generated" }, servingsBase: 2, timeMinutes: 20, difficulty: "쉬움",
  tags: ["파스타"], tips: ["면수를 버리지 마세요"],
  ingredients: [
    { name: "스파게티면", key: "spaghetti", qty: 200, unit: "g", scalable: true, optional: false, group: "주재료" },
    { name: "소금", key: "salt", qty: null, unit: "기타", scalable: false, optional: false, group: "양념", note: "약간" },
  ],
  steps: [{ order: 1, text: "면을 삶는다", minutes: 9, ingredientKeys: ["spaghetti", "salt"] }],
};

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

export function claudeMessage(text: string, extra: Record<string, unknown> = {}) {
  return {
    id: "msg_test", type: "message", role: "assistant", model: "claude-opus-5-5",
    content: [{ type: "thinking", thinking: "", signature: "sig" }, { type: "text", text }],
    stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1200, output_tokens: 2400 }, ...extra,
  };
}
