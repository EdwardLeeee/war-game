// The page on core's real simulation Worker (standard scenario), in WebKit and Chromium at
// iPhone landscape size: the game runs, units follow orders, pause and speed, orders given
// while paused, rejected commands, automatic pause, and the determinism check against the
// hashes CI computed with the headless runner (dist/expected-hashes.json).

import { expect, type Page, test } from "@playwright/test";
import { hintTownOf, openLab, shot, watchErrors } from "./helpers.ts";
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

const header = (page: Page) => page.evaluate(() => window.__proto?.game?.header() ?? { tick: -1, paused: false, speed: 0, scenario: -1 });
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
  await page.getByRole("button", { name: "暫停", exact: true }).tap();
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

test("開局：模擬在跑，自己有 5 名村民", async ({ page }, info) => {
  await start(page);
  const t0 = (await header(page)).tick;
  await expect.poll(async () => (await header(page)).tick).toBeGreaterThan(t0 + 5);
  expect((await farmers(page)).length).toBe(5);
  await shot(page, info, "sim-start");
});

test("選村民 → 點地面前進：村民往那裡走", async ({ page }) => {
  await start(page, "?test=1&tps=60");
  await pause(page);
  const ids = await selectFarmers(page);
  const target = await groundNearFarmers(page, 6, -3);
  const before = await distanceTo(page, target);
  await tap(page, await toScreen(page, target));
  await expect.poll(() => lastSent(page)).toMatchObject({ c: "move", u: ids, x: target.x, y: target.y });
  await page.getByRole("button", { name: "繼續", exact: true }).tap();
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

  await page.getByRole("button", { name: "繼續", exact: true }).tap();
  await expect(page.getByText("暫停中：仍可下指令")).toBeHidden();
  await expect.poll(() => distanceTo(page, target), { timeout: 15_000 }).toBeLessThan(before - 5);
});

// User report 2026-09-30 (iPhone, 8a0b002): 「點果樹跟金礦沒反應耶」「有阿我有先選」.
// Farmers the economy sent to the berries and the gold mine stand next to them; a tap on
// the resource used to re-select the nearest farmer instead of ordering gather.
test("選了村民點野果、點金礦（旁邊有村民在採）→ 送出採集，村民真的去採", async ({ page }, info) => {
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

  // The failing case on the berries: a farmer inside the old pick radius (HIT_RADIUS_PT, 22 pt)
  // of the tapped cell, but not right under the finger (UNIT_CORE_HIT_PT, 12 pt, where the
  // farmer is meant). The zoom puts the nearest farmer halfway between the two, from where it
  // stands (paused); a fixed zoom made the case depend on that (run 37214078363: 1.22 cells,
  // over the 1.15 that 0.6 gave). Gold at the default zoom.
  for (const [name, list] of [
    ["berries", berries],
    ["gold", gold],
  ] as const) {
    // The resource cell with a farmer closest to it: the case that used to re-select the farmer.
    const all = await farmers(page);
    const nearest = (n: (typeof list)[number]) => Math.min(...all.map((f) => Math.hypot(f.fx - (n.cx + 0.5), f.fy - (n.cy + 0.5))));
    const target = [...list].sort((a, b) => nearest(a) - nearest(b))[0];
    const d = nearest(target);
    // A cell is 32 world px; the radii are screen pt, so (22 + 12) / 2 pt is d cells at this zoom.
    const scale = name === "berries" ? 17 / 32 / d : 1;
    await page.evaluate(([x, y, z]) => window.__proto?.game?.centerOn(x, y, z), [target.cx, target.cy, scale] as const);
    if (name === "berries") {
      const actual = await page.evaluate(() => window.__proto?.game?.camera().scale ?? 0);
      const cells = (pt: number) => pt / actual / 32;
      expect(d, "a farmer is inside the old pick radius, so the old rule would have re-selected it").toBeLessThan(cells(22));
      expect(d, "and not right under the finger, so the new rule gathers").toBeGreaterThan(cells(12));
    }
    await tap(page, await toScreen(page, { x: target.cx, y: target.cy }));
    await expect.poll(() => lastSent(page), { message: name }).toMatchObject({ c: "gather", u: ids, node: target.id });
    expect(await selection(page), `${name}: the selection stays the farmers`).toEqual({ units: ids, building: null });
    await shot(page, info, `gather-${name}`);
    await page.getByRole("button", { name: "繼續", exact: true }).tap();
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

test("沒選村民時點資源點：顯示它是什麼、剩多少，並提示可以在下面派村民", async ({ page }) => {
  await start(page);
  const berry = (await page.evaluate(() => window.__proto?.game?.nodes() ?? [])).find((n) => n.kind === 2 && n.amount > 0);
  if (berry === undefined) throw new Error("no berries");
  await pause(page);
  await page.evaluate(([x, y]) => window.__proto?.game?.centerOn(x, y), [berry.cx, berry.cy] as const);
  await tap(page, await toScreen(page, { x: berry.cx, y: berry.cy }));
  await expect(page.getByRole("status").filter({ hasText: /野果（糧）剩 \d+：下面可以派村民過來/ })).toBeVisible();
});

test("點資源派村民（D-061）：沒選東西時點一棵樹，面板寫別處有幾名在採木；按 ½ 送出親手派的 gather，只派採木的村民、照比例、近的先派，他們真的過去", async ({ page }, info) => {
  test.setTimeout(120_000);
  await start(page, "?test=1&tps=60");
  const nodes = await page.evaluate(() => window.__proto?.game?.nodes() ?? []);
  const kindOf = new Map(nodes.map((n) => [n.id, n.kind]));
  // The economy sends some villagers to the trees on its own (no farms yet: every target is a node).
  const onWood = async () => (await farmers(page)).filter((f) => f.order === 4 && kindOf.get(f.target) === 0);
  await expect.poll(async () => (await onWood()).length, { timeout: 60_000 }).toBeGreaterThanOrEqual(2);
  await pause(page);
  await page.evaluate(() => window.__proto?.game?.select([]));
  const cutters = await onWood();
  const mid = { x: cutters.reduce((s, f) => s + f.fx, 0) / cutters.length, y: cutters.reduce((s, f) => s + f.fy, 0) / cutters.length };
  // A tree nobody works, near them, and a tap on it that picks the tree (not a villager beside it).
  const free = nodes
    .filter((n) => n.kind === 0 && n.amount > 0 && !cutters.some((f) => f.target === n.id))
    .sort((a, b) => Math.hypot(a.cx - mid.x, a.cy - mid.y) - Math.hypot(b.cx - mid.x, b.cy - mid.y));
  let tree: (typeof nodes)[number] | null = null;
  for (const n of free.slice(0, 30)) {
    await page.evaluate(([x, y]) => window.__proto?.game?.centerOn(x, y + 2), [n.cx, n.cy] as const);
    const at = await toScreen(page, { x: n.cx, y: n.cy });
    if ((await page.evaluate(([x, y]) => window.__proto?.game?.pickAt(x, y) ?? null, [at.x, at.y] as const)) === "node") {
      tree = n;
      break;
    }
  }
  if (tree === null) throw new Error("no free tree to tap");
  const t = tree;
  await tap(page, await toScreen(page, { x: t.cx, y: t.cy }));
  const panel = page.locator(".sel-info");
  await expect(panel.locator(".sel-head")).toContainText("樹");
  const n = cutters.length;
  await expect(panel.locator(".dispatch-whom")).toHaveText(`派採木的村民過來（別處有 ${n} 名）`);
  const half = Math.max(1, Math.floor(n / 2 + 0.5));
  const quarter = Math.max(1, Math.floor(n / 4 + 0.5));
  await expect(panel.locator(".dispatch-shares button")).toHaveText([`¼（${quarter} 名）`, `½（${half} 名）`, `全部（${n} 名）`]);
  await shot(page, info, "dispatch-panel");
  await panel.getByRole("button", { name: `派 ½ 村民過來：${half} 名` }).tap();
  // The nearest of those cutting wood elsewhere, as the player's own gather.
  const nearest = [...cutters]
    .sort((a, b) => Math.hypot(a.fx - (t.cx + 0.5), a.fy - (t.cy + 0.5)) - Math.hypot(b.fx - (t.cx + 0.5), b.fy - (t.cy + 0.5)) || a.id - b.id)
    .slice(0, half)
    .map((f) => f.id)
    .sort((a, b) => a - b);
  await expect.poll(() => lastSent(page)).toMatchObject({ c: "gather", u: nearest, node: t.id });
  await expect(page.getByRole("status").filter({ hasText: `派 ${half} 名村民去採木` })).toBeVisible();
  await page.getByRole("button", { name: "繼續", exact: true }).tap();
  await expect.poll(async () => (await farmers(page)).filter((f) => nearest.includes(f.id)).every((f) => f.target === t.id), { timeout: 15_000 }).toBe(true);
});

test("介面：資源列是模擬的數字；選主城 → 訓練村民 → 佇列顯示 → 村民出生、人口增加", async ({ page }, info) => {
  await start(page, "?test=1&tps=60");
  await pause(page);
  const h = await page.evaluate(() => window.__proto?.game?.header());
  expect(h).toBeDefined();
  await expect(page.locator(".res-bar")).toContainText(/糧 \d+　木 \d+　金 \d+　晶 \d+　人口 \d+\/\d+/);
  const me = await page.evaluate(() => window.__proto?.game?.me() ?? 0);
  const city = (await page.evaluate(() => window.__proto?.game?.buildings() ?? [])).find((b) => b.owner === me && b.type === 0);
  if (city === undefined) throw new Error("no main city");
  const centre = { x: city.cx + Math.floor(city.size / 2), y: city.cy + Math.floor(city.size / 2) };
  await page.evaluate(([x, y]) => window.__proto?.game?.centerOn(x, y), [centre.x, centre.y] as const);
  await tap(page, await toScreen(page, centre));
  await expect(page.locator(".sel-info")).toContainText("主城");
  const before = (await farmers(page)).length;
  await page.getByRole("button", { name: /^訓練村民/ }).tap();
  await expect.poll(() => lastSent(page)).toMatchObject({ c: "train", building: city.id, type: 0, n: 1 });
  await page.getByRole("button", { name: "繼續", exact: true }).tap();
  await expect(page.getByRole("button", { name: /取消訓練第 1 個：村民/ })).toBeVisible();
  await shot(page, info, "train-farmer");
  await expect.poll(async () => (await farmers(page)).length, { timeout: 30_000 }).toBe(before + 1);
});

test("介面：選村民 → 建造 → 民居 → 找到能蓋的位置 → ✓ → 工地出現", async ({ page }, info) => {
  await start(page, "?test=1&tps=60");
  await pause(page);
  const ids = await selectFarmers(page);
  await page.getByRole("button", { name: "建造" }).tap();
  await page.getByRole("button", { name: /^民居/ }).tap();
  // Try open cells around the farmers until the preview turns green.
  let placed: { cellX: number; cellY: number } | null = null;
  for (const [dx, dy] of [[4, -3], [5, -2], [3, -4], [6, -3], [4, -5], [7, -1]]) {
    const cell = await groundNearFarmers(page, dx, dy);
    await tap(page, await toScreen(page, cell));
    const p = await page.evaluate(() => window.__proto?.game?.placement());
    if (p?.valid === true) {
      placed = p;
      break;
    }
  }
  expect(placed, "a green spot near the farmers").not.toBeNull();
  await shot(page, info, "place-house");
  await page.getByRole("button", { name: "確定蓋在這裡" }).tap();
  await expect.poll(() => lastSent(page)).toMatchObject({ c: "build", u: ids, type: 1, x: placed?.cellX, y: placed?.cellY });
  await page.getByRole("button", { name: "繼續", exact: true }).tap();
  const me = await page.evaluate(() => window.__proto?.game?.me() ?? 0);
  await expect
    .poll(async () => (await page.evaluate(() => window.__proto?.game?.buildings() ?? [])).some((b) => b.owner === me && b.type === 1 && b.cx === placed?.cellX && b.cy === placed?.cellY), { timeout: 20_000 })
    .toBe(true);
});

test("速度：正常 → 快 → 慢 → 正常（每秒 30、40、20 tick，D-024）", async ({ page }) => {
  await start(page);
  await expect.poll(async () => (await header(page)).speed).toBe(3000);
  const speed = page.getByRole("button", { name: /^速度/ });
  await expect(speed).toHaveText("速度 正常");
  await speed.tap();
  await expect(speed).toHaveText("速度 快");
  await expect.poll(async () => (await header(page)).speed).toBe(4000);
  await speed.tap();
  await expect(speed).toHaveText("速度 慢");
  await expect.poll(async () => (await header(page)).speed).toBe(2000);
  await speed.tap();
  await expect.poll(async () => (await header(page)).speed).toBe(3000);
});

// Which commands the simulation has not built yet changes as core's PRs land (surrender
// ends the game once PR-4 is in), so "原型尚未開放" is covered by the unit tests
// (test/messages.test.ts) and this test only uses a rule that exists.
test("已經有的規則被拒時說明原因：主城連排 5 個村民，第 5 個糧食不夠", async ({ page }) => {
  await start(page);
  await pause(page);
  const me = await page.evaluate(() => window.__proto?.game?.me() ?? 0);
  const city = (await page.evaluate(() => window.__proto?.game?.buildings() ?? [])).find((b) => b.owner === me && b.type === 0);
  if (city === undefined) throw new Error("no main city");
  const c = { x: city.cx + Math.floor(city.size / 2), y: city.cy + Math.floor(city.size / 2) };
  await tap(page, await toScreen(page, c));
  await expect(page.locator(".sel-info")).toContainText("主城");
  // Standard start: 200 food, a farmer costs 50. Orders given while paused all run on the next tick.
  for (let i = 0; i < 5; i++) await page.getByRole("button", { name: /^訓練村民/ }).tap();
  await page.getByRole("button", { name: "繼續", exact: true }).tap();
  await expect(page.getByRole("status").filter({ hasText: "資源不夠" })).toBeVisible();
});

test("選了村民時點自己完好的建築是選取它（不是叫村民去修）；✕ 取消選取", async ({ page }) => {
  await start(page);
  await pause(page);
  const ids = await selectFarmers(page);
  expect(ids.length).toBeGreaterThan(0);
  const me = await page.evaluate(() => window.__proto?.game?.me() ?? 0);
  const city = (await page.evaluate(() => window.__proto?.game?.buildings() ?? [])).find((b) => b.owner === me && b.type === 0);
  if (city === undefined) throw new Error("no main city");
  await tap(page, await toScreen(page, { x: city.cx + Math.floor(city.size / 2), y: city.cy + Math.floor(city.size / 2) }));
  await expect.poll(() => selection(page)).toEqual({ units: [], building: city.id });
  // The command area is the main city's now.
  await expect(page.getByRole("button", { name: /^訓練村民/ })).toBeVisible();
  await page.getByRole("button", { name: "取消選取" }).tap();
  await expect.poll(() => selection(page)).toEqual({ units: [], building: null });
});

test("轉成直向或切到背景會自動暫停；回來後維持暫停，要自己按繼續", async ({ page }) => {
  await start(page);
  const landscape = page.viewportSize() ?? { width: 814, height: 380 };
  await page.setViewportSize({ width: landscape.height, height: landscape.width });
  await expect.poll(async () => (await header(page)).paused).toBe(true);
  await page.setViewportSize(landscape);
  await page.waitForTimeout(500);
  expect((await header(page)).paused).toBe(true);
  await expect(page.getByRole("button", { name: "繼續", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "繼續", exact: true }).tap();
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
  await openLab(page);
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

test("選單 → 投降 → 勝負畫面顯示失敗（投降）→ 重來開新局", async ({ page }, info) => {
  await start(page);
  await page.getByRole("button", { name: "選單" }).tap();
  await page.getByRole("button", { name: "投降" }).tap();
  await page.getByRole("dialog").getByRole("button", { name: "投降" }).tap();
  const result = page.getByRole("dialog", { name: "失敗" });
  await expect(result).toBeVisible();
  await expect(result).toContainText("投降");
  await shot(page, info, "surrender-result");
  await result.getByRole("button", { name: "重來" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true);
  await expect(page.getByRole("dialog")).toBeHidden();
  expect((await header(page)).tick).toBeLessThan(200);
});

test("開局提示：真的地圖上，提示指向離主城最近的小鎮，大城比較近也一樣（不管地圖上有幾座、編號是多少）；按知道了，模擬開始跑（D-044）", async ({ page }, info) => {
  await start(page, "?test=1&hint=1");
  const hint = page.getByRole("dialog", { name: "魔晶從城鎮來" });
  await expect(hint).toBeVisible();
  const town = await hintTownOf(page);
  expect(town.size, "the real map has small towns").toBe(0);
  await expect(hint).toContainText(/離你的主城最近的小鎮在主城的.{1,2}方，約 \d+ 格/);
  expect(await page.evaluate(() => window.__proto?.game?.townHint())).toEqual({ town: town.id, open: true, flashing: true });
  await shot(page, info, "town-hint-real-map");
  const tick = (await header(page)).tick;
  await hint.getByRole("button", { name: "知道了" }).tap();
  await expect(hint).toBeHidden();
  await expect.poll(async () => (await header(page)).tick, { timeout: 10_000 }).toBeGreaterThan(tick);
  expect(await page.evaluate(() => window.__proto?.game?.townHint())).toEqual({ town: town.id, open: false, flashing: true });
});

test("量測：開一局 perf 場景（所有系統都開著），暖機 5 秒量 30 秒，結果框寫明場景", async ({ page }, info) => {
  test.setTimeout(150_000);
  await start(page);
  await openLab(page);
  await page.getByRole("button", { name: "開始量測" }).tap();
  // A new game of the perf scenario (Scenario.Perf = 2) that measures itself.
  await page.waitForFunction(() => window.__proto?.ready === true && window.__proto.game?.header().scenario === 2);
  await expect.poll(() => page.evaluate(() => window.__proto?.game?.labPhase())).toMatch(/warmup|measuring/);
  await expect(page.getByRole("button", { name: "確定性檢查" })).toBeDisabled();
  await expect(page.locator(".lab-result")).toContainText("場景：perf（所有系統都開著）", { timeout: 90_000 });
  // Measured at the speed the player plays at (D-024: 正常 is 30 ticks per second).
  await expect(page.locator(".lab-result")).toContainText("tick 速度：每秒 30 tick（正常）");
  // The texture limits for the sprite atlas (client/docs/sprite-atlas.md section 8).
  await expect(page.locator(".lab-result")).toContainText(/最大貼圖 \d+、一次繪製 \d+ 張、ASTC (有|沒有)/);
  // D-030: the mean fps and the stalls, which the median hides.
  await expect(page.locator(".lab-result")).toContainText(/平均 fps：[\d.]+/);
  await expect(page.locator(".lab-result")).toContainText(/停頓（一張畫面超過 50 ms）：\d+ 次，共 [\d.]+ 秒；最長的一張 [\d.]+ ms/);
  await shot(page, info, "perf-measure");
});

// --- 點存放建築派村民 (D-066) ------------------------------------------------------------

type Building = { id: number; owner: number; type: number; cx: number; cy: number; size: number; progress: number };
/** Distance from a point (cells) to a building's footprint, as src/game/depot.ts measures it. */
const toFootprint = (p: { x: number; y: number }, b: Building) =>
  Math.hypot(Math.max(b.cx - p.x, 0, p.x - (b.cx + b.size)), Math.max(b.cy - p.y, 0, p.y - (b.cy + b.size)));
const ownBuildings = async (page: Page): Promise<Building[]> => {
  const me = await page.evaluate(() => window.__proto?.game?.me() ?? 0);
  return (await page.evaluate(() => window.__proto?.game?.buildings() ?? [])).filter((b) => b.owner === me);
};

/** Tap one of our buildings where the tap picks the building (not a villager beside or on it); its panel opens. */
async function tapBuilding(page: Page, b: Building): Promise<void> {
  await page.evaluate(([x, y]) => window.__proto?.game?.centerOn(x, y), [b.cx + b.size / 2, b.cy + b.size / 2] as const);
  for (let y = b.cy; y < b.cy + b.size; y++) {
    for (let x = b.cx; x < b.cx + b.size; x++) {
      const at = await toScreen(page, { x, y });
      if ((await page.evaluate(([sx, sy]) => window.__proto?.game?.pickAt(sx, sy) ?? null, [at.x, at.y] as const)) !== "building") continue;
      await tap(page, at);
      await expect.poll(() => selection(page)).toEqual({ units: [], building: b.id });
      return;
    }
  }
  throw new Error(`no cell of building ${b.id} to tap`);
}

/** Whom ＋ should send (src/game/depot.ts): idle first, then those gathering another resource (not the vein), nearest to the building. */
function expectedPick(list: Awaited<ReturnType<typeof farmers>>, kindOf: Map<number, number>, b: Building, kind: number): number | null {
  const near = (a: { fx: number; fy: number; id: number }, c: { fx: number; fy: number; id: number }) => toFootprint({ x: a.fx, y: a.fy }, b) - toFootprint({ x: c.fx, y: c.fy }, b) || a.id - c.id;
  const free = list.filter((f) => f.order !== 5 && f.order !== 6);
  const idle = free.filter((f) => f.order === 0).sort(near);
  if (idle.length > 0) return idle[0].id;
  const others = free.filter((f) => f.order === 4 && kindOf.has(f.target) && kindOf.get(f.target) !== kind && kindOf.get(f.target) !== 3).sort(near);
  return others[0]?.id ?? null;
}

/** The node ＋ should send to: the nearest of this kind within 10 cells of the building (ties: lower id). */
function expectedNode(nodes: { id: number; kind: number; cx: number; cy: number; amount: number }[], b: Building, kind: number) {
  return (
    nodes
      .filter((n) => n.kind === kind && n.amount > 0)
      .map((n) => ({ n, d: toFootprint({ x: n.cx + 0.5, y: n.cy + 0.5 }, b) }))
      .filter((e) => e.d <= 10)
      .sort((a, c) => a.d - c.d || a.n.id - c.n.id)[0]?.n ?? null
  );
}

test("點主城派村民（D-066）：主城寫糧、木、金各有幾名在採；木的＋派閒置的、沒有就派採別種資源、離主城最近的一名，送出親手派的 gather 去最近的樹；－讓採木最遠的一名放下工作（release），不再是親手派的", async ({ page }, info) => {
  test.setTimeout(120_000);
  await start(page, "?test=1&tps=60");
  await expect.poll(async () => (await farmers(page)).filter((f) => f.order === 4).length, { timeout: 60_000 }).toBeGreaterThanOrEqual(3);
  await pause(page);
  await page.evaluate(() => window.__proto?.game?.select([]));
  const city = (await ownBuildings(page)).find((b) => b.type === 0);
  if (city === undefined) throw new Error("no main city");
  const nodes = await page.evaluate(() => window.__proto?.game?.nodes() ?? []);
  const kindOf = new Map(nodes.map((n) => [n.id, n.kind]));
  const list = await farmers(page);
  // At the start the main city is our only depot (no farms yet): everyone gathering food, wood or gold counts here.
  const on = (kind: number) => list.filter((f) => f.order === 4 && kindOf.get(f.target) === kind).length;
  await tapBuilding(page, city);
  const panel = page.locator(".sel-info");
  await expect(panel.locator(".depot-caption")).toHaveText("附近在採的村民");
  await expect(panel.locator(".depot-count")).toHaveText([`糧 ${on(2)} 名`, `木 ${on(0)} 名`, `金 ${on(1)} 名`]);
  await shot(page, info, "depot-city");
  const who = await expectedPick(list, kindOf, city, 0);
  const tree = expectedNode(nodes, city, 0);
  expect(who, "someone to send").not.toBeNull();
  await panel.getByRole("button", { name: "多派 1 名村民採木" }).tap();
  if (tree === null) {
    await expect(page.getByRole("status").filter({ hasText: "附近沒有樹" })).toBeVisible();
    return;
  }
  await expect.poll(() => lastSent(page)).toMatchObject({ c: "gather", u: [who], node: tree.id });
  await expect(page.getByRole("status").filter({ hasText: "派 1 名村民去採木" })).toBeVisible();
  // The player's own gather: off to that tree, and the economy ratio leaves it there (HandPicked, D-050).
  await page.getByRole("button", { name: "繼續", exact: true }).tap();
  await expect.poll(async () => (await farmers(page)).find((f) => f.id === who), { timeout: 15_000 }).toMatchObject({ target: tree.id, handPicked: true });
  // －: of those on wood (all of them bring it to the city), the farthest from it lets go.
  await pause(page);
  const now = await farmers(page);
  const nodesNow = await page.evaluate(() => window.__proto?.game?.nodes() ?? []);
  const kindNow = new Map(nodesNow.map((n) => [n.id, n.kind]));
  const far = now
    .filter((f) => f.order === 4 && kindNow.get(f.target) === 0)
    .sort((a, c) => toFootprint({ x: c.fx, y: c.fy }, city) - toFootprint({ x: a.fx, y: a.fy }, city) || c.id - a.id)[0];
  await expect(panel.locator(".depot-count").filter({ hasText: "木" })).toHaveText(/木 [1-9]\d* 名/);
  await panel.getByRole("button", { name: "少派 1 名村民採木" }).tap();
  await expect.poll(() => lastSent(page)).toMatchObject({ c: "release", u: [far.id] });
  await expect(page.getByRole("status").filter({ hasText: "1 名採木的村民放下工作，交給經濟分配" })).toBeVisible();
  await page.getByRole("button", { name: "繼續", exact: true }).tap();
  // Back to the economy: no longer the player's own (the ratio may send it anywhere, wood included).
  await expect.poll(async () => (await farmers(page)).find((f) => f.id === far.id)?.handPicked, { timeout: 15_000 }).toBe(false);
});

test("點伐木場、糧倉派村民（D-066）：寫附近有幾名在採；每名村民只算在他送回的那一棟；伐木場的＋派去它旁邊的樹，糧倉沒有空田時去野果或提示先蓋田", async ({ page }, info) => {
  test.setTimeout(180_000);
  await start(page, "?test=1&tps=60");
  await expect.poll(async () => (await farmers(page)).filter((f) => f.order === 4).length, { timeout: 60_000 }).toBeGreaterThanOrEqual(3);
  const city = (await ownBuildings(page)).find((b) => b.type === 0);
  if (city === undefined) throw new Error("no main city");
  const nodes0 = await page.evaluate(() => window.__proto?.game?.nodes() ?? []);
  // A lumber camp by the trees nearest the main city, a granary by the city; the nearest villagers build them.
  const nearTree = nodes0.filter((n) => n.kind === 0 && n.amount > 0).sort((a, c) => toFootprint({ x: a.cx, y: a.cy }, city) - toFootprint({ x: c.cx, y: c.cy }, city))[0];
  const campAt = await page.evaluate(([x, y]) => window.__proto?.game?.buildSpotNear(2, x, y) ?? null, [nearTree.cx, nearTree.cy] as const);
  const granaryAt = await page.evaluate(([x, y]) => window.__proto?.game?.buildSpotNear(4, x, y) ?? null, [city.cx - 4, city.cy + 1] as const);
  if (campAt === null || granaryAt === null) throw new Error("no spot to build on");
  await page.evaluate(([c, g]) => {
    window.__proto?.game?.send({ c: "build", u: [], type: 2, x: c.x, y: c.y });
    window.__proto?.game?.send({ c: "build", u: [], type: 4, x: g.x, y: g.y });
  }, [campAt, granaryAt] as const);
  const done = async (type: number) => (await ownBuildings(page)).find((b) => b.type === type && b.progress >= 1000);
  await expect.poll(async () => (await done(2)) !== undefined && (await done(4)) !== undefined, { timeout: 120_000 }).toBe(true);
  await pause(page);
  await page.evaluate(() => window.__proto?.game?.select([]));
  const camp = (await done(2)) as Building;
  const granary = (await done(4)) as Building;
  const panel = page.locator(".sel-info");
  const count = async (b: Building, name: string, word: string) => {
    await tapBuilding(page, b);
    // The panel is rebuilt for this building and fills its numbers on the next interface
    // update (10 a second); until then it is the one before (run 37565059980 read the city's).
    await expect(panel.locator(".sel-head")).toContainText(name);
    const cell = panel.locator(".depot-count").filter({ hasText: word });
    await expect(cell).toHaveText(/\d+ 名/);
    return Number(/(\d+) 名/.exec((await cell.textContent()) ?? "")?.[1] ?? -1);
  };
  // Every villager on wood counts at exactly one of the two: the city and the camp add up.
  const nodes = await page.evaluate(() => window.__proto?.game?.nodes() ?? []);
  const kindOf = new Map(nodes.map((n) => [n.id, n.kind]));
  const list = await farmers(page);
  const onWood = list.filter((f) => f.order === 4 && kindOf.get(f.target) === 0).length;
  const atCity = await count(city, "主城", "木");
  const atCamp = await count(camp, "伐木場", "在採木");
  expect(atCity + atCamp, "each villager on wood counted once").toBe(onWood);
  await expect(panel.locator(".depot-count")).toHaveText(`附近有 ${atCamp} 名村民在採木`);
  await shot(page, info, "depot-lumber-camp");
  // ＋ at the camp: the tree nearest the camp.
  const who = expectedPick(list, kindOf, camp, 0);
  const tree = expectedNode(nodes, camp, 0);
  await panel.getByRole("button", { name: "多派 1 名村民採木" }).tap();
  if (who !== null && tree !== null) await expect.poll(() => lastSent(page)).toMatchObject({ c: "gather", u: [who], node: tree.id });
  // The granary: food, no farms yet, so berries within reach or 先蓋農田.
  await tapBuilding(page, granary);
  await expect(panel.locator(".sel-head")).toContainText("糧倉");
  await expect(panel.locator(".depot-count")).toHaveText(/^附近有 \d+ 名村民在採糧$/);
  await shot(page, info, "depot-granary");
  const mark = (await page.evaluate(() => window.__proto?.game?.sent() ?? [])).length;
  await panel.getByRole("button", { name: "多派 1 名村民採糧" }).tap();
  const berries = expectedNode(nodes, granary, 2);
  if (berries === null) await expect(page.getByRole("status").filter({ hasText: "附近沒有空田，先蓋農田" })).toBeVisible();
  else await expect.poll(async () => (await page.evaluate(() => window.__proto?.game?.sent() ?? [])).slice(mark)).toMatchObject([{ c: "gather", node: berries.id }]);
});
