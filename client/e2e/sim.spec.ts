// The page on core's real simulation Worker (standard scenario), in WebKit and Chromium at
// iPhone landscape size: the game runs, units follow orders, pause and speed, orders given
// while paused, not-yet-built rules, automatic pause, and the determinism check against the
// hashes CI computed with the headless runner (dist/expected-hashes.json).

import { expect, type Page, test } from "@playwright/test";
import { shot, watchErrors } from "./helpers.ts";
import { doubleTap, tap } from "./touch.ts";

const FARMER = 0;

let checkErrors: () => void;

test.beforeEach(({ page }) => {
  checkErrors = watchErrors(page);
});

test.afterEach(() => {
  checkErrors();
});

async function start(page: Page, query = "?test=1"): Promise<void> {
  await page.goto(`./${query}`);
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true);
}

const header = (page: Page) => page.evaluate(() => window.__proto?.game?.header() ?? { tick: -1, paused: false, speed: 0 });
const units = (page: Page) => page.evaluate(() => window.__proto?.game?.units() ?? []);
const selection = (page: Page) => page.evaluate(() => window.__proto?.game?.selection());
const lastSent = (page: Page) => page.evaluate(() => window.__proto?.game?.sent().at(-1) as Record<string, unknown> | undefined);
const toScreen = (page: Page, c: { x: number; y: number }) => page.evaluate(([x, y]) => window.__proto?.game?.cellToScreen(x, y) ?? { x: 0, y: 0 }, [c.x, c.y] as const);

async function farmers(page: Page) {
  const me = await page.evaluate(() => window.__proto?.game?.me() ?? 0);
  return (await units(page)).filter((u) => u.owner === me && u.type === FARMER);
}

/** Double-tap a farmer: selects every farmer on screen. */
async function selectFarmers(page: Page): Promise<number[]> {
  const list = await farmers(page);
  await doubleTap(page, { x: list[0].sx, y: list[0].sy });
  const ids = list.map((u) => u.id).sort((a, b) => a - b);
  await expect.poll(() => selection(page)).toEqual({ units: ids, building: null });
  return ids;
}

/** An open cell a few cells from the farmers, on screen. */
async function groundNearFarmers(page: Page, dx: number, dy: number) {
  const f = (await farmers(page))[0];
  const cell = await page.evaluate(([x, y]) => window.__proto?.game?.openCellNear(x, y) ?? null, [f.cx + dx, f.cy + dy] as const);
  if (cell === null) throw new Error("no open cell near the farmers");
  return cell;
}

/** Sum of the farmers' distances (in cells) to a cell. */
async function distanceTo(page: Page, c: { x: number; y: number }): Promise<number> {
  return (await farmers(page)).reduce((sum, u) => sum + Math.hypot(u.cx - c.x, u.cy - c.y), 0);
}

test("開局：模擬在跑，自己有 5 名農民", async ({ page }, info) => {
  await start(page);
  const t0 = (await header(page)).tick;
  await expect.poll(async () => (await header(page)).tick).toBeGreaterThan(t0 + 5);
  expect((await farmers(page)).length).toBe(5);
  await shot(page, info, "sim-start");
});

test("選農民 → 點地面前進：農民往那裡走", async ({ page }) => {
  await start(page, "?test=1&tps=60");
  const ids = await selectFarmers(page);
  const target = await groundNearFarmers(page, 6, -3);
  const before = await distanceTo(page, target);
  await tap(page, await toScreen(page, target));
  await expect.poll(() => lastSent(page)).toMatchObject({ c: "move", u: ids, x: target.x, y: target.y });
  await expect.poll(() => distanceTo(page, target), { timeout: 15_000 }).toBeLessThan(before - 5);
});

test("暫停時下指令：模擬停住、指令照收，按繼續後才執行", async ({ page }, info) => {
  await start(page, "?test=1&tps=60");
  await page.getByRole("button", { name: "暫停" }).tap();
  await expect.poll(async () => (await header(page)).paused).toBe(true);
  await expect(page.getByText("暫停中：仍可下指令")).toBeVisible();
  const frozen = (await header(page)).tick;

  const ids = await selectFarmers(page);
  const target = await groundNearFarmers(page, 6, -3);
  const before = await distanceTo(page, target);
  await tap(page, await toScreen(page, target));
  await expect.poll(() => lastSent(page)).toMatchObject({ c: "move", u: ids });
  await shot(page, info, "paused-order");
  await page.waitForTimeout(600);
  expect((await header(page)).tick, "no ticks while paused").toBe(frozen);
  expect(await distanceTo(page, target), "nobody moved while paused").toBe(before);

  await page.getByRole("button", { name: "繼續" }).tap();
  await expect(page.getByText("暫停中：仍可下指令")).toBeHidden();
  await expect.poll(() => distanceTo(page, target), { timeout: 15_000 }).toBeLessThan(before - 5);
});

test("速度：正常 → 快 1.5× → 慢 0.75× → 正常（每秒 20、30、15 tick）", async ({ page }) => {
  await start(page);
  await expect.poll(async () => (await header(page)).speed).toBe(2000);
  const speed = page.getByRole("button", { name: /^速度/ });
  await expect(speed).toHaveText("速度 正常 1×");
  await speed.tap();
  await expect(speed).toHaveText("速度 快 1.5×");
  await expect.poll(async () => (await header(page)).speed).toBe(3000);
  await speed.tap();
  await expect(speed).toHaveText("速度 慢 0.75×");
  await expect.poll(async () => (await header(page)).speed).toBe(1500);
  await speed.tap();
  await expect.poll(async () => (await header(page)).speed).toBe(2000);
});

test("還沒開放的規則（採集）顯示「原型尚未開放」，不當成錯誤", async ({ page }) => {
  await start(page);
  await selectFarmers(page);
  const f = (await farmers(page))[0];
  const nodes = await page.evaluate(() => window.__proto?.game?.nodes() ?? []);
  expect(nodes.length).toBeGreaterThan(0);
  // The nearest resource node with no unit standing on or next to it (a tap there must hit the node).
  const all = await units(page);
  const clear = (n: { cx: number; cy: number }) => all.every((u) => Math.hypot(u.cx - n.cx, u.cy - n.cy) >= 2);
  const near = nodes
    .filter((n) => n.amount > 0 && clear(n))
    .sort((a, b) => Math.hypot(a.cx - f.cx, a.cy - f.cy) - Math.hypot(b.cx - f.cx, b.cy - f.cy))[0];
  await page.evaluate(([x, y]) => window.__proto?.game?.centerOn(x, y), [near.cx, near.cy] as const);
  await tap(page, await toScreen(page, { x: near.cx, y: near.cy }));
  await expect.poll(() => lastSent(page)).toMatchObject({ c: "gather", node: near.id });
  await expect(page.getByRole("status").filter({ hasText: "原型尚未開放" })).toBeVisible();
});

test("轉成直向或切到背景會自動暫停；回來後維持暫停，要自己按繼續", async ({ page }) => {
  await start(page);
  const landscape = page.viewportSize() ?? { width: 814, height: 380 };
  await page.setViewportSize({ width: landscape.height, height: landscape.width });
  await expect.poll(async () => (await header(page)).paused).toBe(true);
  await page.setViewportSize(landscape);
  await page.waitForTimeout(500);
  expect((await header(page)).paused).toBe(true);
  await expect(page.getByRole("button", { name: "繼續" })).toBeVisible();

  await page.getByRole("button", { name: "繼續" }).tap();
  await expect.poll(async () => (await header(page)).paused).toBe(false);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(async () => (await header(page)).paused).toBe(true);
});

test("確定性檢查：瀏覽器算出的一局和 CI 的無畫面執行完全相同；檢查時不能量測", async ({ page }, info) => {
  test.setTimeout(240_000);
  await start(page);
  await page.getByRole("button", { name: "量測", exact: true }).tap();
  const check = page.getByRole("button", { name: "確定性檢查" });
  const measure = page.getByRole("button", { name: "開始量測" });
  await expect(check).toBeEnabled();
  await check.tap();
  await expect(measure).toBeDisabled();
  await expect(page.getByText("確定性檢查進行中，完成後才能量測")).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__proto?.game?.lastCheck() as { same: boolean | null } | null), { timeout: 200_000 }).not.toBeNull();
  const r = (await page.evaluate(() => window.__proto?.game?.lastCheck())) as { same: boolean | null; compared: number; ticks: number; finalHash: string };
  info.annotations.push({ type: "determinism", description: JSON.stringify(r) });
  expect(r.same, JSON.stringify(r)).toBe(true);
  expect(r.compared).toBeGreaterThan(100);
  await expect(page.getByText("確定性：與 CI 相同 ✓")).toBeVisible();
  await expect(measure).toBeEnabled();
  await shot(page, info, "determinism-same");
});
