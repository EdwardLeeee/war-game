// 退回駐守的城（D-138 A; the user 2026-11-10: 「軍團按退守應該要會退到上一座它駐守的城市」）on the fake world with walls: a group
// that left soldiers in a town goes back there on 退 (or 全軍撤退) while it is ours, and is stationed there once in, as 進駐
// does (駐N on its button); a town lost on the way, it goes to our other town; those in no group go to the main city.

import { expect, type Page, test } from "@playwright/test";
import { expectSaid, openPanel, recordToasts, saveGroup, selectForCommands, watchErrors } from "./helpers.ts";
import { tap } from "./touch.ts";

const SPEARMAN = 1;
const GOVERNED = 4;
const NEUTRAL_STATE = 0;
const GROUP_1 = ".groups > button:nth-child(1)";
// The fake world with walls: our small town (1) and a neutral one (0), made ours here.
const OUR_TOWN = 1;
const OTHER_TOWN = 0;

const units = (page: Page) => page.evaluate(() => window.__proto?.game?.units() ?? []);
const sent = (page: Page) => page.evaluate(() => (window.__proto?.game?.sent() ?? []) as Record<string, unknown>[]);
const lastOrder = async (page: Page) => (await sent(page)).filter((c) => c.auto !== true).at(-1);
const inside = (page: Page, town: number) => page.evaluate((t) => window.__proto?.game?.castleCells(t)?.inside ?? null, town);
const retreat1 = (page: Page) => page.getByRole("button", { name: "編隊 1 撤退" });
const at = (page: Page, c: { x: number; y: number }) => page.evaluate(([x, y]) => window.__proto?.game?.cellToScreen(x, y) ?? { x: 0, y: 0 }, [c.x, c.y] as const);

/** Group 1: three spearmen, stationed in town 0 (made ours) by 進駐, then sent away out of it. */
async function setUp(page: Page): Promise<{ ids: number[]; box: { x0: number; y0: number; x1: number; y1: number } }> {
  await page.goto("./?test=1&mock=1&walls=1&tps=20");
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true, null, { timeout: 60_000 });
  await recordToasts(page);
  const me = await page.evaluate(() => window.__proto?.game?.me() ?? 0);
  await page.evaluate(([t, s, o]) => window.__proto?.game?.setTown(t, s, o), [OTHER_TOWN, GOVERNED, me] as const);
  const box = await inside(page, OTHER_TOWN);
  if (box === null) throw new Error("no castle");
  const ids = (await units(page)).filter((u) => u.owner === me && u.type === SPEARMAN).map((u) => u.id).sort((a, b) => a - b).slice(0, 3);
  await page.evaluate(([i, x, y]) => window.__proto?.game?.place(i as number[], [0, 1, 2].map((k) => ({ x: (x as number) + k, y: (y as number) + 4 }))), [ids, box.x0, box.y1] as const);
  await page.evaluate(([x, y]) => window.__proto?.game?.centerOn(x, y, 1), [(box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2 + 2] as const);
  await selectForCommands(page, ids);
  await saveGroup(page, GROUP_1);
  await page.evaluate(() => window.__proto?.game?.select([]));
  await page.locator(GROUP_1).tap();
  await page.locator(".cmds").getByRole("button", { name: /^進駐/ }).tap();
  await tap(page, await at(page, { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 }));
  await expect.poll(() => page.evaluate((t) => window.__proto?.game?.garrison(t) ?? [], OTHER_TOWN)).toEqual(ids);
  // Out with 全部帶走 (軍團畫面), then away by his own order, far from both towns.
  await page.evaluate(() => window.__proto?.game?.select([]));
  await page.locator(GROUP_1).tap();
  // 軍團畫面 open whatever the panel did with the tap (CI's WebKit draws it late).
  await openPanel(page);
  await page.locator(".sel-info").getByRole("button", { name: "全部帶走" }).tap();
  await expect.poll(() => page.evaluate((t) => window.__proto?.game?.garrison(t) ?? [], OTHER_TOWN)).toEqual([]);
  await page.evaluate((u) => window.__proto?.game?.send({ c: "move", u, x: 60, y: 40 }), ids);
  await page.evaluate((i) => window.__proto?.game?.place(i, [{ x: 60, y: 40 }, { x: 61, y: 40 }, { x: 62, y: 40 }]), ids);
  await expect(retreat1(page)).toBeVisible({ timeout: 30_000 });
  return { ids, box };
}

const within = (o: Record<string, unknown> | undefined, b: { x0: number; y0: number; x1: number; y1: number }) =>
  o !== undefined && (o.x as number) >= b.x0 && (o.x as number) <= b.x1 && (o.y as number) >= b.y0 && (o.y as number) <= b.y1;

test("退1：回上一次駐守的城（不是主城），走進城就駐守在那裡（駐3），和進駐一樣", async ({ page }) => {
  test.setTimeout(240_000);
  const check = watchErrors(page);
  const { ids, box } = await setUp(page);
  await retreat1(page).tap();
  const order = await lastOrder(page);
  expect(order).toMatchObject({ c: "retreat", u: ids });
  expect(within(order, box), `to a cell inside town ${OTHER_TOWN}: ${JSON.stringify(order)}`).toBe(true);
  await expectSaid(page, /^編隊 1 退回(小鎮|大城)・/);
  // In: stationed there (guard), 駐3 on the button.
  await page.evaluate(([i, x, y]) => window.__proto?.game?.place(i as number[], [0, 1, 2].map((k) => ({ x: (x as number) + k, y: y as number }))), [ids, box.x0 + 1, box.y0 + 1] as const);
  await expect.poll(() => page.evaluate((t) => window.__proto?.game?.garrison(t) ?? [], OTHER_TOWN), { timeout: 30_000 }).toEqual(ids);
  expect((await sent(page)).filter((c) => c.c === "guard").at(-1)).toMatchObject({ u: ids, town: OTHER_TOWN });
  await expect(page.locator(GROUP_1)).toContainText("駐3");
  await expectSaid(page, /^編隊 1 到了(小鎮|大城)・.+，留守 3 名$/);
  check();
});

test("退1 走到一半那座城丟了：改去我方另一座城，說哪座丟了、改去哪", async ({ page }) => {
  test.setTimeout(240_000);
  const check = watchErrors(page);
  const { ids } = await setUp(page);
  await retreat1(page).tap();
  await expectSaid(page, /^編隊 1 退回/);
  await page.evaluate(([t, s]) => window.__proto?.game?.setTown(t, s, -1), [OTHER_TOWN, NEUTRAL_STATE] as const);
  const ours = await inside(page, OUR_TOWN);
  if (ours === null) throw new Error("no castle");
  await expect.poll(async () => within(await lastOrder(page), ours), { timeout: 30_000 }).toBe(true);
  expect(await lastOrder(page)).toMatchObject({ c: "retreat", u: ids });
  await expectSaid(page, /^(小鎮|大城)・.+丟了，編隊 1 改去(小鎮|大城)・/);
  check();
});

test("全軍撤退：每個軍團各自回自己的城，不屬於任何軍團的兵回主城", async ({ page }) => {
  test.setTimeout(240_000);
  const check = watchErrors(page);
  const { ids, box } = await setUp(page);
  await page.getByRole("button", { name: "全軍撤退" }).tap();
  const orders = (await sent(page)).filter((c) => c.auto !== true && c.c === "retreat").slice(-2);
  const mine = orders.find((o) => JSON.stringify(o.u) === JSON.stringify(ids));
  expect(within(mine, box), `group 1 to its town: ${JSON.stringify(orders)}`).toBe(true);
  const rest = orders.find((o) => o !== mine);
  expect(rest, "the others in one order").toBeDefined();
  expect((rest?.u as number[]).some((id) => ids.includes(id))).toBe(false);
  expect(within(rest, box)).toBe(false);
  await expectSaid(page, /^全軍退回：編隊 1 (小鎮|大城)・.+，其他 \d+ 名回主城$/);
  check();
});
