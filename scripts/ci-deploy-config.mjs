// 자동 배포(GitHub Actions)용: 저장소 변수에 붙여 넣은 값으로 앱·AI 서버 설정 파일을 채운다.
//   node scripts/ci-deploy-config.mjs                  → apps/web/.env, apps/worker/wrangler.toml [vars]
//   node scripts/ci-deploy-config.mjs --worker-url URL → apps/web/.env 의 VITE_WORKER_URL 만
// FIREBASE_WEB_CONFIG: Firebase 콘솔 "웹 앱" 설정에 나오는 firebaseConfig 덩어리를 그대로 (const … = { apiKey: "…", … })
// ALLOWED_EMAILS: 설치한 사람의 구글 이메일 (쉼표로). 그 사람의 가족에 초대 코드로 들어온 사람은 넣지 않아도 AI를 쓴다
import { readFileSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = join(root, "apps", "web", ".env");
const out = (k, v) => { if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`); };

function setEnv(updates) {
  const lines = existsSync(envPath) ? readFileSync(envPath, "utf8").split("\n").filter(Boolean) : [];
  for (const [k, v] of Object.entries(updates)) {
    const i = lines.findIndex((l) => l.startsWith(`${k}=`));
    if (i >= 0) lines[i] = `${k}=${v}`; else lines.push(`${k}=${v}`);
  }
  writeFileSync(envPath, lines.join("\n") + "\n");
}

const wi = process.argv.indexOf("--worker-url");
if (wi >= 0) {
  const url = (process.argv[wi + 1] ?? "").trim().replace(/\/$/, "");
  setEnv({ VITE_WORKER_URL: url });
  console.log(url ? `AI 서버 주소: ${url}` : "AI 서버 주소 없음 (AI 기능은 '연결되지 않았어요'로 보인다)");
  process.exit(0);
}

const raw = process.env.FIREBASE_WEB_CONFIG ?? "";
const cfg = {};
for (const m of raw.matchAll(/["']?(\w+)["']?\s*:\s*["']([^"']+)["']/g)) cfg[m[1]] = m[2];
const missing = ["apiKey", "projectId", "appId"].filter((k) => !cfg[k]);
if (missing.length) {
  console.error(`FIREBASE_WEB_CONFIG 에서 ${missing.join(", ")} 을(를) 찾지 못했어요. Firebase 콘솔 > 프로젝트 설정 > 내 앱의 firebaseConfig 를 그대로 붙여 넣어 주세요.`);
  process.exit(1);
}
const pid = cfg.projectId;
if (!/^[a-z0-9-]+$/.test(pid)) { console.error(`projectId 형식이 이상해요: ${pid}`); process.exit(1); }

setEnv({
  VITE_FIREBASE_API_KEY: cfg.apiKey,
  // 아이폰 홈 화면 앱 로그인: 로그인 주소를 앱 주소(Firebase Hosting)와 같게
  VITE_FIREBASE_AUTH_DOMAIN: `${pid}.web.app`,
  VITE_FIREBASE_PROJECT_ID: pid,
  VITE_FIREBASE_STORAGE_BUCKET: cfg.storageBucket ?? "",
  VITE_FIREBASE_MESSAGING_SENDER_ID: cfg.messagingSenderId ?? "",
  VITE_FIREBASE_APP_ID: cfg.appId,
});

const emails = (process.env.ALLOWED_EMAILS ?? "").split(/[,\s]+/).filter(Boolean).join(",");
if (!emails) console.warn("::warning title=ALLOWED_EMAILS 없음::설치한 사람 이메일이 없으면 AI 기능이 모두 막혀요 (비용 사고 방지). 저장소 변수 ALLOWED_EMAILS 에 쉼표로 넣어 주세요.");
const tomlPath = join(root, "apps", "worker", "wrangler.toml");
let toml = readFileSync(tomlPath, "utf8");
const setVar = (k, v) => { toml = toml.replace(new RegExp(`^${k} = ".*"`, "m"), `${k} = ${JSON.stringify(v)}`); };
setVar("FIREBASE_PROJECT_ID", pid);
setVar("ALLOWED_ORIGINS", `https://${pid}.web.app,https://${pid}.firebaseapp.com`);
setVar("ALLOWED_EMAILS", emails);
writeFileSync(tomlPath, toml);

out("project_id", pid);
console.log(`Firebase 프로젝트: ${pid} → https://${pid}.web.app (허용 이메일 ${emails ? emails.split(",").length : 0}개)`);
