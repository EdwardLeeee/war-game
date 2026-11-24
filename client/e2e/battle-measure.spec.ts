// 量測大軍交戰 (the user 2026-11-24 「我用網頁到200兵時畫面會卡卡的」; ceo, core 2026-11-24): from the 量測 panel, perf360 watched
// with the computer at 困難 on both sides, so the two armies fight at once; measured from its 10th second (here for 3
// seconds, ?measures=3, not 30). Its result has the frame's time by part (the one screenshot the iPhone sends): a
// frame's own code and the rest, the drawing's parts, the fog's redraws and the units drawn and left off the screen.
import { expect, test } from "@playwright/test";
import { openLab, watchErrors } from "./helpers.ts";

const ATTACK = 2;

test("量測大軍交戰：雙方都是電腦（困難）、一開始就打起來；第 10 秒起量，結果有每張畫面拆開的時間、迷霧重畫次數、畫了幾個兵", async ({ page }) => {
  // The real simulation's perf360 (468 soldiers): its start, 10 s of warm-up and 3 measured (CI's slowest runner: about 3 times).
  test.setTimeout(240_000);
  const check = watchErrors(page);
  await page.goto("./?test=1&tps=30&measures=3");
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true, null, { timeout: 120_000 });
  await openLab(page);
  await page.getByRole("button", { name: "量測大軍交戰" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true && (window.__proto?.game?.header().tick ?? 0) > 0, null, { timeout: 120_000 });
  // Both sides the computer's at 困難, no person, no time limit, the fixed map (not saved: a perf scenario).
  expect(await page.evaluate(() => window.__proto?.game?.init())).toMatchObject({ scenario: "perf360", human: null, ai: [true, true], difficulty: ["hard", "hard"], maxTicks: 0 });
  expect((await page.evaluate(() => window.__proto?.game?.init()))?.map).toBeUndefined();
  // And they fight.
  await expect.poll(async () => page.evaluate((a) => (window.__proto?.game?.units() ?? []).filter((u) => u.action === a).length, ATTACK), { timeout: 60_000 }).toBeGreaterThan(20);
  // Both sides' soldiers in sight (and the neutral towns' guards, owner 2).
  const owners = await page.evaluate(() => [...new Set((window.__proto?.game?.units() ?? []).filter((u) => u.type !== 0).map((u) => u.owner))].sort());
  expect(owners).toEqual(expect.arrayContaining([0, 1]));
  const result = page.locator(".lab-result");
  await expect(result).toBeVisible({ timeout: 120_000 });
  await expect(result).toContainText("場景：大軍交戰（雙方電腦困難）（perf360，第 10 秒起量 3 秒）");
  await expect(result).toContainText(/每張畫面：平均 [\d.]+ ms/);
  const n = "[\\d.]+（\\d+/s）";
  await expect(result).toContainText(new RegExp(`本頁程式 [\\d.]+（收快照 ${n}、畫圖 ${n}、Pixi render ${n}、介面 ${n}、其他 ${n}）＋程式以外（顯示卡、瀏覽器）[\\d.]+`));
  await expect(result).toContainText(new RegExp(`畫圖裡（每張 ms，括號裡每秒 ms）：迷霧 ${n}、兵 ${n}、城和建築 ${n}、資源點 ${n}、地面 ${n}、特效 ${n}`));
  await expect(result).toContainText(/迷霧每秒重畫 [\d.]+ 次；每張畫面畫 \d+ 個兵、畫面外 \d+ 個/);
  await expect(result).toContainText("每 tick 模擬平均");
  // The camera on the battle: some drawn.
  const drawn = Number((await result.textContent())?.match(/每張畫面畫 (\d+) 個兵/)?.[1] ?? "0");
  expect(drawn).toBeGreaterThan(0);
  check();
});
