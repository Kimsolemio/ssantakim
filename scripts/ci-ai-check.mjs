// 배포 때 AI 키로 아주 짧은 요청 몇 개를 보내, 어떤 기능이 막혀 있는지 결과(상태 코드·오류 문구)만 적는다.
// 키 값은 어디에도 찍지 않는다. 실패해도 배포는 그대로 진행된다 (deploy.yml 에서 continue-on-error).
// 쓰는 값: ANTHROPIC_API_KEY (비밀값), CLAUDE_MODEL·CLAUDE_FAST_MODEL (없으면 기본값)
import { appendFileSync } from "node:fs";

const key = process.env.ANTHROPIC_API_KEY ?? "";
if (!key) { console.log("ANTHROPIC_API_KEY 없음: 건너뜀"); process.exit(0); }
const model = process.env.CLAUDE_MODEL || "claude-opus-5-5";
const fast = process.env.CLAUDE_FAST_MODEL || "claude-haiku-5-5";
const API = "https://api.anthropic.com/v1";
const headers = (beta) => ({
  "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json",
  ...(beta ? { "anthropic-beta": beta } : {}),
});
const hide = (s) => String(s).split(key).join("***").slice(0, 300);
const hi = { max_tokens: 16, messages: [{ role: "user", content: "Reply with the single word: ok" }] };

const checks = [
  ["모델 목록", null],
  [`${model} 기본`, { body: { model, ...hi } }],
  [`${model} + 대체 모델 기능(베타)`, { beta: "server-side-fallback-2026-07-01", body: { model, ...hi, fallbacks: "default" } }],
  [`${model} + JSON 형식 출력`, { body: { model, ...hi, max_tokens: 64, output_config: { effort: "low", format: { type: "json_schema", schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false } } } } }],
  [`${model} + 웹 읽기 도구`, { body: { model, ...hi, tools: [{ type: "web_fetch_20260318", name: "web_fetch", max_uses: 1, allowed_callers: ["direct"] }] } }],
  [`${model} + 웹 검색 도구`, { body: { model, ...hi, tools: [{ type: "web_search_20260318", name: "web_search", max_uses: 1, allowed_callers: ["direct"] }] } }],
  [`${fast} 기본`, { body: { model: fast, ...hi } }],
];

const lines = [];
for (const [name, c] of checks) {
  let line;
  try {
    const res = c
      ? await fetch(`${API}/messages`, { method: "POST", headers: headers(c.beta), body: JSON.stringify(c.body) })
      : await fetch(`${API}/models?limit=100`, { headers: headers(null) });
    const j = await res.json().catch(() => ({}));
    if (res.ok) {
      line = c ? `✅ ${name}: ${res.status} (${j.model ?? ""})` : `✅ ${name}: ${(j.data ?? []).map((m) => m.id).join(", ")}`;
    } else {
      line = `❌ ${name}: ${res.status} ${j.error?.type ?? ""} — ${hide(j.error?.message ?? "")}`;
    }
  } catch (e) {
    line = `❌ ${name}: 연결 실패 — ${hide(e instanceof Error ? e.message : e)}`;
  }
  console.log(line);
  lines.push(`- ${line}`);
}
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### AI 연결 점검\n\n${lines.join("\n")}\n\n`);
