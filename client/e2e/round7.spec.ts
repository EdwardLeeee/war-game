// 第七輪 (D-061) on the fake world with its rules on (?test=1&mock=1&r7=1, src/mock/mock-port.ts):
// a town plundered once offers only 治理, a governed town's income line, arrow towers only near
// the main city or a governed town, 躲進去 and 全部出來, those hiding left out of orders given to
// many (ceo 2026-10-07), the enemy tower's 裡面有人 and its arrows, and the stable training
// cavalry. The last tests check that without the switches none of it shows. The simulation's
// side is tested by core.

import { expect, type Page, test } from "@playwright/test";
import { armyButton, FULL_SCREEN, INTERACTIVE, IPHONE_SAFE, injectSafeArea, saveGroup, selectForCommands, shot, visibleBoxes, watchErrors } from "./helpers.ts";
import { tap, tapOn } from "./touch.ts";

// Fake-world layout with r7=1, in cells.
const MAIN_CITY = { x: 8, y: 80, size: 4 };
/** Ours, governed, plundered before: pays a quarter and climbs back. */
const OUR_TOWN = { x: 18, y: 62 };
/** The enemy's arrow tower with someone inside. */
const FOE_TOWER = { x: 26, y: 63 };
/** Within 8 cells of the main city: TowerLand. */
const TOWER_ON = { x: 12, y: 84 };
/** 10 cells off the main city and 14 off our town: not TowerLand. */
const TOWER_OFF = { x: 21, y: 76 };
/** Ours, training cavalry. */
const STABLE = { x: 14, y: 70, size: 3 };
const GROUP_1 = ".groups > button:nth-child(1)";
/**
 * Waits on the fake world's ticks (shooting, slipping inside, training): Chromium on a busy runner ran
 * far slower than 30 ticks a second (run 37544720334).
 */
const TICKS = { timeout: 30_000 };
const HIDE_ERROR = "躲著的兵要從建築的「全部出來」叫出來";

let checkErrors: () => void;

test.beforeEach(async ({ page }) => {
  checkErrors = watchErrors(page);
});

test.afterEach(() => {
  checkErrors();
});

async function start(page: Page, round7 = true): Promise<void> {
  await page.goto(round7 ? "./?test=1&mock=1&r7=1" : "./?test=1&mock=1");
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true);
  await centre(page, 22, 71);
}

const centre = (page: Page, x: number, y: number, scale = 1) =>
  page.evaluate(([x, y, s]) => window.__proto?.game?.centerOn(x, y, s), [x, y, scale] as const);
const at = (page: Page, c: { x: number; y: number }) => page.evaluate(([x, y]) => window.__proto?.game?.cellToScreen(x, y) ?? { x: 0, y: 0 }, [c.x, c.y] as const);
const selection = (page: Page) => page.evaluate(() => window.__proto?.game?.selection());
const sent = (page: Page) => page.evaluate(() => (window.__proto?.game?.sent() ?? []) as Record<string, unknown>[]);
/** The last order of the player's own hand (not the interface's own 堅守 or 積極). */
const lastOrder = async (page: Page) => (await sent(page)).filter((c) => c.auto !== true).at(-1);
const units = (page: Page) => page.evaluate(() => window.__proto?.game?.units() ?? []);
const buildings = (page: Page) => page.evaluate(() => window.__proto?.game?.buildings() ?? []);
const mode = (page: Page) => page.evaluate(() => window.__proto?.game?.mode());
const place = (page: Page, ids: number[], cells: { x: number; y: number }[]) => page.evaluate(([i, c]) => window.__proto?.game?.place(i, c), [ids, cells] as const);
const toast = (page: Page, text: string | RegExp) => page.getByRole("status").filter({ hasText: text });

async function ownIds(page: Page, types: number[]): Promise<number[]> {
  const me = await page.evaluate(() => window.__proto?.game?.me() ?? 0);
  return (await units(page)).filter((u) => u.owner === me && types.includes(u.type)).map((u) => u.id).sort((a, b) => a - b);
}

async function mainCityId(page: Page): Promise<number> {
  const city = (await buildings(page)).find((b) => b.type === 0 && b.owner === 0);
  if (city === undefined) throw new Error("no main city");
  return city.id;
}

const soldiersIn = async (page: Page, id: number) => (await buildings(page)).find((b) => b.id === id)?.soldiers ?? -1;

/** A point inside the town where a tap picks the town itself (not a soldier, a tree or a building). */
async function townSpot(page: Page, c: { x: number; y: number }): Promise<{ x: number; y: number }> {
  for (const [dx, dy] of [[0, 0], [1, 1], [-1, 1], [1, -1], [-1, -1], [2, 0], [0, 2], [-2, 0], [0, -2], [2, 2], [-2, -2]]) {
    const p = await at(page, { x: c.x + 0.5 + dx, y: c.y + 0.5 + dy });
    if ((await page.evaluate(([x, y]) => window.__proto?.game?.pickAt(x, y) ?? null, [p.x, p.y] as const)) === "town") return p;
  }
  throw new Error("no open ground inside the town");
}

/** Ranged units and mages (who can hide) and spearmen (who cannot). */
async function army(page: Page): Promise<{ hiders: number[]; spear: number[] }> {
  return { hiders: await ownIds(page, [2, 3]), spear: await ownIds(page, [1]) };
}

/** Hide these in the main city: the 躲進去 order, then put them beside it (the fake world walks slowly). */
async function hideInCity(page: Page, ids: number[]): Promise<number> {
  const city = await mainCityId(page);
  await page.evaluate(([u, b]) => window.__proto?.game?.send({ c: "garrison", u, building: b }), [ids, city] as const);
  await place(page, ids, [{ x: MAIN_CITY.x + 4, y: MAIN_CITY.y + 2 }]);
  await expect.poll(() => soldiersIn(page, city), TICKS).toBe(ids.length);
  return city;
}

/** Buttons at least 44 pt, inside the iPhone's safe area and not overlapping each other or the panels. */
async function checkLayout(page: Page): Promise<void> {
  const { width, height } = page.viewportSize() ?? { width: 0, height: 0 };
  const buttons = await visibleBoxes(page, INTERACTIVE);
  const panels = await visibleBoxes(page, ".minimap, .res-bar, .sel-info");
  for (const b of buttons) expect.soft(Math.min(b.width, b.height), `${b.label} size`).toBeGreaterThanOrEqual(44);
  const boxes = [...buttons, ...panels.map((p, i) => ({ ...p, label: ["資源列", "小地圖", "選取資訊"][i] ?? p.label }))];
  for (const b of boxes) {
    expect.soft(b.x, `${b.label} left`).toBeGreaterThanOrEqual(IPHONE_SAFE.left);
    expect.soft(b.x + b.width, `${b.label} right`).toBeLessThanOrEqual(width - IPHONE_SAFE.right);
    expect.soft(b.y + b.height, `${b.label} bottom`).toBeLessThanOrEqual(height - IPHONE_SAFE.bottom);
  }
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      const overlap = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 1 && Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 1;
      const nested = (x: typeof a, y: typeof a) => x.x >= y.x && x.y >= y.y && x.x + x.width <= y.x + y.width && x.y + x.height <= y.y + y.height;
      if (overlap && !nested(a, b) && !nested(b, a)) expect.soft(`${a.label} ↔ ${b.label}`, "overlapping").toBe("");
    }
  }
}

test("城鎮只能搶一次：搶過的城鎮再攻下，只有治理，寫明這局已經搶過；硬送搶會被拒絕並說明（D-061）", async ({ page }, info) => {
  await start(page);
  await page.evaluate(() => window.__proto?.game?.inject({ k: "town_captured", town: 0, by: 0 }));
  const dialog = page.getByRole("dialog", { name: /只能治理/ });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: /^搶/ })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: /^治理/ })).toBeVisible();
  await expect(dialog).toContainText("這座城這局已經被搶過，只能治理");
  await shot(page, info, "r7-town-choice-once");
  await dialog.getByRole("button", { name: /^稍後再決定/ }).tap();
  await expect(dialog).toBeHidden();
  // Tapped again, the choice under the town: 治理 only.
  await centre(page, 30, 66);
  await expect.poll(async () => (await page.evaluate(() => window.__proto?.game?.towns() ?? [])).find((t) => t.id === 0)?.state).toBe(1);
  await tap(page, await townSpot(page, { x: 30, y: 66 }));
  await expect(dialog).toBeVisible();
  const panel = page.locator(".sel-info");
  await expect(panel.getByRole("button", { name: "搶", exact: true })).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "治理", exact: true })).toBeAttached();
  await expect(panel).toContainText("這座城這局已經被搶過，只能治理");
  // 搶 sent anyway (Reject.AlreadyPlundered): the reason, and the town still waits.
  await page.evaluate(() => window.__proto?.game?.send({ c: "town_choice", town: 0, choice: 0 }));
  await expect(toast(page, "這座城這局已經被搶過，只能治理")).toBeVisible();
  await dialog.getByRole("button", { name: /^治理/ }).tap();
  await expect.poll(() => lastOrder(page)).toMatchObject({ c: "town_choice", town: 0, choice: 1 });
});

test("治理收入：搶過又治理的城鎮，選取資訊寫收入幾成、慢慢回升，數字會往上走（D-061）", async ({ page }, info) => {
  await start(page);
  await centre(page, OUR_TOWN.x, OUR_TOWN.y);
  await tap(page, await townSpot(page, OUR_TOWN));
  const panel = page.locator(".sel-info");
  await expect(panel).toContainText(/收入 \d+%，慢慢回升/);
  const pct = async () => Number(/收入 (\d+)%/.exec((await panel.textContent()) ?? "")?.[1] ?? -1);
  const first = await pct();
  expect(first).toBeGreaterThanOrEqual(25);
  expect(first).toBeLessThan(100);
  await shot(page, info, "r7-town-income");
  await expect.poll(pct, { timeout: 30_000 }).toBeGreaterThan(first);
});

test("箭樓：建造選單有箭樓；離主城或治理的城鎮太遠時預覽變紅、提示說原因，近的才送得出 build（D-061）", async ({ page }, info) => {
  await start(page);
  await centre(page, 16, 80);
  await selectForCommands(page, []);
  await page.getByRole("button", { name: "建造" }).tap();
  await expect(page.getByRole("button", { name: /^箭樓/ })).toBeVisible();
  await shot(page, info, "r7-build-menu");
  await page.getByRole("button", { name: /^箭樓/ }).tap();
  await expect.poll(() => mode(page)).toBe("place:dragging");
  await expect(page.getByText("拖曳箭樓到主城或治理的城鎮附近，放開後按 ✓ 或 ✗；會派最近的村民去蓋")).toBeVisible();
  const placement = () => page.evaluate(() => window.__proto?.game?.placement());
  await centre(page, TOWER_OFF.x, TOWER_OFF.y);
  await tap(page, await at(page, TOWER_OFF));
  await expect.poll(placement).toMatchObject({ cellX: TOWER_OFF.x, cellY: TOWER_OFF.y, valid: false });
  await expect(page.getByText("箭樓要蓋在主城或治理的城鎮附近")).toBeVisible();
  await shot(page, info, "r7-tower-off-land");
  await centre(page, TOWER_ON.x, TOWER_ON.y);
  await tap(page, await at(page, TOWER_ON));
  await expect.poll(placement).toMatchObject({ cellX: TOWER_ON.x, cellY: TOWER_ON.y, valid: true });
  await expect(page.getByText("箭樓要蓋在主城或治理的城鎮附近")).toBeHidden();
  await shot(page, info, "r7-tower-on-land");
  await page.getByRole("button", { name: "確定蓋在這裡" }).tap();
  await expect.poll(() => lastOrder(page)).toMatchObject({ c: "build", type: 10, x: TOWER_ON.x, y: TOWER_ON.y });
  await expect.poll(async () => (await buildings(page)).some((b) => b.type === 10 && b.cx === TOWER_ON.x && b.cy === TOWER_ON.y)).toBe(true);
});

test("躲進去：混選時提示只有遠程兵和法師會去，點錯地方說明要點什麼；點主城送出 garrison；主城寫躲了幾名、最多幾名；全部出來送 leave（D-061）", async ({ page }, info) => {
  await start(page);
  const { hiders, spear } = await army(page);
  await selectForCommands(page, [...hiders, spear[0]]);
  const hide = page.locator(".cmds").getByRole("button", { name: /^躲進去/ });
  await expect(hide).toContainText("主城或箭樓");
  await hide.tap();
  await expect.poll(() => mode(page)).toBe("garrison");
  await expect(page.getByText("點自己的主城或箭樓：只有遠程兵和法師會躲進去")).toBeVisible();
  await expect(page.locator(".cmds").getByRole("button", { name: /^取消\s*躲進去/ })).toHaveClass(/active/);
  await shot(page, info, "r7-garrison-prompt");
  // Open ground, or the enemy's tower: told what to tap, still picking.
  await tap(page, await at(page, { x: 18, y: 67 }));
  await expect(toast(page, "要點自己蓋好的主城或箭樓")).toBeVisible();
  expect(await mode(page)).toBe("garrison");
  const mark = (await sent(page)).length;
  await centre(page, MAIN_CITY.x + 2, MAIN_CITY.y + 2);
  await tap(page, await at(page, { x: MAIN_CITY.x + 2, y: MAIN_CITY.y + 2 }));
  const city = await mainCityId(page);
  await expect.poll(async () => (await sent(page)).slice(mark)).toMatchObject([{ c: "garrison", u: hiders, building: city }]);
  await expect(toast(page, `${hiders.length} 名躲進主城`)).toBeVisible();
  expect(await mode(page)).toBe("normal");
  // Beside the city they slip in and are no longer drawn.
  await place(page, hiders, [{ x: MAIN_CITY.x + 4, y: MAIN_CITY.y + 2 }]);
  await expect.poll(() => soldiersIn(page, city), TICKS).toBe(hiders.length);
  await expect.poll(async () => (await units(page)).filter((u) => hiders.includes(u.id)).every((u) => u.action === 7 && u.order === 9), TICKS).toBe(true);
  // The city: how many hide inside, how many fit, and 全部出來.
  await tap(page, await at(page, { x: MAIN_CITY.x + 2, y: MAIN_CITY.y + 2 }));
  const panel = page.locator(".sel-info");
  await expect(panel.locator(".garrison-count")).toHaveText(`躲了 ${hiders.length} 名士兵（最多 6 名）`);
  const out = panel.getByRole("button", { name: "全部出來" });
  await expect(out).toBeEnabled();
  await shot(page, info, "r7-garrison-city");
  await out.tap();
  await expect.poll(() => lastOrder(page)).toMatchObject({ c: "leave", building: city });
  await expect.poll(() => soldiersIn(page, city), TICKS).toBe(0);
  await expect(panel.locator(".garrison-count")).toHaveText("躲了 0 名士兵（最多 6 名）");
  await expect(out).toBeDisabled();
  await expect.poll(async () => (await units(page)).filter((u) => hiders.includes(u.id)).every((u) => u.action !== 7)).toBe(true);
});

test("躲著的兵：編隊照算、點編隊會選到，不會因此再拉兵補進編隊；編隊的進攻只送沒躲的；只選躲著的兵時說明怎麼叫出來；全軍、全軍撤退不含他們（ceo 2026-10-07）", async ({ page }) => {
  await start(page);
  const spear = await ownIds(page, [1]);
  const ranged = await ownIds(page, [2]);
  const mages = await ownIds(page, [3]);
  const hiding = ranged.slice(0, 2);
  const group = [...spear, ...hiding].sort((a, b) => a - b);
  await selectForCommands(page, group);
  await saveGroup(page, GROUP_1);
  await hideInCity(page, hiding);
  // Still in the group, which is not short of them: the other ranged units stay free.
  const groupIds = async () => [...((await page.evaluate(() => window.__proto?.game?.groupInfo() ?? []))[0]?.ids ?? [])].sort((a, b) => a - b);
  // Nothing should happen: 自動補兵 checks every snapshot, and a second is many of them.
  await page.waitForTimeout(1000);
  expect(await groupIds()).toEqual(group);
  await expect(toast(page, "補進編隊")).toHaveCount(0);
  // Tapping the group selects them too.
  await page.evaluate(() => window.__proto?.game?.select([]));
  await tapOn(page, GROUP_1);
  await expect.poll(() => selection(page)).toEqual({ units: group, building: null });
  // 進攻 for the group: those hiding stay inside.
  await expect(page.locator(".cmds")).toHaveAttribute("data-selection", group.join(","));
  await page.locator(".cmds").getByRole("button", { name: /^進攻/ }).tap();
  await tap(page, await at(page, { x: 18, y: 67 }));
  await expect.poll(() => lastOrder(page)).toMatchObject({ c: "move", u: spear, x: 18, y: 67 });
  expect(await soldiersIn(page, await mainCityId(page))).toBe(hiding.length);
  // Only those hiding selected: nothing sent, and how to get them out.
  const mark = (await sent(page)).length;
  await selectForCommands(page, hiding);
  await expect(page.locator(".sel-info .order-now")).toHaveText(`目前：躲在建築裡 ${hiding.length}`);
  await page.locator(".cmds").getByRole("button", { name: /^進攻/ }).tap();
  await tap(page, await at(page, { x: 18, y: 67 }));
  await expect(toast(page, HIDE_ERROR)).toBeVisible();
  expect((await sent(page)).slice(mark).filter((c) => c.c === "move" || c.c === "attack")).toEqual([]);
  // 全軍 and 全軍撤退: only those outside.
  const outside = [...spear, ...ranged.slice(2), ...mages].sort((a, b) => a - b);
  await expect(armyButton(page)).toHaveText(`全軍 ${outside.length}`);
  await page.evaluate(() => window.__proto?.game?.select([]));
  await page.getByRole("button", { name: "全軍撤退" }).tap();
  await expect.poll(() => lastOrder(page)).toMatchObject({ c: "retreat", u: outside });
  await armyButton(page).tap();
  await expect.poll(() => selection(page)).toEqual({ units: outside, building: null });
});

test("別人的建築裡有人：敵方箭樓右上角有記號，點它寫「裡面有人」；它射箭時畫出箭（D-061）", async ({ page }, info) => {
  await start(page);
  const tower = (await buildings(page)).find((b) => b.type === 10 && b.owner === 1);
  expect(tower, "the enemy's arrow tower is in view").toBeDefined();
  expect((tower?.flags ?? 0) & 32, "Occupied").toBe(32);
  await expect.poll(() => page.evaluate(() => window.__proto?.game?.shots() ?? 0), TICKS).toBeGreaterThan(0);
  await centre(page, FOE_TOWER.x + 1, FOE_TOWER.y + 1, 2);
  await tap(page, await at(page, FOE_TOWER));
  const panel = page.locator(".sel-info");
  await expect(panel).toContainText("箭樓");
  await expect(panel).toContainText("裡面有人");
  // Not ours: no count and no 全部出來.
  await expect(panel.locator(".sel-garrison")).toHaveCount(0);
  await shot(page, info, "r7-occupied-marker");
});

test("馬廄和騎兵：建造選單有馬廄；選馬廄 → 訓練騎兵，騎兵出來加入編隊，軍團畫面的騎兵列算到，全軍也算到（D-061）", async ({ page }, info) => {
  await start(page);
  const spear = await ownIds(page, [1]);
  const soldiers = (await ownIds(page, [1, 2, 3])).length;
  await selectForCommands(page, spear);
  await saveGroup(page, GROUP_1);
  // 建造 lists 馬廄 (nothing to build first in the fake world, as in the simulation).
  await selectForCommands(page, []);
  await page.getByRole("button", { name: "建造" }).tap();
  await expect(page.getByRole("button", { name: /^馬廄/ })).toBeEnabled();
  await page.getByRole("button", { name: "返回" }).tap();
  // The stable trains cavalry, and on its own too, as the barracks does (D-054).
  await centre(page, STABLE.x + 1, STABLE.y + 1);
  await tap(page, await at(page, { x: STABLE.x + 1, y: STABLE.y + 1 }));
  const panel = page.locator(".sel-info");
  await expect(panel).toContainText("馬廄");
  await expect(panel).toContainText("自動訓練中");
  await page.getByRole("button", { name: /^訓練騎兵/ }).tap();
  await expect.poll(() => lastOrder(page)).toMatchObject({ c: "train", type: 5, n: 1 });
  await shot(page, info, "r7-stable");
  await expect.poll(async () => (await ownIds(page, [5])).length, TICKS).toBe(1);
  const [cavalry] = await ownIds(page, [5]);
  // No group short of cavalry: it joins the largest, which wants one more (D-054).
  await expect.poll(async () => (await page.evaluate(() => window.__proto?.game?.groupInfo() ?? []))[0]?.ids ?? [], TICKS).toContain(cavalry);
  await shot(page, info, "r7-cavalry");
  // Beside the spearmen, close up: the two shapes read apart.
  await place(page, [cavalry], [{ x: 25, y: 69 }]);
  await centre(page, 23.5, 68.5, 2.5);
  await shot(page, info, "r7-cavalry-vs-spear");
  await centre(page, 22, 71);
  await tapOn(page, GROUP_1);
  const row = panel.locator(".group-row").filter({ hasText: "騎兵" });
  await expect(row.locator(".group-has")).toHaveText("現有 1");
  await expect(row.locator(".group-want")).toHaveText("1");
  await shot(page, info, "r7-cavalry-group");
  await expect(armyButton(page)).toHaveText(`全軍 ${soldiers + 1}`);
});

for (const viewport of [null, FULL_SCREEN]) {
  test(`版面：軍團畫面多了騎兵一列，按鈕至少 44 pt、在安全區內、不重疊（${viewport === null ? "工具列展開" : "工具列收合"}）`, async ({ page }, info) => {
    await start(page);
    if (viewport !== null) await page.setViewportSize(viewport);
    await injectSafeArea(page);
    await selectForCommands(page, await ownIds(page, [1]));
    await saveGroup(page, GROUP_1);
    await expect(page.locator(".sel-info .group-row")).toHaveCount(4);
    await expect(page.locator(".sel-info .group-row").nth(3)).toContainText("騎兵");
    await checkLayout(page);
    const { width, height } = page.viewportSize() ?? { width: 0, height: 0 };
    await shot(page, info, `r7-layout-group-${width}x${height}`);
  });
}

for (const viewport of [null, FULL_SCREEN]) {
  test(`版面：選了全軍（有躲進去）、選了主城（有躲了幾名和全部出來）時，按鈕至少 44 pt、在安全區內、不重疊（${viewport === null ? "工具列展開" : "工具列收合"}）`, async ({ page }, info) => {
    await start(page);
    if (viewport !== null) await page.setViewportSize(viewport);
    await injectSafeArea(page);
    const { hiders, spear } = await army(page);
    await selectForCommands(page, [...spear, ...hiders].sort((a, b) => a - b));
    await expect(page.locator(".cmds").getByRole("button", { name: /^躲進去/ })).toBeVisible();
    await expect(page.locator(".sel-note")).toBeVisible();
    await checkLayout(page);
    // 進攻、撤退、堅守、停止, then 隊形 (two columns wide) and the mages' two; 躲進去 starts a third row.
    const rows = new Set((await visibleBoxes(page, ".cmds button")).map((b) => Math.round(b.y)));
    expect(rows.size, "three rows of commands").toBe(3);
    const { width, height } = page.viewportSize() ?? { width: 0, height: 0 };
    await shot(page, info, `r7-layout-army-${width}x${height}`);
    await centre(page, MAIN_CITY.x + 2, MAIN_CITY.y + 2);
    await tap(page, await at(page, { x: MAIN_CITY.x + 2, y: MAIN_CITY.y + 2 }));
    await expect(page.locator(".sel-info .garrison-count")).toBeVisible();
    await checkLayout(page);
    await shot(page, info, `r7-layout-city-${width}x${height}`);
    // The build menu with 箭樓 added.
    await page.getByRole("button", { name: "建造" }).tap();
    await expect(page.getByRole("button", { name: /^箭樓/ })).toBeVisible();
    await checkLayout(page);
    await shot(page, info, `r7-layout-build-${width}x${height}`);
  });
}

test("開關關著（沒有 r7）：沒有箭樓、馬廄、騎兵那一列、躲進去，建築不寫躲了幾名士兵、城鎮不寫收入，攻下城鎮照樣有搶（D-061）", async ({ page }) => {
  await start(page, false);
  const { hiders, spear } = await army(page);
  await selectForCommands(page, [...spear, ...hiders].sort((a, b) => a - b));
  await expect(page.locator(".cmds").getByRole("button", { name: /^隊形/ })).toBeVisible();
  await expect(page.locator(".cmds").getByRole("button", { name: /^躲進去/ })).toHaveCount(0);
  await selectForCommands(page, []);
  await page.getByRole("button", { name: "建造" }).tap();
  await expect(page.getByRole("button", { name: /^民居/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^箭樓/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^馬廄/ })).toHaveCount(0);
  await page.getByRole("button", { name: "返回" }).tap();
  // 軍團畫面: the three rows of before, no 騎兵.
  await selectForCommands(page, spear);
  await saveGroup(page, GROUP_1);
  await expect(page.locator(".sel-info .group-row")).toHaveCount(3);
  await expect(page.locator(".sel-info .group-row").filter({ hasText: "騎兵" })).toHaveCount(0);
  // The group's panel could cover the main city at the centre of the screen.
  await page.evaluate(() => window.__proto?.game?.select([]));
  await centre(page, MAIN_CITY.x + 2, MAIN_CITY.y + 2);
  await tap(page, await at(page, { x: MAIN_CITY.x + 2, y: MAIN_CITY.y + 2 }));
  const panel = page.locator(".sel-info");
  await expect(panel).toContainText("主城");
  await expect(panel.locator(".sel-garrison")).toHaveCount(0);
  // With a building selected, a tap on a town only names it (the panel keeps the building): nothing selected first.
  await page.evaluate(() => window.__proto?.game?.select([]));
  await expect(panel).toBeHidden();
  await centre(page, OUR_TOWN.x, OUR_TOWN.y);
  await tap(page, await townSpot(page, OUR_TOWN));
  await expect(panel).toContainText("民兵");
  await expect(panel).not.toContainText("收入");
  await page.evaluate(() => window.__proto?.game?.inject({ k: "town_captured", town: 0, by: 0 }));
  const dialog = page.getByRole("dialog", { name: /搶還是治理/ });
  await expect(dialog.getByRole("button", { name: /^搶/ })).toBeVisible();
});
