// 城門好點（the user 2026-11-10: 「我覺得門不好點，我點門的上半部會無反應」, D-138 C）: a gate's picture stands well above its
// opening, the cells a tap on the ground finds; a tap on its upper half was on the town behind it. Now a tap anywhere on the
// gate's picture is on the gate, and on a building's picture (main city, the keep, towers) on that building; a wall's picture
// is its town's, as before. With art.lock.json's art (the castles' pictures), a real game.

import { expect, type Page, test } from "@playwright/test";
import { watchErrors } from "./helpers.ts";

const GATE = 13;
type Box = { x0: number; y0: number; x1: number; y1: number };
const pictures = (page: Page) => page.evaluate(() => window.__proto?.game?.pictures() ?? { buildings: [], gates: [] });
const pickIdAt = (page: Page, x: number, y: number) => page.evaluate(([a, b]) => window.__proto?.game?.pickIdAt(a, b) ?? null, [x, y] as const);
const onScreen = (b: Box) => b.x0 >= 0 && b.y0 >= 0 && b.x1 <= 932 && b.y1 <= 336;

test("點城門畫出來的上半部也選得到城門；主城、主堡、箭樓的圖上半部也是那棟建築（寫實美術）", async ({ page }) => {
  test.setTimeout(240_000);
  const check = watchErrors(page);
  await page.setViewportSize({ width: 932, height: 336 });
  // Watching (everything seen: the castles drawn from their pictures), the computers off.
  await page.goto("./?test=1&watch=1&ai=0&art=x2&ui=proto");
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true, null, { timeout: 90_000 });
  await page.waitForFunction(() => (window.__proto?.game?.castle()?.pieces ?? 0) > 0, null, { timeout: 60_000 });
  await page.evaluate(() => window.__proto?.game?.pause());
  await page.addStyleTag({ content: "#hud, #proto-label { visibility: hidden !important; }" });
  // Every known town in turn, at 1×, until a few gates were seen whole.
  const towns = await page.evaluate(() => window.__proto?.game?.towns() ?? []);
  let gatesTried = 0;
  for (const t of towns) {
    await page.evaluate(([x, y]) => window.__proto?.game?.centerOn(x, y, 1), [t.cx, t.cy] as const);
    await page.waitForTimeout(500);
    // The town's own buildings drawn here too (the keep, the big town's tower): the top of their pictures.
    for (const b of (await pictures(page)).buildings.filter(onScreen)) {
      const picked = await pickIdAt(page, (b.x0 + b.x1) / 2, b.y0 + (b.y1 - b.y0) * 0.25);
      expect(picked?.kind, `building ${b.id}'s picture in town ${t.id}`).toBe("building");
    }
    for (const g of (await pictures(page)).gates.filter(onScreen)) {
      // Its upper part: a fifth down its picture, in the middle across.
      const x = (g.x0 + g.x1) / 2;
      const y = g.y0 + (g.y1 - g.y0) * 0.2;
      const picked = await pickIdAt(page, x, y);
      expect(picked, `the gate at ${JSON.stringify(g.cells)}, a tap at ${Math.round(x)},${Math.round(y)}`).toMatchObject({ kind: "building", type: GATE });
      gatesTried++;
    }
    if (gatesTried >= 4) break;
  }
  expect(gatesTried, "gates seen whole on the screen").toBeGreaterThanOrEqual(2);
  // A real tap on one: the gate is what the page shows (selected, or looked at: it is not ours).
  const t0 = towns[0];
  await page.evaluate(([x, y]) => window.__proto?.game?.centerOn(x, y, 1), [t0.cx, t0.cy] as const);
  await page.waitForTimeout(500);
  const g = (await pictures(page)).gates.find(onScreen);
  if (g !== undefined) {
    const at = { x: (g.x0 + g.x1) / 2, y: g.y0 + (g.y1 - g.y0) * 0.2 };
    const want = (await pickIdAt(page, at.x, at.y))?.id;
    await page.touchscreen.tap(at.x, at.y);
    await expect.poll(() => page.evaluate(() => window.__proto?.game?.selection().building ?? window.__proto?.game?.inspected()?.id ?? null)).toBe(want);
  }
  // The buildings drawn from the atlases: the top of each picture on the screen is that building (or one drawn in front of it).
  const home = (await page.evaluate(() => window.__proto?.game?.buildings() ?? [])).find((b) => b.type === 0);
  if (home === undefined) throw new Error("no main city");
  await page.evaluate(([x, y]) => window.__proto?.game?.centerOn(x, y, 1), [home.cx + 2, home.cy + 2] as const);
  await page.waitForTimeout(500);
  const drawn = (await pictures(page)).buildings.filter(onScreen);
  expect(drawn.length, "buildings drawn on the screen").toBeGreaterThan(0);
  for (const b of drawn) {
    const picked = await pickIdAt(page, (b.x0 + b.x1) / 2, b.y0 + (b.y1 - b.y0) * 0.25);
    expect(picked?.kind, `building ${b.id}'s picture`).toBe("building");
  }
  check();
});

test("箭樓、哨所畫出來的上半部也選得到（假世界的箭樓和哨所，寫實美術）", async ({ page }) => {
  test.setTimeout(180_000);
  const check = watchErrors(page);
  await page.setViewportSize({ width: 932, height: 336 });
  await page.goto("./?test=1&mock=1&tps=20&r7=1&outpost=1&art=x2&ui=proto");
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true, null, { timeout: 90_000 });
  await page.waitForFunction(() => (window.__proto?.game?.pictures().buildings.length ?? 0) > 0, null, { timeout: 60_000 });
  await page.evaluate(() => window.__proto?.game?.pause());
  await page.addStyleTag({ content: "#hud, #proto-label { visibility: hidden !important; }" });
  const all = await page.evaluate(() => window.__proto?.game?.buildings() ?? []);
  // The enemy's arrow tower (26, 63), our outpost (12, 66) and the enemy's (31, 61).
  for (const type of [10, 12]) {
    const list = all.filter((b) => b.type === type);
    expect(list.length, `type ${type} in the fake world`).toBeGreaterThan(0);
    for (const b of list) {
      await page.evaluate(([x, y]) => window.__proto?.game?.centerOn(x, y, 1), [b.cx + 1, b.cy + 1] as const);
      await page.waitForTimeout(400);
      const box = (await pictures(page)).buildings.find((p) => p.id === b.id);
      if (box === undefined) throw new Error(`building ${b.id} not drawn from a picture`);
      const picked = await pickIdAt(page, (box.x0 + box.x1) / 2, box.y0 + (box.y1 - box.y0) * 0.15);
      expect(picked, `the top of ${b.id}'s picture (type ${type})`).toMatchObject({ kind: "building", id: b.id });
    }
  }
  check();
});
