import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import handler, { type Env } from "../src/index";
import { makeSigner, PROJECT, jsonResponse, claudeMessage } from "./helpers";

let signer: Awaited<ReturnType<typeof makeSigner>>;
let token: string;
function stubFetch(route: (body: any) => Response) {
  const bodies: any[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    if (req.url.startsWith("https://www.googleapis.com/service_accounts/v1/jwk/")) return jsonResponse({ keys: signer.jwks }, 200, { "cache-control": "max-age=3600" });
    const b = JSON.parse(await req.text()); bodies.push(b); return route(b);
  });
  return bodies;
}
const env: Env = { FIREBASE_PROJECT_ID: PROJECT, ALLOWED_ORIGINS: "http://localhost:5173", ANTHROPIC_API_KEY: "sk-ant-test" };
const post = (body: unknown) => handler.fetch!(new Request("https://api.test/normalize", {
  method: "POST", body: JSON.stringify(body), headers: { Origin: "http://localhost:5173", Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
}) as any, env, {} as any);

beforeAll(async () => { signer = await makeSigner(); token = await signer.token(); });
afterEach(() => vi.unstubAllGlobals());

describe("/normalize", () => {
  it("returns AI keys in input order with low effort", async () => {
    const bodies = stubFetch(() => jsonResponse(claudeMessage(JSON.stringify({ items: [{ name: "깐마늘", key: "garlic" }, { name: "서울우유", key: "milk" }] }))));
    const r = await post({ names: ["깐마늘", "서울우유"] });
    expect(r.status).toBe(200);
    expect((await r.json() as any).items).toEqual([{ name: "깐마늘", key: "garlic" }, { name: "서울우유", key: "milk" }]);
    expect(bodies[0].output_config.effort).toBe("low");
    expect(bodies[0].messages[0].content[0].text).toBe("1. 깐마늘\n2. 서울우유");
  });
  it("falls back to a provisional key when the AI skips or garbles an item", async () => {
    stubFetch(() => jsonResponse(claudeMessage(JSON.stringify({ items: [{ name: "서울우유", key: "Milk Carton!" }] }))));
    const j = await (await post({ names: ["대파", "서울우유"] })).json() as any;
    expect(j.items).toEqual([{ name: "대파", key: "대파" }, { name: "서울우유", key: "서울우유" }]);
  });
  it("validates input", async () => {
    stubFetch(() => jsonResponse({}, 500));
    expect((await post({ names: [] })).status).toBe(400);
    expect((await post({ names: Array(41).fill("a") })).status).toBe(400);
  });
});
