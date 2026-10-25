/**
 * 실제 AI 인식 검증용 "가짜 영수증" 이미지를 만든다 (실제 가게·실제 결제와 무관한 예시).
 * 실행: node apps/worker/test/fixtures/make-sample-receipt.mjs  → sample-receipt.png
 */
import { chromium } from "playwright";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const rows = [
  ["서울우유 1L", 1, 2980], ["무항생제 대란 15구", 1, 6980], ["국산콩 부침두부 300g", 1, 1980],
  ["대파 1단", 1, 2480], ["부사 사과 1.5kg", 1, 12900], ["국내산 삼겹살 600g", 1, 15600],
  ["손질 고등어 2미", 1, 7980], ["포기김치 1kg", 1, 9900], ["콜라 1.5L", 2, 2580],
  ["진간장 500ml", 1, 3480], ["냉동 왕교자 1.05kg", 1, 9980], ["메론맛 아이스바 6입", 1, 4480],
  ["매운 라면 5입", 1, 4380], ["양파 1.5kg", 1, 3980], ["종량제봉투 20L", 1, 490],
];
const total = rows.reduce((s, [, q, p]) => s + q * p, 0);
const won = (n) => n.toLocaleString("ko-KR");
const html = `<!doctype html><meta charset="utf-8"><style>
body{margin:0;background:#f4f1ea;font-family:"Noto Sans Mono CJK KR","Noto Sans CJK KR",monospace;color:#222}
.r{width:360px;margin:16px auto;background:#fffdf8;padding:18px 16px;box-shadow:0 2px 8px #0002;font-size:13px;line-height:1.55}
h1{font-size:17px;text-align:center;margin:0 0 4px} .c{text-align:center} .row{display:flex;justify-content:space-between}
hr{border:0;border-top:1px dashed #999;margin:8px 0} .n{flex:1;white-space:nowrap;overflow:hidden} .q{width:28px;text-align:right} .p{width:72px;text-align:right}
</style><div class="r">
<h1>예시마트 성수점</h1><div class="c">서울 성동구 예시로 123 · 02-000-0000</div><div class="c">[영수증 예시 · 실제 거래 아님]</div><hr>
<div class="row"><span>2026-10-11 18:42</span><span>POS 03-1234</span></div><hr>
<div class="row"><b class="n">상품명</b><b class="q">수량</b><b class="p">금액</b></div><hr>
${rows.map(([n, q, p]) => `<div class="row"><span class="n">${n}</span><span class="q">${q}</span><span class="p">${won(q * p)}</span></div>`).join("")}
<hr><div class="row"><span>행사할인</span><span>-1,000</span></div>
<div class="row"><b>합계</b><b>${won(total - 1000)}</b></div>
<div class="row"><span>신용카드 ****-****-****-1234</span><span>${won(total - 1000)}</span></div>
<div class="row"><span>포인트 적립</span><span>120P</span></div><hr><div class="c">감사합니다</div></div>`;

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 400, height: 900 } });
await page.setContent(html);
await page.locator(".r").screenshot({ path: join(here, "sample-receipt.png") });
await browser.close();
console.log("wrote", join(here, "sample-receipt.png"));
