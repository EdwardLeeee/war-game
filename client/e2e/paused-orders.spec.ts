// 暫停時下的指令要馬上看得到 (the user 2026-10-19: 「然後按暫停造兵跟放建築應該要顯示，不然還以為沒
// 按到」; ceo): on core's real simulation, which takes no order while paused. 自動訓練 turned off
// reads 目前：暫停 at once and the barracks gets its 停 tag; a spearman trained shows in the queue
// at once (繼續後開始); a house placed leaves a pale site and a line; after 繼續 they are real.

import { expect, type Page, test } from "@playwright/test";
import { shot, watchErrors } from "./helpers.ts";
import { tap } from "./touch.ts";

const BARRACKS = 6;
const HOUSE = 1;

const header = (page: Page) => page.evaluate(() => window.__proto?.game?.header() ?? { tick: -1, paused: false, speed: 0, scenario: -1 });
const buildings = (page: Page) => page.evaluate(() => window.__proto?.game?.buildings() ?? []);
const toScreen = (page: Page, c: { x: number; y: number }) => page.evaluate(([x, y]) => window.__proto?.game?.cellToScreen(x, y) ?? { x: 0, y: 0 }, [c.x, c.y] as const);
const pending = (page: Page, building?: number) => page.evaluate((b) => window.__proto?.game?.pending(b) ?? { sites: -1, trains: -1 }, building);
/** BuildingFlag.AutoTrain (sim/src/protocol.ts). */
const AUTO_TRAIN = 8;

test("遊戲暫停時：暫停自動訓練、練兵、放建築都馬上看得到；按繼續後換成模擬真的狀態（使用者 2026-10-19）", async ({ page }, info) => {
  test.setTimeout(120_000);
  const check = watchErrors(page);
  await page.goto("./?test=1&scenario=e2e");
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true, null, { timeout: 60_000 });
  await page.getByRole("button", { name: "暫停", exact: true }).tap();
  await expect.poll(async () => (await header(page)).paused).toBe(true);
  const frozen = (await header(page)).tick;

  // Our barracks: selected by a tap on it.
  const me = await page.evaluate(() => window.__proto?.game?.me() ?? 0);
  const barracks = (await buildings(page)).find((b) => b.owner === me && b.type === BARRACKS);
  if (barracks === undefined) throw new Error("no barracks");
  expect(barracks.flags & AUTO_TRAIN, "自動訓練 on at the start (D-054)").not.toBe(0);
  await page.evaluate(([x, y]) => window.__proto?.game?.centerOn(x, y, 1.2), [barracks.cx + 1, barracks.cy + 1] as const);
  await tap(page, await toScreen(page, { x: barracks.cx + 1, y: barracks.cy + 1 }));
  await expect.poll(async () => (await page.evaluate(() => window.__proto?.game?.selection()))?.building).toBe(barracks.id);

  // 自動訓練: the button reads 暫停 at once, a line says it starts on 繼續; the simulation has not taken it.
  const auto = page.locator(".cmds").getByRole("button", { name: /^自動訓練/ });
  await auto.tap();
  await expect(auto).toContainText("目前：暫停");
  await expect(page.getByText("已暫停這座兵營的自動訓練，按繼續後生效")).toBeVisible();
  expect(((await buildings(page)).find((b) => b.id === barracks.id)?.flags ?? 0) & AUTO_TRAIN, "not taken yet").not.toBe(0);

  // 訓練槍兵: in the queue at once, 繼續後開始.
  await page.locator(".cmds").getByRole("button", { name: /^訓練槍兵/ }).tap();
  await expect(page.locator(".sel-queue .pending")).toHaveCount(1);
  await expect(page.locator(".sel-queue .pending")).toContainText("繼續後開始");
  expect(await pending(page, barracks.id)).toMatchObject({ trains: 1 });

  // 民居: placed where it may go, ✓: a pale site and a line.
  const spot = await page.evaluate(([x, y]) => window.__proto?.game?.buildSpotNear(1, x, y) ?? null, [barracks.cx - 4, barracks.cy + 2] as const);
  if (spot === null) throw new Error("no spot for a house");
  await page.evaluate((t) => window.__proto?.game?.startPlacement(t), HOUSE);
  await tap(page, await toScreen(page, { x: spot.x + 0.5, y: spot.y + 0.5 }));
  await expect.poll(() => page.evaluate(() => window.__proto?.game?.placement()?.valid ?? false)).toBe(true);
  await page.getByRole("button", { name: "確定蓋在這裡" }).tap();
  await expect(page.getByText(/^已下令蓋民居，按繼續後開工$/)).toBeVisible();
  expect(await pending(page)).toMatchObject({ sites: 1 });
  await shot(page, info, "paused-orders");
  expect((await header(page)).tick, "no ticks while paused").toBe(frozen);

  // 繼續: the simulation takes them; what was shown gives way to what is.
  await page.getByRole("button", { name: "繼續", exact: true }).tap();
  await expect.poll(async () => (await pending(page, barracks.id)).sites, { timeout: 15_000 }).toBe(0);
  await expect.poll(async () => ((await buildings(page)).find((b) => b.id === barracks.id)?.flags ?? AUTO_TRAIN) & AUTO_TRAIN, { timeout: 15_000 }).toBe(0);
  await expect.poll(async () => (await buildings(page)).some((b) => b.owner === me && b.type === HOUSE && b.progress < 1000), { timeout: 15_000 }).toBe(true);
  await expect(page.locator(".sel-queue .pending")).toHaveCount(0);
  await expect(auto).toContainText("目前：暫停");
  check();
});
