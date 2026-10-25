// 자동 배포용: 하루 AI 사용 한도를 세는 Cloudflare KV(USAGE)를 없으면 만들고 apps/worker/wrangler.toml 에 연결한다.
// 가족 단위로 AI를 열어 줄 때는 이 한도가 꼭 있어야 한다 (초대 코드가 새도 하루 손해에 상한이 있게, src/guard.ts).
// 쓰는 값: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID (비밀값). 실패해도 배포는 계속한다 (가족 공유만 꺼진다).
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const TITLE = "family-cook-usage";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tomlPath = join(root, "apps", "worker", "wrangler.toml");
const token = process.env.CLOUDFLARE_API_TOKEN ?? "";
const account = process.env.CLOUDFLARE_ACCOUNT_ID ?? "";
const warn = (msg) => console.log(`::warning title=하루 한도(KV) 준비 못 함::${msg} 가족 공유 AI는 꺼진 채로 배포해요. Cloudflare API 토큰에 "Workers KV Storage: Edit" 권한을 더한 뒤 다시 실행하세요.`);

// 이미 손으로 USAGE 를 연결해 두었으면 그대로 쓴다 (띄어쓰기·따옴표가 달라도)
const bound = /^\s*binding\s*=\s*["']USAGE["']/m;
if (bound.test(readFileSync(tomlPath, "utf8"))) { console.log("USAGE KV가 이미 연결되어 있어요"); process.exit(0); }
if (!token || !account) { warn("Cloudflare 값이 없어요."); process.exit(0); }

/** 잠깐의 오류(5xx·429·연결 끊김)는 세 번까지 다시 해 본다. 한 번에 15초까지만 기다린다 */
const api = async (path, init = {}) => {
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 2000 * attempt));
    try {
      const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/storage/kv/namespaces${path}`, {
        ...init, signal: AbortSignal.timeout(15_000),
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
      });
      const j = await r.json().catch(() => null);
      if (r.ok && j?.success) return j;
      last = new Error(`${r.status} ${(j?.errors ?? []).map((e) => e.message).join(", ")}`);
      if (r.status < 500 && r.status !== 429) break; // 권한·형식 오류는 다시 해도 같다
    } catch (e) { last = e; }
  }
  throw last;
};

try {
  let id = null;
  for (let page = 1; page <= 10 && !id; page++) {
    const j = await api(`?per_page=100&page=${page}`);
    id = j.result.find((n) => n.title === TITLE)?.id ?? null;
    if (j.result.length < 100) break;
  }
  if (!id) {
    id = (await api("", { method: "POST", body: JSON.stringify({ title: TITLE }) })).result.id;
    console.log(`하루 한도 KV를 새로 만들었어요 (${TITLE})`);
  } else {
    console.log(`하루 한도 KV를 찾았어요 (${TITLE})`);
  }
  if (!/^[0-9a-f]{32}$/.test(id)) throw new Error("KV id 형식이 이상해요");
  const toml = readFileSync(tomlPath, "utf8");
  writeFileSync(tomlPath, `${toml.trimEnd()}\n\n# 자동 배포가 연결한 하루 한도 KV (scripts/ci-kv.mjs)\n[[kv_namespaces]]\nbinding = "USAGE"\nid = "${id}"\n`);
} catch (e) {
  warn(`(${e instanceof Error ? e.message : e})`);
}
