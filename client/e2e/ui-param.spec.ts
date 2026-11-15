// ?ui= on any page (R24-01, ceo 2026-11-15): 正式介面 the default (D-150), ?ui=proto the prototype, ?ui=r6 正式介面, on a
// player's page too, not only test pages (whose games are not sent to the logs). Only the start screen here: no game
// starts, so nothing is sent.

import { expect, test } from "@playwright/test";

test("預設是正式介面；?ui=proto 是原型、?ui=r6 是正式介面，不用 test=1 也有效", async ({ page }) => {
  await page.goto("./");
  await expect(page.locator("html")).toHaveAttribute("data-ui", "r6");
  await expect(page.getByRole("button", { name: "開始" })).toBeVisible();
  await page.goto("./?ui=proto");
  await expect(page.locator("html")).not.toHaveAttribute("data-ui", "r6");
  await expect(page.getByRole("button", { name: "開始" })).toBeVisible();
  await page.goto("./?ui=r6");
  await expect(page.locator("html")).toHaveAttribute("data-ui", "r6");
});
