// 菱形畫面（D-085; ?view=diamond since 方形斜看 is the default, D-088）on core's real simulation: the map turned 45° and flattened (camera/projection.ts),
// the fixed map's two spawns left and right of the big city, at about its height. Whether (0, 0)
// belongs at the top corner is the user's to see (ceo 2026-10-18), hence the pictures.

import { expect, type Page, test } from "@playwright/test";
import { shot, watchErrors } from "./helpers.ts";

const MAIN_CITY = 0;
const LARGE = 1;

const at = (page: Page, c: { x: number; y: number }) => page.evaluate(([x, y]) => window.__proto?.game?.cellToScreen(x, y) ?? { x: 0, y: 0 }, [c.x, c.y] as const);

async function start(page: Page, query: string): Promise<void> {
  await page.goto(`./?test=1&view=diamond&${query}`);
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true, null, { timeout: 60_000 });
}

test("菱形畫面：觀戰縮到最小，整張地圖放得下；兩邊的主城一左一右，大城在中間（D-085）", async ({ page }, info) => {
  const check = watchErrors(page);
  await start(page, "watch=1");
  const size = await page.evaluate(() => window.__proto?.game?.mapSize() ?? 0);
  // The map's middle (centerOn takes a cell and adds half of one).
  await page.evaluate((s) => window.__proto?.game?.centerOn(s / 2 - 0.5, s / 2 - 0.5, 0.01), size);
  // The whole map on screen: its four corners.
  const view = page.viewportSize() ?? { width: 0, height: 0 };
  for (const c of [{ x: 0, y: 0 }, { x: size - 1, y: 0 }, { x: 0, y: size - 1 }, { x: size - 1, y: size - 1 }]) {
    const p = await at(page, c);
    expect(p.x >= 0 && p.x <= view.width && p.y >= 0 && p.y <= view.height, `corner ${c.x},${c.y} on screen`).toBe(true);
  }
  // (0, 0) at the top corner.
  expect((await at(page, { x: 0, y: 0 })).y).toBeLessThan((await at(page, { x: size - 1, y: size - 1 })).y);
  const cities = (await page.evaluate(() => window.__proto?.game?.buildings() ?? [])).filter((b) => b.type === MAIN_CITY);
  expect(cities.length).toBe(2);
  const big = (await page.evaluate(() => window.__proto?.game?.towns() ?? [])).find((t) => t.size === LARGE);
  if (big === undefined) throw new Error("no big city");
  const [a, b] = (await Promise.all(cities.map((c) => at(page, { x: c.cx + c.size / 2, y: c.cy + c.size / 2 })))).sort((p, q) => p.x - q.x);
  const mid = await at(page, { x: big.cx, y: big.cy });
  expect(a.x).toBeLessThan(mid.x);
  expect(mid.x).toBeLessThan(b.x);
  // About level: within a tenth of the screen's height of each other and of the big city.
  expect(Math.abs(a.y - b.y)).toBeLessThan(view.height / 10);
  expect(Math.abs((a.y + b.y) / 2 - mid.y)).toBeLessThan(view.height / 10);
  await shot(page, info, "diamond-whole-map");
  check();
});

test("菱形畫面：開局看得到自己的主城和村民，按一下村民選得到（D-085）", async ({ page }, info) => {
  const check = watchErrors(page);
  await start(page, "scenario=e2e");
  const me = await page.evaluate(() => window.__proto?.game?.me() ?? 0);
  const view = page.viewportSize() ?? { width: 0, height: 0 };
  const city = (await page.evaluate(() => window.__proto?.game?.buildings() ?? [])).find((b) => b.owner === me && b.type === MAIN_CITY);
  if (city === undefined) throw new Error("no main city");
  const p = await at(page, { x: city.cx + city.size / 2, y: city.cy + city.size / 2 });
  expect(p.x > 0 && p.x < view.width && p.y > 0 && p.y < view.height, "the main city on screen").toBe(true);
  await shot(page, info, "diamond-start");
  // A farmer tapped on its body (the pictures stand up): picked. Paused, so it stays where it is.
  await page.getByRole("button", { name: "暫停", exact: true }).tap();
  await page.waitForFunction(() => window.__proto?.game?.header().paused === true);
  // The one standing furthest from the others (they start in a huddle, one in front of another).
  const list = await page.evaluate(() => window.__proto?.game?.units() ?? []);
  const room = (u: (typeof list)[number]) => Math.min(...list.filter((v) => v.id !== u.id).map((v) => Math.hypot(v.sx - u.sx, v.sy - u.sy)));
  const farmer = list
    .filter((u) => u.owner === me && u.type === 0 && u.sx > 80 && u.sx < view.width - 80 && u.sy > 60 && u.sy < view.height - 60)
    .sort((u, v) => room(v) - room(u))[0];
  if (farmer === undefined) throw new Error("no farmer on screen");
  await page.evaluate(() => window.__proto?.game?.select([]));
  await page.touchscreen.tap(farmer.sx, farmer.sy - 8);
  await expect.poll(async () => (await page.evaluate(() => window.__proto?.game?.selection()))?.units).toEqual([farmer.id]);
  check();
});
