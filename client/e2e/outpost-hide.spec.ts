// 哨所 3 × 3 (D-119, D-121) on the fake world with its switch on (?test=1&mock=1&r7=1&outpost=1&hide=1,
// features.outpostHide, src/mock/mock-port.ts): the outpost is 3 × 3; ＋槍兵 sends one, who hides in
// it (躲了 n/9); 攻擊／堅守 say what they mean now; the enemy's outpost pokes one of ours by it; and
// with the pictures' stand points (art-v6.4 on) those hiding are drawn on its walk, the enemy's too.
// The simulation's side is core's (core/outpost-hide).

import { expect, type Page, test } from "@playwright/test";
import { shot, watchErrors } from "./helpers.ts";
import { tap } from "./touch.ts";

const OUTPOST = { x: 12, y: 66 };
const FOE_OUTPOST = { x: 31, y: 61 };
const TICKS = { timeout: 30_000 };
const GARRISONED = 7;

const centre = (page: Page, x: number, y: number, scale = 1) => page.evaluate(([x, y, s]) => window.__proto?.game?.centerOn(x, y, s), [x, y, scale] as const);
const at = (page: Page, c: { x: number; y: number }) => page.evaluate(([x, y]) => window.__proto?.game?.cellToScreen(x, y) ?? { x: 0, y: 0 }, [c.x, c.y] as const);
const sent = (page: Page) => page.evaluate(() => (window.__proto?.game?.sent() ?? []) as Record<string, unknown>[]);
const lastOrder = async (page: Page) => (await sent(page)).filter((c) => c.auto !== true).at(-1);
const units = (page: Page) => page.evaluate(() => window.__proto?.game?.units() ?? []);
const buildings = (page: Page) => page.evaluate(() => window.__proto?.game?.buildings() ?? []);
const crew = (page: Page) => page.evaluate(() => window.__proto?.game?.crew() ?? { drawn: 0, pokes: 0, stands: 0 });
/** Those inside the outposts in the snapshot (the enemy's only while in view): as many drawn on their walks. */
const inside = async (page: Page) => (await buildings(page)).filter((b) => b.type === 12).reduce((n, b) => n + b.soldiers, 0);
const place = (page: Page, ids: number[], cells: { x: number; y: number }[]) => page.evaluate(([i, c]) => window.__proto?.game?.place(i, c), [ids, cells] as const);

test("哨所 3×3（D-119、D-121）：躲了幾名／9；＋槍兵走過去躲進去；攻擊、堅守寫現在的意思；全部離開；敵方哨所戳貼過去的兵；圖有站位時躲著的畫在牆頂", async ({ page }, info) => {
  test.setTimeout(120_000);
  const check = watchErrors(page);
  await page.goto("./?test=1&mock=1&r7=1&outpost=1&hide=1&tps=20&art=x3");
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true);
  const me = await page.evaluate(() => window.__proto?.game?.me() ?? 0);
  const ours = (await buildings(page)).find((b) => b.type === 12 && b.owner === me);
  if (ours === undefined) throw new Error("no outpost of ours");
  expect(ours.size, "3 × 3").toBe(3);
  const spear = (await units(page)).filter((u) => u.owner === me && u.type === 1).map((u) => u.id).sort((a, b) => a - b);
  await place(page, [spear[5]], [{ x: OUTPOST.x + 4, y: OUTPOST.y + 1 }]);
  await centre(page, OUTPOST.x + 1.5, OUTPOST.y + 1.5, 2);
  await tap(page, await at(page, { x: OUTPOST.x + 1.5, y: OUTPOST.y + 1.5 }));
  const panel = page.locator(".sel-info");
  await expect(panel.locator(".sel-head")).toContainText("哨所");
  await expect(panel.locator(".outpost-count")).toHaveText("躲了 0/9 名槍兵");
  await expect(panel.locator(".outpost-note")).toHaveText("攻擊：敵兵進到 8 格內或哨所被打，就出去打；打完或追到 12 格就回來躲");

  // ＋槍兵: the nearest walks over and hides in it (not drawn on the ground, Garrisoned).
  await panel.getByRole("button", { name: "叫 1 名槍兵來駐守" }).tap();
  await expect.poll(() => lastOrder(page)).toMatchObject({ c: "post", u: [spear[5]], building: ours.id });
  await expect.poll(async () => (await buildings(page)).find((b) => b.id === ours.id)?.soldiers, TICKS).toBe(1);
  await expect(panel.locator(".outpost-count")).toHaveText("躲了 1/9 名槍兵");
  expect((await units(page)).find((u) => u.id === spear[5])?.action).toBe(GARRISONED);
  const stands = (await crew(page)).stands;
  if (stands > 0) {
    await expect.poll(() => inside(page), TICKS).toBeGreaterThanOrEqual(1);
    await expect.poll(async () => (await crew(page)).drawn - (await inside(page)), TICKS).toBe(0);
  }
  await shot(page, info, "outpost-hide-ours-1");

  await panel.getByRole("button", { name: "堅守", exact: true }).tap();
  await expect.poll(() => lastOrder(page)).toMatchObject({ c: "outpost_mode", building: ours.id, hold: true });
  await expect(panel.locator(".outpost-note")).toHaveText("堅守：躲在哨所裡，戳貼過來的敵人，被打也不出來", TICKS);

  await panel.getByRole("button", { name: "全部離開" }).tap();
  await expect.poll(() => lastOrder(page)).toMatchObject({ c: "unpost", building: ours.id });
  await expect.poll(async () => (await buildings(page)).find((b) => b.id === ours.id)?.soldiers, TICKS).toBe(0);
  await expect(panel.locator(".outpost-count")).toHaveText("躲了 0/9 名槍兵");
  expect((await units(page)).find((u) => u.id === spear[5])?.action).not.toBe(GARRISONED);

  // The enemy's, 5 inside (the fake world's): one of ours right by its east wall is poked, and its
  // count is ours to see (on its walk, D-121).
  await page.evaluate(() => window.__proto?.game?.select([]));
  await place(page, [spear[4]], [{ x: FOE_OUTPOST.x + 3, y: FOE_OUTPOST.y + 1 }]);
  await centre(page, FOE_OUTPOST.x + 1.5, FOE_OUTPOST.y + 1.5, 2);
  await expect.poll(async () => (await buildings(page)).find((b) => b.type === 12 && b.owner !== me)?.soldiers, TICKS).toBe(5);
  await expect.poll(async () => (await crew(page)).pokes, TICKS).toBeGreaterThan(0);
  if (stands > 0) await expect.poll(async () => (await crew(page)).drawn - (await inside(page)), TICKS).toBe(0);
  await page.waitForTimeout(300);
  await shot(page, info, "outpost-hide-enemy-poke");
  check();
});
