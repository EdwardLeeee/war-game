// 使用者 2026-10-18 的回饋（D-084）on the phone held sideways (814 × 380): 搶 keeps soldiers by
// default as 治理 does (the capture dialog), and the towns drawn as a stretch of wall (the user's
// choice B): 鎮 3 × 3 cells, 城 4 × 4 right under its tower, the state's words under the wall. The
// fake world shows every state; the real simulation shows where the big city's tower really
// stands (in the middle).

import { expect, type Page, test } from "@playwright/test";
import { shot, watchErrors } from "./helpers.ts";

const TILE = 32;
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

/** The town's wall: a picture's frame and, for the test, where it stands. */
async function wallOf(page: Page, id: number): Promise<{ x: number; y: number; side: number; visible: boolean }> {
  await expect.poll(async () => (await walls(page)).find((w) => w.id === id)?.visible ?? false).toBe(true);
  const w = (await walls(page)).find((v) => v.id === id);
  if (w === undefined) throw new Error(`no wall for town ${id}`);
  return w;
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

test("野城的城牆（D-084）：中立小鎮、我方搶奪中、敵方治理、廢墟都畫城牆；小鎮 3×3 格在正中間，大城 4×4 在塔的正下方；狀態字在城牆下面；點城牆就是選城鎮", async ({ page }, info) => {
  const check = watchErrors(page);
  await startFake(page);
  await lookAtCity(page);
  const all = await towns(page);
  // The fake world: 0 neutral (30, 66), 1 ours governed, 2 ruins (36, 80), 3 the big city ours plundering (48, 48), 4 the enemy's governed (38, 56).
  for (const t of all.filter((v) => v.size === 0)) {
    const w = await wallOf(page, t.id);
    expect(w, `town ${t.id}`).toMatchObject({ x: (t.cx + 0.5) * TILE - 48, y: (t.cy + 0.5) * TILE - 48, side: 96 });
  }
  const tower = (await buildings(page)).find((b) => b.type === TOWER);
  if (tower === undefined) throw new Error("no tower");
  const big = await wallOf(page, 3);
  expect(big.side).toBe(4 * TILE);
  expect(big.y, "its top along the tower's foot").toBe((tower.cy + tower.size) * TILE);
  expect(big.x + big.side / 2, "centred under the tower").toBe((tower.cx + tower.size / 2) * TILE);
  // A tap on the wall picks the town (the ruins at (36, 80): no unit there).
  await centre(page, 36, 80);
  expect(await pickAt(page, await toScreen(page, 36.5, 80.5))).toBe("town");
  // Soldiers of ours beside the ruins and the enemy's town, so that the pictures are not in the fog.
  const spear = await page.evaluate(() => (window.__proto?.game?.units() ?? []).filter((u) => u.owner === window.__proto?.game?.me() && u.type === 1).map((u) => u.id));
  await page.evaluate(([a, b]) => window.__proto?.game?.place([a, b], [{ x: 40, y: 83 }, { x: 42, y: 57 }]), [spear[0], spear[1]] as const);
  await page.waitForTimeout(500);
  for (const [name, x, y] of [["d084-neutral-town", 30, 66], ["d084-own-plundering", 48, 48], ["d084-enemy-governed", 38, 56], ["d084-ruins", 36, 80]] as const) {
    await centre(page, x, y);
    await shot(page, info, name);
  }
  check();
});

test("大城的塔被拆掉（D-084）：城牆留在原來的位置，不跳回正中間", async ({ page }, info) => {
  const check = watchErrors(page);
  await startFake(page);
  await lookAtCity(page);
  // Neutral again (a revolt), its tower standing.
  await page.evaluate(() => window.__proto?.game?.inject({ k: "town_revolted", town: 3, from: 0 }));
  await expect.poll(async () => (await towns(page)).find((t) => t.id === 3)?.state).toBe(0);
  // The revolt's line goes before the pictures.
  await expect(page.getByRole("status").filter({ hasText: "叛離" })).toHaveCount(0, { timeout: 10_000 });
  const before = await wallOf(page, 3);
  const tower = (await buildings(page)).find((b) => b.type === TOWER);
  if (tower === undefined) throw new Error("no tower");
  await centre(page, 48, 48);
  await shot(page, info, "d084-neutral-city-fake");
  await page.evaluate((id) => window.__proto?.game?.remove([id]), tower.id);
  await expect.poll(async () => (await buildings(page)).some((b) => b.type === TOWER)).toBe(false);
  await page.waitForTimeout(300);
  expect(await wallOf(page, 3)).toEqual(before);
  await shot(page, info, "d084-city-tower-down");
  check();
});

test("真的模擬（D-084）：中立大城的塔在正中間，城牆在塔的正下方、不重疊，還在城鎮的圓裡", async ({ page }, info) => {
  const check = watchErrors(page);
  // Watching the computer play itself: everything in sight, nothing taken yet.
  await page.goto("./?test=1&watch=1&tps=20");
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true);
  const big = (await towns(page)).find((t) => t.size === 1);
  if (big === undefined) throw new Error("no big city");
  const tower = (await buildings(page)).find((b) => b.type === TOWER);
  if (tower === undefined) throw new Error("no tower");
  expect(big.cx >= tower.cx && big.cx < tower.cx + tower.size && big.cy >= tower.cy && big.cy < tower.cy + tower.size, "the tower stands in the middle").toBe(true);
  const w = await wallOf(page, big.id);
  expect(w.side).toBe(4 * TILE);
  expect(w.y).toBe((tower.cy + tower.size) * TILE);
  expect(w.x + w.side / 2).toBe((tower.cx + tower.size / 2) * TILE);
  const far = Math.hypot(w.x + w.side - (big.cx + 0.5) * TILE, w.y + w.side + TILE - (big.cy + 0.5) * TILE);
  expect(far, "the wall and its words inside the circle").toBeLessThan(big.radius * TILE);
  await centre(page, big.cx + 0.5, big.cy + 2);
  await shot(page, info, "d084-neutral-city");
  check();
});
