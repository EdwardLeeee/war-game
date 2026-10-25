// 寫實地面 (D-093, ?test=1&ground=real): the ground blended on the GPU from ui's textures (CI: the
// test page's stand-ins; locally, R7's CC0 development set when scripts/fetch-ground-dev.ts has
// run), over ui's terrain pictures, under the fog; its quality switched live. Pictures for ceo and
// ui from Chromium.

import { expect, type Page, test } from "@playwright/test";
import { openLab, shot, watchErrors } from "./helpers.ts";

const look = (page: Page) => page.evaluate(() => window.__proto?.game?.groundLook() ?? null);

async function start(page: Page, query: string): Promise<void> {
  await page.goto(`./?test=1&${query}`);
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true, null, { timeout: 60_000 });
}

test("寫實地面（D-093）：?ground=real 時地面在顯示卡上混合，畫在地形的圖下面、迷霧下面；高、低畫質可以即時切換（觀戰，給 ceo 和 ui 看）", async ({ page, browserName }, info) => {
  test.setTimeout(180_000);
  const check = watchErrors(page);
  await start(page, "watch=1&ai=0&art=x3&ground=real");
  // The water too, drawn by the shader (art-v6; the test page's stand-ins and the development set have its layer).
  // (The towns' ground with art-v6's: tested in town-interior.spec.ts.)
  await expect.poll(() => look(page)).toMatchObject({ real: true, quality: "high", water: true });
  if (browserName === "chromium") {
    for (const [name, x, y, z] of [
      ["ground-real-river-bridge", 18.5, 59.5, 1.2],
      // R8-28 (the weights soft, the dirt patches' edges soft): a diagonal river's bank, rocks' gravel and dirt.
      ["ground-real-river-bank", 24, 62, 2.4],
      ["ground-real-gravel-dirt", 16, 47, 2.2],
      ["ground-real-home", 14, 80, 1.0],
      ["ground-real-rock-cliff", 46, 24, 0.9],
      ["ground-real-whole-map", 48, 48, 0.35],
    ] as const) {
      await page.evaluate(([cx, cy, s]) => window.__proto?.game?.centerOn(cx, cy, s), [x, y, z] as const);
      await page.waitForTimeout(300);
      await shot(page, info, name);
    }
  }
  // The 量測 panel: 高、低, and what the ground costs (CI's numbers: software rendering, not the iPhone's).
  await openLab(page);
  const lab = page.getByRole("region", { name: "量測與確定性檢查" });
  await lab.getByRole("button", { name: "量地面" }).tap();
  const line = lab.locator(".lab-log").getByText(/^地面（\d+×\d+ 像素，每格）：高 [\d.]+ ms、低 [\d.]+ ms、只貼一張圖 [\d.]+ ms；材質 [\d.]+ MB$/);
  await expect(line).toBeVisible({ timeout: 30_000 });
  console.log(`[ground ${info.project.name}] ${await line.textContent()}`);
  await lab.getByRole("radio", { name: "低", exact: true }).tap();
  await expect.poll(() => look(page)).toMatchObject({ real: true, quality: "low", water: true });
  await lab.getByRole("button", { name: "關閉" }).tap();
  if (browserName === "chromium") {
    await page.evaluate(() => window.__proto?.game?.centerOn(14, 80, 1.0));
    await page.waitForTimeout(300);
    await shot(page, info, "ground-real-home-low");
  }
  check();
});

test("寫實地面：沒有 ?ground=real 照舊畫兩種綠；美術關（沒有地形的圖）時也不換", async ({ page }) => {
  const check = watchErrors(page);
  await start(page, "watch=1&ai=0&art=x3");
  await expect.poll(() => look(page)).toEqual({ real: false, quality: null, water: false, town: false });
  await start(page, "watch=1&ai=0&art=off&ground=real");
  await expect.poll(() => look(page)).toEqual({ real: false, quality: null, water: false, town: false });
  check();
});
