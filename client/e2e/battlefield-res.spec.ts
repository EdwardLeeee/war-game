// 戰場像素比 (ceo 2026-11-06, after client's fps comparison: on art-v7.5's diamond the frame's time
// follows the pixels drawn): on a test page the 量測 panel draws the battlefield at 2 on a phone of 3,
// at once, the interface as it was; ?res=2 starts it so, and the address keeps it for the art-v7 量測
// pages. A plain page has no such row.

import { expect, type Page, test } from "@playwright/test";
import { openLab } from "./helpers.ts";

const canvasWidth = (page: Page) => page.evaluate(() => document.querySelector<HTMLCanvasElement>("#stage canvas")?.width ?? 0);
const resParam = (page: Page) => new URL(page.url()).searchParams.get("res");

async function start(page: Page, q = ""): Promise<void> {
  await page.goto(`./?test=1&mock=1&tps=20${q}`);
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true);
  await openLab(page);
}

test("戰場像素比：量測面板切 2 馬上生效、介面不變、網址帶著；切回照裝置", async ({ page, browserName }) => {
  test.skip(browserName !== "webkit", "the iPhone's pixel ratio 3 (Chromium runs at 1 here)");
  await start(page);
  const width = await page.evaluate(() => innerWidth);
  const group = page.getByRole("radiogroup", { name: "戰場像素比" });
  await expect(group.getByRole("radio")).toHaveText(["照裝置（3）", "2"]);
  await expect(group.getByRole("radio", { name: "照裝置（3）" })).toHaveAttribute("aria-checked", "true");
  expect(await canvasWidth(page)).toBe(width * 3);
  const menuBox = await page.getByRole("button", { name: "選單" }).boundingBox();
  await group.getByRole("radio", { name: "2" }).tap();
  await expect(group.getByRole("radio", { name: "2" })).toHaveAttribute("aria-checked", "true");
  await expect.poll(() => canvasWidth(page)).toBe(width * 2);
  expect(resParam(page)).toBe("2");
  // The interface is the page's: as it was.
  expect(await page.getByRole("button", { name: "選單" }).boundingBox()).toEqual(menuBox);
  await expect(page.getByText("戰場像素比：2（裝置 3；介面照裝置）")).toBeVisible();
  await group.getByRole("radio", { name: "照裝置（3）" }).tap();
  await expect.poll(() => canvasWidth(page)).toBe(width * 3);
  expect(resParam(page)).toBeNull();
});

test("戰場像素比：?res=2 一開始就畫 2；量測結果寫用的是幾", async ({ page, browserName }) => {
  test.skip(browserName !== "webkit", "the iPhone's pixel ratio 3 (Chromium runs at 1 here)");
  test.setTimeout(120_000);
  await start(page, "&res=2");
  const width = await page.evaluate(() => innerWidth);
  expect(await canvasWidth(page)).toBe(width * 2);
  await expect(page.getByRole("radiogroup", { name: "戰場像素比" }).getByRole("radio", { name: "2" })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("button", { name: "量測 120 人" }).tap();
  await expect(page.locator(".lab-result")).toContainText("戰場像素比：2（裝置 3）", { timeout: 90_000 });
});

test("戰場像素比：切 2 以後按 art-v7 量測，新開的那頁也畫 2，結果寫 2", async ({ page, browserName }) => {
  test.skip(browserName !== "webkit", "the iPhone's pixel ratio 3 (Chromium runs at 1 here)");
  test.setTimeout(150_000);
  await page.goto("./?test=1&art=test&scenario=e2e&measures=5");
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true);
  await openLab(page);
  await page.getByRole("radiogroup", { name: "戰場像素比" }).getByRole("radio", { name: "2" }).tap();
  await page.getByRole("group", { name: "art-v7 量測" }).getByRole("button", { name: "量 x3 ASTC" }).tap();
  await page.waitForURL(/measure=x3-astc/);
  await page.waitForFunction(() => window.__proto?.ready === true, null, { timeout: 90_000 });
  expect(resParam(page)).toBe("2");
  expect(await canvasWidth(page)).toBe((await page.evaluate(() => innerWidth)) * 2);
  await expect(page.locator(".lab-result")).toContainText("戰場像素比：2（裝置 3）", { timeout: 120_000 });
});

test("戰場像素比：裝置只有 1、2 時沒得省，2 不能按", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "Chromium runs at pixel ratio 1 here");
  await start(page, "&res=2");
  const group = page.getByRole("radiogroup", { name: "戰場像素比" });
  await expect(group.getByRole("radio", { name: "照裝置（1）" })).toHaveAttribute("aria-checked", "true");
  await expect(group.getByRole("radio", { name: "2" })).toBeDisabled();
  expect(await canvasWidth(page)).toBe(await page.evaluate(() => innerWidth));
});

test("戰場像素比：一般頁面的量測面板沒有這一列", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("./");
  await page.getByRole("button", { name: "開始" }).tap();
  // A plain page shows 開局提示 first.
  const hint = page.locator(".dialog.town-hint");
  await expect(hint).toBeVisible({ timeout: 60_000 });
  await hint.getByRole("button", { name: "知道了" }).tap();
  await openLab(page);
  await expect(page.getByRole("region", { name: "量測與確定性檢查" })).toBeVisible();
  await expect(page.getByRole("radiogroup", { name: "戰場像素比" })).toHaveCount(0);
});
