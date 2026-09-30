// The page on core's real simulation Worker (standard scenario), in WebKit and Chromium at
// iPhone landscape size: the game runs, units follow orders, pause and speed, orders given
// while paused, rejected commands, automatic pause, and the determinism check against the
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

/** Pause with the 暫停 button (farmers go to work on their own, so they would walk away from the taps). */
async function pause(page: Page): Promise<void> {
  await page.getByRole("button", { name: "暫停" }).tap();
  await expect.poll(async () => (await header(page)).paused).toBe(true);
}

/** Double-tap a farmer: selects every farmer on screen. Call while paused. */
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
  await pause(page);
  const ids = await selectFarmers(page);
  const target = await groundNearFarmers(page, 6, -3);
  const before = await distanceTo(page, target);
  await tap(page, await toScreen(page, target));
  await expect.poll(() => lastSent(page)).toMatchObject({ c: "move", u: ids, x: target.x, y: target.y });
  await page.getByRole("button", { name: "繼續" }).tap();
  await expect.poll(() => distanceTo(page, target), { timeout: 15_000 }).toBeLessThan(before - 5);
});

test("暫停時下指令：模擬停住、指令照收，按繼續後才執行", async ({ page }, info) => {
  await start(page, "?test=1&tps=60");
  await pause(page);
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

// User report 2026-09-30 (iPhone, 8a0b002): 「點果樹跟金礦沒反應耶」「有阿我有先選」.
// Farmers the economy sent to the berries and the gold mine stand next to them; a tap on
// the resource used to re-select the nearest farmer instead of ordering gather.
test("選了農民點野果、點金礦（旁邊有農民在採）→ 送出採集，農民真的去採", async ({ page }, info) => {
  test.setTimeout(120_000);
  await start(page, "?test=1&tps=60");
  const nodes = await page.evaluate(() => window.__proto?.game?.nodes() ?? []);
  const berries = nodes.filter((n) => n.kind === 2 && n.amount > 0);
  const gold = nodes.filter((n) => n.kind === 1 && n.amount > 0);
  expect(berries.length).toBeGreaterThan(0);
  expect(gold.length).toBeGreaterThan(0);
  const workingNextTo = async (list: typeof nodes) =>
    (await farmers(page)).some((f) => list.some((n) => Math.hypot(f.fx - (n.cx + 0.5), f.fy - (n.cy + 0.5)) < 1.6));
  // The economy sends farmers to the berries (the first food) on its own.
  await expect.poll(() => workingNextTo(berries), { timeout: 30_000 }).toBe(true);
  await pause(page);
  const ids = (await farmers(page)).map((f) => f.id).sort((a, b) => a - b);
  await page.evaluate((u) => window.__proto?.game?.select(u), ids);

  // Berries zoomed out to 0.6, where the old 22 pt pick radius (36.7 px, 1.15 cells) reaches a
  // farmer working the next cell: the failing case, checked below. Gold at the default zoom.
  for (const [name, list, scale] of [
    ["berries", berries, 0.6],
    ["gold", gold, 1],
  ] as const) {
    // The resource cell with a farmer closest to it: the case that used to re-select the farmer.
    const all = await farmers(page);
    const nearest = (n: (typeof list)[number]) => Math.min(...all.map((f) => Math.hypot(f.fx - (n.cx + 0.5), f.fy - (n.cy + 0.5))));
    const target = [...list].sort((a, b) => nearest(a) - nearest(b))[0];
    if (name === "berries") {
      expect(nearest(target), "a farmer is inside the old pick radius, so the old rule would have re-selected it").toBeLessThan(22 / scale / 32);
    }
    await page.evaluate(([x, y, z]) => window.__proto?.game?.centerOn(x, y, z), [target.cx, target.cy, scale] as const);
    await tap(page, await toScreen(page, { x: target.cx, y: target.cy }));
    await expect.poll(() => lastSent(page), { message: name }).toMatchObject({ c: "gather", u: ids, node: target.id });
    expect(await selection(page), `${name}: the selection stays the farmers`).toEqual({ units: ids, building: null });
    await shot(page, info, `gather-${name}`);
    await page.getByRole("button", { name: "繼續" }).tap();
    // Every selected farmer takes the order (the simulation may spread them over the
    // resource's cells), and they get to work on it.
    const cells = new Set(list.map((n) => n.id));
    await expect
      .poll(async () => (await farmers(page)).filter((f) => f.order === 4 && cells.has(f.target)).length, { timeout: 30_000, message: name })
      .toBe(ids.length);
    await expect
      .poll(async () => (await farmers(page)).some((f) => cells.has(f.target) && f.action === 3), { timeout: 30_000, message: name })
      .toBe(true);
    await pause(page);
  }
});

test("沒選農民時點資源點：顯示它是什麼、剩多少，並提示先選農民", async ({ page }) => {
  await start(page);
  const berry = (await page.evaluate(() => window.__proto?.game?.nodes() ?? [])).find((n) => n.kind === 2 && n.amount > 0);
  if (berry === undefined) throw new Error("no berries");
  await pause(page);
  await page.evaluate(([x, y]) => window.__proto?.game?.centerOn(x, y), [berry.cx, berry.cy] as const);
  await tap(page, await toScreen(page, { x: berry.cx, y: berry.cy }));
  await expect(page.getByRole("status").filter({ hasText: /野果（糧）剩 \d+：先選農民再點它，就會去採/ })).toBeVisible();
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

test("模擬還沒做的指令（投降）顯示「原型尚未開放」；已經有的規則被拒時說明原因", async ({ page }) => {
  await start(page);
  await page.evaluate(() => window.__proto?.game?.send({ c: "surrender" }));
  await expect(page.getByRole("status").filter({ hasText: "原型尚未開放" })).toBeVisible();
  // Farmers tapping their own undamaged main city: repair is a real rule, so it says why.
  await pause(page);
  const ids = await selectFarmers(page);
  const me = await page.evaluate(() => window.__proto?.game?.me() ?? 0);
  const city = (await page.evaluate(() => window.__proto?.game?.buildings() ?? [])).find((b) => b.owner === me && b.type === 0);
  if (city === undefined) throw new Error("no main city");
  await tap(page, await toScreen(page, { x: city.cx + Math.floor(city.size / 2), y: city.cy + Math.floor(city.size / 2) }));
  await expect.poll(() => lastSent(page)).toMatchObject({ c: "repair", u: ids, building: city.id });
  // Orders given while paused run on the next tick, so the answer comes after 繼續.
  await page.getByRole("button", { name: "繼續" }).tap();
  await expect(page.getByRole("status").filter({ hasText: "不需要農民" })).toBeVisible();
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
