// 游標 (R26 05, design/r26/spec.md 05; ceo 2026-11-21): with a mouse, the battlefield's cursor is what the right button
// would do there now. Each spot: the cursor, then the right button there and the order it sends, side by side (Game.cursorAt
// and Game.order work it out the same way, Game.rightPlan): 攻擊 a sword, 進駐 a gate (only when someone goes in), 採集 an
// axe (a finished field of ours too), a walk the arrow. A mouse held still: an enemy walking in under it turns it into a
// sword (worked out again with a snapshot). Picking a place: the arrow. The CSS: the 32 px picture, then image-set.
import { expect, type Page, test } from "@playwright/test";
import { watchErrors } from "./helpers.ts";

const W = 1366;
const H = 768;
const ME = 0;
const FOE = 1;
const SPEARMAN = 1;
const RANGED = 2;
const FARMER = 0;
const MAIN_CITY = 0;
const HOUSE = 1;
const FARM = 5;

test.use({ viewport: { width: W, height: H }, isMobile: false, hasTouch: false, deviceScaleFactor: 1, reducedMotion: "reduce" });
test.describe.configure({ timeout: 120_000 });

type Order = { c: string; u?: number[]; target?: number };
const orders = (page: Page) => page.evaluate(() => (window.__proto?.game?.sent() ?? []).filter((c) => (c as { auto?: boolean }).auto !== true) as Order[]);
const cursor = (page: Page) => page.evaluate(() => window.__proto?.game?.cursor() ?? null);
const select = (page: Page, ids: number[]) => page.evaluate((u) => window.__proto?.game?.select(u), ids);
const units = (page: Page) => page.evaluate(() => window.__proto?.game?.units() ?? []);
const own = async (page: Page, type: number) => (await units(page)).filter((u) => u.owner === ME && u.type === type).map((u) => u.id);

async function start(page: Page): Promise<void> {
  // 進駐 on (outposts, towers, the main city taking ranged), as mouse-enter.spec.
  await page.goto("./?test=1&mock=1&r7=1&outpost=1&hide=1&tps=20");
  await page.getByRole("button", { name: "開始", exact: true }).click();
  await page.waitForFunction(() => window.__proto?.ready === true && window.__proto.screen === "battle");
  await page.waitForFunction(() => (window.__proto?.game?.header().tick ?? 0) > 5);
  await page.evaluate(() => window.__proto?.game?.pause());
}

/** The camera on cell (cx, cy) and that point on the screen. */
async function lookAt(page: Page, cx: number, cy: number): Promise<{ x: number; y: number }> {
  await page.evaluate(([x, y]) => window.__proto?.game?.centerOn(x, y, 1.2), [cx, cy] as const);
  await page.waitForTimeout(200);
  return page.evaluate(([x, y]) => window.__proto?.game?.cellToScreen(x, y) ?? { x: 0, y: 0 }, [cx, cy] as const);
}

/** The camera on unit `id` and where it is on the screen (a unit is drawn lifted off its cell: its own point). */
async function lookAtUnit(page: Page, id: number): Promise<{ x: number; y: number }> {
  const u = (await units(page)).find((v) => v.id === id);
  if (u === undefined) throw new Error(`no unit ${id}`);
  await lookAt(page, u.fx, u.fy);
  const now = (await units(page)).find((v) => v.id === id);
  if (now === undefined) throw new Error(`no unit ${id}`);
  return { x: now.sx, y: now.sy };
}

/** The mouse to `p`, the cursor there (as worked out in the page), and what the right button there then sends. */
async function cursorThenRight(page: Page, p: { x: number; y: number }, want: string | null): Promise<string[]> {
  await page.mouse.move(p.x, p.y);
  await expect.poll(() => cursor(page), { message: `the cursor at ${p.x},${p.y}` }).toBe(want);
  // The canvas wears it (style.css): the 32 px picture's name in its cursor, or the browser's own.
  const css = await page.evaluate(() => getComputedStyle(document.querySelector("#stage canvas") as HTMLElement).cursor);
  if (want === null) expect(css).toBe("auto");
  else expect(css).toContain(`/cursors/${want}-32.png`);
  const from = (await orders(page)).length;
  await page.mouse.click(p.x, p.y, { button: "right" });
  await expect.poll(async () => (await orders(page)).length, { message: "the right button sent something" }).toBeGreaterThan(from);
  return (await orders(page)).slice(from).map((o) => o.c);
}

// Two tests (one took 26 s here, about 67 s and up to 112 s on CI's slowest): soldiers, then farmers.
test("選了兵，游標＝右鍵在那裡會下的指令：敵人劍＝攻擊、地面箭頭＝走過去、遠程指主城城門＝進駐、只選槍兵指主城箭頭＝走過去", async ({ page }) => {
  const check = watchErrors(page);
  await start(page);
  const soldiers = [...(await own(page, SPEARMAN)), ...(await own(page, RANGED))];
  // An enemy unit: a sword, and the right button attacks it.
  const foe = (await units(page)).find((u) => u.owner === FOE && u.type !== FARMER);
  if (foe === undefined) throw new Error("no enemy soldier");
  await select(page, soldiers);
  let p = await lookAtUnit(page, foe.id);
  expect(await cursorThenRight(page, p, "sword")).toEqual(["attack"]);
  // Open ground next to it: the arrow, a walk there.
  p = await lookAt(page, foe.cx + 8.5, foe.cy + 0.5);
  await expect.poll(() => page.evaluate(([x, y]) => window.__proto?.game?.pickAt(x, y) ?? null, [p.x, p.y] as const)).toBeNull();
  expect(await cursorThenRight(page, p, null)).toEqual(["retreat"]);
  // The main city: spearmen cannot go in (grey): the arrow, a walk there; ranged can: the gate, they go in.
  const city = (await page.evaluate(() => window.__proto?.game?.buildings() ?? [])).find((b) => b.type === MAIN_CITY && b.owner === ME);
  if (city === undefined) throw new Error("no main city");
  await select(page, await own(page, SPEARMAN));
  p = await lookAt(page, city.cx + city.size / 2, city.cy + city.size / 2);
  expect(await cursorThenRight(page, p, null)).toEqual(["retreat"]);
  const ranged = (await own(page, RANGED)).slice(0, 3);
  await select(page, ranged);
  const went = await cursorThenRight(page, p, "gate");
  expect(went.length).toBeGreaterThan(0);
  expect(went).not.toContain("retreat");
  check();
});

test("選了村民，游標＝右鍵在那裡會下的指令：樹斧頭＝採集、蓋好的田斧頭（去種田）、蓋到一半的民居鎚子＝去蓋", async ({ page }) => {
  const check = watchErrors(page);
  await start(page);
  const city = (await page.evaluate(() => window.__proto?.game?.buildings() ?? [])).find((b) => b.type === MAIN_CITY && b.owner === ME);
  if (city === undefined) throw new Error("no main city");
  let p: { x: number; y: number };
  // Farmers: a tree, an axe (gather); our finished field, an axe too (they farm it: the sim's repair there).
  const farmers = (await own(page, FARMER)).slice(0, 2);
  await select(page, farmers);
  const tree = (await page.evaluate(() => window.__proto?.game?.nodes() ?? [])).find((n) => n.kind === 0);
  if (tree === undefined) throw new Error("no tree");
  p = await lookAt(page, tree.cx + 0.5, tree.cy + 0.5);
  expect(await cursorThenRight(page, p, "axe")).toEqual(["gather"]);
  const field = (await page.evaluate(() => window.__proto?.game?.buildings() ?? [])).find((b) => b.type === FARM && b.owner === ME && b.progress >= 1000);
  if (field === undefined) throw new Error("no finished field");
  await select(page, farmers);
  p = await lookAt(page, field.cx + field.size / 2, field.cy + field.size / 2);
  expect(await cursorThenRight(page, p, "axe")).toEqual(["repair"]);
  // A house begun by another farmer (a site): the hammer, and they go to build it.
  const builder = (await own(page, FARMER)).filter((id) => !farmers.includes(id))[0];
  const sites = async () => (await page.evaluate(() => window.__proto?.game?.buildings() ?? [])).filter((b) => b.type === HOUSE && b.owner === ME && b.progress < 1000);
  // The fake world takes orders with its ticks: going while the site is begun.
  await page.keyboard.press("Space");
  await expect.poll(() => page.evaluate(() => window.__proto?.game?.header().paused ?? true)).toBe(false);
  for (const [dx, dy] of [[6, 0], [0, 6], [-6, 0], [0, -6], [6, 6], [-6, 6]]) {
    if ((await sites()).length > 0) break;
    await page.evaluate(([u, x, y, t]) => window.__proto?.game?.send({ c: "build", u: [u], type: t, x, y }), [builder, city.cx + dx, city.cy + dy, HOUSE] as const);
    await page.waitForTimeout(300);
  }
  await expect.poll(async () => (await sites()).length, { message: "a house begun", timeout: 10_000 }).toBeGreaterThan(0);
  await page.evaluate(() => window.__proto?.game?.pause());
  const [site] = await sites();
  await select(page, farmers);
  p = await lookAt(page, site.cx + site.size / 2, site.cy + site.size / 2);
  expect(await cursorThenRight(page, p, "hammer")).toEqual(["repair"]);
  check();
});

test("滑鼠不動：敵人走到滑鼠下，游標跟著變成劍（快照來時重算）；按 Q 選地方時是箭頭", async ({ page }) => {
  const check = watchErrors(page);
  await start(page);
  const soldiers = await own(page, SPEARMAN);
  const foe = (await units(page)).find((u) => u.owner === FOE && u.type !== FARMER);
  if (foe === undefined) throw new Error("no enemy soldier");
  await select(page, soldiers);
  // Open ground in our sight (next to our spearmen: out of it, the enemy put there is not seen), the mouse held still
  // there: the arrow. Where a unit standing on that cell is drawn (as far off the cell's middle as the enemy is off its
  // own).
  const ours = (await units(page)).find((u) => u.id === soldiers[0]);
  if (ours === undefined) throw new Error("no spearman");
  let cell: { x: number; y: number } | null = null;
  let here = { x: 0, y: 0 };
  for (const [dx, dy] of [[3, 0], [-3, 0], [0, 3], [0, -3], [4, 2], [-4, -2]]) {
    const c = { x: ours.cx + dx, y: ours.cy + dy };
    here = await lookAt(page, c.x + 0.5, c.y + 0.5);
    const open = await page.evaluate(([x, y]) => (window.__proto?.game?.pickAt(x, y) ?? null) === null, [here.x, here.y - 12] as const);
    if (open) {
      cell = c;
      break;
    }
  }
  if (cell === null) throw new Error("no open ground by our spearmen");
  const lift = await (async () => {
    const u = (await units(page)).find((v) => v.id === foe.id);
    if (u === undefined) throw new Error("no enemy");
    const c = await page.evaluate(([x, y]) => window.__proto?.game?.cellToScreen(x, y) ?? { x: 0, y: 0 }, [u.fx, u.fy] as const);
    return { x: u.sx - c.x, y: u.sy - c.y };
  })();
  const p = { x: here.x + lift.x, y: here.y + lift.y };
  await page.mouse.move(p.x, p.y);
  await expect.poll(() => cursor(page)).toBeNull();
  // The enemy put under it, the game going (Space: a click on 繼續 would take the mouse off the battlefield): a sword
  // without the mouse moving.
  await page.keyboard.press("Space");
  await expect.poll(() => page.evaluate(() => window.__proto?.game?.header().paused ?? true)).toBe(false);
  const to = cell;
  await page.evaluate(([id, x, y]) => window.__proto?.game?.place([id], [{ x, y }]), [foe.id, to.x, to.y] as const);
  await expect.poll(() => cursor(page)).toBe("sword");
  await page.evaluate(() => window.__proto?.game?.pause());
  // Q: 攻擊 picks a place: the arrow, the enemy under the mouse all the same.
  await page.keyboard.press("q");
  await expect.poll(() => page.evaluate(() => window.__proto?.game?.mode() ?? "")).toBe("advance");
  await page.mouse.move(p.x + 1, p.y);
  await expect.poll(() => cursor(page)).toBeNull();
  await page.keyboard.press("Escape");
  check();
});
