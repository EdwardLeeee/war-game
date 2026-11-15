// ?ui=r6 on any page (R24-01, ceo 2026-11-15): the player opens 正式介面 for a real game, not only test pages (whose games
// are not sent to the logs). Only the start screen here: no game starts, so nothing is sent.

import { expect, test } from "@playwright/test";

test("?ui=r6 不用 test=1 也打開正式介面；?ui=proto、沒帶就是原型（預設照舊）", async ({ page }) => {
  await page.goto("./?ui=r6");
  await expect(page.locator("html")).toHaveAttribute("data-ui", "r6");
  await expect(page.getByRole("button", { name: "開始" })).toBeVisible();
  await page.goto("./?ui=proto");
  await expect(page.locator("html")).not.toHaveAttribute("data-ui", "r6");
  await page.goto("./");
  await expect(page.locator("html")).not.toHaveAttribute("data-ui", "r6");
});
