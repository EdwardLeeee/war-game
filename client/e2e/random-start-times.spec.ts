// 開隨機地圖新局要等多久 (D-115; ceo 2026-10-31: 隨機地圖多關口讓產生地圖變慢，最慢超過 1 秒要另外想辦法):
// on CI's WebKit, the time from `init` to `ready` of the load times (D-091), the simulation making
// its map and answering: the slowest seeds core measured (1, 89, 170, 22) and an ordinary one, each
// on a fresh page, a few rounds, the first game of each page. Printed for the CI log; these are
// this runner's numbers, not the iPhone's. No limit asserted: a timing here says nothing of a bug.

import { expect, test } from "@playwright/test";

const SEEDS = [22, 1, 89, 170, 7];
const ROUNDS = 3;

test("開隨機地圖新局：init → ready，慢的種子 1、89、170、22 和普通的 7（這台 CI 的數字，不是 iPhone）", async ({ page, browserName }) => {
  test.skip(browserName !== "webkit", "ceo: WebKit's numbers");
  test.setTimeout(240_000);
  const rows: { seed: number; ms: number[] }[] = SEEDS.map((seed) => ({ seed, ms: [] }));
  for (let round = 0; round < ROUNDS; round++) {
    for (const row of rows) {
      await page.goto(`./?test=1&map=random&seed=${row.seed}&ai=0&tps=20&loadtimes=1`);
      await page.getByRole("button", { name: "開始" }).tap();
      await page.waitForFunction(() => window.__proto?.ready === true, null, { timeout: 60_000 });
      await expect.poll(() => page.evaluate(() => window.__proto?.loadTimes()?.marks.ready !== undefined), { timeout: 60_000 }).toBe(true);
      const marks = await page.evaluate(() => window.__proto?.loadTimes()?.marks ?? null);
      if (marks?.init === undefined || marks.ready === undefined) throw new Error("no load times");
      row.ms.push(Math.round(marks.ready - marks.init));
    }
  }
  const all = rows.flatMap((r) => r.ms);
  console.log(`[random start times ${browserName}] ${JSON.stringify({ commit: await page.evaluate(() => window.__proto?.commit ?? ""), rows, slowest: Math.max(...all), mean: Math.round(all.reduce((a, b) => a + b, 0) / all.length) })}`);
  expect(all.length).toBe(SEEDS.length * ROUNDS);
});
