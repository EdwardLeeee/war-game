// 城門與城牆 (D-096, PROTOCOL.md 3.7; the user 2026-10-21: 城牆「雞肋」) on the fake world with gates
// and walls on (?walls=1): a gate in each opening, as wide as it (tap any of its cells), its town's
// hit points, attacked with 攻擊; broken (gone), rubble on its opening; 上城牆 (war-game-ui's icon) takes
// the ranged units and mages selected up on a town we hold, 「牆上 N／M」 on its panel, 下城牆 back;
// a tower's volley drawn as its arrows. Pictures for the user: soldiers on a wall (東陸、西陸), a gate
// closed and broken, the button.

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

const units = (page: Page) => page.evaluate(() => window.__proto?.game?.units() ?? []);
const buildings = (page: Page) => page.evaluate(() => window.__proto?.game?.buildings() ?? []);
const sent = (page: Page) => page.evaluate(() => (window.__proto?.game?.sent() ?? []) as Record<string, unknown>[]);
const lastOrder = async (page: Page) => (await sent(page)).filter((c) => c.auto !== true).at(-1);
const selection = (page: Page) => page.evaluate(() => window.__proto?.game?.selection());
/** A cell's middle on the screen (the hook adds the half cell). */
const at = (page: Page, c: { x: number; y: number }) => page.evaluate(([x, y]) => window.__proto?.game?.cellToScreen(x, y) ?? { x: 0, y: 0 }, [c.x, c.y] as const);
const centre = (page: Page, x: number, y: number, scale = 1) => page.evaluate(([cx, cy, s]) => window.__proto?.game?.centerOn(cx, cy, s), [x, y, scale] as const);
const toast = (page: Page, text: string | RegExp) => page.getByRole("status").filter({ hasText: text });

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

test("上城牆（D-096）：選了遠程兵有上城牆鈕（ui 的圖示）；點別人的城鎮說原因；點自己的城鎮送 wall，城鎮寫牆上幾名；下城牆送 leave_wall", async ({ page }, info) => {
  const check = watchErrors(page);
  await start(page);
  const ranged = await ownIds(page, [RANGED]);
  // Ranged and spearmen: only the ranged go up.
  await selectForCommands(page, [...ranged, ...(await ownIds(page, [SPEARMAN]))]);
  const up = page.locator(".cmds").getByRole("button", { name: /^上城牆/ });
  await expect(up).toBeVisible();
  await expect(up.locator("svg.ic")).toHaveCount(1);
  await shot(page, info, "walls-button");
  await up.tap();
  await expect.poll(() => page.evaluate(() => window.__proto?.game?.mode())).toBe("wall");
  await expect(page.locator(".prompt")).toContainText("點自己持有的城鎮：只有遠程兵和法師會站上城牆");
  // The neutral town: not ours.
  await centre(page, NEUTRAL_TOWN.x + 0.5, NEUTRAL_TOWN.y + 0.5, 1);
  await tap(page, await at(page, NEUTRAL_OPEN));
  await expect(toast(page, "不是你攻下的城鎮")).toBeVisible();
  // Ours: the ranged go up.
  await centre(page, OUR_TOWN.x + 0.5, OUR_TOWN.y + 0.5, 1);
  await tap(page, await at(page, { x: OUR_TOWN.x, y: OUR_TOWN.y }));
  await expect.poll(() => lastOrder(page)).toMatchObject({ c: "wall", u: ranged, town: OUR_TOWN.id });
  await expect(toast(page, `${ranged.length} 名上城牆`)).toBeVisible();
  // Order.Wall (11).
  await expect.poll(async () => (await units(page)).filter((u) => ranged.includes(u.id) && u.order === 11).length).toBe(ranged.length);
  // The town's panel: 牆上 N／28.
  await page.evaluate(() => window.__proto?.game?.select([]));
  await tap(page, await at(page, { x: OUR_TOWN.x, y: OUR_TOWN.y }));
  await expect(page.locator(".sel-info")).toContainText(`牆上 ${ranged.length}／28`);
  // Not about other towns' walls (ceo: nothing about others').
  await centre(page, NEUTRAL_TOWN.x + 0.5, NEUTRAL_TOWN.y + 0.5, 1);
  await tap(page, await at(page, NEUTRAL_OPEN));
  await expect(page.locator(".sel-info")).toContainText("小鎮");
  await expect(page.locator(".sel-info")).not.toContainText("牆上");
  // 下城牆.
  await selectForCommands(page, ranged);
  const down = page.locator(".cmds").getByRole("button", { name: /^下城牆/ });
  await down.tap();
  await expect.poll(() => lastOrder(page)).toMatchObject({ c: "leave_wall", u: ranged, town: OUR_TOWN.id });
  await expect.poll(async () => (await units(page)).filter((u) => ranged.includes(u.id) && u.order === 11).length).toBe(0);
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
  test(`牆上的兵（D-096）：抬到牆頂、畫在牆前面，不當成躲在牆後（${culture === "e" ? "東陸" : "西陸"}，3 倍圖）`, async ({ page, browserName }, info) => {
    test.setTimeout(120_000);
    const check = watchErrors(page);
    await start(page, `&art=x3&culture=${culture}`);
    const ranged = await ownIds(page, [RANGED]);
    await selectForCommands(page, ranged);
    await page.locator(".cmds").getByRole("button", { name: /^上城牆/ }).tap();
    await centre(page, OUR_TOWN.x + 0.5, OUR_TOWN.y + 0.5, 1);
    await tap(page, await at(page, { x: OUR_TOWN.x, y: OUR_TOWN.y }));
    await expect.poll(async () => (await units(page)).filter((u) => ranged.includes(u.id) && u.order === 11).length).toBe(ranged.length);
    await page.evaluate(() => window.__proto?.game?.select([]));
    // With the castle's pictures, drawn up there (none when it is drawn as blocks).
    const pictures = (await page.evaluate(() => window.__proto?.game?.castle() ?? null))?.pieces ?? 0;
    if (pictures > 0) await expect.poll(() => page.evaluate(() => window.__proto?.game?.wallLifted() ?? 0)).toBe(ranged.length);
    // Where they went up: the wall cells nearest them (they came from the south-east).
    const on = (await units(page)).filter((u) => ranged.includes(u.id));
    await centre(page, on.reduce((n, u) => n + u.cx, 0) / on.length + 0.5, on.reduce((n, u) => n + u.cy, 0) / on.length - 1, 1.6);
    await page.waitForTimeout(400);
    if (browserName === "webkit" || browserName === "chromium") await shot(page, info, `walls-on-wall-${culture}`);
    check();
  });
}
