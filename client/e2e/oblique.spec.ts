// 方形斜看（D-088）on core's real simulation, the default since art-v3 (its buildings and nodes drawn
// for this camera): the map square on, flattened 2:1; the fixed map's spawns bottom left and top
// right, the big city between.

import { expect, type Page, test } from "@playwright/test";
import { shot, watchErrors } from "./helpers.ts";

const MAIN_CITY = 0;
const LARGE = 1;

const at = (page: Page, c: { x: number; y: number }) => page.evaluate(([x, y]) => window.__proto?.game?.cellToScreen(x, y) ?? { x: 0, y: 0 }, [c.x, c.y] as const);

async function start(page: Page, query: string): Promise<void> {
  await page.goto(`./?test=1&${query}`);
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
  // The perf battle from the atlases (3 倍): art-v3's buildings and nodes are this camera's.
  await page.goto("./?test=1&art=x3&scenario=perf");
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true, null, { timeout: 60_000 });
  await expect.poll(async () => (await page.evaluate(() => window.__proto?.game?.art() ?? null))?.units ?? 0, { timeout: 30_000 }).toBeGreaterThan(100);
  await expect.poll(async () => (await page.evaluate(() => window.__proto?.game?.art() ?? null))?.buildings ?? 0, { message: "art-v3's buildings drawn" }).toBeGreaterThan(0);
  await page.evaluate(() => window.__proto?.game?.centerOn(48, 52, 1.6));
  await page.waitForTimeout(3000);
  await shot(page, info, "oblique-battle");
  check();
});

test("方形斜看，暫停中放建築（R6-31）：預定的房子照方形斜看的格子畫虛線占地框、寫「繼續後開工」，art-v3 的完工圖半透明；按繼續後換成地基", async ({ page, browserName }, info) => {
  const check = watchErrors(page);
  // With art-v3 (3 倍) in Chromium, for the picture; WebKit, the shapes.
  await start(page, browserName === "chromium" ? "scenario=e2e&art=x3" : "scenario=e2e");
  if (browserName === "chromium") await expect.poll(async () => (await page.evaluate(() => window.__proto?.game?.art() ?? null))?.buildings ?? 0, { timeout: 30_000 }).toBeGreaterThan(0);
  await page.getByRole("button", { name: "暫停", exact: true }).tap();
  const me = await page.evaluate(() => window.__proto?.game?.me() ?? 0);
  const city = (await page.evaluate(() => window.__proto?.game?.buildings() ?? [])).find((b) => b.owner === me && b.type === MAIN_CITY);
  if (city === undefined) throw new Error("no main city");
  const spot = await page.evaluate(([x, y]) => window.__proto?.game?.buildSpotNear(1, x, y) ?? null, [city.cx + city.size + 3, city.cy] as const);
  if (spot === null) throw new Error("no spot for a house");
  await page.evaluate(([x, y]) => window.__proto?.game?.centerOn(x, y, 1.4), [spot.x + 1, spot.y + 1] as const);
  await page.evaluate(() => window.__proto?.game?.startPlacement(1));
  const c = await at(page, { x: spot.x + 0.5, y: spot.y + 0.5 });
  await page.touchscreen.tap(c.x, c.y);
  await expect.poll(() => page.evaluate(() => window.__proto?.game?.placement()?.valid ?? false)).toBe(true);
  await page.getByRole("button", { name: "確定蓋在這裡" }).tap();
  await expect(page.locator(".toast")).toHaveText("已下令蓋民居，按繼續後開工");
  expect(await page.evaluate(() => window.__proto?.game?.pending())).toMatchObject({ sites: 1 });
  await shot(page, info, "oblique-paused-site");
  await page.getByRole("button", { name: "繼續", exact: true }).tap();
  await expect.poll(async () => (await page.evaluate(() => window.__proto?.game?.pending()))?.sites, { timeout: 15_000 }).toBe(0);
  check();
});

test("方形斜看＋art-v3（3 倍）給使用者看（O-2）：整張地圖縮到最小、開局、中立大城、城鎮四種狀態", async ({ page, browserName }, info) => {
  test.skip(browserName !== "chromium", "pictures for the user");
  test.setTimeout(180_000);
  const check = watchErrors(page);
  const artDrawn = () => expect.poll(async () => (await page.evaluate(() => window.__proto?.game?.art() ?? null))?.buildings ?? 0, { timeout: 30_000 }).toBeGreaterThan(0);
  // The whole map, watched (no fog), at its smallest; then the big city, neutral at the start.
  await start(page, "watch=1&art=x3");
  await artDrawn();
  const size = await page.evaluate(() => window.__proto?.game?.mapSize() ?? 0);
  await page.evaluate((s) => window.__proto?.game?.centerOn(s / 2 - 0.5, s / 2 - 0.5, 0.01), size);
  await page.waitForTimeout(1000);
  await shot(page, info, "o2-whole-map");
  const big = (await page.evaluate(() => window.__proto?.game?.towns() ?? [])).find((t) => t.size === LARGE);
  if (big === undefined) throw new Error("no big city");
  await page.evaluate(([x, y]) => window.__proto?.game?.centerOn(x, y, 1.1), [big.cx, big.cy] as const);
  await page.waitForTimeout(1000);
  await shot(page, info, "o2-big-city");
  // The start of a game.
  await start(page, "art=x3");
  await artDrawn();
  await page.waitForTimeout(1000);
  await shot(page, info, "o2-start");
  // Towns in their states on the fake world (src/mock/mock-port.ts): neutral (30, 66), ours
  // governed (18, 62), the enemy's (38, 56), ruins (36, 80), the big one plundered by us (48, 48).
  await start(page, "mock=1&tps=20&art=x3");
  await artDrawn();
  await page.evaluate(() => window.__proto?.game?.centerOn(30, 68, 0.55));
  await page.waitForTimeout(1000);
  await shot(page, info, "o2-town-states");
  check();
});
