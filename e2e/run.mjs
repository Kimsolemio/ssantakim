/**
 * 2단계 E2E 시나리오 (Firebase 에뮬레이터 + 가짜 Worker + Vite dev 서버가 떠 있어야 한다. README "자동 테스트" 참고)
 * 실행: node e2e/run.mjs
 */
import { chromium } from "playwright";
import assert from "node:assert/strict";

const APP = "http://127.0.0.1:5173/";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const shots = join(dirname(fileURLToPath(import.meta.url)), "shots");
mkdirSync(shots, { recursive: true });

async function waitFor(url, label) {
  for (let i = 0; i < 60; i++) { try { const r = await fetch(url); if (r.status < 500) return; } catch {} await new Promise((r) => setTimeout(r, 1000)); }
  throw new Error(`${label} not ready`);
}
await waitFor("http://127.0.0.1:9099/", "auth emulator");
await waitFor("http://127.0.0.1:8080/", "firestore emulator");
await waitFor(APP, "vite");
// 이전 실행 데이터 초기화
await fetch("http://127.0.0.1:8080/emulator/v1/projects/demo-cook/databases/(default)/documents", { method: "DELETE" });
await fetch("http://127.0.0.1:9099/emulator/v1/projects/demo-cook/accounts", { method: "DELETE" });

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const errors = [];
async function newUser(email, name) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${email}: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/favicon|ERR_CONNECTION_REFUSED.*9099|net::ERR|status of 502/.test(m.text())) errors.push(`${email} console: ${m.text()}`); });
  page.on("dialog", (d) => d.accept());
  await page.goto(APP);
  await page.getByText("Google로 시작하기").waitFor({ timeout: 20000 });
  await page.evaluate(([e, n]) => window.__cookTest.signInAs(e, n), [email, name]);
  return page;
}

const pages = [];
const origNewUser = newUser;
async function newUserTracked(e, n) { const p = await origNewUser(e, n); pages.push(p); return p; }
process.on("uncaughtException", async (err) => {
  console.error("FAILED:", err.message);
  for (const [i, p] of pages.entries()) { try { await p.screenshot({ path: `${shots}/failure-${i}.png` }); } catch {} }
  console.log("errors so far:", errors);
  await browser.close(); process.exit(1);
});
// ---------- 사용자 1: 가족 생성 ----------
const mom = await newUserTracked("mom@test.local", "엄마");
await mom.getByText("새 가족 만들기").click();
await mom.getByPlaceholder("가족 이름 (예: 김씨네)").fill("테스트네");
await mom.getByText("만들기", { exact: true }).click();
await mom.getByRole("heading", { name: "레시피" }).waitFor();
await mom.screenshot({ path: `${shots}/01-recipes-empty.png` });

// 초대 코드 읽기 + 가족 취향 저장
await mom.getByText("👨‍👩‍👧 테스트네").click();
const code = (await mom.locator(".tracking-widest").first().textContent()).trim();
assert.match(code, /^[A-Z0-9]{6}$/);
await mom.getByLabel("아이가 함께 먹어요").check();
await mom.getByPlaceholder("알레르기 (쉼표로: 땅콩, 새우)").fill("새우, 땅콩");
await mom.getByText("취향 저장").click();
await mom.getByText("저장했어요").waitFor();
await mom.screenshot({ path: `${shots}/02-family-menu.png` });
await mom.getByText("닫기").click();

// ---------- AI 레시피 생성 → 편집 → 저장 ----------
await mom.getByLabel("AI 레시피 만들기").click();
await mom.getByPlaceholder(/알리오올리오/).fill("알리오올리오");
await mom.getByLabel("인분 늘리기").click(); // 2 → 3
await mom.getByPlaceholder(/추가 요청/).fill("덜 맵게");
await mom.screenshot({ path: `${shots}/03-generate.png` });
await mom.getByText("레시피 만들기", { exact: true }).click();
await mom.getByText("레시피 확인·수정").waitFor({ timeout: 20000 });
assert.equal(await mom.getByPlaceholder("요리 이름", { exact: true }).inputValue(), "알리오올리오");
await mom.screenshot({ path: `${shots}/04-editor.png`, fullPage: false });
// 편집: 팁 하나 추가
await mom.getByText("+ 팁 추가").click();
await mom.locator("section").filter({ hasText: "팁" }).locator("input").last().fill("남은 면수는 버리지 마세요.");
await mom.getByText("저장", { exact: true }).click();

// ---------- 상세: 스케일링 ----------
await mom.getByRole("heading", { name: "재료", exact: true }).waitFor();
await mom.screenshot({ path: `${shots}/05-detail.png` });
const amountOf = async (name) => (await mom.locator("li", { hasText: name }).first().locator("span").last().textContent()).trim();
assert.equal(await amountOf("스파게티면"), "300g", "3인분 기준 저장");
await mom.getByLabel("인분 늘리기").click(); // 3 → 4
assert.equal(await amountOf("스파게티면"), "400g");
assert.equal(await amountOf("마늘"), "16쪽"); // 12*4/3
assert.equal(await amountOf("소금"), "약간", "scalable=false 는 그대로");
await mom.getByText(/자동 환산했어요/).waitFor();
await mom.screenshot({ path: `${shots}/06-detail-scaled.png` });
// ---------- 쿡 모드 (3단계) ----------
await mom.getByText("🍳 요리 시작").click();
await mom.getByText("1 / 5 단계").waitFor();
assert.match(await mom.getByTestId("step-text").textContent(), /큰 냄비에 물 2L/);
// 단계 재료: 4인분 환산된 스파게티면 400g, 소금 약간
const cookMain = mom.locator("main");
await cookMain.locator("li", { hasText: "스파게티면" }).getByText("400g").waitFor();
await cookMain.locator("li", { hasText: "소금" }).getByText("약간", { exact: true }).waitFor();
// 타이머 시작 → 상단 타이머 바에 9:00 근처로 카운트
await mom.getByText("⏱ 9분 타이머 시작").click();
await mom.getByTestId("timer-bar").waitFor();
await mom.waitForTimeout(1500);
assert.match(await mom.getByTestId("timer-bar").textContent(), /1단계.*8:5\d/);
await mom.getByText("+1분").click();
assert.match(await mom.getByTestId("timer-bar").textContent(), /9:5\d/);
await mom.screenshot({ path: `${shots}/09-cook-step1.png` });
// 다음 → 2단계, 타이머는 계속 표시
await mom.getByText("다음 ›").click();
await mom.getByText("2 / 5 단계").waitFor();
await mom.getByTestId("timer-bar").waitFor();
await cookMain.locator("li", { hasText: "마늘" }).getByText("16쪽").waitFor();
await mom.getByText("‹ 이전").click();
await mom.getByText("1 / 5 단계").waitFor();
for (let i = 0; i < 5; i++) await mom.getByText(/다음 ›|마무리 ›/).click();
await mom.getByText("요리 완료!").waitFor();
await mom.screenshot({ path: `${shots}/10-cook-done.png` });
await mom.getByText("요리 완료", { exact: true }).click();
await mom.getByText(/요리 기록 1회/).waitFor({ timeout: 10000 });

// 즐겨찾기
await mom.getByLabel("즐겨찾기").click();
await mom.locator("header").getByText("★").waitFor();
// 폴더 이동 (메뉴)
await mom.getByLabel("더보기").click();
await mom.getByText("레시피 관리").waitFor();
await mom.getByText("닫기").click();
await mom.getByLabel("뒤로").click();
await mom.getByRole("heading", { name: "레시피" }).waitFor();
await mom.locator("li", { hasText: "알리오올리오" }).getByText("★").waitFor();

// 폴더 만들고 필터
await mom.getByText("폴더 관리").click();
await mom.getByPlaceholder(/새 폴더 이름/).fill("평일 저녁");
await mom.getByText("추가", { exact: true }).click();
await mom.locator("li", { hasText: "평일 저녁" }).waitFor();
await mom.getByText("닫기").click();
await mom.getByText("평일 저녁").click(); // 폴더 필터 → 비어 있음
await mom.getByText("조건에 맞는 레시피가 없어요.").waitFor();
await mom.getByText("전체").click();

// 생성 실패 경로
await mom.getByLabel("AI 레시피 만들기").click();
await mom.getByPlaceholder(/알리오올리오/).fill("실패테스트");
await mom.getByText("레시피 만들기", { exact: true }).click();
await mom.getByText("AI 호출 실패 (테스트)").waitFor({ timeout: 10000 });
await mom.screenshot({ path: `${shots}/07-generate-error.png` });
await mom.getByText("닫기").click();

// 냉장고에 재료 하나
await mom.getByText("냉장고", { exact: true }).click();
await mom.getByLabel("재료 추가").click();
await mom.getByPlaceholder("재료 이름 (예: 대파)").fill("대파");
await mom.getByPlaceholder("수량").fill("2");
await mom.getByText("+3일").click();
await mom.getByText("저장", { exact: true }).click();
await mom.locator("li", { hasText: "대파" }).getByText("D-3").waitFor();

// ---------- 사용자 2: 초대 코드로 참여 → 같은 데이터 ----------
const dad = await newUserTracked("dad@test.local", "아빠");
await dad.getByRole("button", { name: "초대 코드로 참여" }).click();
await dad.getByPlaceholder("초대 코드 6자리").fill(code);
await dad.getByText("참여하기").click();
await dad.getByRole("heading", { name: "레시피" }).waitFor({ timeout: 20000 });
await dad.locator("li", { hasText: "알리오올리오" }).waitFor();
await dad.getByText("냉장고", { exact: true }).click();
await dad.locator("li", { hasText: "대파" }).waitFor();
await dad.screenshot({ path: `${shots}/08-dad-fridge.png` });

// 사용자 2가 레시피 수정 → 사용자 1 화면에 실시간 반영
await dad.getByText("레시피", { exact: true }).click();
await dad.locator("li", { hasText: "알리오올리오" }).click();
await dad.getByLabel("더보기").click();
await dad.getByText("수정하기").click();
await dad.getByPlaceholder("요리 이름", { exact: true }).fill("알리오올리오 (아빠 수정)");
await dad.getByText("저장", { exact: true }).click();
await dad.getByRole("heading", { name: "재료", exact: true }).waitFor();
await mom.getByText("레시피", { exact: true }).click();
await mom.locator("li", { hasText: "알리오올리오 (아빠 수정)" }).waitFor({ timeout: 10000 });

// ---------- 사용자 3: 다른 가족은 못 봄 ----------
const stranger = await newUserTracked("x@test.local", "남");
await stranger.getByText("새 가족 만들기").click();
await stranger.getByPlaceholder("가족 이름 (예: 김씨네)").fill("남의집");
await stranger.getByText("만들기", { exact: true }).click();
await stranger.getByText("아직 레시피가 없어요.").waitFor();

console.log("E2E OK");
console.log("console/page errors:", errors.length ? errors : "none");
await browser.close();
if (errors.length) process.exit(1);
