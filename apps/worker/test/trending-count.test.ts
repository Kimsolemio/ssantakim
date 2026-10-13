/**
 * 오늘의 인기 레시피가 하루에 몇 개 모이는지 실제 유튜브로 센다 (유튜브 무료 한도 약 900 유닛, 요금 없음).
 *   COOK_TRENDING=1 COOK_YOUTUBE_API_KEY=... pnpm --filter @cook/worker exec vitest run trending-count
 * GitHub에서는 .github/workflows/trending-count.yml 이 한 번 돌린다.
 * 오늘 검색어와 내일 검색어를 둘 다 돌려, 나라마다 검색을 두 번 하면 얼마나 늘어나는지도 본다.
 */
import { appendFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resetTrendingCache, trendingRecipes, type TrendingVideo } from "../src/trending";

const key = process.env.COOK_YOUTUBE_API_KEY;
const on = !!key && process.env.COOK_TRENDING === "1";
const COUNTRIES = ["kr", "us", "es", "jp"] as const;
const count = (vs: TrendingVideo[]) => COUNTRIES.map((c) => `${c} ${vs.filter((v) => v.region === c).length}`).join(" · ");

describe.skipIf(!on)("인기 영상 개수", () => {
  it("오늘·내일 검색어", async () => {
    const now = Date.now();
    resetTrendingCache();
    const today = await trendingRecipes({ YOUTUBE_API_KEY: key }, null, now);
    resetTrendingCache();
    const tomorrow = await trendingRecipes({ YOUTUBE_API_KEY: key }, null, now + 86400_000);
    const union = [...new Map([...today.videos, ...tomorrow.videos].map((v) => [v.id, v])).values()];
    const lines = [
      `| 오늘 검색어 (${today.day}) | ${today.videos.length}개 | ${count(today.videos)} |`,
      `| 내일 검색어 (${tomorrow.day}) | ${tomorrow.videos.length}개 | ${count(tomorrow.videos)} |`,
      `| 둘을 합치면 (중복 뺌) | ${union.length}개 | ${count(union)} |`,
    ];
    const table = ["| | 남은 영상 | 나라별 |", "|---|---|---|", ...lines].join("\n");
    console.log(table);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### 인기 레시피 개수\n\n${table}\n\n`);
    expect(today.videos.length).toBeGreaterThanOrEqual(0);
  }, 120_000);
});
