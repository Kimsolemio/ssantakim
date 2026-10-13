// 체험판 빌드(apps/web/dist-demo)를 링크로 열 수 있는 한 페이지로 묶는다.
// 페이지에는 CSS·JS를 그대로 넣고(외부 스크립트를 못 쓰는 곳에서도 돌게), 글꼴·아이콘은 옆 파일로 둔다.
// 결과: dist-demo/page.html + dist-demo/files.json(올릴 파일 목록)
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "apps", "web", "dist-demo");
const html = readFileSync(join(dir, "index.html"), "utf8");
const js = /<script type="module"[^>]*src="\.\/(assets\/[^"]+\.js)"/.exec(html)?.[1];
const css = /<link rel="stylesheet"[^>]*href="\.\/(assets\/[^"]+\.css)"/.exec(html)?.[1];
if (!js || !css) throw new Error("index.html 에서 JS·CSS를 찾지 못했어요");

// CSS 안의 글꼴 주소는 assets/ 기준이었으니 페이지 기준으로 바꾼다
const style = readFileSync(join(dir, css), "utf8").replace(/url\(\.\//g, "url(assets/");
// 스크립트 안의 </script 와 <!-- 는 HTML이 스크립트를 끝난 것으로 읽지 않게 바꾼다
const script = readFileSync(join(dir, js), "utf8").replace(/<\/script/gi, "<\\/script").replace(/<!--/g, "<\\!--");

const page = `<title>우리집 요리</title>
<meta name="theme-color" content="#F3F2EE" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#141311" media="(prefers-color-scheme: dark)">
<style>${style}</style>
<div id="root"></div>
<script type="module">${script}</script>
`;
writeFileSync(join(dir, "page.html"), page);

const files = {};
for (const f of readdirSync(join(dir, "assets"))) if (f.endsWith(".woff2")) files[`assets/${f}`] = join(dir, "assets", f);
for (const f of ["icon.svg", "apple-touch-icon.png", "icon-192.png"]) files[f] = join(dir, f);
writeFileSync(join(dir, "files.json"), JSON.stringify(files, null, 1));
console.log(`page.html ${(page.length / 1024).toFixed(0)}KB, 함께 올릴 파일 ${Object.keys(files).length}개`);
