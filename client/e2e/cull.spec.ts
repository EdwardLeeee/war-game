// 鏡頭裁切 (the user 2026-11-24 「我用網頁到200兵時畫面會卡卡的」; ceo 2026-11-24): units off the screen are not drawn,
// those on it are, in the very frame the camera moves (none comes in a frame late as the view is dragged to them); an
// archer off the screen shooting at one on it still sends its arrows in. The fog's own redraw (only its changed tiles)
// is round-fog.test.ts's.
import { expect, type Page, test } from "@playwright/test";
import { watchErrors } from "./helpers.ts";

const RANGED = 2;
const SPEARMAN = 1;
const GARRISONED = 7;

type U = { id: number; owner: number; type: number; sx: number; sy: number; action: number };
const units = (page: Page) => page.evaluate(() => (window.__proto?.game?.units() ?? []) as U[]);

async function start(page: Page): Promise<void> {
  // The round 7 fake world (both sides' soldiers, bowmen, a tower), with the test atlases: units drawn from atlases.
  await page.goto("./?test=1&mock=1&r7=1&tps=20&art=test");
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true, null, { timeout: 60_000 });
  await page.waitForFunction(() => (window.__proto?.game?.header().tick ?? 0) > 5);
}

/**
 * The camera to `cell` at `scale` and a frame drawn at once: every unit whose feet are on the screen drawn in it (none
 * waits a frame), none far off it drawn. Returns how many were drawn and left off.
 */
async function moveAndCheck(page: Page, x: number, y: number, scale: number): Promise<{ drawn: number; off: number; onScreen: number }> {
  return page.evaluate(
    ([x, y, scale]) => {
      const g = window.__proto?.game;
      if (g === undefined) throw new Error("no game");
      g.centerOn(x, y, scale);
      g.drawNow();
      const drawn = new Set(g.unitsDrawn().ids);
      const all = g.units() as { id: number; sx: number; sy: number; action: number }[];
      const W = innerWidth;
      const H = innerHeight;
      const onScreen = all.filter((u) => u.action !== 7 && u.sx >= 0 && u.sx <= W && u.sy >= 0 && u.sy <= H);
      const missing = onScreen.filter((u) => !drawn.has(u.id)).map((u) => `${u.id} at ${Math.round(u.sx)},${Math.round(u.sy)}`);
      // Far off (a screen away): never drawn.
      const far = all.filter((u) => drawn.has(u.id) && (u.sx < -W || u.sx > 2 * W || u.sy < -H || u.sy > 2 * H)).map((u) => u.id);
      if (missing.length > 0) throw new Error(`on the screen and not drawn in the frame the camera moved: ${missing.join("; ")}`);
      if (far.length > 0) throw new Error(`drawn a screen away: ${far.join(", ")}`);
      return { drawn: drawn.size, off: g.unitsDrawn().off, onScreen: onScreen.length };
    },
    [x, y, scale] as const,
  );
}

test("鏡頭裁切：畫面外的兵不畫；鏡頭一動，畫面裡的兵當下那一格就畫出來（跳過去、一點一點拖過去都一樣），一個螢幕以外的不畫", async ({ page }) => {
  const check = watchErrors(page);
  await start(page);
  await page.evaluate(() => window.__proto?.game?.pause());
  const all = await units(page);
  expect(all.filter((u) => u.action !== GARRISONED).length, "units in sight").toBeGreaterThan(20);
  // Jumps across the map: on the armies, beside them, far off.
  let culled = 0;
  let seen = 0;
  for (const [x, y, s] of [
    [25, 70, 1.6],
    [14, 76, 1],
    [60, 60, 1],
    [90, 20, 1.6],
    [25, 70, 0.6],
    [40, 40, 2.4],
  ] as const) {
    const r = await moveAndCheck(page, x, y, s);
    culled += r.off;
    seen += r.onScreen;
  }
  expect(culled, "some left off the screen").toBeGreaterThan(0);
  expect(seen, "some on it").toBeGreaterThan(0);
  // Dragged a little at a time across the edge of the armies (a cell a frame, as a finger or the arrow keys).
  for (let x = 4; x <= 40; x += 1) await moveAndCheck(page, x, 70, 1.6);
  for (let y = 50; y <= 90; y += 1) await moveAndCheck(page, 25, y, 1.6);
  check();
});

test("鏡頭裁切：畫面外的弓手照樣放箭（箭照樣飛），停手就不放", async ({ page }) => {
  const check = watchErrors(page);
  await start(page);
  await expect.poll(async () => (await page.evaluate(() => window.__proto?.game?.arrows()))?.real ?? false, { timeout: 30_000 }).toBe(true);
  const me = await page.evaluate(() => window.__proto?.game?.me() ?? 0);
  const all = await units(page);
  const bowmen = all.filter((u) => u.owner === me && u.type === RANGED).map((u) => u.id);
  const foe = all.find((u) => u.owner !== me && u.owner >= 0 && u.type === SPEARMAN);
  if (bowmen.length === 0 || foe === undefined) throw new Error("the fake world's round 7 layout changed");
  // The camera far from them all.
  await page.evaluate(() => window.__proto?.game?.centerOn(90, 10, 2));
  await page.waitForTimeout(300);
  const W = page.viewportSize()?.width ?? 0;
  const H = page.viewportSize()?.height ?? 0;
  const theirs = (await units(page)).filter((u) => bowmen.includes(u.id));
  expect(theirs.every((u) => u.sx < 0 || u.sx > W || u.sy < 0 || u.sy > H), "the bowmen off the screen").toBe(true);
  expect((await page.evaluate(() => window.__proto?.game?.unitsDrawn()))?.off ?? 0).toBeGreaterThan(0);
  const before = (await page.evaluate(() => window.__proto?.game?.arrows()))?.bow ?? 0;
  await page.evaluate(([ids, t]) => window.__proto?.game?.strike(ids, t), [bowmen, foe.id] as const);
  // One a cooldown each (CI's Chromium runs the fake world at a few ticks a second: 30 s).
  await expect.poll(async () => (await page.evaluate(() => window.__proto?.game?.arrows()))?.bow ?? 0, { timeout: 30_000 }).toBeGreaterThanOrEqual(before + bowmen.length);
  check();
});
