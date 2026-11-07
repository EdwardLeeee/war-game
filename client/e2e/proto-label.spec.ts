// 原型介面's label (ceo 2026-11-07; the prototype only, INV-16): at the top left it sat on 重設 on a short screen (932 × 336,
// Safari with its tab bar, the iPhone's safe area), the column under 重設 being laid from the bottom up. There it goes beside
// 編隊 1 on the battlefield, clear of all that is on screen; with the start card or a dialog up, which would cover
// that place, it stays at the top left, clear of them. On a taller screen it is where it always was.

import { expect, type Page, test } from "@playwright/test";
import { injectSafeArea, IPHONE_SAFE, selectForCommands } from "./helpers.ts";

/** What the label is over: the visible things it meets. */
const over = (page: Page, selector: string) =>
  page.evaluate((sel) => {
    const l = document.querySelector("#proto-label")?.getBoundingClientRect();
    if (l === undefined) return ["no label"];
    return [...document.querySelectorAll<HTMLElement>(sel)]
      .filter((e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== "hidden")
      .filter((e) => {
        const r = e.getBoundingClientRect();
        return Math.min(r.right, l.right) - Math.max(r.left, l.left) > 0 && Math.min(r.bottom, l.bottom) - Math.max(r.top, l.top) > 0;
      })
      .map((e) => e.textContent?.slice(0, 12) || e.className);
  }, selector);

const BATTLE = "#hud button, .res-bar, .paused-banner, .sel-info, .cmds, .prompt, .minimap";

async function start(page: Page, size: { width: number; height: number }): Promise<void> {
  await page.setViewportSize(size);
  await page.goto("./?test=1&mock=1&tps=20");
  await injectSafeArea(page);
  await expect(page.locator("#proto-label")).toBeVisible();
}

test("原型介面標籤（932×336，iPhone 安全區）：戰場上、暫停、選兵、選位置都不壓到按鈕和面板；開局卡片、對話框開著時也不被蓋到", async ({ page }) => {
  test.setTimeout(90_000);
  await start(page, { width: 932, height: 336 });
  const card = await page.locator("#start .card").boundingBox();
  const atStart = await page.locator("#proto-label").boundingBox();
  expect((atStart?.x ?? 0) + (atStart?.width ?? 0), "clear of the start card").toBeLessThanOrEqual(card?.x ?? 0);
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true);
  expect(await over(page, BATTLE), "on the battlefield").toEqual([]);
  // Inside the safe area, under the top row.
  const l = await page.locator("#proto-label").boundingBox();
  expect((l?.x ?? 0) + (l?.width ?? 0)).toBeLessThanOrEqual(932 - IPHONE_SAFE.right);
  await page.getByRole("button", { name: "暫停", exact: true }).tap();
  await expect(page.locator(".paused-banner")).toBeVisible();
  expect(await over(page, BATTLE), "paused").toEqual([]);
  const me = await page.evaluate(() => window.__proto?.game?.me() ?? 0);
  const ids = (await page.evaluate(() => window.__proto?.game?.units() ?? [])).filter((u) => u.owner === me && u.type !== 0).map((u) => u.id);
  await selectForCommands(page, ids);
  await expect(page.locator(".sel-info")).toBeVisible();
  expect(await over(page, BATTLE), "units selected").toEqual([]);
  await page.locator(".cmds").getByRole("button", { name: /^移動/ }).tap();
  await expect(page.locator(".prompt")).toBeVisible();
  expect(await over(page, BATTLE), "choosing where to go").toEqual([]);
  await page.getByRole("button", { name: "選單" }).tap();
  await expect(page.locator(".dialog-card")).toBeVisible();
  expect(await over(page, ".dialog-card"), "a dialog up").toEqual([]);
  await page.getByRole("button", { name: "關閉" }).tap();
  await expect(page.locator(".dialog-card")).toBeHidden();
  expect(await over(page, BATTLE), "back on the battlefield").toEqual([]);
});

for (const size of [
  { width: 932, height: 430 },
  { width: 814, height: 380 },
]) {
  test(`原型介面標籤（${size.width}×${size.height}）：位置照舊，全軍撤退左邊`, async ({ page }) => {
    await start(page, size);
    await page.getByRole("button", { name: "開始" }).tap();
    await page.waitForFunction(() => window.__proto?.ready === true);
    const l = await page.locator("#proto-label").boundingBox();
    const retreat = await page.locator(".retreat-all-btn").boundingBox();
    expect(l?.y).toBe(42);
    expect((l?.x ?? 0) + (l?.width ?? 0)).toBeLessThanOrEqual(retreat?.x ?? 0);
    expect(await over(page, BATTLE)).toEqual([]);
  });
}
