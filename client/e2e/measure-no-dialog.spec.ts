// 量測 (D-083, D-128) with nothing over its panel and result (ceo 2026-11-06: on the user's
// art-v7 量測, perf360, our side took the big city at about minute 4 and 「攻下大城！搶還是治理？」
// covered the panel). Measuring, a town taken opens no dialog (nothing is sent: the game goes as it
// would); a game that does not measure opens it as always. 開局提示 is not shown either.

import { expect, type Page, test } from "@playwright/test";
import { expectNotSaid, expectSaid, openLab, saidMark, watchToasts } from "./helpers.ts";

/** A town taken: by us, or by the enemy. */
const captured = (page: Page, ours = true) =>
  page.evaluate((o) => {
    const g = window.__proto?.game;
    if (g === undefined) return;
    g.inject({ k: "town_captured", town: 0, by: o ? g.me() : 1 - g.me() });
  }, ours);

test("量測時攻下城鎮不跳出搶還是治理（蓋住量測面板）；不量測時照舊跳出", async ({ page }) => {
  test.setTimeout(120_000);
  await watchToasts(page);
  await page.goto("./?test=1&mock=1&tps=20&hint=1");
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true);
  // Not measuring: the dialog, as always (開局提示 first, on this page).
  const dialog = page.locator(".dialog");
  if (await dialog.isVisible()) await dialog.getByRole("button", { name: "知道了" }).tap();
  await captured(page);
  await expect(dialog.locator(".town-choice, .dialog-card")).toBeVisible();
  await expect(dialog).toHaveClass(/\btown-choice\b/);
  await dialog.getByRole("button", { name: /稍後再決定/ }).tap();
  // Measuring (量測 360 人 from the panel): no dialog over it, no 開局提示 either.
  await openLab(page);
  await page.getByRole("button", { name: "量測 360 人" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true);
  await expect(page.getByRole("region", { name: "量測與確定性檢查" })).toBeVisible();
  await expect(dialog).toBeHidden();
  const mark = await saidMark(page);
  await captured(page);
  await page.waitForTimeout(1000);
  await expect(dialog, "nothing over the 量測 panel").toBeHidden();
  await expect(page.getByRole("region", { name: "量測與確定性檢查" })).toBeVisible();
  // Ours: nothing said either (not the enemy's line).
  await expectNotSaid(page, "敵方攻下了一座城鎮", mark);
  // The enemy's: said, as always.
  await captured(page, false);
  await expectSaid(page, "敵方攻下了一座城鎮", {}, { from: mark });
  await expect(dialog).toBeHidden();
});
