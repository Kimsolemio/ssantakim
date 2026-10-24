// 자동 배포용: 하루 AI 사용 한도를 세는 Cloudflare KV(USAGE)를 없으면 만들고 apps/worker/wrangler.toml 에 연결한다.
// 가족 단위로 AI를 열어 줄 때는 이 한도가 꼭 있어야 한다 (초대 코드가 새도 하루 손해에 상한이 있게, src/guard.ts).
// 쓰는 값: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID (비밀값). 실패해도 배포는 계속한다 (가족 공유만 꺼진다).
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const TITLE = "family-cook-usage";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tomlPath = join(root, "apps", "worker", "wrangler.toml");
const token = process.env.CLOUDFLARE_API_TOKEN ?? "";
const account = process.env.CLOUDFLARE_ACCOUNT_ID ?? "";
const warn = (msg) => console.log(`::warning title=하루 한도(KV) 준비 못 함::${msg} 가족 공유 AI는 꺼진 채로 배포해요. Cloudflare API 토큰에 "Workers KV Storage: Edit" 권한을 더한 뒤 다시 실행하세요.`);

if (!token || !account) { warn("Cloudflare 값이 없어요."); process.exit(0); }

const api = async (path, init = {}) => {
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/storage/kv/namespaces${path}`, {
    ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.success) throw new Error(`${r.status} ${(j?.errors ?? []).map((e) => e.message).join(", ")}`);
  return j;
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
  let toml = readFileSync(tomlPath, "utf8");
  if (!/^binding = "USAGE"/m.test(toml)) {
    toml = `${toml.trimEnd()}\n\n# 자동 배포가 연결한 하루 한도 KV (scripts/ci-kv.mjs)\n[[kv_namespaces]]\nbinding = "USAGE"\nid = "${id}"\n`;
    writeFileSync(tomlPath, toml);
  }
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, "usage=1\n");
} catch (e) {
  warn(`(${e instanceof Error ? e.message : e})`);
}
