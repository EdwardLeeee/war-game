// 方形斜看（D-088）on core's real simulation (?test=1&view=oblique): the map square on, flattened
// 2:1; the fixed map's spawns bottom left and top right, the big city between. The default stays
// the diamond until art-v3 (its buildings drawn for this camera); till then buildings and nodes
// are the shapes here, the units from their atlases.

import { expect, type Page, test } from "@playwright/test";
import { shot, watchErrors } from "./helpers.ts";

const MAIN_CITY = 0;
const LARGE = 1;

const at = (page: Page, c: { x: number; y: number }) => page.evaluate(([x, y]) => window.__proto?.game?.cellToScreen(x, y) ?? { x: 0, y: 0 }, [c.x, c.y] as const);

async function start(page: Page, query: string): Promise<void> {
  await page.goto(`./?test=1&view=oblique&${query}`);
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true, null, { timeout: 60_000 });
}

test("方形斜看：觀戰縮到最小，整張地圖放得下；我方主城在左下、敵方在右上，大城在中間（D-088）", async ({ page }, info) => {
  const check = watchErrors(page);
  await start(page, "watch=1");
  const size = await page.evaluate(() => window.__proto?.game?.mapSize() ?? 0);
  await page.evaluate((s) => window.__proto?.game?.centerOn(s / 2 - 0.5, s / 2 - 0.5, 0.01), size);
  const view = page.viewportSize() ?? { width: 0, height: 0 };
  for (const c of [{ x: 0, y: 0 }, { x: size - 1, y: 0 }, { x: 0, y: size - 1 }, { x: size - 1, y: size - 1 }]) {
    const p = await at(page, c);
    expect(p.x >= 0 && p.x <= view.width && p.y >= 0 && p.y <= view.height, `corner ${c.x},${c.y} on screen`).toBe(true);
  }
  // Square to the screen: (0, 0) and (size − 1, 0) level, (0, 0) and (0, size − 1) one above the other.
  const o = await at(page, { x: 0, y: 0 });
  expect(Math.abs((await at(page, { x: size - 1, y: 0 })).y - o.y)).toBeLessThan(0.5);
  expect(Math.abs((await at(page, { x: 0, y: size - 1 })).x - o.x)).toBeLessThan(0.5);
  const cities = (await page.evaluate(() => window.__proto?.game?.buildings() ?? [])).filter((b) => b.type === MAIN_CITY);
  expect(cities.length).toBe(2);
  const big = (await page.evaluate(() => window.__proto?.game?.towns() ?? [])).find((t) => t.size === LARGE);
  if (big === undefined) throw new Error("no big city");
  const [a, b] = (await Promise.all(cities.map((c) => at(page, { x: c.cx + c.size / 2, y: c.cy + c.size / 2 })))).sort((p, q) => p.x - q.x);
  const mid = await at(page, { x: big.cx, y: big.cy });
  expect(a.x < mid.x && mid.x < b.x, "left, middle, right").toBe(true);
  expect(a.y > mid.y && mid.y > b.y, "bottom, middle, top").toBe(true);
  await shot(page, info, "oblique-whole-map");
  check();
});

test("方形斜看：開局看得到自己的主城，點村民的身體選得到；3 倍的兵站在方形斜看的地上（D-088）", async ({ page, browserName }, info) => {
  const check = watchErrors(page);
  await start(page, "scenario=e2e");
  const me = await page.evaluate(() => window.__proto?.game?.me() ?? 0);
  const view = page.viewportSize() ?? { width: 0, height: 0 };
  const city = (await page.evaluate(() => window.__proto?.game?.buildings() ?? [])).find((b) => b.owner === me && b.type === MAIN_CITY);
  if (city === undefined) throw new Error("no main city");
  const p = await at(page, { x: city.cx + city.size / 2, y: city.cy + city.size / 2 });
  expect(p.x > 0 && p.x < view.width && p.y > 0 && p.y < view.height, "the main city on screen").toBe(true);
  await shot(page, info, "oblique-start");
  await page.getByRole("button", { name: "暫停", exact: true }).tap();
  await page.waitForFunction(() => window.__proto?.game?.header().paused === true);
  const list = await page.evaluate(() => window.__proto?.game?.units() ?? []);
  const room = (u: (typeof list)[number]) => Math.min(...list.filter((v) => v.id !== u.id).map((v) => Math.hypot(v.sx - u.sx, v.sy - u.sy)));
  const farmer = list.filter((u) => u.owner === me && u.type === 0 && u.sx > 80 && u.sx < view.width - 80 && u.sy > 60 && u.sy < view.height - 60).sort((u, v) => room(v) - room(u))[0];
  if (farmer === undefined) throw new Error("no farmer on screen");
  await page.evaluate(() => window.__proto?.game?.select([]));
  await page.touchscreen.tap(farmer.sx, farmer.sy - 8);
  await expect.poll(async () => (await page.evaluate(() => window.__proto?.game?.selection()))?.units).toEqual([farmer.id]);
  if (browserName !== "chromium") return check();
  // The perf battle with the units' atlases (3 倍): the buildings shapes until art-v3.
  await page.goto("./?test=1&view=oblique&art=x3&scenario=perf");
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true, null, { timeout: 60_000 });
  await expect.poll(async () => (await page.evaluate(() => window.__proto?.game?.art() ?? null))?.units ?? 0, { timeout: 30_000 }).toBeGreaterThan(100);
  expect((await page.evaluate(() => window.__proto?.game?.art() ?? null))?.buildings, "art-v2's buildings are the diamond's: shapes").toBe(0);
  await page.evaluate(() => window.__proto?.game?.centerOn(48, 52, 1.6));
  await page.waitForTimeout(3000);
  await shot(page, info, "oblique-battle");
  check();
});
