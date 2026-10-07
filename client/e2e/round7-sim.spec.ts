// 第七輪 on core's real simulation with every switch on (ceo 2026-10-07: 上線前用真 sim 驗), its
// `e2e` scenario (plenty of resources, a squad with 4 ranged units) and the opponent standing
// still (ai=0): build an arrow tower on TowerLand, hide ranged units in it, let them out, build
// a stable and train cavalry. Each step through the screen's own buttons.

import { expect, type Page, test } from "@playwright/test";
import { armyButton, selectForCommands, shot, watchErrors } from "./helpers.ts";
import { tap } from "./touch.ts";

const RANGED = 2;
const CAVALRY = 5;
const MAIN_CITY = 0;
const BARRACKS = 6;
const ARROW_TOWER = 10;
const STABLE = 11;
/** The simulation's ticks: walking, building and training at tps=100 on a busy runner. */
const TICKS = { timeout: 90_000 };

type Building = { id: number; owner: number; type: number; cx: number; cy: number; size: number; progress: number; flags: number; soldiers: number };

const units = (page: Page) => page.evaluate(() => window.__proto?.game?.units() ?? []);
const buildings = (page: Page) => page.evaluate(() => (window.__proto?.game?.buildings() ?? []) as Building[]);
const sent = (page: Page) => page.evaluate(() => (window.__proto?.game?.sent() ?? []) as Record<string, unknown>[]);
const lastOrder = async (page: Page) => (await sent(page)).filter((c) => c.auto !== true).at(-1);
const placement = (page: Page) => page.evaluate(() => window.__proto?.game?.placement() ?? null);
const myId = (page: Page) => page.evaluate(() => window.__proto?.game?.me() ?? 0);
const centre = (page: Page, c: { x: number; y: number }) => page.evaluate(([x, y]) => window.__proto?.game?.centerOn(x, y), [c.x, c.y] as const);
const toScreen = (page: Page, c: { x: number; y: number }) => page.evaluate(([x, y]) => window.__proto?.game?.cellToScreen(x, y) ?? { x: 0, y: 0 }, [c.x, c.y] as const);

async function own(page: Page, type: number) {
  const me = await myId(page);
  return (await units(page)).filter((u) => u.owner === me && u.type === type);
}

async function ownBuilding(page: Page, type: number, done = true): Promise<Building | undefined> {
  const me = await myId(page);
  return (await buildings(page)).find((b) => b.owner === me && b.type === type && (!done || b.progress >= 1000));
}

/** Tap one of our buildings where the tap picks the building (not a unit beside it). */
async function tapBuilding(page: Page, b: Building): Promise<void> {
  await centre(page, { x: b.cx + b.size / 2, y: b.cy + b.size / 2 });
  for (let y = b.cy; y < b.cy + b.size; y++) {
    for (let x = b.cx; x < b.cx + b.size; x++) {
      const at = await toScreen(page, { x, y });
      if ((await page.evaluate(([sx, sy]) => window.__proto?.game?.pickAt(sx, sy) ?? null, [at.x, at.y] as const)) !== "building") continue;
      await tap(page, at);
      return;
    }
  }
  throw new Error(`no cell of building ${b.id} to tap`);
}

/** 建造 → this building → the preview on the nearest spot where it may go (by the placement grid) → ✓. */
async function build(page: Page, type: number, name: RegExp, near: { x: number; y: number }): Promise<{ x: number; y: number }> {
  await page.evaluate(() => window.__proto?.game?.select([]));
  await page.getByRole("button", { name: "建造" }).tap();
  await page.getByRole("button", { name }).tap();
  await expect.poll(() => page.evaluate(() => window.__proto?.game?.mode())).toBe("place:dragging");
  const spot = await page.evaluate(([t, x, y]) => window.__proto?.game?.buildSpotNear(t, x, y) ?? null, [type, near.x, near.y] as const);
  if (spot === null) throw new Error(`nowhere to build ${type}`);
  const size = type === STABLE ? 3 : 2;
  // The preview's top-left follows the finger at its footprint's centre (src/ui/placement.ts).
  const finger = { x: spot.x + size / 2 - 0.5, y: spot.y + size / 2 - 0.5 };
  await centre(page, finger);
  await tap(page, await toScreen(page, finger));
  await expect.poll(() => placement(page)).toMatchObject({ cellX: spot.x, cellY: spot.y, valid: true });
  await page.getByRole("button", { name: "確定蓋在這裡" }).tap();
  await expect.poll(() => lastOrder(page)).toMatchObject({ c: "build", type, x: spot.x, y: spot.y });
  return spot;
}

test("第七輪（真的模擬，開關全開）：蓋箭樓 → 遠程兵躲進去 → 全部出來 → 蓋馬廄 → 訓練騎兵", async ({ page }, info) => {
  test.setTimeout(420_000);
  const check = watchErrors(page);
  await page.goto("./?test=1&scenario=e2e&tps=100&ai=0");
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true);
  expect(await page.evaluate(() => window.__proto?.game?.init())).toMatchObject({ ai: [false, false] });
  const city = await ownBuilding(page, MAIN_CITY);
  if (city === undefined) throw new Error("no main city");
  const home = { x: city.cx + city.size / 2, y: city.cy + city.size / 2 };
  // The scenario's barracks trains on its own (D-054) and would fill the population (20) before the cavalry.
  const barracks = await ownBuilding(page, BARRACKS);
  if (barracks === undefined) throw new Error("no barracks");
  await page.evaluate((id) => window.__proto?.game?.send({ c: "auto_train", building: id, on: false }), barracks.id);

  // 1. 箭樓, by the main city (TowerLand).
  await build(page, ARROW_TOWER, /^箭樓/, { x: home.x + 4, y: home.y });
  await expect.poll(async () => (await ownBuilding(page, ARROW_TOWER)) !== undefined, TICKS).toBe(true);
  const tower = (await ownBuilding(page, ARROW_TOWER)) as Building;
  await shot(page, info, "r7sim-1-tower");

  // 2. 躲進去: the 4 ranged units of the squad; the tower holds 3, the fourth stays out.
  const ranged = (await own(page, RANGED)).map((u) => u.id).sort((a, b) => a - b);
  expect(ranged.length).toBe(4);
  await selectForCommands(page, ranged);
  await page.locator(".cmds").getByRole("button", { name: /^躲進去/ }).tap();
  await expect.poll(() => page.evaluate(() => window.__proto?.game?.mode())).toBe("garrison");
  await tapBuilding(page, tower);
  await expect.poll(() => lastOrder(page)).toMatchObject({ c: "garrison", u: ranged, building: tower.id });
  await expect.poll(async () => (await buildings(page)).find((b) => b.id === tower.id)?.soldiers, TICKS).toBe(3);
  const hiding = (await units(page)).filter((u) => ranged.includes(u.id) && u.order === 9).map((u) => u.id);
  expect(hiding.length, "three on their way or inside, one left out").toBe(3);
  await page.evaluate(() => window.__proto?.game?.select([]));
  await tapBuilding(page, tower);
  const panel = page.locator(".sel-info");
  await expect(panel.locator(".garrison-count")).toHaveText("躲了 3 名士兵（最多 3 名）");
  await shot(page, info, "r7sim-2-garrison");

  // 3. 全部出來.
  await panel.getByRole("button", { name: "全部出來" }).tap();
  await expect.poll(() => lastOrder(page)).toMatchObject({ c: "leave", building: tower.id });
  await expect.poll(async () => (await buildings(page)).find((b) => b.id === tower.id)?.soldiers, TICKS).toBe(0);
  await expect.poll(async () => (await units(page)).filter((u) => hiding.includes(u.id)).every((u) => u.order !== 9 && u.action !== 7), TICKS).toBe(true);
  await expect(panel.locator(".garrison-count")).toHaveText("躲了 0 名士兵（最多 3 名）");

  // 4. 馬廄, then 5. 騎兵 from it.
  await build(page, STABLE, /^馬廄/, { x: home.x - 6, y: home.y + 2 });
  await expect.poll(async () => (await ownBuilding(page, STABLE)) !== undefined, TICKS).toBe(true);
  const stable = (await ownBuilding(page, STABLE)) as Building;
  const soldiers = async () => Number(/(\d+)/.exec((await armyButton(page).textContent()) ?? "")?.[1] ?? -1);
  const before = await soldiers();
  await page.evaluate(() => window.__proto?.game?.select([]));
  await tapBuilding(page, stable);
  await expect(panel).toContainText("馬廄");
  await page.getByRole("button", { name: /^訓練騎兵/ }).tap();
  await expect.poll(() => lastOrder(page)).toMatchObject({ c: "train", building: stable.id, type: CAVALRY, n: 1 });
  await expect.poll(async () => (await own(page, CAVALRY)).length, TICKS).toBeGreaterThanOrEqual(1);
  await expect.poll(soldiers, TICKS).toBeGreaterThan(before);
  const [rider] = await own(page, CAVALRY);
  await centre(page, { x: rider.fx, y: rider.fy });
  await shot(page, info, "r7sim-3-cavalry");
  check();
});
