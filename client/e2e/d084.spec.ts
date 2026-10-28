// 使用者 2026-10-18 的回饋（D-084）on the phone held sideways (814 × 380): 搶 keeps soldiers by
// default as 治理 does (the capture dialog). The towns' wall symbol (the user's choice B) gave way
// to real castles (D-089, the user 2026-10-19: 「希望像一個城堡」; castle.spec.ts): with a castle
// no symbol and no range circle; the walls on the simulation's cells (here without the atlases:
// blocks, the inside tinted), a tap on them picking the town, and the state's words under the
// south wall. The fake world shows every state; the real simulation the big city's tower inside its walls.

import { expect, type Page, test } from "@playwright/test";
import { shot, watchErrors } from "./helpers.ts";

const TOWER = 9; // BuildingType.TownTower

const walls = (page: Page) => page.evaluate(() => window.__proto?.game?.townWalls() ?? []);
const towns = (page: Page) => page.evaluate(() => window.__proto?.game?.towns() ?? []);
const buildings = (page: Page) => page.evaluate(() => window.__proto?.game?.buildings() ?? []);
const centre = (page: Page, x: number, y: number, scale = 1.3) => page.evaluate(([cx, cy, s]) => window.__proto?.game?.centerOn(cx, cy, s), [x, y, scale] as const);
const toScreen = (page: Page, x: number, y: number) => page.evaluate(([cx, cy]) => window.__proto?.game?.cellToScreen(cx, cy) ?? { x: 0, y: 0 }, [x, y] as const);
const pickAt = (page: Page, p: { x: number; y: number }) => page.evaluate(([x, y]) => window.__proto?.game?.pickAt(x, y) ?? null, [p.x, p.y] as const);

async function startFake(page: Page): Promise<void> {
  await page.goto("./?test=1&mock=1&tps=20");
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true);
}

/** The big city at (48, 48) lies in the fog at first: a spearman of ours goes and looks (its tower too). */
async function lookAtCity(page: Page): Promise<void> {
  const spear = await page.evaluate(() => (window.__proto?.game?.units() ?? []).filter((u) => u.owner === window.__proto?.game?.me() && u.type === 1).map((u) => u.id));
  await page.evaluate(([id]) => window.__proto?.game?.place([id], [{ x: 51, y: 52 }]), [spear.at(-1) ?? -1] as const);
  await expect.poll(async () => (await towns(page)).find((t) => t.id === 3)?.state ?? -1).toBeGreaterThanOrEqual(0);
  await expect.poll(async () => (await buildings(page)).some((b) => b.type === TOWER)).toBe(true);
}

test("攻下對話框（D-084）：搶和治理都預設留最少駐軍數（小鎮 1 名）", async ({ page }, info) => {
  const check = watchErrors(page);
  await startFake(page);
  const spear = await page.evaluate(() => (window.__proto?.game?.units() ?? []).filter((u) => u.owner === window.__proto?.game?.me() && u.type === 1).map((u) => u.id));
  await page.evaluate(([ids]) => window.__proto?.game?.place(ids, [{ x: 30, y: 67 }, { x: 31, y: 66 }]), [spear.slice(0, 2)] as const);
  await centre(page, 30, 66, 1);
  await page.evaluate(() => window.__proto?.game?.inject({ k: "town_captured", town: 0, by: 0 }));
  const dialog = page.getByRole("dialog", { name: /搶還是治理/ });
  await expect(dialog.getByRole("status", { name: "留守幾名（搶）" })).toHaveText("1");
  await expect(dialog.getByRole("status", { name: "留守幾名（治理）" })).toHaveText("1");
  await shot(page, info, "d084-capture-dialog");
  check();
});

const castleCells = (page: Page, id: number) => page.evaluate((t) => window.__proto?.game?.castleCells(t) ?? null, id);

test("有城堡以後（D-089）：不畫 D-084 的城牆符號；中立、我方搶奪中、敵方治理、廢墟的城牆都照模擬的格子畫成方塊（沒有美術）；點牆就是選城鎮", async ({ page }, info) => {
  const check = watchErrors(page);
  await startFake(page);
  await lookAtCity(page);
  // The fake world: 0 neutral (30, 66), 1 ours governed, 2 ruins (36, 80), 3 the big city ours plundering (48, 48), 4 the enemy's governed (38, 56).
  await expect.poll(async () => (await page.evaluate(() => window.__proto?.game?.castle() ?? null))?.blockTowns ?? 0).toBe((await towns(page)).length);
  expect((await walls(page)).filter((w) => w.visible), "no D-084 symbol").toEqual([]);
  // A tap on the ruins' west wall picks the town (no unit there).
  const ruins = await castleCells(page, 2);
  if (ruins === null) throw new Error("no castle");
  const [wx, wy] = ruins.wall.filter(([x]) => x === ruins.inside.x0 - 1).sort(([, a], [, b]) => a - b)[2];
  await centre(page, 36, 80);
  expect(await pickAt(page, await toScreen(page, wx, wy))).toBe("town");
  // Soldiers of ours beside the ruins and the enemy's town, so that they are not in the fog.
  const spear = await page.evaluate(() => (window.__proto?.game?.units() ?? []).filter((u) => u.owner === window.__proto?.game?.me() && u.type === 1).map((u) => u.id));
  await page.evaluate(([a, b]) => window.__proto?.game?.place([a, b], [{ x: 40, y: 83 }, { x: 42, y: 57 }]), [spear[0], spear[1]] as const);
  await page.waitForTimeout(500);
  for (const [name, x, y] of [["d089-blocks-neutral-town", 30, 66], ["d089-blocks-own-plundering", 48, 48], ["d089-blocks-enemy-governed", 38, 56], ["d089-blocks-ruins", 36, 80]] as const) {
    await centre(page, x, y, 0.9);
    await shot(page, info, name);
  }
  check();
});

test("大城的塔被拆掉（D-089）：城牆照模擬的格子，位置不變", async ({ page }) => {
  const check = watchErrors(page);
  await startFake(page);
  await lookAtCity(page);
  const before = await castleCells(page, 3);
  const tower = (await buildings(page)).find((b) => b.type === TOWER);
  if (tower === undefined || before === null) throw new Error("no tower or castle");
  await page.evaluate((id) => window.__proto?.game?.remove([id]), tower.id);
  await expect.poll(async () => (await buildings(page)).some((b) => b.type === TOWER)).toBe(false);
  await page.waitForTimeout(300);
  expect(await castleCells(page, 3)).toEqual(before);
  check();
});

test("真的模擬（D-089）：中立大城的塔（D-100 開著時是主堡）在城牆裡面的正中間，牆照模擬的格子", async ({ page }, info) => {
  const check = watchErrors(page);
  // Watching the computer play itself: everything in sight, nothing taken yet.
  await page.goto("./?test=1&watch=1&tps=20");
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true);
  const big = (await towns(page)).find((t) => t.size === 1);
  if (big === undefined) throw new Error("no big city");
  // The big city's: with D-100's keeps on (core's default since 2026-10-29) every town has one (the same type).
  const tower = (await buildings(page)).filter((b) => b.type === TOWER).sort((a, b) => Math.hypot(a.cx - big.cx, a.cy - big.cy) - Math.hypot(b.cx - big.cx, b.cy - big.cy))[0];
  if (tower === undefined) throw new Error("no tower");
  expect(big.cx >= tower.cx && big.cx < tower.cx + tower.size && big.cy >= tower.cy && big.cy < tower.cy + tower.size, "the tower stands in the middle").toBe(true);
  const c = await castleCells(page, big.id);
  if (c === null) throw new Error("no castle");
  expect(tower.cx >= c.inside.x0 && tower.cx + tower.size - 1 <= c.inside.x1 && tower.cy >= c.inside.y0 && tower.cy + tower.size - 1 <= c.inside.y1, "the tower inside the walls").toBe(true);
  expect((await walls(page)).filter((w) => w.visible), "no D-084 symbol").toEqual([]);
  await centre(page, big.cx + 0.5, big.cy + 2, 0.9);
  await shot(page, info, "d089-neutral-city");
  check();
});
