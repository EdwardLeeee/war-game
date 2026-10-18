// 正式美術（D-085）on core's real simulation with stand-in atlases (scripts/make-test-atlas.ts,
// ?test=1&art=test): the units are drawn from atlases instead of the shapes, the 量測 panel has
// 美術 (off unless chosen there; this build without a Release says so), a measurement says
// which atlases, how many pages and the draw calls a frame, and a measurement cut short by a
// reload is told on the start screen. The atlases are only the picture: the game is the same.

import { expect, type Page, test } from "@playwright/test";
import { openLab, shot, watchErrors } from "./helpers.ts";

const art = (page: Page) => page.evaluate(() => window.__proto?.game?.art() ?? null);

async function start(page: Page, query: string): Promise<void> {
  await page.goto(`./?test=1&${query}`);
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true, null, { timeout: 60_000 });
}

test("美術（測試圖）：兵從圖集畫，不再是幾何圖形；載入 10 種兵的頁；關掉時照舊畫圖形", async ({ page }) => {
  const check = watchErrors(page);
  await start(page, "art=test&scenario=e2e");
  // Every unit on screen from its atlas: 10 units × colour, team, shadow (+ the mages' shields) and the effects.
  await expect.poll(async () => (await art(page))?.units ?? 0).toBeGreaterThan(0);
  const a = await art(page);
  expect(a?.label).toBe("測試圖");
  expect(a?.pages).toBe(10 * 3 + 2 + 1);
  const units = await page.evaluate(() => (window.__proto?.game?.units() ?? []).filter((u) => u.action !== 7).length);
  expect(a?.units).toBe(units);
  check();
});

test("美術關著（預設）：照舊畫幾何圖形；這個版本沒有 Release 的圖集時，量測面板的 3 倍、2 倍按不了，寫明原因", async ({ page }, info) => {
  const check = watchErrors(page);
  await start(page, "scenario=e2e");
  expect(await art(page)).toBeNull();
  await openLab(page);
  const group = page.getByRole("radiogroup", { name: "美術" });
  await expect(group.getByRole("radio", { name: "關" })).toHaveAttribute("aria-checked", "true");
  await expect(group.getByRole("radio", { name: "3 倍" })).toBeDisabled();
  await expect(group.getByRole("radio", { name: "2 倍" })).toBeDisabled();
  await expect(group).toContainText("這個版本沒有圖集");
  await shot(page, info, "art-lab-panel");
  check();
});

test("量測（測試圖）：結果框寫美術是哪一套、幾頁圖，和每張畫面的繪製次數", async ({ page }) => {
  test.setTimeout(150_000);
  const check = watchErrors(page);
  await start(page, "art=test&scenario=e2e");
  await openLab(page);
  await page.getByRole("button", { name: "量測 120 人" }).tap();
  // A game of the perf scenario of its own, the atlases kept.
  await page.waitForFunction(() => window.__proto?.ready === true && window.__proto.game?.header().scenario === 2, null, { timeout: 60_000 });
  const result = page.locator(".lab-result");
  await expect(result).toContainText("美術：測試圖，33 頁圖", { timeout: 90_000 });
  await expect(result).toContainText(/每張畫面的繪製次數：中位數 [1-9][\d.]*、最多 [1-9]/);
  check();
});

test("量測到一半頁面重新載入了（Safari 記憶體不足）：開局畫面寫明是哪一次量測", async ({ page }) => {
  await page.goto("./?test=1");
  await page.evaluate(() => sessionStorage.setItem("war-game.proto.measuring", "美術 3 倍，37 頁圖、場景 perf360"));
  await page.reload();
  await expect(page.locator("#measure-note")).toHaveText("上次量測到一半，頁面重新載入了（美術 3 倍，37 頁圖、場景 perf360）");
  // Once: told, then forgotten.
  await page.reload();
  await expect(page.locator("#measure-note")).toBeHidden();
});
