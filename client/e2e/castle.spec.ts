// 城牆 (D-089, the user 2026-10-19: 「希望像一個城堡」; R6-06 approved 2026-10-20) on core's real
// simulation, the fixed map: every town's castle drawn from art-v4's pictures (square on, 3 倍)
// on exactly the cells the simulation walls; a tap on a wall picks the town; units behind a wall
// drawn again over it (whole, or as their rims on ?ghost=outline, for ceo to compare).

import { expect, type Page, test } from "@playwright/test";
import { shot, watchErrors } from "./helpers.ts";

const SMALL = 0;
const LARGE = 1;

const towns = (page: Page) => page.evaluate(() => window.__proto?.game?.towns() ?? []);
const castle = (page: Page) => page.evaluate(() => window.__proto?.game?.castle() ?? null);
const toScreen = (page: Page, c: { x: number; y: number }) => page.evaluate(([x, y]) => window.__proto?.game?.cellToScreen(x, y) ?? { x: 0, y: 0 }, [c.x, c.y] as const);

async function start(page: Page, query: string): Promise<void> {
  await page.goto(`./?test=1&${query}`);
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true, null, { timeout: 60_000 });
}

test("城牆（D-089）：每座城鎮的牆照模擬的格子、用 art-v4 的圖畫出來；點牆選到那座城鎮；牆後的兵畫在牆上（3 倍，方形斜看）", async ({ page, browserName }, info) => {
  test.setTimeout(180_000);
  const check = watchErrors(page);
  // Watching: no fog, so every castle is drawn at once.
  await start(page, "watch=1&art=x3");
  await expect.poll(async () => (await castle(page))?.pieces ?? 0, { timeout: 30_000 }).toBeGreaterThan(0);
  const all = await towns(page);
  const c = await castle(page);
  expect(c?.misfit, "every castle fits one of ui's layouts").toBe(0);
  expect(c?.blockTowns, "none drawn as blocks").toBe(0);
  // 32 pieces a castle (atlas-buildings.md section 11).
  expect(c?.pieces).toBe(32 * all.length);

  // A tap on a wall picks its town (nothing else there).
  const small = all.find((t) => t.size === SMALL);
  const large = all.find((t) => t.size === LARGE);
  if (small === undefined || large === undefined) throw new Error("no small town or big city");
  const cells = await page.evaluate((id) => window.__proto?.game?.castleCells(id) ?? null, small.id);
  if (cells === null) throw new Error("no castle");
  await page.evaluate(([x, y]) => window.__proto?.game?.centerOn(x, y, 1.1), [small.cx + 0.5, small.cy + 0.5] as const);
  // A wall cell of its west side, its middle (open ground beyond it, no unit there).
  const west = cells.wall.filter(([x]) => x === cells.inside.x0 - 1).sort(([, a], [, b]) => a - b);
  const w = west[1];
  const p = await toScreen(page, { x: w[0], y: w[1] });
  expect(await page.evaluate(([x, y]) => window.__proto?.game?.pickAt(x, y) ?? null, [p.x, p.y] as const)).toBe("town");
  if (browserName === "chromium") await shot(page, info, "castle-small-neutral");

  // The big city, its militia inside: those behind its south wall drawn over it.
  await page.evaluate(([x, y]) => window.__proto?.game?.centerOn(x, y, 1.0), [large.cx + 0.5, large.cy + 2.5] as const);
  await page.waitForTimeout(500);
  if (browserName === "chromium") await shot(page, info, "castle-large-neutral");
  check();
});

for (const style of ["fill", "outline"] as const) {
  test(`牆後的兵（D-089）：${style === "fill" ? "整個填成玩家色" : "只畫輪廓"}，透明度 45%（給 ceo 比較）`, async ({ page, browserName }, info) => {
    test.skip(browserName !== "chromium", "pictures for ceo");
    test.setTimeout(120_000);
    const check = watchErrors(page);
    // The fake world (its towns walled as the simulation's rules have them): our spearmen just inside the small town's south palisade.
    await start(page, `mock=1&tps=20&art=x3${style === "outline" ? "&ghost=outline" : ""}`);
    await expect.poll(async () => (await castle(page))?.pieces ?? 0, { timeout: 30_000 }).toBeGreaterThan(0);
    const small = (await towns(page)).find((t) => t.size === SMALL && t.cx === 30 && t.cy === 66);
    if (small === undefined) throw new Error("no small town at 30, 66");
    const cells = await page.evaluate((id) => window.__proto?.game?.castleCells(id) ?? null, small.id);
    if (cells === null) throw new Error("no castle");
    const me = await page.evaluate(() => window.__proto?.game?.me() ?? 0);
    const spears = (await page.evaluate(() => window.__proto?.game?.units() ?? [])).filter((u) => u.owner === me && u.type === 1).map((u) => u.id).slice(0, 4);
    const row = cells.inside.y1;
    await page.evaluate(([ids, c]) => window.__proto?.game?.place(ids, c), [spears, [27, 29, 32, 33].map((x) => ({ x, y: row }))] as const);
    await page.evaluate((ids) => window.__proto?.game?.select(ids), spears.slice(0, 2));
    await page.evaluate(([x, y]) => window.__proto?.game?.centerOn(x, y, 1.6), [small.cx + 0.5, row + 1] as const);
    await expect.poll(async () => (await castle(page))?.ghosts ?? 0, { timeout: 10_000 }).toBeGreaterThanOrEqual(4);
    await shot(page, info, `castle-ghost-${style}`);
    check();
  });
}

test("隨機地圖相鄰出生（種子 2）：大城是 3×3 箭樓、large3 的城牆，照模擬的格子畫出來", async ({ page, browserName }, info) => {
  test.setTimeout(120_000);
  const check = watchErrors(page);
  await start(page, "map=random&seed=2&watch=1&art=x3");
  await expect.poll(async () => (await castle(page))?.pieces ?? 0, { timeout: 30_000 }).toBeGreaterThan(0);
  const all = await towns(page);
  expect((await castle(page))?.misfit, "every castle fits one of ui's layouts").toBe(0);
  expect((await castle(page))?.blockTowns).toBe(0);
  const large = all.find((t) => t.size === LARGE);
  if (large === undefined) throw new Error("no big city");
  const cells = await page.evaluate((id) => window.__proto?.game?.castleCells(id) ?? null, large.id);
  // 13 × 13 inside (large3).
  expect(cells && cells.inside.x1 - cells.inside.x0 + 1).toBe(13);
  await page.evaluate(([x, y]) => window.__proto?.game?.centerOn(x, y, 0.9), [(cells?.inside.x0 ?? 0) + 6.5, (cells?.inside.y0 ?? 0) + 8] as const);
  await page.waitForTimeout(500);
  if (browserName === "chromium") await shot(page, info, "castle-large3");
  check();
});

test("城鎮四種狀態的城牆（假世界，3 倍）：我方治理、中立、敵方治理、廢墟；擁有者的顏色在城門和角上", async ({ page, browserName }, info) => {
  test.skip(browserName !== "chromium", "pictures for ceo");
  const check = watchErrors(page);
  await start(page, "mock=1&tps=20&art=x3");
  await expect.poll(async () => (await castle(page))?.pieces ?? 0, { timeout: 30_000 }).toBeGreaterThan(0);
  expect((await castle(page))?.misfit).toBe(0);
  // Some of ours by the enemy's town and the ruins, so that they are in sight (the fog).
  const me = await page.evaluate(() => window.__proto?.game?.me() ?? 0);
  const ours = (await page.evaluate(() => window.__proto?.game?.units() ?? [])).filter((u) => u.owner === me && u.type === 1).map((u) => u.id);
  const spots = [{ x: 40, y: 62 }, { x: 44, y: 56 }, { x: 36, y: 74 }, { x: 42, y: 80 }];
  await page.evaluate(([ids, c]) => window.__proto?.game?.place(ids, c), [ours.slice(0, 4), spots] as const);
  await page.waitForTimeout(1500);
  // Ours governed (18, 62) and the neutral one (30, 66); the enemy's (38, 56); the ruins (36, 80).
  for (const [name, x, y, z] of [
    ["castle-own-neutral", 24, 65, 0.7],
    ["castle-enemy", 38, 57, 1.0],
    ["castle-ruins", 36, 81, 1.0],
  ] as const) {
    await page.evaluate(([cx, cy, s]) => window.__proto?.game?.centerOn(cx, cy, s), [x, y, z] as const);
    await page.waitForTimeout(300);
    await shot(page, info, name);
  }
  check();
});
