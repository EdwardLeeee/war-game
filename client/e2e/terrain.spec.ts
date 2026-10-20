// 天然障礙物 (R6-51) on core's real simulation, the fixed map (war-game-ui's whole map,
// sim/src/core/fixed-terrain.ts): the river, its bridges and fords drawn from the ground the
// simulation sends, in flat colours until war-game-ui's tiles (art-v5), each bridge with rails
// along the way it is crossed; the minimap in the same colours; a house on a bridge is red and
// says why.

import { expect, type Page, test } from "@playwright/test";
import { selectForCommands, shot, watchErrors } from "./helpers.ts";
import { tap } from "./touch.ts";

// Terrain (sim/src/protocol.ts).
const WATER = 3;
const FORD = 4;
const BRIDGE_NS = 5;
const BRIDGE_EW = 6;

const ground = (page: Page, x: number, y: number) => page.evaluate(([cx, cy]) => window.__proto?.game?.ground(cx, cy) ?? -1, [x, y] as const);
const at = (page: Page, c: { x: number; y: number }) => page.evaluate(([x, y]) => window.__proto?.game?.cellToScreen(x, y) ?? { x: 0, y: 0 }, [c.x, c.y] as const);

async function start(page: Page, query: string): Promise<void> {
  await page.goto(`./?test=1&${query}`);
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true, null, { timeout: 60_000 });
}

/** Every cell of a 3 × 3 crossing (PROTOCOL.md 3.6: fords and bridges are 3 wide, bank to bank). */
async function crossing(page: Page, x0: number, y0: number): Promise<number[]> {
  const out: number[] = [];
  for (let y = y0; y < y0 + 3; y++) for (let x = x0; x < x0 + 3; x++) out.push(await ground(page, x, y));
  return out;
}

test("固定地圖的河、橋、淺灘（R6-51）：照模擬送來的地形畫；橋照過橋的方向畫欄杆；小地圖同色（觀戰，給 ceo 看）", async ({ page, browserName }, info) => {
  test.setTimeout(120_000);
  const check = watchErrors(page);
  await start(page, "watch=1&ai=0");
  // Player 0's bridge (17–19, 58–60), crossed north-south; its mirror (58–60, 17–19), east-west; the ford (39–41, 85–87).
  await expect.poll(() => crossing(page, 17, 58)).toEqual(Array(9).fill(BRIDGE_NS));
  expect(await crossing(page, 58, 17)).toEqual(Array(9).fill(BRIDGE_EW));
  expect(await crossing(page, 39, 85)).toEqual(Array(9).fill(FORD));
  const counts = await page.evaluate(() => window.__proto?.game?.groundCounts() ?? {});
  expect(counts[WATER] ?? 0, "a river and lakes").toBeGreaterThan(100);
  if (browserName !== "chromium") return check();
  await page.evaluate(() => window.__proto?.game?.centerOn(18.5, 59.5, 1.2));
  await page.waitForTimeout(300);
  await shot(page, info, "terrain-bridge-ns");
  await page.evaluate(() => window.__proto?.game?.centerOn(40.5, 86.5, 1.2));
  await page.waitForTimeout(300);
  await shot(page, info, "terrain-ford");
  await page.evaluate(() => window.__proto?.game?.centerOn(48, 48, 0.35));
  await page.waitForTimeout(300);
  await shot(page, info, "terrain-whole-map");
  check();
});

test("在橋上蓋房子（R6-51）：預覽是紅的，提示「橋和淺灘要留給人走，不能蓋」；挪到岸上就沒有", async ({ page }, info) => {
  test.setTimeout(120_000);
  const check = watchErrors(page);
  await start(page, "ai=0");
  await page.evaluate(() => window.__proto?.game?.centerOn(18.5, 60, 1.1));
  await selectForCommands(page, []);
  await page.getByRole("button", { name: "建造" }).tap();
  await page.getByRole("button", { name: /^民居/ }).tap();
  await expect.poll(() => page.evaluate(() => window.__proto?.game?.mode())).toBe("place:dragging");
  const why = page.getByText("橋和淺灘要留給人走，不能蓋");
  const placement = () => page.evaluate(() => window.__proto?.game?.placement());
  // The house's 2 × 2 on the bridge (17–18, 58–59).
  await tap(page, await at(page, { x: 17, y: 58 }));
  await expect.poll(placement).toMatchObject({ cellX: 17, cellY: 58, valid: false });
  await expect(why).toBeVisible();
  if (info.project.name === "chromium") await shot(page, info, "terrain-build-on-bridge");
  // Off it, on the bank south of the river.
  await tap(page, await at(page, { x: 18, y: 64 }));
  await expect.poll(placement).toMatchObject({ cellX: 18, cellY: 64 });
  await expect(why).toBeHidden();
  check();
});
