/**
 * 오프라인 E2E: 빌드한 앱(서비스워커 포함)에서 인터넷을 끊고 새로 고쳐도
 * 저장한 레시피·냉장고가 보이고, 끊긴 동안 고친 것은 연결되면 다른 기기에도 보이는지 확인한다.
 * 준비: 에뮬레이터 + 가짜 Worker(e2e/mock-worker.mjs) +
 *   (cd apps/web && cp ../../e2e/.env.emulator .env && pnpm build && npx vite preview --host 127.0.0.1 --port 4173 --strictPort)
 * 실행: node e2e/offline.mjs
 */
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const APP = "http://127.0.0.1:4173/";
const shots = join(dirname(fileURLToPath(import.meta.url)), "shots");
mkdirSync(shots, { recursive: true });
async function waitFor(url, label) {
  for (let i = 0; i < 60; i++) { try { const r = await fetch(url); if (r.status < 500) return; } catch {} await new Promise((r) => setTimeout(r, 1000)); }
  throw new Error(`${label} not ready`);
}
await waitFor("http://127.0.0.1:9099/", "auth emulator");
await waitFor("http://127.0.0.1:8080/", "firestore emulator");
await waitFor(APP, "vite preview");

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const errors = [];
const email = `offline-${Date.now()}@test.local`;
async function device() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  await page.goto(APP);
  await page.getByText("Google로 시작하기").waitFor({ timeout: 20000 });
  await page.evaluate(([e]) => window.__cookTest.signInAs(e, "오프"), [email]);
  return { ctx, page };
}
const fail = async (page, err) => {
  console.error("FAILED:", err.message);
  try { await page.screenshot({ path: `${shots}/offline-failure.png` }); } catch {}
  await browser.close(); process.exit(1);
};

const { ctx, page } = await device();
try {
  await page.getByText("새 가족 만들기").click();
  await page.getByPlaceholder("가족 이름 (예: 김씨네)").fill("오프라인네");
  await page.getByText("만들기", { exact: true }).click();
  await page.getByRole("heading", { name: "레시피" }).waitFor();
  // 레시피 하나 (가짜 AI)
  await page.getByTestId("open-generate").click();
  await page.getByPlaceholder(/알리오올리오/).fill("오프라인 파스타");
  await page.getByRole("button", { name: "레시피 만들기", exact: true }).click();
  await page.getByText("레시피 확인·수정").waitFor({ timeout: 20000 });
  await page.getByText("저장", { exact: true }).click();
  await page.getByRole("heading", { name: "재료", exact: true }).waitFor();
  await page.getByLabel("뒤로").click();
  // 냉장고에 하나
  await page.locator("nav").getByText("냉장고", { exact: true }).click();
  await page.getByRole("button", { name: "직접 추가" }).click();
  await page.getByPlaceholder("재료 이름 (예: 대파)").fill("두부");
  await page.getByPlaceholder("수량").fill("1");
  await page.getByText("저장", { exact: true }).click();
  await page.getByLabel(/^두부 1/).first().waitFor();

  // 서비스워커가 이 페이지를 맡게 한 뒤 (처음 연 페이지는 아직 맡지 않는다)
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 });
  await page.getByRole("heading", { name: "레시피" }).waitFor({ timeout: 20000 });

  // ---------- 인터넷을 끊고 새로 고침 ----------
  await ctx.setOffline(true);
  await page.reload();
  await page.getByRole("heading", { name: "레시피" }).waitFor({ timeout: 20000 });
  await page.getByTestId("offline-pill").waitFor();
  await page.locator("li", { hasText: "오프라인 파스타" }).first().click();
  await page.getByRole("heading", { name: "재료", exact: true }).waitFor();
  await page.screenshot({ path: `${shots}/30-offline-detail.png` });
  await page.getByLabel("뒤로").click();
  await page.locator("nav").getByText("냉장고", { exact: true }).click();
  await page.getByLabel(/^두부 1/).first().waitFor();
  // 끊긴 채로 고쳐도 바로 보인다
  await page.getByRole("button", { name: "채우기", exact: true }).click();
  await page.getByText("직접 추가").click();
  await page.getByPlaceholder("재료 이름 (예: 대파)").fill("양파");
  await page.getByPlaceholder("수량").fill("2");
  await page.getByText("저장", { exact: true }).click();
  await page.getByLabel(/^양파 2/).first().waitFor({ timeout: 10000 });
  await page.screenshot({ path: `${shots}/31-offline-fridge.png` });
  // AI는 기다리지 않고 바로 알려 준다
  await page.locator("nav").getByText("레시피", { exact: true }).click();
  await page.getByRole("button", { name: "레시피 추가" }).click();
  await page.getByTestId("open-generate").click();
  await page.getByPlaceholder(/알리오올리오/).fill("김치볶음밥");
  await page.getByRole("button", { name: "레시피 만들기", exact: true }).click();
  await page.getByText(/인터넷이 끊겨 있어요/).waitFor({ timeout: 5000 });
  await page.getByRole("button", { name: "닫기", exact: true }).click();

  // ---------- 다시 연결 → 다른 기기에서도 양파가 보인다 ----------
  await ctx.setOffline(false);
  await page.getByTestId("offline-pill").waitFor({ state: "detached" });
  const other = await device();
  await other.page.locator("nav").getByText("냉장고", { exact: true }).click();
  await other.page.getByLabel(/^양파 2/).first().waitFor({ timeout: 20000 });
} catch (e) { await fail(page, e); }

await browser.close();
assert.deepEqual(errors, [], "페이지 오류가 없어야 한다");
console.log("OFFLINE E2E OK");
