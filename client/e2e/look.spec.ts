// 電影色調 開／關 (the user 2026-11-02, R9-05 B; ceo: off until measured on the iPhone): 選單's
// switch lays the film grade over the battlefield at once, and this device keeps it for the next
// game. The picture of the menu for the user.

import { expect, test } from "@playwright/test";
import { shot, watchErrors } from "./helpers.ts";

test("電影色調（R9-05 B）：預設關；選單按「電影色調：關」馬上蓋上調色、寫開；記在這台裝置上，下一局照樣開著；再按就拿掉", async ({ page }, info) => {
  const check = watchErrors(page);
  const start = async () => {
    await page.goto("./?test=1&mock=1&tps=20");
    await page.getByRole("button", { name: "開始" }).tap();
    await page.waitForFunction(() => window.__proto?.ready === true, null, { timeout: 60_000 });
  };
  const graded = () => page.evaluate(() => window.__proto?.game?.filmGrade() ?? null);
  await start();
  expect(await graded()).toBe(false);
  const menu = page.getByRole("button", { name: "選單", exact: true });
  const dialog = page.locator(".dialog");
  const sw = dialog.getByRole("button", { name: /^電影色調：/ });
  await menu.tap();
  await expect(sw).toHaveText("電影色調：關");
  await expect(sw).toHaveAttribute("aria-pressed", "false");
  await shot(page, info, "look-menu-grade-off");
  await sw.tap();
  await expect(sw).toHaveText("電影色調：開");
  await expect(sw).toHaveAttribute("aria-pressed", "true");
  expect(await graded()).toBe(true);
  await dialog.getByRole("button", { name: "關閉" }).tap();
  // Kept on this device: the next game starts graded.
  await start();
  expect(await graded()).toBe(true);
  await menu.tap();
  await expect(sw).toHaveText("電影色調：開");
  await sw.tap();
  await expect(sw).toHaveText("電影色調：關");
  expect(await graded()).toBe(false);
  check();
});
