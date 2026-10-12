import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import handler, { type Env } from "../src/index";
import { makeSigner, PROJECT, SAMPLE_SCAN, FAKE_IMAGE, jsonResponse, claudeMessage } from "./helpers";

let signer: Awaited<ReturnType<typeof makeSigner>>;
let token: string;
type Captured = { url: string; headers: Headers; body: any };

function stubFetch(route: (c: Captured) => Response) {
  const calls: Captured[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    if (req.url.startsWith("https://www.googleapis.com/service_accounts/v1/jwk/")) return jsonResponse({ keys: signer.jwks }, 200, { "cache-control": "max-age=3600" });
    const text = await req.text();
    const c = { url: req.url, headers: req.headers, body: text ? JSON.parse(text) : null };
    calls.push(c);
    return route(c);
  });
  return calls;
}

const env: Env = { FIREBASE_PROJECT_ID: PROJECT, ALLOWED_ORIGINS: "http://localhost:5173", ALLOWED_EMAILS: "me@example.com", ANTHROPIC_API_KEY: "sk-ant-test" };
const post = (body: unknown, e: Env = env) => handler.fetch!(new Request("https://api.test/pantry/receipt", {
  method: "POST", body: typeof body === "string" ? body : JSON.stringify(body),
  headers: { Origin: "http://localhost:5173", Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
}) as any, e, {} as any);

beforeAll(async () => { signer = await makeSigner(); token = await signer.token(); });
afterEach(() => vi.unstubAllGlobals());

describe("/pantry/receipt", () => {
  it("sends the photos to Claude as image blocks and returns parsed items", async () => {
    const calls = stubFetch(() => jsonResponse(claudeMessage(JSON.stringify(SAMPLE_SCAN))));
    const r = await post({ today: "2026-10-12", images: [{ mediaType: "image/jpeg", data: FAKE_IMAGE }, { mediaType: "image/png", data: FAKE_IMAGE }] });
    expect(r.status).toBe(200);
    const j = await r.json() as any;
    expect(j.provider).toBe("claude");
    expect(j.scan.items).toHaveLength(4);
    expect(j.scan.items[2]).toMatchObject({ name: "만두", location: "냉동", category: "냉동식품" });

    const content = calls[0].body.messages[0].content;
    expect(content.slice(0, 2)).toEqual([
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: FAKE_IMAGE } },
      { type: "image", source: { type: "base64", media_type: "image/png", data: FAKE_IMAGE } },
    ]);
    expect(content[2].type).toBe("text");
    expect(content[2].text).toContain("오늘 날짜: 2026-10-12");
    expect(content[2].text).toContain("사진 2장");
    expect(calls[0].body.system).toContain("영수증");
    const schema = calls[0].body.output_config.format.schema;
    expect(schema.properties.items.items.properties.category.enum).toContain("냉동식품");
  });

  it("works with Gemini too (inline image data)", async () => {
    const calls = stubFetch(() => jsonResponse({ candidates: [{ content: { parts: [{ text: JSON.stringify(SAMPLE_SCAN) }] }, finishReason: "STOP" }] }));
    const r = await post({ today: "2026-10-12", images: [{ mediaType: "image/jpeg", data: FAKE_IMAGE }] }, { ...env, ANTHROPIC_API_KEY: undefined, GEMINI_API_KEY: "g" });
    expect(r.status).toBe(200);
    expect(calls[0].body.contents[0].parts[0]).toEqual({ inlineData: { mimeType: "image/jpeg", data: FAKE_IMAGE } });
  });

  it("validates the request", async () => {
    stubFetch(() => jsonResponse({}, 500));
    const bad: [unknown, number, RegExp][] = [
      [{ today: "2026-10-12", images: [] }, 400, /사진이 필요합니다/],
      [{ today: "2026-10-12", images: Array(5).fill({ mediaType: "image/jpeg", data: FAKE_IMAGE }) }, 400, /4장까지/],
      [{ today: "2026-10-12", images: [{ mediaType: "image/heic", data: FAKE_IMAGE }] }, 400, /mediaType/],
      [{ today: "2026-10-12", images: [{ mediaType: "image/jpeg", data: "data:image/jpeg;base64," + FAKE_IMAGE }] }, 400, /base64/],
      [{ today: "어제", images: [{ mediaType: "image/jpeg", data: FAKE_IMAGE }] }, 400, /today/],
      [{ today: "2026-10-12", images: [{ mediaType: "image/jpeg", data: "A".repeat(5 * 1024 * 1024 * 4 / 3 + 1000) }] }, 400, /너무 큽니다/],
    ];
    for (const [body, status, msg] of bad) {
      const r = await post(body);
      expect(r.status, String(msg)).toBe(status);
      expect((await r.json() as any).error).toMatch(msg);
    }
    const huge = await post({ today: "2026-10-12", images: [{ mediaType: "image/jpeg", data: "A".repeat(12_100_000) }] });
    expect(huge.status).toBe(413);
  });

  it("requires login", async () => {
    const r = await handler.fetch!(new Request("https://api.test/pantry/receipt", { method: "POST", body: "{}" }) as any, env, {} as any);
    expect(r.status).toBe(401);
  });

  it("rejects AI output that breaks the schema", async () => {
    stubFetch(() => jsonResponse(claudeMessage(JSON.stringify({ ...SAMPLE_SCAN, items: [{ ...SAMPLE_SCAN.items[0], location: "베란다" }] }))));
    const r = await post({ today: "2026-10-12", images: [{ mediaType: "image/jpeg", data: FAKE_IMAGE }] });
    expect(r.status).toBe(502);
    expect((await r.json() as any).error).toMatch(/형식에 맞지 않습니다/);
  });
});
