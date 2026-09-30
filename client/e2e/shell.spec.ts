// Page shell: start screen, touch-target size, safe area, portrait prompt, entering the
// battlefield. Runs in WebKit and Chromium at iPhone 14 Pro Max landscape size with touch.

import { expect, test } from "@playwright/test";
import { FULL_SCREEN, INTERACTIVE, IPHONE_SAFE, injectSafeArea, shot, visibleBoxes, watchErrors } from "./helpers.ts";

let checkErrors: () => void;

test.beforeEach(async ({ page }) => {
  checkErrors = watchErrors(page);
  await page.goto("./?test=1");
});

test.afterEach(() => {
  checkErrors();
});

test("開局畫面：一個模式、開始鈕、原型標示", async ({ page }, info) => {
  info.annotations.push({ type: "viewport", description: JSON.stringify(page.viewportSize()) });
  await expect(page.getByRole("heading", { name: "war-game 原型" })).toBeVisible();
  await expect(page.getByText("1 對 1 對簡單 AI")).toBeVisible();
  await expect(page.getByRole("button", { name: "開始" })).toBeVisible();
  await expect(page.getByText("原型介面（非正式設計）")).toBeVisible();
  await expect(page.locator("#commit")).toHaveText(/^commit ([0-9a-f]{7}|unknown)$/);
  await shot(page, info, "start");
});

for (const size of [
  { name: "工具列展開", viewport: null },
  { name: "工具列收合", viewport: FULL_SCREEN },
]) {
  test(`觸控目標至少 44 pt、不被安全區蓋住、沒有水平捲動（${size.name}）`, async ({ page }, info) => {
    if (size.viewport !== null) await page.setViewportSize(size.viewport);
    await injectSafeArea(page);
    const { width, height } = page.viewportSize() ?? { width: 0, height: 0 };
    info.annotations.push({ type: "viewport", description: `${width}x${height}` });

    const targets = await visibleBoxes(page, INTERACTIVE);
    expect(targets.length).toBeGreaterThan(0);
    for (const b of targets) {
      expect.soft(b.width, `${b.label} width`).toBeGreaterThanOrEqual(44);
      expect.soft(b.height, `${b.label} height`).toBeGreaterThanOrEqual(44);
    }
    const inSafeArea = [...targets, ...(await visibleBoxes(page, "#proto-label"))];
    for (const b of inSafeArea) {
      expect.soft(b.x, `${b.label} left edge`).toBeGreaterThanOrEqual(IPHONE_SAFE.left);
      expect.soft(b.x + b.width, `${b.label} right edge`).toBeLessThanOrEqual(width - IPHONE_SAFE.right);
      expect.soft(b.y, `${b.label} top edge`).toBeGreaterThanOrEqual(IPHONE_SAFE.top);
      expect.soft(b.y + b.height, `${b.label} bottom edge`).toBeLessThanOrEqual(height - IPHONE_SAFE.bottom);
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, "horizontal overflow in px").toBeLessThanOrEqual(0);
    await shot(page, info, `safe-area-${width}x${height}`);
  });
}

test("點開始進入戰場", async ({ page }, info) => {
  await page.getByRole("button", { name: "開始" }).tap();
  await expect(page.locator("#start")).toBeHidden();
  await expect(page.locator("#stage canvas")).toBeVisible();
  await page.waitForFunction(() => window.__proto?.screen === "battle" && window.__proto.ready);
  await expect(page.getByText("原型介面（非正式設計）")).toBeVisible();
  await shot(page, info, "battle");
});

test("直向時蓋住畫面、顯示請轉成橫向", async ({ page }, info) => {
  const landscape = page.viewportSize() ?? FULL_SCREEN;
  await page.setViewportSize({ width: landscape.height, height: landscape.width });
  const prompt = page.getByText("請轉成橫向");
  await expect(prompt).toBeVisible();
  const cover = await page.locator("#rotate").boundingBox();
  expect(cover).toEqual({ x: 0, y: 0, width: landscape.height, height: landscape.width });
  await shot(page, info, "portrait");

  await page.setViewportSize(landscape);
  await expect(prompt).toBeHidden();
});
