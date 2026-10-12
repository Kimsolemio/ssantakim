import { describe, expect, it } from "vitest";
import { verifyFirebaseIdToken, AuthError } from "../src/auth";
import { makeSigner, PROJECT } from "./helpers";

describe("verifyFirebaseIdToken", async () => {
  const { jwks, token, now } = await makeSigner();
  const fetchJwks = async () => jwks;

  it("accepts a valid token", async () => {
    expect(await verifyFirebaseIdToken(await token(), PROJECT, fetchJwks)).toEqual({ uid: "uid-1", email: "me@example.com", emailVerified: true, name: "Tester" });
  });
  it("reports an unverified email", async () => {
    expect((await verifyFirebaseIdToken(await token({ email_verified: false }), PROJECT, fetchJwks)).emailVerified).toBe(false);
  });

  const bad: [string, () => Promise<string>][] = [
    ["expired", () => token({ exp: now - 1 })],
    ["wrong audience", () => token({ aud: "other" })],
    ["wrong issuer", () => token({ iss: "https://securetoken.google.com/other" })],
    ["empty subject", () => token({ sub: "" })],
    ["bad signature", () => token({}, { badSig: true })],
    ["unknown key id", () => token({}, { kid: "nope" })],
    ["garbage", async () => "abc.def"],
  ];
  for (const [label, make] of bad) {
    it(`rejects ${label}`, async () => {
      await expect(verifyFirebaseIdToken(await make(), PROJECT, fetchJwks)).rejects.toBeInstanceOf(AuthError);
    });
  }
});
