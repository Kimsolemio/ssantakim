/**
 * Firebase ID 토큰 검증 (firebase-admin 없이 WebCrypto로).
 * 규칙: https://firebase.google.com/docs/auth/admin/verify-id-tokens#verify_id_tokens_using_a_third-party_jwt_library
 */
export type Verified = { uid: string; email: string | null; name: string | null };

type Jwk = JsonWebKey & { kid: string };
type JwksFetcher = () => Promise<Jwk[]>;

const JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

let cache: { keys: Jwk[]; expiresAt: number } | null = null;

export const defaultJwksFetcher: JwksFetcher = async () => {
  if (cache && cache.expiresAt > Date.now()) return cache.keys;
  const res = await fetch(JWKS_URL);
  if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
  const body = (await res.json()) as { keys: Jwk[] };
  const cc = res.headers.get("cache-control") ?? "";
  const m = /max-age=(\d+)/.exec(cc);
  const ttl = m ? Number(m[1]) * 1000 : 60 * 60 * 1000;
  cache = { keys: body.keys, expiresAt: Date.now() + ttl };
  return body.keys;
};

function b64urlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function decodeJson(seg: string): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(seg))) as Record<string, unknown>;
}

export class AuthError extends Error {}

export async function verifyFirebaseIdToken(
  token: string,
  projectId: string,
  fetchJwks: JwksFetcher = defaultJwksFetcher,
  now: number = Math.floor(Date.now() / 1000),
): Promise<Verified> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new AuthError("토큰 형식 오류");
  const header = decodeJson(parts[0]);
  const payload = decodeJson(parts[1]);
  if (header.alg !== "RS256" || typeof header.kid !== "string") throw new AuthError("지원하지 않는 토큰");

  const keys = await fetchJwks();
  let jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) {
    cache = null; // 키 회전 가능성 → 한 번 더
    jwk = (await fetchJwks()).find((k) => k.kid === header.kid);
    if (!jwk) throw new AuthError("토큰 서명 키를 찾을 수 없음");
  }

  const key = await crypto.subtle.importKey(
    "jwk", { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"],
  );
  const data = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlToBytes(parts[2]), data);
  if (!ok) throw new AuthError("토큰 서명 불일치");

  const exp = Number(payload.exp), iat = Number(payload.iat), authTime = Number(payload.auth_time ?? 0);
  if (!(exp > now)) throw new AuthError("토큰 만료");
  if (!(iat <= now + 300)) throw new AuthError("토큰 발급 시각 오류");
  if (authTime && !(authTime <= now + 300)) throw new AuthError("토큰 인증 시각 오류");
  if (payload.aud !== projectId) throw new AuthError("토큰 대상(aud) 불일치");
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) throw new AuthError("토큰 발급자(iss) 불일치");
  const sub = payload.sub;
  if (typeof sub !== "string" || !sub) throw new AuthError("토큰 subject 오류");

  return {
    uid: sub,
    email: typeof payload.email === "string" ? payload.email : null,
    name: typeof payload.name === "string" ? payload.name : null,
  };
}
