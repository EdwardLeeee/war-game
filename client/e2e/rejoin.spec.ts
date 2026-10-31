// 出城歸隊 (the user 2026-10-26: 「我把軍隊放進去之後應該要可以釋放回兵團…讓軍隊上城牆也一樣，現在似乎
// 下城牆沒辦法回到原本的軍隊，點城池也沒辦法處理」, choosing 自動留最少人數; ceo's spec) on the fake
// world with walls (?walls=1), our small town governed (it needs 1): soldiers stationed there
// (駐軍) are still their group's: its button counts them (5/5) with 駐N and selects them, 軍團畫面
// says 駐守中 with 出城歸隊 and 全部帶走; the town's panel lists its 留守 by group, 歸隊 and 全部帶走;
// 出城歸隊 leaves the least the town needs; an order from the group's button takes it out, the
// town keeping as much; the player's own 移動 for one selected by hand takes it out and says when
// the town is left short. The pictures for the user.

import { expect, type Page, test } from "@playwright/test";
import { saveGroup, selectForCommands, shot, watchErrors } from "./helpers.ts";
import { tap } from "./touch.ts";

const RANGED = 2;
const SPEARMAN = 1;
const WALL_ORDER = 11;
const AGGRESSIVE = 0;
// Fake-world layout (src/mock/mock-port.ts) with walls: our small town, governed.
const OUR_TOWN = { id: 1, x: 18, y: 62 };
const NEUTRAL_TOWN = { id: 0, x: 30, y: 66 };
const BARRACKS = { x: 4, y: 74 };
const GROUP_1 = ".groups > button:nth-child(1)";

const units = (page: Page) => page.evaluate(() => window.__proto?.game?.units() ?? []);
const sent = (page: Page) => page.evaluate(() => (window.__proto?.game?.sent() ?? []) as Record<string, unknown>[]);
const at = (page: Page, c: { x: number; y: number }) => page.evaluate(([x, y]) => window.__proto?.game?.cellToScreen(x, y) ?? { x: 0, y: 0 }, [c.x, c.y] as const);
const centre = (page: Page, x: number, y: number, scale = 1) => page.evaluate(([cx, cy, s]) => window.__proto?.game?.centerOn(cx, cy, s), [x, y, scale] as const);
const garrison = (page: Page) => page.evaluate((t) => window.__proto?.game?.garrison(t) ?? [], OUR_TOWN.id);
const group1 = async (page: Page) => (await page.evaluate(() => window.__proto?.game?.groupInfo() ?? []))[0];
const selected = (page: Page) => page.evaluate(() => window.__proto?.game?.selection().units ?? []);
const panel = (page: Page) => page.locator(".sel-info");

async function ownIds(page: Page, type: number, n: number): Promise<number[]> {
  const me = await page.evaluate(() => window.__proto?.game?.me() ?? 0);
  return (await units(page)).filter((u) => u.owner === me && u.type === type).map((u) => u.id).sort((a, b) => a - b).slice(0, n);
}

/** A spot on screen with nothing to pick, south of the town (the fake world's own units stand about there). */
async function emptyGround(page: Page): Promise<{ x: number; y: number }> {
  for (const [x, y] of [[15, 73], [22, 73], [26, 73], [13, 70], [28, 70], [22, 75], [15, 76]]) {
    const p = await at(page, { x: x + 0.5, y: y + 0.5 });
    if ((await page.evaluate(([a, b]) => window.__proto?.game?.pickAt(a, b) ?? null, [p.x, p.y] as const)) === null) return p;
  }
  throw new Error("no empty ground");
}

/** The fake world with walls, every message of the strip recorded as it comes (one replaces another fast). */
async function start(page: Page): Promise<() => Promise<string>> {
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { __toasts: string[] }).__toasts = seen;
    new MutationObserver(() => {
      for (const t of document.querySelectorAll(".toast")) {
        const text = t.textContent ?? "";
        if (text !== "" && seen.at(-1) !== text) seen.push(text);
      }
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });
  await page.goto("./?test=1&mock=1&walls=1&tps=20");
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true, null, { timeout: 60_000 });
  return () => page.evaluate(() => (window as unknown as { __toasts: string[] }).__toasts.join("｜"));
}

test("出城歸隊：整個編隊 1 駐軍後還是編隊 1 的（5/5、駐5、駐守中）；出城歸隊留 1 名守城；點城看留守分編隊，歸隊、全部帶走（說會叛離）", async ({ page }, info) => {
  // CI's Chromium runs the fake world at a few steps a second: the walk in takes a while.
  test.setTimeout(240_000);
  const check = watchErrors(page);
  const said = await start(page);
  const ranged = await ownIds(page, RANGED, 2);
  const ids = [...(await ownIds(page, SPEARMAN, 3)), ...ranged].sort((a, b) => a - b);
  // Just south of our town, a short walk in.
  await page.evaluate((i) => window.__proto?.game?.place(i, [16, 17, 18, 19, 20].map((x) => ({ x, y: 71 }))), ids);
  await centre(page, 24, 66);
  await selectForCommands(page, ids);
  await saveGroup(page, GROUP_1);
  // 駐軍 from 軍團畫面, the panel put away to see the town.
  await page.locator(".cmds").getByRole("button", { name: /^駐軍/ }).tap();
  await page.locator(".sel-info").getByRole("button", { name: "收起選取資訊" }).tap();
  await tap(page, await at(page, { x: OUR_TOWN.x + 0.5, y: OUR_TOWN.y + 0.5 }));
  await expect.poll(said).toContain("5 名駐軍在小鎮");
  expect(await garrison(page)).toEqual(ids);
  // Still group 1's: 5/5 with 駐5 on its button, and nobody else pulled in to replace them.
  expect((await group1(page)).ids.sort((a, b) => a - b)).toEqual(ids);
  await expect(page.locator(GROUP_1)).toContainText("5/5");
  await expect(page.locator(GROUP_1)).toContainText("駐5");
  // In and the ranged up on the wall (the first to stay).
  await expect.poll(async () => (await units(page)).filter((u) => ranged.includes(u.id) && u.order === WALL_ORDER).length, { timeout: 120_000 }).toBe(2);
  // 軍團畫面: its button selects all of them (the user 2026-10-31), folded; 駐守中 with 出城歸隊 and 全部帶走.
  await page.evaluate(() => window.__proto?.game?.select([]));
  await page.locator(GROUP_1).tap();
  const panel = page.locator(".sel-info");
  await expect(panel.locator(".sel-head")).toContainText(/^編隊 1/);
  await expect.poll(async () => [...(await selected(page))].sort((a, b) => a - b)).toEqual(ids);
  await panel.getByRole("button", { name: "展開選取資訊" }).tap();
  await expect(panel).toContainText("駐守中：小鎮 5 名");
  await centre(page, OUR_TOWN.x, OUR_TOWN.y + 3, 1.2);
  await shot(page, info, "rejoin-1-group-screen-stationed");
  // 出城歸隊: the town keeps 1 (a governed small town), one of the ranged on its wall.
  await panel.getByRole("button", { name: "出城歸隊" }).tap();
  await expect.poll(said).toContain("4 名出城歸隊編隊 1，留 1 名守城");
  const kept = await garrison(page);
  expect(kept).toHaveLength(1);
  expect(ranged).toContain(kept[0]);
  const out = ids.filter((id) => !kept.includes(id));
  // All five still selected by its button (the 4 積極), the line reads 1.
  await expect.poll(async () => [...(await selected(page))].sort((a, b) => a - b)).toEqual(ids);
  await expect(panel).toContainText("駐守中：小鎮 1 名");
  await expect(page.locator(GROUP_1)).toContainText("駐1");
  await expect.poll(async () => (await units(page)).filter((u) => out.includes(u.id)).every((u) => u.stance === AGGRESSIVE), { timeout: 60_000 }).toBe(true);
  await shot(page, info, "rejoin-2-out-keeps-one");
  // The town's panel: its 留守 by group.
  await page.evaluate(() => window.__proto?.game?.select([]));
  await tap(page, await at(page, { x: OUR_TOWN.x + 0.5, y: OUR_TOWN.y + 0.5 }));
  await expect(panel).toContainText("編隊 1：1 名");
  await shot(page, info, "rejoin-3-town-list");
  // 歸隊 keeps the least: nobody comes out; 全部帶走 takes the last one, and the town will revolt.
  await panel.getByRole("button", { name: "編隊 1 的留守歸隊" }).tap();
  await expect.poll(said).toContain("城裡的 1 名都要留下守城：要帶走按「全部帶走」");
  await panel.getByRole("button", { name: "全部帶走" }).tap();
  await expect.poll(said).toContain("1 名離開這座城");
  await expect.poll(said).toContain("駐軍不足，這座城會叛離");
  expect(await garrison(page)).toEqual([]);
  await expect(page.locator(GROUP_1)).not.toContainText("駐");
  expect((await group1(page)).ids.sort((a, b) => a - b)).toEqual(ids);
  await shot(page, info, "rejoin-4-all-out");
  check();
});

test("編隊按鈕選得到駐守的兵（收起）：點地板整隊出城，城留最少人數，留的不收到指令；單獨選駐守的兵照玩家的意思走，城裡不夠就提醒", async ({ page }, info) => {
  test.setTimeout(240_000);
  const check = watchErrors(page);
  const said = await start(page);
  const ranged = await ownIds(page, RANGED, 2);
  const spears = await ownIds(page, SPEARMAN, 3);
  const ids = [...spears, ...ranged].sort((a, b) => a - b);
  await page.evaluate((i) => window.__proto?.game?.place(i, [16, 17, 18, 19, 20].map((x) => ({ x, y: 71 }))), ids);
  await centre(page, 24, 66);
  await selectForCommands(page, ids);
  await saveGroup(page, GROUP_1);
  // One of the group selected: 駐軍 takes all of it.
  await selectForCommands(page, [spears[0]]);
  await page.locator(".cmds").getByRole("button", { name: /^駐軍/ }).tap();
  await tap(page, await at(page, { x: OUR_TOWN.x + 0.5, y: OUR_TOWN.y + 0.5 }));
  await expect.poll(said).toContain("5 名駐軍在小鎮");
  expect(await garrison(page)).toEqual(ids);
  await expect.poll(async () => (await units(page)).filter((u) => ranged.includes(u.id) && u.order === WALL_ORDER).length, { timeout: 120_000 }).toBe(2);
  // Its button: all five selected, the panel folded.
  await page.evaluate(() => window.__proto?.game?.select([]));
  await page.locator(GROUP_1).tap();
  await expect.poll(async () => [...(await selected(page))].sort((a, b) => a - b)).toEqual(ids);
  await expect(page.locator(".sel-info").getByRole("button", { name: "展開選取資訊" })).toBeVisible();
  await shot(page, info, "rejoin-5-group-button-selects-stationed");
  // 堅守 and 停止 are not for those in the town; a tap on the ground takes all out but the 1 it keeps, a ranged on its wall.
  await panel(page).getByRole("button", { name: "展開選取資訊" }).tap();
  const before = (await sent(page)).length;
  await page.locator(".cmds").getByRole("button", { name: "停止" }).tap();
  expect((await sent(page)).slice(before).filter((c) => c.auto !== true)).toEqual([]);
  await panel(page).getByRole("button", { name: "收起選取資訊" }).tap();
  await tap(page, await emptyGround(page));
  await expect.poll(said).toContain("4 名出發，留 1 名守城");
  const order = (await sent(page)).slice(before).find((c) => c.auto !== true && c.c === "retreat");
  const kept = await garrison(page);
  expect(kept).toHaveLength(1);
  expect(ranged).toContain(kept[0]);
  expect((order?.u as number[]).sort((a, b) => a - b)).toEqual(ids.filter((id) => !kept.includes(id)));
  expect((await units(page)).find((u) => u.id === kept[0])?.order).toBe(WALL_ORDER);
  // Still group 1's, and no recruits: they go where they were sent.
  const g = await group1(page);
  expect([...g.ids].sort((a, b) => a - b)).toEqual(ids);
  expect(g.recruits).toEqual([]);
  await page.waitForTimeout(1500);
  await centre(page, 20, 68, 1.1);
  await shot(page, info, "rejoin-6-out-keeps-one");
  // The last one selected by hand: the player's word, and the town is left short.
  await selectForCommands(page, kept);
  await page.evaluate((u) => window.__proto?.game?.send({ c: "move", u, x: 22, y: 70 }), kept);
  await expect.poll(said).toContain("駐軍不足，這座城會叛離");
  expect(await garrison(page)).toEqual([]);
  check();
});

test("新兵補進全部駐守的編隊就走進那座城當留守；編隊再駐軍到別的城：原城留最少人數", async ({ page }, info) => {
  test.setTimeout(240_000);
  const check = watchErrors(page);
  const said = await start(page);
  const spears = await ownIds(page, SPEARMAN, 4);
  // The other spearmen gone: no free one to fill the group when one falls.
  const spare = (await ownIds(page, SPEARMAN, 99)).filter((id) => !spears.includes(id));
  await page.evaluate((i) => window.__proto?.game?.remove(i), spare);
  await page.evaluate((i) => window.__proto?.game?.place(i, [16, 17, 18, 19].map((x) => ({ x, y: 71 }))), spears);
  await centre(page, 24, 66);
  await selectForCommands(page, spears);
  await saveGroup(page, GROUP_1);
  await page.locator(".cmds").getByRole("button", { name: /^駐軍/ }).tap();
  await page.locator(".sel-info").getByRole("button", { name: "收起選取資訊" }).tap();
  await tap(page, await at(page, { x: OUR_TOWN.x + 0.5, y: OUR_TOWN.y + 0.5 }));
  await expect.poll(said).toContain("4 名駐軍在小鎮");
  // One falls; the barracks' next spearman fills the group and walks in.
  await page.evaluate((i) => window.__proto?.game?.remove(i), [spears[3]]);
  await expect(page.locator(GROUP_1)).toContainText("3/4");
  await page.evaluate(() => window.__proto?.game?.select([]));
  await centre(page, BARRACKS.x + 1, BARRACKS.y + 1);
  await tap(page, await at(page, { x: BARRACKS.x + 1, y: BARRACKS.y + 1 }));
  await page.getByRole("button", { name: /^訓練槍兵/ }).tap();
  await expect.poll(said, { timeout: 30_000 }).toContain("新的槍兵補進編隊 1，走進城裡留守");
  await expect(page.locator(GROUP_1)).toContainText("駐4");
  const all = await garrison(page);
  const recruit = all.filter((id) => !spears.includes(id));
  expect(recruit).toHaveLength(1);
  expect((await sent(page)).filter((c) => c.auto === true && c.c === "retreat").at(-1)).toMatchObject({ u: recruit, x: OUR_TOWN.x, y: OUR_TOWN.y });
  expect((await group1(page)).recruits).toEqual([]);
  // A second town of ours; 駐軍 there from the group's button: all but the 1 the first town keeps.
  await centre(page, NEUTRAL_TOWN.x + 0.5, NEUTRAL_TOWN.y + 0.5);
  await page.evaluate(() => window.__proto?.game?.inject({ k: "town_captured", town: 0, by: 0 }));
  await page.locator(".town-choice").getByRole("button", { name: /^治理/ }).tap();
  await page.evaluate(() => window.__proto?.game?.select([]));
  await page.locator(GROUP_1).tap();
  await page.locator(".cmds").getByRole("button", { name: /^駐軍/ }).tap();
  await tap(page, await at(page, { x: NEUTRAL_TOWN.x + 0.5, y: NEUTRAL_TOWN.y + 2.5 }));
  await expect.poll(said).toContain("3 名駐軍在小鎮：留守、堅守，不跟全軍走，原本的城留 1 名守城");
  expect(await garrison(page)).toHaveLength(1);
  await expect(page.locator(GROUP_1)).toContainText("駐4");
  await shot(page, info, "rejoin-7-other-town-keeps-one");
  check();
});
