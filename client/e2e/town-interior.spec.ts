// 城內 B (R8-36 B, the user 2026-10-23; art-v6's castle 2) on the fake world with D-100's towns
// (?keep=1): what lives in a town (huts, sheds, a well, a cart) is drawn; left out once a building
// stands on it, and in ruins; never tapped: a tap on its picture is the ground's (with soldiers
// selected, the town is attacked, D-100), a unit standing on it is selected as anywhere; the towns'
// lanes and trampled earth are in the ground's shader. Skipped until art.lock's castles are
// `war-game castle 2` (art-v6), as the sling's test was until art-v5.2.

import { expect, type Page, test } from "@playwright/test";
import { selectForCommands, shot, watchErrors } from "./helpers.ts";
import { tap } from "./touch.ts";

const SPEARMAN = 1;
const HOUSE = 1;
/** ?keep=1's towns: the neutral small town (its keep on its centre cell) and ours. */
const NEUTRAL_TOWN = { id: 0, x: 36, y: 72 };
const OUR_TOWN = 1;

async function start(page: Page, query = ""): Promise<boolean> {
  await page.goto(`./?test=1&mock=1&tps=20&keep=1&art=x3${query}`);
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true, null, { timeout: 60_000 });
  const drawn = await page.waitForFunction(() => (window.__proto?.game?.castle()?.pieces ?? 0) > 0, null, { timeout: 30_000 }).then(() => true, () => false);
  return drawn && (await page.evaluate(() => window.__proto?.game?.decor().length ?? 0)) > 0;
}

const decor = (page: Page) => page.evaluate(() => window.__proto?.game?.decor() ?? []);
const centre = (page: Page, x: number, y: number, scale = 1) => page.evaluate(([x, y, s]) => window.__proto?.game?.centerOn(x, y, s), [x, y, scale] as const);
const sent = (page: Page) => page.evaluate(() => (window.__proto?.game?.sent() ?? []) as Record<string, unknown>[]);
const same = (a: { town: number; cells: [number, number][] }, b: { town: number; cells: [number, number][] }) => a.town === b.town && a.cells[0][0] === b.cells[0][0] && a.cells[0][1] === b.cells[0][1];

async function spearmen(page: Page): Promise<number[]> {
  const me = await page.evaluate(() => window.__proto?.game?.me() ?? 0);
  return (await page.evaluate(() => window.__proto?.game?.units() ?? [])).filter((u) => u.owner === me && u.type === SPEARMAN).map((u) => u.id).sort((a, b) => a - b);
}

test("城內擺設（R8-36 B）：畫出來，小屋的旗子是城鎮擁有者的顏色；蓋了建築的格子上不畫；城鎮變廢墟就改畫燒毀版（R8-39）", async ({ page }, info) => {
  const check = watchErrors(page);
  test.skip(!(await start(page)), "art.lock 的城牆還不是 war-game castle 2（art-v6 之前）");
  const all = await decor(page);
  expect(all.filter((d) => d.town === NEUTRAL_TOWN.id).length).toBe(19);
  expect(all.some((d) => d.shown)).toBe(true);
  await centre(page, 16, 62, 1.2);
  await page.waitForTimeout(500);
  await shot(page, info, "town-interior-ours");
  // A house of ours on a hut's first cell: the hut is left out (the ground there trampled earth).
  const hut = all.find((d) => d.town === OUR_TOWN && d.piece.startsWith("hut") && !d.leftOut);
  if (hut === undefined) throw new Error("no hut in our town");
  const [hx, hy] = hut.cells[0];
  await page.evaluate(([x, y, t]) => window.__proto?.game?.send({ c: "build", u: [], type: t, x, y }), [hx, hy, HOUSE] as const);
  await expect.poll(async () => (await decor(page)).find((d) => same(d, hut))?.leftOut, { timeout: 30_000 }).toBe(true);
  expect((await decor(page)).find((d) => same(d, hut))?.shown).toBe(false);
  // The neutral town in ruins: its pieces burnt (art-v6.3's decor_ruin, R8-39), none of a flag.
  const me = await page.evaluate(() => window.__proto?.game?.me() ?? 0);
  await page.evaluate(([t, by]) => window.__proto?.game?.inject({ k: "town_plundered", town: t, by, food: 0, gold: 0, crystal: 0 }), [NEUTRAL_TOWN.id, me] as const);
  await expect.poll(async () => (await decor(page)).filter((d) => d.town === NEUTRAL_TOWN.id).every((d) => d.burnt && !d.leftOut), { timeout: 30_000 }).toBe(true);
  expect((await decor(page)).filter((d) => d.town === NEUTRAL_TOWN.id && d.shown).length).toBeGreaterThan(0);
  await centre(page, NEUTRAL_TOWN.x, NEUTRAL_TOWN.y, 1.2);
  await page.waitForTimeout(500);
  await shot(page, info, "town-interior-ruins-burnt");
  check();
});

test("城內擺設不接點擊：選著兵點擺設的圖，照樣是點城鎮（攻擊移動到主堡）；站在擺設上的兵照樣點得到", async ({ page }) => {
  const check = watchErrors(page);
  test.skip(!(await start(page)), "art.lock 的城牆還不是 war-game castle 2（art-v6 之前）");
  const ids = await spearmen(page);
  // A piece of the neutral town in view, its picture just above its anchor.
  const piece = (await decor(page)).find((d) => d.town === NEUTRAL_TOWN.id && d.piece.startsWith("hut"));
  if (piece === undefined) throw new Error("no hut in the neutral town");
  await centre(page, piece.cells[0][0] + 1, piece.cells[0][1] + 2, 1.4);
  await page.waitForTimeout(300);
  const onScreen = (await decor(page)).find((d) => same(d, piece));
  if (onScreen === undefined) throw new Error("the hut went");
  await selectForCommands(page, ids);
  const before = (await sent(page)).length;
  await tap(page, { x: onScreen.sx, y: onScreen.sy - 12 });
  await expect.poll(async () => (await sent(page)).slice(before).find((c) => c.c === "move")).toMatchObject({ c: "move", u: ids, x: NEUTRAL_TOWN.x, y: NEUTRAL_TOWN.y });
  // One of ours on a piece of our town: a tap on him selects him, the hut over or under him or not.
  const ours = (await decor(page)).find((d) => d.town === OUR_TOWN && d.shown);
  if (ours === undefined) throw new Error("no piece in our town");
  const [one] = ids;
  await page.evaluate(([id, x, y]) => window.__proto?.game?.place([id], [{ x, y }]), [one, ours.cells[0][0], ours.cells[0][1]] as const);
  await centre(page, ours.cells[0][0], ours.cells[0][1], 1.4);
  await selectForCommands(page, []);
  await page.waitForTimeout(500);
  const unit = (await page.evaluate(() => window.__proto?.game?.units() ?? [])).find((u) => u.id === one);
  if (unit === undefined) throw new Error("he went");
  await tap(page, { x: unit.sx, y: unit.sy });
  await expect.poll(() => page.evaluate(() => window.__proto?.game?.selection().units)).toEqual([one]);
  check();
});

test("城裡的地（R8-36 B）：美術的 ground.json 有 rules.town 時，地面著色器畫土路和踩平的土", async ({ page }, info) => {
  const check = watchErrors(page);
  test.skip(!(await start(page, "&ground=real")), "art.lock 的城牆還不是 war-game castle 2（art-v6 之前）");
  await expect.poll(async () => (await page.evaluate(() => window.__proto?.game?.groundLook()))?.town, { timeout: 30_000 }).toBe(true);
  await centre(page, 16, 62, 1.6);
  await page.waitForTimeout(800);
  await shot(page, info, "town-interior-ground");
  check();
});
