import { afterEach, describe, expect, it } from "vitest";
import { familyAllowed, resetFamilyMemo } from "../src/guard";

const user = { uid: "uid-1", email: "me@example.com", emailVerified: true, name: null };
const doc = (emails: Record<string, string>) => new Response(JSON.stringify({
  fields: {
    members: { arrayValue: { values: [{ stringValue: "uid-owner" }, { stringValue: "uid-1" }] } },
    memberEmails: { mapValue: { fields: Object.fromEntries(Object.entries(emails).map(([k, v]) => [k, { stringValue: v }])) } },
  },
}));
const proof = (respond: () => Response) => {
  let n = 0;
  return { proof: { projectId: "p", idToken: "t", familyId: "fam-1", fetch: (async () => { n++; return respond(); }) as typeof fetch }, count: () => n };
};
afterEach(() => resetFamilyMemo());

describe("familyAllowed timing", () => {
  it("re-checks a family without an allowed member after 15 s (owner may have just opened the app)", async () => {
    let emails: Record<string, string> = {};
    const p = proof(() => doc(emails));
    expect(await familyAllowed(["owner@example.com"], user, p.proof, 0)).toBe(false);
    emails = { "uid-owner": "owner@example.com" };
    expect(await familyAllowed(["owner@example.com"], user, p.proof, 10_000)).toBe(false); // 아직 기억한 거절
    expect(await familyAllowed(["owner@example.com"], user, p.proof, 16_000)).toBe(true);
    expect(p.count()).toBe(2);
  });
  it("keeps outsiders (read refused) out for a minute", async () => {
    const p = proof(() => new Response("{}", { status: 403 }));
    expect(await familyAllowed(["owner@example.com"], user, p.proof, 0)).toBe(false);
    expect(await familyAllowed(["owner@example.com"], user, p.proof, 59_000)).toBe(false);
    expect(p.count()).toBe(1);
  });
  it("treats an unreadable body as 'try again', not as a denial", async () => {
    const p = proof(() => new Response("not json"));
    await expect(familyAllowed(["owner@example.com"], user, p.proof, 0)).rejects.toThrow();
  });
});
