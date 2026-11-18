// 載入中 (ceo 2026-11-18: the player took the black screen while a game loaded for a broken one): a new game (開始,
// 新手教學, from 設定 in a game) keeps the start screen up with what it is doing, the bar running back and forth (no
// share of it known), until the battlefield shows; 取消 goes back, a game kept stays kept; a failure says why, with
// 重試 and 回開局畫面. 正式介面 at 932 × 336, the test atlases held back or the simulation's Worker, to see each stage.

import { expect, type Page, type Route, test } from "@playwright/test";
import { injectSafeArea, watchErrors } from "./helpers.ts";

const line = (page: Page) => page.locator("#continue-progress");
const ready = (page: Page) => page.waitForFunction(() => window.__proto?.ready === true && window.__proto.screen === "battle", null, { timeout: 120_000 });

/** Requests matching `pattern` wait until released (the stage they belong to stays on screen). */
async function hold(page: Page, pattern: string): Promise<() => void> {
  const waiting: Route[] = [];
  let open = false;
  await page.route(pattern, (route) => {
    if (open) void route.continue();
    else waiting.push(route);
  });
  return () => {
    open = true;
    for (const r of waiting.splice(0)) void r.continue();
  };
}

async function open(page: Page, query = ""): Promise<void> {
  await page.setViewportSize({ width: 932, height: 336 });
  await page.goto(`./?test=1&art=test${query}`);
  await injectSafeArea(page);
}

test("開始：畫面出來以前開局畫面不收，寫著載入中和階段（下載圖片時下面一行小字），進度條沒有百分比；出來以後才收", async ({ page }) => {
  const check = watchErrors(page);
  await open(page);
  const release = await hold(page, "**/art/test/**");
  await page.getByRole("button", { name: "開始", exact: true }).tap();
  await expect(line(page)).toBeVisible();
  await expect(line(page)).toContainText("載入中：下載圖片");
  await expect(page.locator("#loading-note")).toHaveText("第一次要下載圖片，之後就不用了");
  // No share of it known: the bar without a value runs back and forth.
  await expect(page.locator("#continue-bar")).not.toHaveAttribute("value");
  await expect(page.locator("#continue-retry")).toBeHidden();
  await expect(page.getByRole("button", { name: "取消" })).toBeVisible();
  // The start screen's other buttons and the game's wait out of sight.
  await expect(page.locator("#start-buttons")).toBeHidden();
  expect(await page.evaluate(() => getComputedStyle(document.getElementById("hud") as HTMLElement).visibility)).toBe("hidden");
  expect(await page.evaluate(() => window.__proto?.ready)).toBe(false);
  release();
  await ready(page);
  await expect(page.locator("#start")).toBeHidden();
  await expect(page.locator("#loading-note")).toBeHidden();
  expect(await page.evaluate(() => getComputedStyle(document.getElementById("hud") as HTMLElement).visibility)).toBe("visible");
  check();
});

test("載入中按取消：回開局畫面、沒有開局；之前存的局照樣留著，「繼續上一局」接得上", async ({ page }) => {
  test.setTimeout(180_000);
  // A game kept (the e2e scenario, fast), then the page again.
  await open(page, "&scenario=e2e&tps=400");
  await page.getByRole("button", { name: "開始", exact: true }).tap();
  await ready(page);
  await expect.poll(() => page.evaluate(() => window.__proto?.game?.header().tick ?? 0), { timeout: 60_000 }).toBeGreaterThan(1300);
  await page.evaluate(() => window.__proto?.game?.pause());
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(async () => (await page.evaluate(async () => (await window.__proto?.saved()) ?? null))?.tick ?? -1, { timeout: 15_000 }).toBeGreaterThan(1300);
  const kept = (await page.evaluate(async () => (await window.__proto?.saved())?.tick)) ?? -1;
  await open(page);
  await expect(page.getByRole("button", { name: /^繼續上一局/ })).toBeVisible();
  // 開始 (a new game takes the kept one's place once it shows), then 取消 while its pictures load.
  const release = await hold(page, "**/art/test/**");
  await page.getByRole("button", { name: "開始", exact: true }).tap();
  await expect(line(page)).toContainText("載入中");
  await page.getByRole("button", { name: "取消" }).tap();
  await expect(line(page)).toBeHidden();
  await expect(page.locator("#start-buttons")).toBeVisible();
  await expect(page.getByRole("button", { name: "開始", exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__proto?.screen)).toBe("start");
  release();
  await page.waitForTimeout(1000);
  expect(await page.evaluate(() => window.__proto?.game ?? null), "no game started").toBeNull();
  expect((await page.evaluate(async () => (await window.__proto?.saved()) ?? null))?.tick, "the game kept stays").toBe(kept);
  await expect(page.getByRole("button", { name: /^繼續上一局/ })).toBeVisible();
});

test("模擬沒有啟動：載入失敗寫原因，有「重試」和「回開局畫面」；重試就開得起來", async ({ page }) => {
  await open(page);
  // The simulation's Worker not there (the network gone meanwhile).
  await page.route("**/assets/worker-*.js", (route) => route.abort());
  await page.getByRole("button", { name: "開始", exact: true }).tap();
  await expect(line(page)).toContainText("載入失敗：模擬沒有啟動", { timeout: 30_000 });
  await expect(page.locator("#continue-bar")).toBeHidden();
  await expect(page.getByRole("button", { name: "重試" })).toBeVisible();
  await expect(page.getByRole("button", { name: "回開局畫面" })).toBeVisible();
  await expect(page.locator("#start")).toBeVisible();
  await page.unroute("**/assets/worker-*.js");
  await page.getByRole("button", { name: "重試" }).tap();
  await ready(page);
  await expect(page.locator("#start")).toBeHidden();
  // And 回開局畫面 after a failure: the start screen as when the page opened.
  await open(page);
  await page.route("**/assets/worker-*.js", (route) => route.abort());
  await page.getByRole("button", { name: "開始", exact: true }).tap();
  await page.getByRole("button", { name: "回開局畫面" }).tap();
  await expect(line(page)).toBeHidden();
  await expect(page.getByRole("button", { name: "開始", exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__proto?.screen)).toBe("start");
});

test("新手教學：從開局畫面、從一局的「設定」進去，載入時都是開局畫面寫著載入中，不是黑的", async ({ page }) => {
  test.setTimeout(180_000);
  const check = watchErrors(page);
  await open(page, "&tps=100");
  let release = await hold(page, "**/art/test/**");
  await page.getByRole("button", { name: "新手教學" }).tap();
  await expect(line(page)).toContainText("載入中");
  await expect(page.locator("#start")).toBeVisible();
  release();
  await ready(page);
  await expect.poll(() => page.evaluate(() => window.__proto?.tutorial()?.phase ?? null)).toBe("1");
  await page.unroute("**/art/test/**");
  // A game, then 選單 → 設定 → 新手教學: its Worker held, so 準備地圖 stays a while.
  await open(page, "&scenario=e2e&tps=100");
  await page.getByRole("button", { name: "開始", exact: true }).tap();
  await ready(page);
  release = await hold(page, "**/assets/worker-*.js");
  await page.getByRole("button", { name: "選單", exact: true }).tap();
  await page.getByRole("button", { name: /^設定/ }).tap();
  await page.getByRole("button", { name: /新手教學/ }).tap();
  await page.getByRole("button", { name: "開始教學" }).tap();
  await expect(line(page)).toContainText("載入中：準備地圖");
  await expect(page.locator("#start")).toBeVisible();
  await expect(page.locator("#loading-note")).toBeHidden();
  release();
  await ready(page);
  await expect(page.locator("#start")).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.__proto?.tutorial()?.phase ?? null)).toBe("1");
  check();
});
