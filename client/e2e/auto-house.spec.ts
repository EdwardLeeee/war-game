// 自動蓋民居 (the user 2026-10-25: 「人口快滿時自動蓋民居」; ceo's spec). On the fake world: the
// switch beside 自動村民 on the main city's panel; with the population nearly full, no house while
// it is off or while an enemy soldier is at home; then the gathering villager nearest the main
// city (not one sent there by hand) goes to build one 4–10 cells from it, away from the map's
// centre; one at a time; wood short, the message strip says so. On the real simulation: a game's
// first house goes up on its own, its builder back at work once it stands, and none with the
// switch off.

import { expect, type Page, test } from "@playwright/test";
import { shot, watchErrors } from "./helpers.ts";
import { tap } from "./touch.ts";

const FARMER = 0;
const MAIN_CITY = 0;
const HOUSE = 1;
const GATHER = 4;
const GOLD_MINE = 1;

let checkErrors: () => void;

test.beforeEach(({ page }) => {
  checkErrors = watchErrors(page);
});

test.afterEach(() => {
  checkErrors();
});

async function start(page: Page, query: string): Promise<void> {
  await page.goto(`./${query}`);
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true);
}

const sent = (page: Page) => page.evaluate(() => (window.__proto?.game?.sent() ?? []) as Record<string, unknown>[]);
const houseOrders = async (page: Page) => (await sent(page)).filter((c) => c.c === "build" && c.type === HOUSE && c.auto === true);
const autoHouse = (page: Page) => page.evaluate(() => window.__proto?.game?.autoHouse() ?? { on: false, block: "none" });
const units = (page: Page) => page.evaluate(() => window.__proto?.game?.units() ?? []);
const buildings = (page: Page) => page.evaluate(() => window.__proto?.game?.buildings() ?? []);
const me = (page: Page) => page.evaluate(() => window.__proto?.game?.me() ?? 0);
const toast = (page: Page, text: string) => page.getByRole("status").filter({ hasText: text });
const switchButton = (page: Page) => page.locator(".cmds").getByRole("button", { name: /^自動蓋民居/ });

async function mainCity(page: Page): Promise<{ id: number; cx: number; cy: number; size: number }> {
  const m = await me(page);
  const city = (await buildings(page)).find((b) => b.owner === m && b.type === MAIN_CITY);
  if (city === undefined) throw new Error("no main city");
  return city;
}

/** Select the main city (its panel has the switch). */
async function selectCity(page: Page): Promise<void> {
  const city = await mainCity(page);
  const c = { x: city.cx + city.size / 2, y: city.cy + city.size / 2 };
  await page.evaluate(([x, y]) => window.__proto?.game?.centerOn(x, y, 1), [c.x, c.y] as const);
  const p = await page.evaluate(([x, y]) => window.__proto?.game?.cellToScreen(x, y) ?? { x: 0, y: 0 }, [c.x, c.y] as const);
  await tap(page, p);
  await expect(page.locator(".sel-info")).toContainText("主城");
}

/** Where a house went: its centre's distance from the main city's, and whether it is away from the map's centre. */
function spotOf(city: { cx: number; cy: number; size: number }, order: Record<string, unknown>, mapSize: number): { d: number; away: number } {
  const cx = city.cx + city.size / 2;
  const cy = city.cy + city.size / 2;
  const hx = (order.x as number) + 1 - cx;
  const hy = (order.y as number) + 1 - cy;
  return { d: Math.hypot(hx, hy), away: hx * (cx - mapSize / 2) + hy * (cy - mapSize / 2) };
}

test("假世界：開關關著不蓋、家裡有敵兵不蓋；之後派離主城最近、正在採集、不是親手派的村民一名，到主城 4–10 格背對中央那邊蓋；一次一間；木頭不夠時訊息列說", async ({ page }) => {
  await start(page, "?test=1&mock=1");
  const m = await me(page);
  // Room enough for now; no villagers from the main city (they would fill it by themselves); wood enough; our own site finished.
  await page.evaluate(() => {
    const g = window.__proto?.game;
    g?.population({ room: 50, ceiling: 120 });
    g?.autoArmy(true);
    g?.villagersPaused(true);
    g?.stock({ food: 500, wood: 500, gold: 500, crystal: 50 });
  });
  for (const b of await buildings(page)) if (b.owner === m && b.type === HOUSE && b.progress < 1000) await page.evaluate((id) => window.__proto?.game?.progress(id, 1000), b.id);
  const city = await mainCity(page);
  // Three farmers at the gold mine as the economy sends them; a fourth sent there by hand, put nearest the main city.
  const gold = (await page.evaluate(() => window.__proto?.game?.nodes() ?? [])).find((n) => n.kind === GOLD_MINE);
  if (gold === undefined) throw new Error("the fake world's gold mine moved");
  const farmers = (await units(page)).filter((u) => u.owner === m && u.type === FARMER).map((u) => u.id);
  expect(farmers.length).toBeGreaterThanOrEqual(4);
  const [byHand, ...economy] = farmers.slice(0, 4);
  await page.evaluate(([ids, node]) => window.__proto?.game?.employ(ids, node), [economy, gold.id] as const);
  await page.evaluate(([id, node]) => window.__proto?.game?.send({ c: "gather", u: [id], node }), [byHand, gold.id] as const);
  const spots = { ids: [byHand, economy[1], economy[0], economy[2]], cells: [{ x: 13, y: 82 }, { x: 14, y: 84 }, { x: 18, y: 80 }, { x: 22, y: 78 }] };
  await page.evaluate((p) => window.__proto?.game?.place(p.ids, p.cells), spots);
  await expect.poll(async () => (await units(page)).find((u) => u.id === byHand)?.handPicked).toBe(true);

  // The switch, on by default: off.
  await selectCity(page);
  const button = switchButton(page);
  await expect(button).toHaveText("自動蓋民居目前：開");
  await button.tap();
  await expect(button).toHaveText("自動蓋民居目前：關");
  await expect(toast(page, "已關閉自動蓋民居")).toBeVisible();
  expect(await autoHouse(page)).toEqual({ on: false, block: "off" });
  expect(await houseOrders(page)).toEqual([]);
  // Two places left of the cap (a house gives 5 here): wanted, but off.
  await page.evaluate(() => window.__proto?.game?.population({ room: 2, ceiling: 120 }));
  await page.waitForTimeout(1500);
  expect(await houseOrders(page)).toEqual([]);
  // An enemy soldier by the main city: on again, still none.
  const foe = (await units(page)).find((u) => u.owner === 1 - m && u.type !== FARMER);
  if (foe === undefined) throw new Error("no enemy soldier in the fake world");
  await page.evaluate(([id, x, y]) => window.__proto?.game?.place([id], [{ x, y }]), [foe.id, city.cx + 6, city.cy + 2] as const);
  await button.tap();
  await expect(button).toHaveText("自動蓋民居目前：開");
  await expect.poll(async () => (await autoHouse(page)).block, { timeout: 30_000 }).toBe("home");
  await page.waitForTimeout(1500);
  expect(await houseOrders(page)).toEqual([]);

  // The enemy gone: one house, by the economy's farmer nearest the main city.
  await page.evaluate(([id]) => window.__proto?.game?.place([id], [{ x: 60, y: 30 }]), [foe.id] as const);
  await expect.poll(async () => (await houseOrders(page)).length, { timeout: 30_000 }).toBe(1);
  const order = (await houseOrders(page))[0];
  expect(order.u).toEqual([economy[1]]);
  const where = spotOf(city, order, 96);
  expect(where.d).toBeGreaterThanOrEqual(4);
  expect(where.d).toBeLessThanOrEqual(10);
  expect(where.away, "away from the map's centre").toBeGreaterThan(0);
  await expect(toast(page, "人口快滿，自動蓋一間民居")).toBeVisible();
  // Its site shows: one at a time.
  await expect.poll(async () => (await autoHouse(page)).block, { timeout: 30_000 }).toBe("building");
  await page.waitForTimeout(1500);
  expect((await houseOrders(page)).length).toBe(1);
  // Finished: 5 more places, enough room again.
  const site = (await buildings(page)).find((b) => b.owner === m && b.type === HOUSE && b.cx === order.x && b.cy === order.y);
  if (site === undefined) throw new Error("no site where the house was sent");
  await page.evaluate((id) => window.__proto?.game?.progress(id, 1000), site.id);
  await expect.poll(async () => (await autoHouse(page)).block, { timeout: 30_000 }).toBe("room");

  // Full, no wood: the main city's villagers stop, and the strip says why.
  await page.evaluate(() => {
    const g = window.__proto?.game;
    g?.stock({ food: 500, wood: 0, gold: 500, crystal: 50 });
    g?.population({ room: 0, ceiling: 120 });
    g?.villagersPaused(false);
  });
  await expect(toast(page, "人口快滿，木頭不夠蓋民居")).toBeVisible({ timeout: 30_000 });
  expect((await houseOrders(page)).length).toBe(1);
});

test("主城面板的自動蓋民居開關：在自動村民旁邊，名字一行放得下；直向時一樣蓋著請轉成橫向", async ({ page }, info) => {
  await start(page, "?test=1&mock=1");
  // 自動訓練 on, as in a real game (the panel's villager line then says what it does).
  await page.evaluate(() => window.__proto?.game?.autoArmy(true));
  await selectCity(page);
  const button = switchButton(page);
  await expect(button).toHaveText("自動蓋民居目前：開");
  const label = button.locator(".label");
  expect(await label.evaluate((e) => e.getClientRects().length === 1 && e.getBoundingClientRect().height < 20), "its name on one line").toBe(true);
  const villagers = await page.locator(".cmds").getByRole("button", { name: /^自動村民/ }).boundingBox();
  const box = await button.boundingBox();
  expect(villagers !== null && box !== null && Math.abs(villagers.y - box.y) < 2, "beside 自動村民").toBe(true);
  await shot(page, info, "auto-house-switch");
  const landscape = page.viewportSize();
  if (landscape === null) throw new Error("no viewport");
  await page.setViewportSize({ width: landscape.height, height: landscape.width });
  await expect(page.getByText("請轉成橫向")).toBeVisible();
  await shot(page, info, "auto-house-switch-portrait");
});

test("真模擬：開局人口快滿，一名正在採集的村民去蓋民居，蓋好回去工作；開關關掉就不再蓋", async ({ page }) => {
  await start(page, "?test=1&tps=60");
  const m = await me(page);
  const city = await mainCity(page);
  // 5 villagers of 10 and one in training: the first house goes out at once.
  await expect.poll(async () => (await houseOrders(page)).length, { timeout: 30_000 }).toBe(1);
  const order = (await houseOrders(page))[0];
  const builder = (order.u as number[])[0];
  expect((order.u as number[]).length).toBe(1);
  const where = spotOf(city, order, await page.evaluate(() => window.__proto?.game?.mapSize() ?? 96));
  expect(where.d).toBeGreaterThanOrEqual(4);
  expect(where.d).toBeLessThanOrEqual(10);
  // Off now: none after this one.
  await selectCity(page);
  await switchButton(page).tap();
  await expect(switchButton(page)).toHaveText("自動蓋民居目前：關");
  // The house stands (20 s of game time), and its builder is back gathering for the economy.
  await expect.poll(async () => (await buildings(page)).find((b) => b.owner === m && b.type === HOUSE && b.cx === order.x && b.cy === order.y)?.progress, { timeout: 90_000 }).toBe(1000);
  await expect.poll(async () => {
    const u = (await units(page)).find((v) => v.id === builder);
    return u === undefined ? "dead" : `${u.order}:${u.handPicked}`;
  }, { timeout: 30_000 }).toBe(`${GATHER}:false`);
  await page.waitForTimeout(3000);
  expect((await houseOrders(page)).length).toBe(1);
  expect(await autoHouse(page)).toMatchObject({ on: false, block: "off" });
});
