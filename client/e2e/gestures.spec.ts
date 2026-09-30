// GDD §10 gestures on the battlefield, in WebKit and Chromium at iPhone landscape size, on
// the fake world (mock/) until the simulation is connected. Each test names its gesture-table
// row. Positions come from the test hook (cell -> screen), commands from what the page posted.

import { expect, type Page, test } from "@playwright/test";
import { INTERACTIVE, IPHONE_SAFE, injectSafeArea, shot, visibleBoxes, watchErrors } from "./helpers.ts";
import { doubleTap, drag, lift, longPress, move, pinch, pressShowsCue, tap } from "./touch.ts";

// Fake-world layout (src/mock/mock-port.ts), in cells.
const SPEAR = { x: 22, y: 68 };
const MAGE = { x: 23, y: 72 };
const ENEMY_SPEAR = { x: 28, y: 70 };
const GOLD = { x: 27, y: 76 };
const HOUSE = 1;
const FARM_CELL = { x: 15, y: 81 };
const SPEARMAN = 1;

let checkErrors: () => void;

test.beforeEach(async ({ page }) => {
  checkErrors = watchErrors(page);
  await page.goto("./?test=1");
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true);
  await centre(page, 22, 71);
});

test.afterEach(() => {
  checkErrors();
});

const centre = (page: Page, x: number, y: number, scale = 1) =>
  page.evaluate(([x, y, s]) => window.__proto?.game?.centerOn(x, y, s), [x, y, scale] as const);
const at = (page: Page, c: { x: number; y: number }) => page.evaluate(([x, y]) => window.__proto?.game?.cellToScreen(x, y) ?? { x: 0, y: 0 }, [c.x, c.y] as const);
const selection = (page: Page) => page.evaluate(() => window.__proto?.game?.selection());
const lastSent = (page: Page) => page.evaluate(() => window.__proto?.game?.sent().at(-1) as Record<string, unknown> | undefined);
const units = (page: Page) => page.evaluate(() => window.__proto?.game?.units() ?? []);
const camera = (page: Page) => page.evaluate(() => window.__proto?.game?.camera());
const mode = (page: Page) => page.evaluate(() => window.__proto?.game?.mode());

async function idAt(page: Page, c: { x: number; y: number }): Promise<number> {
  const p = await at(page, c);
  const list = await units(page);
  const u = list.find((v) => Math.hypot(v.sx - p.x, v.sy - p.y) < 4);
  if (u === undefined) throw new Error(`no unit at cell ${c.x},${c.y}`);
  return u.id;
}

async function ownIds(page: Page, types: number[]): Promise<number[]> {
  const me = await page.evaluate(() => window.__proto?.game?.me() ?? 0);
  return (await units(page)).filter((u) => u.owner === me && types.includes(u.type)).map((u) => u.id).sort((a, b) => a - b);
}

test("戰場：地形、資源、建築、單位、城鎮四種狀態、迷霧三種狀態", async ({ page }, info) => {
  await shot(page, info, "battlefield-zoom-1");
  await centre(page, 24, 70, 0.55);
  await page.waitForTimeout(100);
  await shot(page, info, "battlefield-overview");
  expect((await units(page)).length).toBeGreaterThan(20);
});

test("單指點單位或建築 → 選取（瀏覽器真的觸控路徑）", async ({ page }) => {
  const id = await idAt(page, SPEAR);
  const p = await at(page, SPEAR);
  await page.touchscreen.tap(p.x, p.y);
  await expect.poll(() => selection(page)).toEqual({ units: [id], building: null });
});

test("點兩下單位 → 選取畫面內所有同類單位", async ({ page }) => {
  await doubleTap(page, await at(page, SPEAR));
  const spears = await ownIds(page, [SPEARMAN]);
  expect(spears.length).toBe(6);
  await expect.poll(() => selection(page)).toEqual({ units: spears, building: null });
});

test("選了部隊後點地面 → 前進；點敵人 → 攻擊", async ({ page }) => {
  await doubleTap(page, await at(page, SPEAR));
  const spears = await ownIds(page, [SPEARMAN]);
  await tap(page, await at(page, { x: 26, y: 75 }));
  await expect.poll(() => lastSent(page)).toMatchObject({ c: "move", u: spears, x: 26, y: 75 });
  const enemy = await idAt(page, ENEMY_SPEAR);
  await tap(page, await at(page, ENEMY_SPEAR));
  await expect.poll(() => lastSent(page)).toMatchObject({ c: "attack", u: spears, target: enemy });
});

test("選了農民後點資源 → 採集", async ({ page }) => {
  await centre(page, 18, 76);
  const farmers = await ownIds(page, [0]);
  await longPress(page, await at(page, { x: 12, y: 77 }), await at(page, { x: 18, y: 79 }));
  await expect.poll(() => selection(page)).toEqual({ units: farmers, building: null });
  await tap(page, await at(page, GOLD));
  await expect.poll(() => lastSent(page)).toMatchObject({ c: "gather", u: farmers });
});

test("長按空地 350 ms 後拖曳 → 框選，優先選軍隊", async ({ page }, info) => {
  await centre(page, 20, 73, 0.8);
  const from = await at(page, { x: 15, y: 67 });
  const to = await at(page, { x: 25, y: 79 });
  expect(await pressShowsCue(page, from, 300), "the hold cue shows while the finger is still").toBe(true);
  await page.waitForTimeout(200);
  await move(page, to);
  await expect(page.locator(".marquee")).toBeVisible();
  await shot(page, info, "box");
  await lift(page, to);
  const army = await ownIds(page, [1, 2, 3]);
  expect(army.length).toBe(12);
  // The box also covers three farmers (row 78): military wins.
  await expect.poll(() => selection(page)).toEqual({ units: army, building: null });
});

test("單指拖曳 → 移動畫面，放開後有慣性", async ({ page }) => {
  const before = (await camera(page))?.x ?? 0;
  const atLift = await drag(page, { x: 600, y: 200 }, { x: 300, y: 200 }, 10, 120);
  expect(atLift, "the map follows the finger").toBeGreaterThan(before + 250);
  await page.waitForTimeout(300);
  expect((await camera(page))?.x ?? 0, "and keeps sliding after the finger lifts").toBeGreaterThan(atLift + 20);
  // A drag that stops before the finger lifts does not fling.
  await drag(page, { x: 300, y: 200 }, { x: 400, y: 200 }, 10, 200, 150);
  await page.waitForTimeout(200);
  expect((await camera(page))?.flinging).toBe(false);
});

test("雙指捏合 → 縮放", async ({ page }) => {
  const before = (await camera(page))?.scale ?? 0;
  await pinch(page, { x: 400, y: 190 }, 100, 200);
  const after = (await camera(page))?.scale ?? 0;
  expect(after).toBeCloseTo(Math.min(before * 2, 2.5), 1);
  // Lifting one finger and then the other is not a tap.
  expect(await lastSent(page)).toBeUndefined();
});

test("長按法師 → 技能輪盤：晶砲、自動施放、撤退；撤退要選位置，也可以直接退回主城", async ({ page }, info) => {
  const mage = await idAt(page, MAGE);
  await longPress(page, await at(page, MAGE));
  await expect.poll(() => page.evaluate(() => window.__proto?.game?.wheel())).toEqual(["cast", "autocast", "retreat"]);
  const items = page.getByRole("menuitem");
  await expect(items).toHaveCount(3);
  for (const b of await visibleBoxes(page, ".wheel-item")) {
    expect(b.width).toBeGreaterThanOrEqual(44);
    expect(b.height).toBeGreaterThanOrEqual(44);
  }
  await shot(page, info, "wheel-mage");
  await page.getByRole("menuitem", { name: "撤退" }).tap();
  expect(await mode(page)).toBe("retreat");
  await expect(page.getByText("點地面或小地圖選撤退位置")).toBeVisible();
  await shot(page, info, "retreat-prompt");
  await page.getByRole("button", { name: "退回主城" }).tap();
  await expect.poll(() => lastSent(page)).toMatchObject({ c: "retreat", u: [mage] });
  expect(await mode(page)).toBe("normal");
});

test("長按法師 → 晶砲：點地面選落點", async ({ page }) => {
  const mage = await idAt(page, MAGE);
  await longPress(page, await at(page, MAGE));
  await page.getByRole("menuitem", { name: "晶砲" }).tap();
  await expect(page.getByText("點地面選晶砲落點")).toBeVisible();
  await tap(page, await at(page, { x: 27, y: 71 }));
  await expect.poll(() => lastSent(page)).toMatchObject({ c: "cast", u: mage, fx: 27 * 1024 + 512, fy: 71 * 1024 + 512 });
  expect(await mode(page)).toBe("normal");
});

test("長按其他兵種 → 技能輪盤：撤退、姿態", async ({ page }, info) => {
  const spear = await idAt(page, SPEAR);
  await longPress(page, await at(page, SPEAR));
  await expect.poll(() => page.evaluate(() => window.__proto?.game?.wheel())).toEqual(["retreat", "stance"]);
  await shot(page, info, "wheel-spearman");
  await page.getByRole("menuitem", { name: "改成堅守" }).tap();
  await expect.poll(() => lastSent(page)).toMatchObject({ c: "stance", u: [spear], stance: 1 });
});

test("撤退：點地面選位置，或按取消離開", async ({ page }) => {
  const spear = await idAt(page, SPEAR);
  await longPress(page, await at(page, SPEAR));
  await page.getByRole("menuitem", { name: "撤退" }).tap();
  await tap(page, await at(page, { x: 12, y: 74 }));
  await expect.poll(() => lastSent(page)).toMatchObject({ c: "retreat", u: [spear], x: 12, y: 74 });
  await longPress(page, await at(page, SPEAR));
  await page.getByRole("menuitem", { name: "撤退" }).tap();
  await page.getByRole("button", { name: "取消" }).tap();
  expect(await mode(page)).toBe("normal");
});

test("放建築 → 預覽跟著手指，紅色不能按 ✓，放開後按 ✓ 送出、✗ 取消", async ({ page }, info) => {
  await centre(page, 18, 77);
  const farmers = await ownIds(page, [0]);
  await longPress(page, await at(page, { x: 12, y: 77 }), await at(page, { x: 18, y: 79 }));
  await page.evaluate((t) => window.__proto?.game?.startPlacement(t), HOUSE);
  expect(await mode(page)).toBe("place:dragging");

  await drag(page, await at(page, { x: 18, y: 74 }), await at(page, FARM_CELL), 8, 300);
  await expect.poll(() => page.evaluate(() => window.__proto?.game?.placement())).toMatchObject({ phase: "confirm", valid: false });
  await expect(page.getByRole("button", { name: "確定蓋在這裡" })).toBeDisabled();
  await shot(page, info, "place-red");

  await drag(page, await at(page, FARM_CELL), await at(page, { x: 21, y: 76 }), 8, 300);
  await expect.poll(() => page.evaluate(() => window.__proto?.game?.placement())).toMatchObject({ phase: "confirm", valid: true, cellX: 21, cellY: 76 });
  await shot(page, info, "place-green");
  await page.getByRole("button", { name: "確定蓋在這裡" }).tap();
  await expect.poll(() => lastSent(page)).toMatchObject({ c: "build", u: farmers, type: HOUSE, x: 21, y: 76 });
  expect(await mode(page)).toBe("normal");

  await page.evaluate((t) => window.__proto?.game?.startPlacement(t), HOUSE);
  await tap(page, await at(page, { x: 22, y: 78 }));
  await page.getByRole("button", { name: "取消放建築" }).tap();
  expect(await mode(page)).toBe("normal");
  expect((await lastSent(page))?.c).toBe("build");
});

test("量測面板：量測中不能再按；log 框跟著最新一行，往上捲時不會被拉走", async ({ page }, info) => {
  await page.getByRole("button", { name: "量測", exact: true }).tap();
  const measure = page.getByRole("button", { name: "開始量測" });
  const check = page.getByRole("button", { name: "確定性檢查" });
  await expect(check).toBeDisabled();
  await measure.tap();
  await expect(measure).toBeDisabled();
  await expect.poll(() => page.evaluate(() => window.__proto?.game?.labPhase())).toBe("warmup");

  for (let i = 0; i < 120; i++) await page.evaluate((n) => window.__proto?.game?.log(`line ${n}`), i);
  const box = page.locator(".lab-log");
  const lastLine = box.getByText("line 119", { exact: true });
  const inside = async () => {
    const b = await box.boundingBox();
    const l = await lastLine.boundingBox();
    return b !== null && l !== null && l.y >= b.y - 1 && l.y + l.height <= b.y + b.height + 1;
  };
  expect(await inside()).toBe(true);
  await shot(page, info, "lab-log-follows");

  await box.evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.evaluate(() => window.__proto?.game?.log("line 120"));
  expect(await box.evaluate((el) => el.scrollTop)).toBe(0);
  const more = page.getByRole("button", { name: "有新訊息 ↓" });
  await expect(more).toBeVisible();
  await more.tap();
  await expect(more).toBeHidden();
  expect(await box.getByText("line 120", { exact: true }).isVisible()).toBe(true);
});

test("戰場上的按鈕至少 44 pt、不被安全區蓋住", async ({ page }) => {
  await injectSafeArea(page);
  const { width, height } = page.viewportSize() ?? { width: 0, height: 0 };
  const boxes = await visibleBoxes(page, INTERACTIVE);
  expect(boxes.length).toBeGreaterThan(0);
  for (const b of boxes) {
    expect.soft(b.width, b.label).toBeGreaterThanOrEqual(44);
    expect.soft(b.height, b.label).toBeGreaterThanOrEqual(44);
    expect.soft(b.x, b.label).toBeGreaterThanOrEqual(IPHONE_SAFE.left);
    expect.soft(b.x + b.width, b.label).toBeLessThanOrEqual(width - IPHONE_SAFE.right);
    expect.soft(b.y + b.height, b.label).toBeLessThanOrEqual(height - IPHONE_SAFE.bottom);
  }
});
