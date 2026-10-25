// 攻城打到底 (the user 2026-10-25: 「打城市的時候 攻進去就停了不會繼續打至佔領，要再按第二次才會繼續打」):
// on the real simulation (scenario e2e, the enemy's computer off), our squad attack-moves to a small
// town's gate once and is given nothing more: it breaks the gate, goes in after the militia on the
// walls and takes the town (攻下小鎮！ asks 搶 or 治理). The pictures, a few in a row, for the user.
// Another order of the player's (移動 away) ends it.

import { expect, type Page, test } from "@playwright/test";
import { shot, watchErrors } from "./helpers.ts";

const SMALL = 0;
const GATE = 13;
const FARMER = 0;

let checkErrors: () => void;

test.beforeEach(({ page }) => {
  checkErrors = watchErrors(page);
});

test.afterEach(() => {
  checkErrors();
});

async function start(page: Page): Promise<void> {
  await page.goto("./?test=1&scenario=e2e&ai=0&tps=60&art=x3");
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true, null, { timeout: 60_000 });
}

const me = (page: Page) => page.evaluate(() => window.__proto?.game?.me() ?? 0);
const units = (page: Page) => page.evaluate(() => window.__proto?.game?.units() ?? []);
const towns = (page: Page) => page.evaluate(() => window.__proto?.game?.towns() ?? []);
const buildings = (page: Page) => page.evaluate(() => window.__proto?.game?.buildings() ?? []);
const playerOrders = async (page: Page) => (await page.evaluate(() => (window.__proto?.game?.sent() ?? []) as Record<string, unknown>[])).filter((c) => c.auto !== true);
const autoAttacks = async (page: Page) => (await page.evaluate(() => (window.__proto?.game?.sent() ?? []) as Record<string, unknown>[])).filter((c) => c.auto === true && (c.c === "attack" || c.c === "move"));

/** Our soldiers, the small town nearest them and that town's gate nearest them. */
async function scene(page: Page) {
  const m = await me(page);
  const soldiers = (await units(page)).filter((u) => u.owner === m && u.type !== FARMER);
  const cx = soldiers.reduce((s, u) => s + u.cx, 0) / soldiers.length;
  const cy = soldiers.reduce((s, u) => s + u.cy, 0) / soldiers.length;
  const town = (await towns(page)).filter((t) => t.size === SMALL).sort((a, b) => Math.hypot(a.cx - cx, a.cy - cy) - Math.hypot(b.cx - cx, b.cy - cy))[0];
  const gate = (await buildings(page)).filter((b) => b.type === GATE && Math.abs(b.cx - town.cx) <= 8 && Math.abs(b.cy - town.cy) <= 8).sort((a, b) => Math.hypot(a.cx - cx, a.cy - cy) - Math.hypot(b.cx - cx, b.cy - cy))[0];
  if (town === undefined || gate === undefined) throw new Error("the e2e scenario changed");
  return { m, ids: soldiers.map((u) => u.id), town, gate, from: { x: cx, y: cy } };
}

test("攻擊移動到小鎮的城門一次，之後不再下指令：兵自己打破門、進去打牆上的民兵，攻下小鎮跳出搶／治理", async ({ page }, info) => {
  test.setTimeout(300_000);
  await start(page);
  const s = await scene(page);
  await page.evaluate(([x, y]) => window.__proto?.game?.centerOn(x, y, 1.1), [(s.town.cx + s.from.x) / 2, (s.town.cy + s.from.y) / 2] as const);
  // 攻擊, then a tap on the gate: an attack-move there.
  await page.evaluate(([ids, x, y]) => window.__proto?.game?.send({ c: "move", u: ids, x, y }), [s.ids, s.gate.cx, s.gate.cy] as const);
  const given = (await playerOrders(page)).length;
  await shot(page, info, "assault-1-attack-move-to-gate");
  // The gate falls (the screen sent them at it: attack-move does not break gates, D-096).
  await expect.poll(async () => (await buildings(page)).some((b) => b.id === s.gate.id), { timeout: 120_000, intervals: [500] }).toBe(false);
  await page.evaluate(([x, y]) => window.__proto?.game?.centerOn(x, y, 1.2), [s.town.cx, s.town.cy] as const);
  await shot(page, info, "assault-2-gate-broken");
  // Down to the last militia, on the walls.
  await expect.poll(async () => (await towns(page)).find((t) => t.id === s.town.id)?.militia ?? 0, { timeout: 120_000, intervals: [500] }).toBeLessThanOrEqual(1);
  await shot(page, info, "assault-3-last-militia");
  // Taken, with no other order of the player's.
  await expect(page.getByText(/^攻下小鎮！/)).toBeVisible({ timeout: 120_000 });
  expect((await towns(page)).find((t) => t.id === s.town.id)?.owner).toBe(s.m);
  await shot(page, info, "assault-4-taken");
  expect((await playerOrders(page)).length, "no other order of the player's").toBe(given);
  expect((await autoAttacks(page)).some((c) => c.target === s.gate.id), "the screen sent them at the gate").toBe(true);
});

test("攻城中玩家改下移動：不再自動打", async ({ page }) => {
  test.setTimeout(180_000);
  await start(page);
  const s = await scene(page);
  await page.evaluate(([ids, x, y]) => window.__proto?.game?.send({ c: "move", u: ids, x, y }), [s.ids, s.gate.cx, s.gate.cy] as const);
  // They reach the gate and the screen sends them at it.
  await expect.poll(async () => (await autoAttacks(page)).length, { timeout: 120_000 }).toBeGreaterThan(0);
  // 移動 back where they came from.
  await page.evaluate(([ids, x, y]) => window.__proto?.game?.send({ c: "retreat", u: ids, x, y }), [s.ids, Math.round(s.from.x), Math.round(s.from.y)] as const);
  const sent = (await autoAttacks(page)).length;
  await page.waitForTimeout(8000);
  expect((await autoAttacks(page)).length).toBe(sent);
});
