// 下指令的回饋 (the user 2026-10-19: 「然後按暫停造兵跟放建築應該要顯示，不然還以為沒按到」; R6-31,
// ceo): on core's real simulation, which takes no order while paused. Paused, each order shows at
// once, dashed, saying it waits for 繼續 (the spearman's cell 繼續後開始, the house's site; 自動訓練's
// pause is the screen's own since D-098, at once), a dark line with a check says what was ordered,
// and the banner counts them; on
// 繼續 they are real. Running, the lines say what was done (排第 N, 派 N 名村民), and ✗ on a
// preview says 已取消 without the check.

import { expect, type Page, test } from "@playwright/test";
import { shot, watchErrors } from "./helpers.ts";
import { tap } from "./touch.ts";

const BARRACKS = 6;
const HOUSE = 1;

const header = (page: Page) => page.evaluate(() => window.__proto?.game?.header() ?? { tick: -1, paused: false, speed: 0, scenario: -1 });
const buildings = (page: Page) => page.evaluate(() => window.__proto?.game?.buildings() ?? []);
const toScreen = (page: Page, c: { x: number; y: number }) => page.evaluate(([x, y]) => window.__proto?.game?.cellToScreen(x, y) ?? { x: 0, y: 0 }, [c.x, c.y] as const);
const pending = (page: Page, building?: number) => page.evaluate((b) => window.__proto?.game?.pending(b) ?? { sites: -1, trains: -1, waiting: -1 }, building);
/** BuildingFlag.AutoTrain (sim/src/protocol.ts). */
const AUTO_TRAIN = 8;

/** A house's preview where one may go near (x, y), confirmed with ✓ or put away with ✗. */
async function placeHouse(page: Page, near: { x: number; y: number }, answer: "確定蓋在這裡" | "取消放建築"): Promise<void> {
  const spot = await page.evaluate(([x, y]) => window.__proto?.game?.buildSpotNear(1, x, y) ?? null, [near.x, near.y] as const);
  if (spot === null) throw new Error("no spot for a house");
  await page.evaluate((t) => window.__proto?.game?.startPlacement(t), HOUSE);
  await tap(page, await toScreen(page, { x: spot.x + 0.5, y: spot.y + 0.5 }));
  await expect.poll(() => page.evaluate(() => window.__proto?.game?.placement()?.valid ?? false)).toBe(true);
  await page.getByRole("button", { name: answer }).tap();
}

/** A game on core's simulation (the e2e scenario), paused, our barracks selected; its row. */
async function pausedAtBarracks(page: Page, query = "") {
  await page.goto(`./?test=1&scenario=e2e${query}`);
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true, null, { timeout: 60_000 });
  await page.getByRole("button", { name: "暫停", exact: true }).tap();
  await expect.poll(async () => (await header(page)).paused).toBe(true);
  const me = await page.evaluate(() => window.__proto?.game?.me() ?? 0);
  const barracks = (await buildings(page)).find((b) => b.owner === me && b.type === BARRACKS);
  if (barracks === undefined) throw new Error("no barracks");
  await page.evaluate(([x, y]) => window.__proto?.game?.centerOn(x, y, 1.2), [barracks.cx + 1, barracks.cy + 1] as const);
  await tap(page, await toScreen(page, { x: barracks.cx + 1, y: barracks.cy + 1 }));
  await expect.poll(async () => (await page.evaluate(() => window.__proto?.game?.selection()))?.building).toBe(barracks.id);
  return { me, barracks };
}

test("下指令的回饋：暫停中先畫出結果（虛線、繼續後…）、橫幅數指令；不暫停時訊息條說做了什麼；✗ 說已取消（R6-31）", async ({ page }, info) => {
  test.setTimeout(150_000);
  const check = watchErrors(page);
  const { me, barracks } = await pausedAtBarracks(page);
  // No villagers from the main city (D-098): filling the population, they would say 「人口滿了」 over
  // this test's messages (#275's run 39779654415: over 「已下令訓練槍兵（排第 N）」).
  await page.evaluate(() => window.__proto?.game?.villagersPaused(true));
  const frozen = (await header(page)).tick;
  const banner = page.locator(".paused-banner");
  const waiting = page.locator(".paused-banner .pend");
  const toast = page.locator(".toast");
  await expect(banner).toBeVisible();
  await expect(waiting, "no orders yet: no second line").toBeHidden();

  // 自動訓練 (D-098): the screen's own pause, at once and not an order (the banner counts none).
  const auto = page.locator(".cmds").getByRole("button", { name: /^自動訓練/ });
  await auto.tap();
  await expect(auto).toContainText("目前：暫停");
  await expect(auto).not.toHaveClass(/\bpending\b/);
  await expect(toast).toHaveText("已暫停這座兵營的自動訓練");
  await expect(toast).toHaveClass(/\btoast-ok\b/);
  await expect(toast.locator(".toast-check")).toBeVisible();
  await expect(waiting).toBeHidden();

  // 訓練槍兵: a dashed cell in the queue at once, 繼續後開始.
  await page.locator(".cmds").getByRole("button", { name: /^訓練槍兵/ }).tap();
  await expect(page.locator(".sel-queue .pending")).toHaveCount(1);
  await expect(page.locator(".sel-queue .pending")).toContainText("繼續後開始");
  await expect(toast).toHaveText("已下令訓練槍兵，按繼續後開始");
  await expect(waiting).toHaveText("已下 1 個指令，按繼續後執行");
  expect(await pending(page, barracks.id)).toMatchObject({ trains: 1 });

  // 民居, placed and ✓: its site at once (see-through, dashed, 繼續後開工).
  await placeHouse(page, { x: barracks.cx - 4, y: barracks.cy + 2 }, "確定蓋在這裡");
  await expect(toast).toHaveText("已下令蓋民居，按繼續後開工");
  await expect(waiting).toHaveText("已下 2 個指令，按繼續後執行");
  expect(await pending(page)).toMatchObject({ sites: 1, waiting: 2 });
  await shot(page, info, "paused-orders");
  expect((await header(page)).tick, "no ticks while paused").toBe(frozen);

  // 繼續: the simulation takes them in order; what was shown gives way to what is.
  await page.getByRole("button", { name: "繼續", exact: true }).tap();
  await expect.poll(async () => (await pending(page, barracks.id)).sites, { timeout: 15_000 }).toBe(0);
  // The simulation's own 自動訓練 is off for the player (D-098: the screen sends what to train), from the
  // start (init.autoTrain): no `auto_train off` building by building.
  expect(await page.evaluate(() => window.__proto?.game?.init()?.autoTrain)).toEqual([false, false]);
  await expect.poll(async () => ((await buildings(page)).find((b) => b.id === barracks.id)?.flags ?? AUTO_TRAIN) & AUTO_TRAIN, { timeout: 15_000 }).toBe(0);
  expect((await page.evaluate(() => window.__proto?.game?.sent() ?? [])).filter((c) => (c as { c: string }).c === "auto_train")).toEqual([]);
  await expect.poll(async () => (await buildings(page)).some((b) => b.owner === me && b.type === HOUSE && b.progress < 1000), { timeout: 15_000 }).toBe(true);
  expect(await pending(page)).toMatchObject({ waiting: 0 });
  await expect(page.locator(".sel-queue .pending")).toHaveCount(0);
  await expect(auto).toContainText("目前：暫停");
  await expect(auto).not.toHaveClass(/\bpending\b/);

  // Running: 訓練槍兵 says its place in the queue (those in it, then this one).
  await expect.poll(async () => (await page.evaluate(() => window.__proto?.game?.selection()))?.building).toBe(barracks.id);
  await page.locator(".cmds").getByRole("button", { name: /^訓練槍兵/ }).tap();
  await expect(toast).toHaveText(/^已下令訓練槍兵（排第 \d+）$/);
  await expect(toast).toHaveClass(/\btoast-ok\b/);
  // The barracks higher on screen, its pause mark clear of the line.
  await page.evaluate(([x, y]) => window.__proto?.game?.centerOn(x, y, 1.2), [barracks.cx + 3, barracks.cy + 3] as const);
  await shot(page, info, "running-orders");

  // ✗ on a preview: 已取消, dark, no check (nothing was ordered).
  await placeHouse(page, { x: barracks.cx - 4, y: barracks.cy - 4 }, "取消放建築");
  await expect(toast).toHaveText("已取消蓋民居");
  await expect(toast).toHaveClass(/\btoast-info\b/);
  await expect(toast.locator(".toast-check")).toBeHidden();
  expect(await page.evaluate(() => window.__proto?.game?.placement() ?? null)).toBeNull();

  // A house running, no farmers selected (the barracks is): 派 1 名村民, the nearest (a house is 2 x 2).
  await placeHouse(page, { x: barracks.cx - 4, y: barracks.cy - 4 }, "確定蓋在這裡");
  await expect(toast).toHaveText(/^已下令蓋民居，派 1 名村民$/);
  check();
});

test("下指令的回饋，正式介面和 3 倍美術打開時（R6-31）：暫停橫幅是面板，第二行數指令；預定的房子半透明；訊息條綠勾", async ({ page }, info) => {
  test.setTimeout(120_000);
  const check = watchErrors(page);
  const { barracks } = await pausedAtBarracks(page, "&ui=r6&art=x3");
  await expect.poll(() => page.evaluate(() => window.__proto?.game?.art()?.buildings ?? 0), { timeout: 30_000 }).toBeGreaterThan(0);
  const banner = page.locator(".paused-banner.panel");
  await expect(banner).toBeVisible();
  await expect(banner.locator(".pend")).toBeHidden();
  await page.locator(".cmds").getByRole("button", { name: /^自動訓練/ }).tap();
  await page.locator(".cmds").getByRole("button", { name: /^訓練槍兵/ }).tap();
  await placeHouse(page, { x: barracks.cx - 4, y: barracks.cy + 2 }, "確定蓋在這裡");
  await expect(banner.locator(".pend")).toHaveText("已下 2 個指令，按繼續後執行");
  await expect(page.locator(".toast")).toHaveText("已下令蓋民居，按繼續後開工");
  await expect(page.locator(".toast .toast-check")).toBeVisible();
  await shot(page, info, "paused-orders-r6");
  check();
});
