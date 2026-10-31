// 城門與城牆 (D-096, PROTOCOL.md 3.7; the user 2026-10-21: 城牆「雞肋」) on the fake world with gates
// and walls on (?walls=1): a gate in each opening, as wide as it (tap any of its cells), its town's
// hit points, attacked with 攻擊; broken (gone), rubble on its opening; those on a wall, 「牆上 N／M」
// on the town's panel;
// a tower's volley drawn as its arrows. With art-v5.2's castle (war-game-ui 2026-10-22): those on a
// wall on its walk, behind its front parts; a gate closed, open, damaged, broken; a tower's arrows
// from its shoot_at_m. Pictures for the user: soldiers on a wall (東陸、西陸: a palisade's south and
// north stretches, a big city's stone wall), the gates' looks, the buttons.

import { expect, type Page, test } from "@playwright/test";
import { selectForCommands, shot, watchErrors } from "./helpers.ts";
import { tap } from "./touch.ts";

const GATE = 13;
const RANGED = 2;
const SPEARMAN = 1;
/** The fake world's towns: 0 the small neutral one at (30, 66), 1 our governed one at (18, 62). */
const NEUTRAL_TOWN = { id: 0, x: 30, y: 66 };
/** Open ground inside the neutral town, away from its militia (29–31, 66) and the enemy's arrow tower (26, 63). */
const NEUTRAL_OPEN = { x: 33, y: 64 };
const OUR_TOWN = { id: 1, x: 18, y: 62 };
/** The big city (ours, plundering) at (48, 48): a stone wall. */
const BIG_CITY = { id: 3, x: 48, y: 48 };
const castle = (page: Page) => page.evaluate(() => window.__proto?.game?.castle() ?? null);
/** The castle's pictures say where those on a wall stand and have the gates' looks (art-v5.2); art-v5's have neither. */
const artV52 = async (page: Page) => (await castle(page))?.walkable === true;

const units = (page: Page) => page.evaluate(() => window.__proto?.game?.units() ?? []);
const buildings = (page: Page) => page.evaluate(() => window.__proto?.game?.buildings() ?? []);
const sent = (page: Page) => page.evaluate(() => (window.__proto?.game?.sent() ?? []) as Record<string, unknown>[]);
const lastOrder = async (page: Page) => (await sent(page)).filter((c) => c.auto !== true).at(-1);
const selection = (page: Page) => page.evaluate(() => window.__proto?.game?.selection());
/** A cell's middle on the screen (the hook adds the half cell). */
const at = (page: Page, c: { x: number; y: number }) => page.evaluate(([x, y]) => window.__proto?.game?.cellToScreen(x, y) ?? { x: 0, y: 0 }, [c.x, c.y] as const);
const centre = (page: Page, x: number, y: number, scale = 1) => page.evaluate(([cx, cy, s]) => window.__proto?.game?.centerOn(cx, cy, s), [x, y, scale] as const);

async function start(page: Page, query = ""): Promise<void> {
  await page.goto(`./?test=1&mock=1&walls=1&tps=20${query}`);
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true, null, { timeout: 60_000 });
}

async function ownIds(page: Page, types: number[]): Promise<number[]> {
  const me = await page.evaluate(() => window.__proto?.game?.me() ?? 0);
  return (await units(page)).filter((u) => u.owner === me && types.includes(u.type)).map((u) => u.id).sort((a, b) => a - b);
}

/** A town's gates (buildings), each with the cells of its opening. */
async function gatesOf(page: Page, town: { id: number; x: number; y: number }) {
  const cells = await page.evaluate((id) => window.__proto?.game?.castleCells(id) ?? null, town.id);
  if (cells === null) throw new Error("no castle");
  // Its own: a gate whose top-left cell is one of this castle's gate cells.
  const gates = (await buildings(page)).filter((b) => b.type === GATE && cells.gate.some(([x, y]) => x === b.cx && y === b.cy));
  return gates.map((g) => ({ ...g, cells: cells.gate.filter(([x, y]) => (x === g.cx && y >= g.cy && y <= g.cy + 3) || (y === g.cy && x >= g.cx && x <= g.cx + 3)) }));
}

test("城門（D-096）：每個開口一座，點開口任何一格都選到它；寫城門和城鎮大小的血量；按攻擊再點中立城鎮的城門就打它；打破了畫碎石", async ({ page }, info) => {
  const check = watchErrors(page);
  await start(page);
  // Our town's gates: its holder's, the small town's 850.
  const ours = await gatesOf(page, OUR_TOWN);
  expect(ours.length, "four openings").toBe(4);
  const south = ours.reduce((a, b) => (b.cy > a.cy ? b : a));
  expect(south.cells.length, "three cells wide").toBe(3);
  await centre(page, OUR_TOWN.x + 0.5, OUR_TOWN.y + 3.5, 1.2);
  for (const [x, y] of [south.cells[0], south.cells[2]]) {
    await tap(page, await at(page, { x, y }));
    await expect.poll(async () => (await selection(page))?.building).toBe(south.id);
  }
  const panel = page.locator(".sel-info");
  await expect(panel).toContainText("城門");
  await expect(panel).toContainText("生命 850/850");
  await shot(page, info, "walls-gate-closed");

  // The neutral town's gate: 攻擊, then a tap on it.
  const spear = await ownIds(page, [SPEARMAN]);
  await selectForCommands(page, spear);
  // Its north gate (the enemy's soldiers stand by its south one, and a tap would pick them).
  const neutral = (await gatesOf(page, NEUTRAL_TOWN)).reduce((a, b) => (b.cy < a.cy ? b : a));
  await centre(page, NEUTRAL_TOWN.x + 0.5, NEUTRAL_TOWN.y - 3.5, 1.2);
  await page.locator(".cmds").getByRole("button", { name: /^攻擊/ }).tap();
  await tap(page, await at(page, { x: neutral.cells[1][0], y: neutral.cells[1][1] }));
  await expect.poll(() => lastOrder(page)).toMatchObject({ c: "attack", u: spear, target: neutral.id });

  // Broken (the building gone, the town not in ruins, the opening in view): rubble on it.
  expect(await page.evaluate(() => window.__proto?.game?.brokenGates() ?? -1)).toBe(0);
  await page.evaluate((id) => window.__proto?.game?.remove([id]), neutral.id);
  await expect.poll(() => page.evaluate(() => window.__proto?.game?.brokenGates() ?? -1)).toBe(1);
  await page.evaluate(() => window.__proto?.game?.select([]));
  await shot(page, info, "walls-gate-broken");
  check();
});

test("牆上（D-096）：沒有上城牆、下城牆鈕（駐軍進城的遠程兵自己上牆）；牆上的遠程兵，城鎮寫牆上幾名", async ({ page }, info) => {
  const check = watchErrors(page);
  await start(page);
  const ranged = await ownIds(page, [RANGED]);
  await selectForCommands(page, ranged);
  await expect(page.locator(".cmds").getByRole("button", { name: /^上城牆/ })).toHaveCount(0);
  await expect(page.locator(".cmds").getByRole("button", { name: /^下城牆/ })).toHaveCount(0);
  await page.evaluate(([u, town]) => window.__proto?.game?.send({ c: "wall", u, town }), [ranged, OUR_TOWN.id] as const);
  // Order.Wall (11).
  await expect.poll(async () => (await units(page)).filter((u) => ranged.includes(u.id) && u.order === 11).length).toBe(ranged.length);
  await expect(page.locator(".cmds").getByRole("button", { name: /^下城牆/ })).toHaveCount(0);
  // The town's panel: 牆上 N／28.
  await page.evaluate(() => window.__proto?.game?.select([]));
  await centre(page, OUR_TOWN.x + 0.5, OUR_TOWN.y + 0.5, 1);
  await tap(page, await at(page, { x: OUR_TOWN.x, y: OUR_TOWN.y }));
  await expect(page.locator(".sel-info")).toContainText(`牆上 ${ranged.length}／28`);
  // Not about other towns' walls (ceo: nothing about others').
  await centre(page, NEUTRAL_TOWN.x + 0.5, NEUTRAL_TOWN.y + 0.5, 1);
  await tap(page, await at(page, NEUTRAL_OPEN));
  await expect(page.locator(".sel-info")).toContainText("小鎮");
  await expect(page.locator(".sel-info")).not.toContainText("牆上");
  await shot(page, info, "walls-no-wall-button");
  check();
});

test("城樓一次射好幾支箭（D-096 shot.n）：分開畫出 n 支", async ({ page }) => {
  await start(page);
  const gate = (await gatesOf(page, OUR_TOWN))[0];
  const [target] = (await units(page)).filter((u) => u.owner !== (0 as number) && u.type === SPEARMAN);
  const before = await page.evaluate(() => window.__proto?.game?.shots() ?? 0);
  await page.evaluate(([b, t]) => window.__proto?.game?.inject({ k: "shot", building: b, target: t, n: 3 }), [gate.id, target.id] as const);
  await expect.poll(() => page.evaluate(() => window.__proto?.game?.shots() ?? 0)).toBe(before + 3);
});

for (const culture of ["e", "w"] as const) {
  test(`牆上的兵（D-096）：站在牆頂走道上、前面的尖樁或垛口擋住下半身，不當成躲在牆後（${culture === "e" ? "東陸" : "西陸"}，3 倍圖）`, async ({ page }, info) => {
    test.setTimeout(150_000);
    const check = watchErrors(page);
    await start(page, `&art=x3&culture=${culture}`);
    // The ranged only (a mage's cannon on autocast fires from the wall, and the fake world calls that 施法).
    const ranged = await ownIds(page, [RANGED]);
    const wallUp = async (ids: number[], town: { id: number; x: number; y: number }) => {
      await page.evaluate(([u, t]) => window.__proto?.game?.send({ c: "wall", u, town: t }), [ids, town.id] as const);
      await expect.poll(async () => (await units(page)).filter((u) => ids.includes(u.id) && u.order === 11).length).toBe(ids.length);
    };
    // Our small town's south stretch (they come from the south-east), its stakes in front of them.
    const south = ranged.slice(0, 2);
    await wallUp(south, OUR_TOWN);
    // With art-v5.2's castle, drawn up there (art-v5's has no walk: where they stand; blocks: none).
    const v6 = await artV52(page);
    if (v6) await expect.poll(() => page.evaluate(() => window.__proto?.game?.wallLifted() ?? 0)).toBe(south.length);
    const on = (await units(page)).filter((u) => south.includes(u.id));
    await centre(page, on.reduce((n, u) => n + u.cx, 0) / on.length + 0.5, on.reduce((n, u) => n + u.cy, 0) / on.length - 1, 1.6);
    await page.waitForTimeout(400);
    await shot(page, info, `walls-on-wall-${culture}`);
    // Its north stretch, the walk in front of the stakes (put by it first).
    const north = ranged.slice(2);
    await page.evaluate(([ids, y]) => window.__proto?.game?.place(ids, [14, 15, 21, 22].map((x) => ({ x, y }))), [north, OUR_TOWN.y - 7] as const);
    await wallUp(north, OUR_TOWN);
    await centre(page, OUR_TOWN.x + 0.5, OUR_TOWN.y - 4.5, 1.6);
    await page.waitForTimeout(400);
    await shot(page, info, `walls-on-wall-north-${culture}`);
    // The big city's stone wall: behind its merlons (all of them, from its south).
    await page.evaluate(([ids, town]) => window.__proto?.game?.send({ c: "leave_wall", u: ids, town }), [ranged, OUR_TOWN.id] as const);
    await expect.poll(async () => (await units(page)).filter((u) => ranged.includes(u.id) && u.order === 11).length).toBe(0);
    await page.evaluate(([ids, y]) => window.__proto?.game?.place(ids, [43, 44, 45, 50, 51, 52].map((x) => ({ x, y }))), [ranged, BIG_CITY.y + 8] as const);
    await wallUp(ranged, BIG_CITY);
    if (v6) await expect.poll(() => page.evaluate(() => window.__proto?.game?.wallLifted() ?? 0)).toBe(ranged.length);
    const up = (await units(page)).filter((u) => ranged.includes(u.id));
    await centre(page, Math.min(...up.map((u) => u.cx)) + 2, BIG_CITY.y + 2.5, 2.2);
    await page.waitForTimeout(400);
    await shot(page, info, `walls-on-wall-stone-${culture}`);
    check();
  });
}

test("城門的樣子（D-096，art-v5.2）：關著；城主的兵在門口開著；血量一半以下受損；打破了是倒下的門（不畫碎石）；城樓的箭從城樓射出", async ({ page }, info) => {
  test.setTimeout(150_000);
  const check = watchErrors(page);
  await start(page, "&art=x3");
  await expect.poll(async () => (await castle(page))?.pieces ?? 0, { timeout: 30_000 }).toBeGreaterThan(0);
  test.skip(!(await artV52(page)), "art.lock 的城牆圖還沒有城門的樣子（art-v5.2 之前）");
  const looks = async () => (await castle(page))?.gates ?? {};
  // The neutral town's north gate: nobody of its holder's by it, closed.
  const neutral = (await gatesOf(page, NEUTRAL_TOWN)).reduce((a, b) => (b.cy < a.cy ? b : a));
  await centre(page, NEUTRAL_TOWN.x + 0.5, NEUTRAL_TOWN.y - 4, 1.4);
  await expect.poll(async () => (await looks()).closed ?? 0).toBeGreaterThan(0);
  await page.waitForTimeout(300);
  await shot(page, info, "walls-gate-art-closed");
  // Our town's north gate: closed; a spearman of ours by it, open.
  const before = await looks();
  const ourNorth = (await gatesOf(page, OUR_TOWN)).reduce((a, b) => (b.cy < a.cy ? b : a));
  const [spear] = await ownIds(page, [SPEARMAN]);
  await page.evaluate(([id, x, y]) => window.__proto?.game?.place([id], [{ x, y }]), [spear, ourNorth.cx + 1, ourNorth.cy - 1] as const);
  await expect.poll(async () => (await looks()).intact ?? 0).toBe((before.intact ?? 0) + 1);
  await centre(page, OUR_TOWN.x + 0.5, OUR_TOWN.y - 4, 1.4);
  await page.waitForTimeout(300);
  await shot(page, info, "walls-gate-art-open");
  // The neutral's damaged (half its hit points or less), then broken: its picture, no rubble.
  await page.evaluate((id) => window.__proto?.game?.damage(id, 400), neutral.id);
  await expect.poll(async () => (await looks()).damaged ?? 0).toBe(1);
  await centre(page, NEUTRAL_TOWN.x + 0.5, NEUTRAL_TOWN.y - 4, 1.4);
  await page.waitForTimeout(300);
  await shot(page, info, "walls-gate-art-damaged");
  await page.evaluate((id) => window.__proto?.game?.remove([id]), neutral.id);
  await expect.poll(async () => (await looks()).broken ?? 0).toBe(1);
  expect(await page.evaluate(() => window.__proto?.game?.brokenGates() ?? -1), "counted broken, drawn by its picture").toBe(1);
  await page.waitForTimeout(300);
  await shot(page, info, "walls-gate-art-broken");
  // Our town's gate shoots: from its tower (shoot_at_m), its flash there.
  const gate = (await gatesOf(page, OUR_TOWN))[0];
  const [target] = (await units(page)).filter((u) => u.owner !== (0 as number) && u.type === SPEARMAN);
  const towers = await page.evaluate(() => window.__proto?.game?.towerShots() ?? 0);
  const arrows = await page.evaluate(() => window.__proto?.game?.arrows() ?? { real: false, bow: 0, building: 0 });
  await page.evaluate(([b, t]) => window.__proto?.game?.inject({ k: "shot", building: b, target: t, n: 3 }), [gate.id, target.id] as const);
  // With the effects' `arrow` (art-v6 on), the three fly as arrows from the gate's tower; before, one straight line.
  // At least three: the fake world's own towers may shoot meanwhile on a slow runner (CI run 40203416464).
  if (arrows.real) await expect.poll(async () => (await page.evaluate(() => window.__proto?.game?.arrows()))?.building ?? 0).toBeGreaterThanOrEqual(arrows.building + 3);
  else await expect.poll(() => page.evaluate(() => window.__proto?.game?.towerShots() ?? 0)).toBe(towers + 1);
  check();
});

test("民兵在牆上投石（D-096，art-v5.2）：我方的兵走近，中立城鎮牆上的民兵用投石動作，石頭從手上飛向他", async ({ page }, info) => {
  test.setTimeout(120_000);
  const check = watchErrors(page);
  await start(page, "&art=x3");
  await expect.poll(async () => (await castle(page))?.pieces ?? 0, { timeout: 30_000 }).toBeGreaterThan(0);
  test.skip(!(await page.evaluate(() => window.__proto?.game?.art()?.sling === true)), "art.lock 的民兵還沒有投石動作（art-v5.2 之前）");
  // The fake world's militia on the neutral town's south wall at (33, 71): one of ours 3 cells south of it.
  const [spear] = await ownIds(page, [SPEARMAN]);
  await page.evaluate(([id]) => window.__proto?.game?.place([id], [{ x: 33, y: 74 }]), [spear] as const);
  await expect.poll(() => page.evaluate(() => window.__proto?.game?.stones() ?? 0), { timeout: 20_000 }).toBeGreaterThan(0);
  await centre(page, 33.5, 70.5, 2.2);
  await page.waitForTimeout(500);
  await shot(page, info, "walls-sling");
  check();
});
