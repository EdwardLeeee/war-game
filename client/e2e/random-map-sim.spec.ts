// 隨機地圖 (D-074) on core's real simulation, watched (?test=1&watch=1: the computer plays
// both sides; until the AI scouts, the worker takes a random map only without a person). The
// random map loads and runs, and the frame times on it are measured beside the fixed map's,
// the same page watching each for the same time (ceo: 129 × 129 is 1.8 times the cells of
// 96 × 96; the phone must not get slower). These are this runner's numbers, not the iPhone's.

import { expect, type Page, test } from "@playwright/test";
import { watchErrors } from "./helpers.ts";

let checkErrors: () => void;

test.beforeEach(({ page }) => {
  checkErrors = watchErrors(page);
});

test.afterEach(() => {
  checkErrors();
});

async function watch(page: Page, map: "fixed" | "random", tps = 30): Promise<void> {
  await page.goto(`./?test=1&watch=1&map=${map}&tps=${tps}`);
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true);
}

const tick = (page: Page) => page.evaluate(() => window.__proto?.game?.header().tick ?? -1);

test("觀戰隨機地圖：模擬接受、開始跑；觀戰看得到整張圖的城鎮和岩石", async ({ page }) => {
  await watch(page, "random", 100);
  expect(await page.evaluate(() => window.__proto?.game?.mapMode())).toBe("random");
  expect(await page.evaluate(() => window.__proto?.game?.init())).toMatchObject({ human: null, ai: [true, true], map: "random" });
  const t0 = await tick(page);
  await expect.poll(() => tick(page), { timeout: 30_000 }).toBeGreaterThan(t0 + 200);
  // Watching, every town of the map comes with its row (core #172: 7 towns), and the rocks with the grid.
  await expect.poll(async () => (await page.evaluate(() => window.__proto?.game?.knownTowns() ?? [])).length, { timeout: 30_000 }).toBe(7);
  await expect.poll(() => page.evaluate(() => window.__proto?.game?.knownRocks() ?? 0), { timeout: 30_000 }).toBeGreaterThan(0);
});

test("畫面量測：觀戰固定地圖和隨機地圖各 20 秒，一格的間隔和畫一格的時間並列（這台 CI 的數字，不是 iPhone）", async ({ page }, info) => {
  test.setTimeout(150_000);
  const rows: Record<string, unknown>[] = [];
  for (const map of ["fixed", "random"] as const) {
    await watch(page, map);
    // Let the page settle, then one window over the same span of play.
    await page.waitForTimeout(3_000);
    await page.evaluate(() => window.__proto?.game?.frameTimes(true));
    await page.waitForTimeout(20_000);
    const s = await page.evaluate(() => window.__proto?.game?.frameTimes(false));
    expect(s?.frames ?? 0, `${map}: frames drawn`).toBeGreaterThan(50);
    const round = (v: number | undefined) => Math.round((v ?? 0) * 100) / 100;
    rows.push({ map, frames: s?.frames, fpsFromMedian: round(s?.fps), gapMedianMs: round(s?.gapMedian), gapP95Ms: round(s?.gapP95), drawMedianMs: round(s?.drawMedian), drawP95Ms: round(s?.drawP95) });
  }
  const text = JSON.stringify({ browser: info.project.name, viewport: page.viewportSize(), rows }, null, 2);
  console.log(`map frame times ${text}`);
  await info.attach("map-frame-times", { body: text, contentType: "application/json" });
});
