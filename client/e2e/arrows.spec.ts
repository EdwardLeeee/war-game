// 真的箭 (R8-35 B, the user's choice; ceo 2026-10-23) on the fake world: with the effects' arrow
// (the test art has art-v6's `arrow`), a bowman attacking shoots an arrow at whom it hits
// (UnitField.attackTarget) at its attack's hit frame, one a cooldown, none once it stops; a
// building's `shot` flies as an arrow too. Without it (art-v5.2, the art in use until art-v6),
// bowmen shoot nothing and a building's arrow is the straight line as before.

import { expect, type Page, test } from "@playwright/test";
import { shot, watchErrors } from "./helpers.ts";

const RANGED = 2;
const SPEARMAN = 1;
const ARROW_TOWER = 10;
const ATTACK = 2;

async function start(page: Page, art: string): Promise<void> {
  await page.goto(`./?test=1&mock=1&r7=1&tps=20&art=${art}`);
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true, null, { timeout: 60_000 });
}

const units = (page: Page) => page.evaluate(() => window.__proto?.game?.units() ?? []);
const buildings = (page: Page) => page.evaluate(() => window.__proto?.game?.buildings() ?? []);
const arrows = (page: Page) => page.evaluate(() => window.__proto?.game?.arrows() ?? { real: false, bow: 0, building: 0 });
const centre = (page: Page, x: number, y: number, scale = 1) => page.evaluate(([x, y, s]) => window.__proto?.game?.centerOn(x, y, s), [x, y, scale] as const);

async function sides(page: Page): Promise<{ bowmen: number[]; foe: number; ours: number; tower: number }> {
  const me = await page.evaluate(() => window.__proto?.game?.me() ?? 0);
  const all = await units(page);
  const bowmen = all.filter((u) => u.owner === me && u.type === RANGED).map((u) => u.id);
  const foe = all.find((u) => u.owner !== me && u.owner >= 0 && u.type === SPEARMAN);
  const ours = all.find((u) => u.owner === me && u.type === SPEARMAN);
  const tower = (await buildings(page)).find((b) => b.owner !== me && b.type === ARROW_TOWER);
  if (bowmen.length === 0 || foe === undefined || ours === undefined || tower === undefined) throw new Error("the fake world's round 7 layout changed");
  return { bowmen, foe: foe.id, ours: ours.id, tower: tower.id };
}

test("真的箭（有 arrow 效果）：遠程兵攻擊時在出手那一格朝目標放箭，停手就不放；建築的箭也照這樣飛", async ({ page }, info) => {
  const check = watchErrors(page);
  await start(page, "test");
  await expect.poll(async () => (await arrows(page)).real, { timeout: 30_000 }).toBe(true);
  const s = await sides(page);
  await centre(page, 25, 70, 1.6);
  await page.evaluate(([ids, t]) => window.__proto?.game?.strike(ids, t), [s.bowmen, s.foe] as const);
  // One a cooldown each (CI's Chromium runs the fake world at a few ticks a second: 30 s).
  await expect.poll(async () => (await arrows(page)).bow, { timeout: 30_000 }).toBeGreaterThanOrEqual(s.bowmen.length);
  await shot(page, info, "arrows-bowmen");
  // They stop (the snapshot says so): no more arrows.
  await page.evaluate(([ids]) => window.__proto?.game?.strike(ids, -1), [s.bowmen] as const);
  await expect.poll(async () => (await units(page)).filter((u) => s.bowmen.includes(u.id) && u.action === ATTACK).length, { timeout: 30_000 }).toBe(0);
  await page.waitForTimeout(500);
  const stopped = (await arrows(page)).bow;
  await page.waitForTimeout(2000);
  expect((await arrows(page)).bow).toBe(stopped);
  // A building's arrows (the enemy's arrow tower at one of ours): flown, three side by side.
  const before = (await arrows(page)).building;
  await page.evaluate(([b, t]) => window.__proto?.game?.inject({ k: "shot", building: b, target: t, n: 3 }), [s.tower, s.ours] as const);
  await expect.poll(async () => (await arrows(page)).building, { timeout: 30_000 }).toBeGreaterThanOrEqual(before + 3);
  check();
});

test("真的箭（art-v5.2，還沒有 arrow 效果）：遠程兵不放箭，建築的箭照舊是直線", async ({ page }) => {
  const check = watchErrors(page);
  await start(page, "x3");
  const loaded = await page.waitForFunction(() => (window.__proto?.game?.art()?.pages ?? 0) > 0, null, { timeout: 30_000 }).then(() => true, () => false);
  test.skip(!loaded, "這台沒有 art.lock 的美術");
  test.skip((await arrows(page)).real, "art.lock 的美術已經有 arrow 效果（art-v6 起）");
  const s = await sides(page);
  await page.evaluate(([ids, t]) => window.__proto?.game?.strike(ids, t), [s.bowmen, s.foe] as const);
  const shots = await page.evaluate(() => window.__proto?.game?.shots() ?? 0);
  await page.evaluate(([b, t]) => window.__proto?.game?.inject({ k: "shot", building: b, target: t }), [s.tower, s.ours] as const);
  await expect.poll(() => page.evaluate(() => window.__proto?.game?.shots() ?? 0), { timeout: 30_000 }).toBeGreaterThan(shots);
  await page.waitForTimeout(3000);
  expect(await arrows(page)).toEqual({ real: false, bow: 0, building: 0 });
  check();
});
