// 城鎮放大、主堡 (D-100, PROTOCOL.md 3.10) on the fake world with its switch on (?keep=1,
// features.keep): with soldiers selected a tap on a town's ground not ours sends them at its keep
// (攻擊移動), the first time with the hint 「點城鎮＝攻擊這座城」, once on this device; once the
// keep is down, where tapped; a tap on the keep attacks it; our own town is 移動 as before. Tapped
// alone, the keep reads 主堡 with its town's life; the town's panel has a line for it. Off (every
// other page): a town's ground is 移動 as before.

import { expect, type Page, test } from "@playwright/test";
import { selectForCommands, shot, watchErrors } from "./helpers.ts";
import { tap } from "./touch.ts";

const SPEARMAN = 1;
const KEEP = 9;
/** The neutral small town of ?keep=1 (13 x 13 inside its walls, the keep on its centre cell), ours, and a cell of each's ground. */
const NEUTRAL_TOWN = { x: 36, y: 72 };
const NEUTRAL_GROUND = { x: 40, y: 68 };
const OUR_GROUND = { x: 12, y: 58 };
/** Our small town's centre (its keep's middle cell). */
const OUR_TOWN = { x: 16, y: 62 };
const FARMER = 0;

let checkErrors: () => void;

test.beforeEach(({ page }) => {
  checkErrors = watchErrors(page);
});

test.afterEach(() => {
  checkErrors();
});

async function start(page: Page, query: string): Promise<void> {
  await page.goto(`./?test=1&mock=1&tps=20${query}`);
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true, null, { timeout: 60_000 });
}

const centre = (page: Page, x: number, y: number, scale = 1) => page.evaluate(([x, y, s]) => window.__proto?.game?.centerOn(x, y, s), [x, y, scale] as const);
const at = (page: Page, c: { x: number; y: number }) => page.evaluate(([x, y]) => window.__proto?.game?.cellToScreen(x, y) ?? { x: 0, y: 0 }, [c.x, c.y] as const);
const sent = (page: Page) => page.evaluate(() => (window.__proto?.game?.sent() ?? []) as Record<string, unknown>[]);
const orders = async (page: Page, c: string) => (await sent(page)).filter((v) => v.c === c && v.auto !== true);
const units = (page: Page) => page.evaluate(() => window.__proto?.game?.units() ?? []);
const buildings = (page: Page) => page.evaluate(() => window.__proto?.game?.buildings() ?? []);
const toast = (page: Page, text: string) => page.getByRole("status").filter({ hasText: text });

async function spearmen(page: Page): Promise<number[]> {
  const me = await page.evaluate(() => window.__proto?.game?.me() ?? 0);
  return (await units(page)).filter((u) => u.owner === me && u.type === SPEARMAN).map((u) => u.id).sort((a, b) => a - b);
}

async function tapCell(page: Page, c: { x: number; y: number }): Promise<void> {
  await centre(page, c.x, c.y + 3);
  await tap(page, await at(page, c));
}

test("主堡開關關著（其他頁面都是）：選著兵點城鎮的地面照舊是移動", async ({ page }) => {
  await start(page, "&r7=1");
  const ids = await spearmen(page);
  await selectForCommands(page, ids);
  // The neutral small town of the other pages (30, 66; 4 cells round): its ground east of its centre.
  await tapCell(page, { x: 32, y: 64 });
  await expect.poll(async () => (await orders(page, "retreat")).length).toBe(1);
  expect(await orders(page, "move")).toEqual([]);
  await expect(toast(page, "點城鎮＝攻擊這座城")).toHaveCount(0);
});

test("點城鎮就是進攻（D-100）：兵攻擊移動到主堡，第一次有提示、之後不再跳；點主堡是攻擊；主堡倒了走到點的那格；自己的城照舊是移動", async ({ page }, info) => {
  await start(page, "&keep=1");
  const ids = await spearmen(page);
  const keep = (await buildings(page)).find((b) => b.type === KEEP && b.cx === NEUTRAL_TOWN.x - 1 && b.cy === NEUTRAL_TOWN.y - 1);
  if (keep === undefined) throw new Error("no keep in the neutral town");
  expect(keep.size).toBe(3);

  // The town's ground, away from its keep: at the keep's centre cell, with the hint the first time.
  await selectForCommands(page, ids);
  await tapCell(page, NEUTRAL_GROUND);
  await expect.poll(async () => (await orders(page, "move")).at(-1)).toMatchObject({ c: "move", u: ids, x: NEUTRAL_TOWN.x, y: NEUTRAL_TOWN.y });
  await expect(toast(page, "點城鎮＝攻擊這座城")).toBeVisible();
  await shot(page, info, "keep-town-tap-hint");
  expect(await page.evaluate(() => localStorage.getItem("war-game.proto.keepHint"))).toBe("seen");

  // Again: the same order, no hint (it has gone from the message strip by then).
  await expect(toast(page, "點城鎮＝攻擊這座城")).toHaveCount(0, { timeout: 15_000 });
  await selectForCommands(page, ids);
  await tapCell(page, { x: NEUTRAL_GROUND.x - 8, y: NEUTRAL_GROUND.y + 8 });
  await expect.poll(async () => (await orders(page, "move")).length).toBe(2);
  expect((await orders(page, "move")).at(-1)).toMatchObject({ x: NEUTRAL_TOWN.x, y: NEUTRAL_TOWN.y });
  await page.waitForTimeout(500);
  await expect(toast(page, "點城鎮＝攻擊這座城")).toHaveCount(0);

  // The keep itself: an attack on it.
  await selectForCommands(page, ids);
  await tapCell(page, NEUTRAL_TOWN);
  await expect.poll(async () => (await orders(page, "attack")).at(-1)).toMatchObject({ c: "attack", u: ids, target: keep.id });

  // The keep down: where tapped.
  await page.evaluate((id) => window.__proto?.game?.remove([id]), keep.id);
  await expect.poll(async () => (await buildings(page)).some((b) => b.id === keep.id)).toBe(false);
  await selectForCommands(page, ids);
  await tapCell(page, NEUTRAL_GROUND);
  await expect.poll(async () => (await orders(page, "move")).at(-1)).toMatchObject({ x: NEUTRAL_GROUND.x, y: NEUTRAL_GROUND.y });

  // Our own town: 移動 as before.
  await selectForCommands(page, ids);
  await tapCell(page, OUR_GROUND);
  await expect.poll(async () => (await orders(page, "retreat")).at(-1)).toMatchObject({ c: "retreat", u: ids, x: OUR_GROUND.x, y: OUR_GROUND.y });
});

test("主堡（D-100）：沒選兵時點它，選取資訊寫主堡、城鎮的生命、會射箭；點城鎮的地面，城鎮面板多一行主堡的血", async ({ page }, info) => {
  await start(page, "&keep=1");
  await selectForCommands(page, []);
  await tapCell(page, NEUTRAL_TOWN);
  const panel = page.locator(".sel-info");
  await expect(panel.locator(".sel-head b")).toHaveText("主堡");
  // A small town's keep: 600 (the big city's 1000, buildings[Keep].hp).
  await expect(panel.locator(".sel-num")).toHaveText("生命 600/600");
  await expect(panel.locator(".sel-status")).toHaveText(/會射箭/);
  await expect(toast(page, "中立主堡")).toBeVisible();
  await shot(page, info, "keep-selected");
  await panel.getByRole("button", { name: "取消選取" }).tap();
  await tapCell(page, NEUTRAL_GROUND);
  await expect(panel.locator(".sel-head b")).toHaveText("小鎮");
  await expect(panel.locator(".sel-num")).toContainText("主堡 600/600");
  await shot(page, info, "keep-town-panel");
});

test("我方的主堡滿血 600（小鎮）：選著村民點它是選取，不是修理（滿血照城鎮的，不是建築表的 1000）", async ({ page }) => {
  await start(page, "&keep=1");
  const me = await page.evaluate(() => window.__proto?.game?.me() ?? 0);
  const farmers = (await units(page)).filter((u) => u.owner === me && u.type === FARMER).map((u) => u.id).sort((a, b) => a - b);
  const keep = (await buildings(page)).find((b) => b.type === KEEP && b.owner === me);
  if (keep === undefined) throw new Error("no keep of ours");
  await selectForCommands(page, farmers);
  await tapCell(page, OUR_TOWN);
  await expect.poll(() => page.evaluate(() => window.__proto?.game?.selection().building)).toBe(keep.id);
  expect(await orders(page, "repair")).toEqual([]);
  await expect(page.locator(".sel-info .sel-num")).toHaveText("生命 600/600");
});
