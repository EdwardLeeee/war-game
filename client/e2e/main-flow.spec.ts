// The brief's main flow, on core's real simulation with its `e2e` scenario (plenty of
// resources, two houses and a barracks, a squad of 6 spearmen and 4 ranged ten cells from
// the small town), in WebKit and Chromium at iPhone landscape size with touch:
// 開局 → 選農民 → 蓋房子 → 訓練 → 框選 → 前進 → 暫停時下指令 → 攻下城鎮後選搶或治理.
// Every step goes through the interface the player uses; the test hook only reads state
// and moves the camera.

import { expect, type Page, test } from "@playwright/test";
import { shot, watchErrors } from "./helpers.ts";
import { doubleTap, longPress, tap } from "./touch.ts";

const FARMER = 0;
const SPEARMAN = 1;
const RANGED = 2;
const HOUSE = 1;
const BARRACKS = 6;
const SQUAD = { x: 26, y: 40 };

const header = (page: Page) => page.evaluate(() => window.__proto?.game?.header() ?? { tick: -1, paused: false, speed: 0, scenario: -1 });
const units = (page: Page) => page.evaluate(() => window.__proto?.game?.units() ?? []);
const buildings = (page: Page) => page.evaluate(() => window.__proto?.game?.buildings() ?? []);
const towns = (page: Page) => page.evaluate(() => window.__proto?.game?.towns() ?? []);
const placement = (page: Page) => page.evaluate(() => window.__proto?.game?.placement() ?? null);
const lastSent = (page: Page) => page.evaluate(() => window.__proto?.game?.sent().at(-1) as Record<string, unknown> | undefined);
const selection = (page: Page) => page.evaluate(() => window.__proto?.game?.selection());
const myId = (page: Page) => page.evaluate(() => window.__proto?.game?.me() ?? 0);
const toScreen = (page: Page, c: { x: number; y: number }) => page.evaluate(([x, y]) => window.__proto?.game?.cellToScreen(x, y) ?? { x: 0, y: 0 }, [c.x, c.y] as const);
const centre = (page: Page, c: { x: number; y: number }, scale = 1) => page.evaluate(([x, y, s]) => window.__proto?.game?.centerOn(x, y, s), [c.x, c.y, scale] as const);

async function own(page: Page, types: number[]) {
  const me = await myId(page);
  return (await units(page)).filter((u) => u.owner === me && types.includes(u.type));
}

async function pause(page: Page): Promise<void> {
  await page.getByRole("button", { name: "暫停" }).tap();
  await expect.poll(async () => (await header(page)).paused).toBe(true);
}

async function resume(page: Page): Promise<void> {
  await page.getByRole("button", { name: "繼續" }).tap();
  await expect.poll(async () => (await header(page)).paused).toBe(false);
}

test("主要流程：開局 → 選農民 → 蓋房子 → 訓練 → 框選 → 前進 → 暫停時下指令 → 攻下城鎮後選搶或治理", async ({ page }, info) => {
  test.setTimeout(300_000);
  const check = watchErrors(page);

  // 1. 開局
  await page.goto("./?test=1&scenario=e2e&tps=100");
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true);
  expect((await header(page)).scenario, "the e2e scenario").toBe(1);
  await expect(page.locator(".res-bar")).toContainText(/糧 \d{4}/);
  await shot(page, info, "1-start");

  // 2. 選農民（點兩下一名農民 = 畫面內所有農民）
  await pause(page);
  const farmers = (await own(page, [FARMER])).sort((a, b) => a.id - b.id);
  await doubleTap(page, { x: farmers[0].sx, y: farmers[0].sy });
  // Every farmer on screen (some may be off it, gathering).
  await expect.poll(async () => (await selection(page))?.units.length ?? 0).toBeGreaterThan(0);
  const farmerIds = (await selection(page))?.units ?? [];
  expect(farmerIds.every((id) => farmers.some((f) => f.id === id)), "only farmers").toBe(true);

  // 3. 蓋房子（指令區：建造 → 民居 → 點一個能蓋的位置 → ✓）
  await page.getByRole("button", { name: "建造" }).tap();
  await page.getByRole("button", { name: /^民居/ }).tap();
  let spot: { cellX: number; cellY: number } | null = null;
  for (const [dx, dy] of [[4, -3], [5, -2], [3, -4], [6, -3], [4, -5], [7, -1], [2, -5], [6, 0]]) {
    const cell = await page.evaluate(([x, y]) => window.__proto?.game?.openCellNear(x, y) ?? null, [farmers[0].cx + dx, farmers[0].cy + dy] as const);
    if (cell === null) continue;
    await tap(page, await toScreen(page, cell));
    const p = await placement(page);
    if (p?.valid === true) {
      spot = p;
      break;
    }
  }
  expect(spot, "a green spot for the house").not.toBeNull();
  await shot(page, info, "3-place-house");
  await page.getByRole("button", { name: "確定蓋在這裡" }).tap();
  await expect.poll(() => lastSent(page)).toMatchObject({ c: "build", u: farmerIds, type: HOUSE, x: spot?.cellX, y: spot?.cellY });
  await resume(page);
  const me = await myId(page);
  await expect
    .poll(async () => (await buildings(page)).some((b) => b.owner === me && b.type === HOUSE && b.cx === spot?.cellX && b.cy === spot?.cellY), { timeout: 30_000 })
    .toBe(true);

  // 4. 訓練（點兵營 → 訓練槍兵 → 佇列 → 出生）
  await pause(page);
  const barracks = (await buildings(page)).find((b) => b.owner === me && b.type === BARRACKS);
  if (barracks === undefined) throw new Error("no barracks");
  const bc = { x: barracks.cx + Math.floor(barracks.size / 2), y: barracks.cy + Math.floor(barracks.size / 2) };
  await centre(page, bc);
  await tap(page, await toScreen(page, bc));
  await expect(page.locator(".sel-info")).toContainText("兵營");
  const spearmenBefore = (await own(page, [SPEARMAN])).length;
  await page.getByRole("button", { name: /^訓練槍兵/ }).tap();
  await expect.poll(() => lastSent(page)).toMatchObject({ c: "train", building: barracks.id, type: SPEARMAN, n: 1 });
  await expect(page.getByRole("button", { name: /取消訓練第 1 個：槍兵/ })).toBeVisible();
  await shot(page, info, "4-train");
  await resume(page);
  await expect.poll(async () => (await own(page, [SPEARMAN])).length, { timeout: 60_000 }).toBe(spearmenBefore + 1);

  // 5. 框選（長按空地 350 ms 後拖曳，框住在小鎮南邊的部隊）
  await pause(page);
  await centre(page, { x: SQUAD.x, y: SQUAD.y - 1 }, 0.8);
  const squad = (await own(page, [SPEARMAN, RANGED])).filter((u) => Math.abs(u.cx - SQUAD.x) <= 5 && Math.abs(u.cy - SQUAD.y) <= 3);
  expect(squad.length).toBeGreaterThanOrEqual(10);
  const xs = squad.map((u) => u.sx);
  const ys = squad.map((u) => u.sy);
  const from = { x: Math.min(...xs) - 30, y: Math.min(...ys) - 30 };
  const to = { x: Math.max(...xs) + 30, y: Math.max(...ys) + 30 };
  expect((await units(page)).some((u) => Math.hypot(u.sx - from.x, u.sy - from.y) < 25), "the long press starts on empty ground").toBe(false);
  await longPress(page, from, to);
  const squadIds = squad.map((u) => u.id).sort((a, b) => a - b);
  await expect.poll(async () => (await selection(page))?.units).toEqual(squadIds);
  await shot(page, info, "5-box");

  // 6. 前進（點地面：往小鎮走，路上遇到敵人會打）
  const town = (await towns(page)).find((t) => t.size === 0);
  if (town === undefined) throw new Error("no small town on the map");
  const halfway = await page.evaluate(([x, y]) => window.__proto?.game?.openCellNear(x, y) ?? null, [SQUAD.x, SQUAD.y - 5] as const);
  if (halfway === null) throw new Error("no open cell on the way");
  await tap(page, await toScreen(page, halfway));
  await expect.poll(() => lastSent(page)).toMatchObject({ c: "move", u: squadIds, x: halfway.x, y: halfway.y });
  await resume(page);
  const distTo = async (c: { x: number; y: number }) => {
    const list = (await units(page)).filter((u) => squadIds.includes(u.id));
    return list.reduce((s, u) => s + Math.hypot(u.fx - (c.x + 0.5), u.fy - (c.y + 0.5)), 0) / Math.max(1, list.length);
  };
  const startDist = await distTo(halfway);
  await expect.poll(() => distTo(halfway), { timeout: 30_000 }).toBeLessThan(startDist - 2);

  // 7. 暫停時下指令（暫停後模擬停住，對小鎮下前進指令，按繼續後才執行）
  await pause(page);
  const frozen = (await header(page)).tick;
  await centre(page, { x: town.cx, y: town.cy + 3 }, 0.8);
  const target = await page.evaluate(([x, y]) => window.__proto?.game?.openCellNear(x, y) ?? null, [town.cx, town.cy] as const);
  if (target === null) throw new Error("no open cell in the town");
  await tap(page, await toScreen(page, target));
  await expect.poll(() => lastSent(page)).toMatchObject({ u: squadIds });
  await page.waitForTimeout(500);
  expect((await header(page)).tick, "no ticks while paused").toBe(frozen);
  await shot(page, info, "7-order-while-paused");
  await resume(page);

  // 8. 攻下城鎮後選搶或治理（民兵全倒、只剩我方軍隊 → 跳出兩個大按鈕）
  const choice = page.getByRole("dialog", { name: /搶還是治理/ });
  await expect(choice).toBeVisible({ timeout: 180_000 });
  await shot(page, info, "8-town-choice");
  await choice.getByRole("button", { name: /^搶/ }).tap();
  await expect.poll(() => lastSent(page)).toMatchObject({ c: "town_choice", town: town.id, choice: 0 });
  // Plundering (TownState 2) by us.
  await expect.poll(async () => (await towns(page)).find((t) => t.id === town.id)?.state, { timeout: 30_000 }).toBe(2);
  await shot(page, info, "8-plundering");
  check();
});
