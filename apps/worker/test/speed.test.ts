/**
 * 레시피 가져오기(유튜브 설명란)에 AI가 몇 초 걸리는지 모델·생각 깊이별로 잰다. 실제 요금이 든다.
 *   COOK_SPEED=1 COOK_ANTHROPIC_API_KEY=sk-ant-... pnpm --filter @cook/worker exec vitest run speed
 * GitHub에서는 .github/workflows/ai-speed.yml 이 한 번 돌린다.
 */
import { appendFileSync } from "node:fs";
import { importResultJsonSchema } from "@cook/shared";
import { describe, expect, it } from "vitest";
import { claudeProvider } from "../src/ai/claude";
import { IMPORT_SYSTEM_PROMPT } from "../src/prompts";

const key = process.env.COOK_ANTHROPIC_API_KEY;
const on = !!key && process.env.COOK_SPEED === "1";

// 가상의 영상 설명란 (실제 채널·인물 아님)
const DESCRIPTION = `유튜브 영상
제목: 초간단 돼지고기 김치찌개 | 15분 완성
채널: 주말부엌(가상)

설명란:
오늘은 누구나 실패 없는 돼지고기 김치찌개를 만들어 볼게요!
구독과 좋아요는 큰 힘이 됩니다 🙏

[재료] 2~3인분
- 신김치 1/4포기 (약 300g)
- 돼지고기 앞다리살 200g
- 두부 반 모
- 대파 1대
- 양파 1/2개
- 청양고추 1개
- 쌀뜨물 500ml (없으면 물)
- 고춧가루 1큰술
- 다진 마늘 1큰술
- 국간장 1큰술
- 설탕 1/2작은술
- 김칫국물 3큰술
- 식용유 1큰술

[만드는 법]
00:30 냄비에 식용유를 두르고 돼지고기를 중불에서 3분 볶아요.
01:10 김치를 넣고 5분 더 볶아 주세요. 설탕을 조금 넣으면 신맛이 줄어요.
02:00 쌀뜨물과 김칫국물을 붓고 센불에서 끓여요.
02:40 끓어오르면 고춧가루, 다진 마늘, 국간장을 넣고 중약불에서 10분 끓여요.
03:30 두부, 양파, 대파, 청양고추를 넣고 3분 더 끓이면 완성!

TIP) 김치가 덜 익었으면 식초를 반 작은술 넣어 보세요.

#김치찌개 #집밥 #자취요리`;

const CASES: { model: string; effort: "low" | "medium" }[] = [
  { model: "claude-opus-5-5", effort: "medium" },   // 지금 쓰는 설정
  { model: "claude-opus-5-5", effort: "low" },
  { model: "claude-sonnet-5-5", effort: "low" },
  { model: "claude-haiku-5-5", effort: "low" },
];

const rows: string[] = [];

describe.skipIf(!on)("가져오기 속도", () => {
  for (const c of CASES) {
    it(`${c.model} ${c.effort}`, async () => {
      const ai = claudeProvider({ apiKey: key!, model: c.model });
      const t0 = Date.now();
      let row: string;
      try {
        const out = await ai.generateJson({
          system: IMPORT_SYSTEM_PROMPT, parts: [{ type: "text", text: DESCRIPTION }],
          schema: importResultJsonSchema(), effort: c.effort, maxTokens: 16000,
        });
        const sec = ((Date.now() - t0) / 1000).toFixed(1);
        const r = JSON.parse(out.text) as { recipe?: { title?: string; ingredients?: { name: string }[]; steps?: unknown[] } | null };
        const ing = r.recipe?.ingredients ?? [];
        row = `| ${c.model} | ${c.effort} | **${sec}초** | 출력 ${out.usage.output} | ${r.recipe?.title ?? "-"} | 재료 ${ing.length} · 단계 ${r.recipe?.steps?.length ?? 0} | ${ing.map((i) => i.name).join(", ")} |`;
      } catch (e) {
        row = `| ${c.model} | ${c.effort} | 실패 (${((Date.now() - t0) / 1000).toFixed(1)}초) | | ${e instanceof Error ? e.message.slice(0, 120) : String(e)} | | |`;
      }
      console.log(row);
      rows.push(row);
      expect(row).toBeTruthy();
    }, 300_000);
  }

  it("요약 남기기", () => {
    const table = ["| 모델 | 생각 깊이 | 걸린 시간 | 토큰 | 제목 | 개수 | 재료 |", "|---|---|---|---|---|---|---|", ...rows].join("\n");
    console.log(table);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### 레시피 가져오기 속도\n\n${table}\n\n`);
  });
});
