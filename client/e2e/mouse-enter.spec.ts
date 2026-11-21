// 右鍵點自己能進駐的地方 (R26 06 a; ceo 2026-11-20: 「右鍵點自己能進駐的地方：進得去的進駐，進不去的走到旁邊」), a
// computer's window (1366 × 768, a mouse, no touch) on the fake world with 進駐 (?r7=1&outpost=1&hide=1): those the
// place takes go in, as 進駐's tag says, and leave what is selected; those it does not take walk there, still selected
// (spearmen at our main city: no word); a full one: all walk there and it says so; our town: 駐軍 as its tag says.

import { expect, type Page, test } from "@playwright/test";
import { expectNotSaid, expectSaid, saidMark, watchErrors, watchToasts } from "./helpers.ts";

const W = 1366;
const H = 768;
test.use({ viewport: { width: W, height: H }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 });
// 1366 × 768, R26's smaller window (as mouse.spec): Chromium on CI draws with the CPU, a third less to draw than 1920 × 950.
test.describe.configure({ timeout: 120_000 });

const SPEARMAN = 1;
const RANGED = 2;
const MAIN_CITY = 0;
const ARROW_TOWER = 10;
/** Order.Garrison, Action.Garrisoned (sim/src/protocol.ts). */
const GARRISON_ORDER = 9;
const GARRISONED = 7;

type Order = { c: string; u?: number[]; x?: number; y?: number; building?: number; town?: number };
const orders = (page: Page) => page.evaluate(() => (window.__proto?.game?.sent() ?? []).filter((c) => (c as { auto?: boolean }).auto !== true) as Order[]);
const selection = (page: Page) => page.evaluate(() => window.__proto?.game?.selection().units ?? []);
const units = (page: Page) => page.evaluate(() => window.__proto?.game?.units() ?? []);
const buildings = (page: Page) => page.evaluate(() => window.__proto?.game?.buildings() ?? []);
const select = (page: Page, ids: number[]) => page.evaluate((u) => window.__proto?.game?.select(u), ids);
const sorted = (ids: readonly number[]) => [...ids].sort((a, b) => a - b);

async function start(page: Page): Promise<void> {
  await watchToasts(page);
  await page.goto("./?test=1&mock=1&r7=1&outpost=1&hide=1&tps=20");
  await page.getByRole("button", { name: "開始", exact: true }).click();
  await page.waitForFunction(() => window.__proto?.ready === true && window.__proto.screen === "battle");
  await page.waitForFunction(() => (window.__proto?.game?.header().tick ?? 0) > 5);
}

async function own(page: Page, type: number): Promise<number[]> {
  const me = await page.evaluate(() => window.__proto?.game?.me() ?? 0);
  return sorted((await units(page)).filter((u) => u.owner === me && u.type === type).map((u) => u.id));
}

/** The camera on building `id`, and the point on screen where a click picks it (its footprint's middle). */
async function onBuilding(page: Page, id: number): Promise<{ x: number; y: number }> {
  const b = (await buildings(page)).find((v) => v.id === id);
  if (b === undefined) throw new Error(`no building ${id}`);
  const [cx, cy] = [b.cx + b.size / 2, b.cy + b.size / 2];
  await page.evaluate(([x, y]) => window.__proto?.game?.centerOn(x, y, 1), [cx, cy] as const);
  await page.waitForTimeout(300);
  const p = await page.evaluate(([x, y]) => window.__proto?.game?.cellToScreen(x, y) ?? { x: 0, y: 0 }, [cx, cy] as const);
  await expect.poll(() => page.evaluate(([x, y]) => window.__proto?.game?.pickIdAt(x, y)?.id ?? null, [p.x, p.y] as const), { message: "the click picks the building" }).toBe(id);
  return p;
}

/** The orders sent after `from` (their count before). */
const sentSince = async (page: Page, from: number) => (await orders(page)).slice(from);

test("右鍵點主城：只選槍兵走過去、不跳字、選取不變；只選遠程就躲進去、從選取拿掉；槍兵加遠程：遠程進去，槍兵走過去、還選著", async ({ page }) => {
  const check = watchErrors(page);
  await start(page);
  const city = (await buildings(page)).find((b) => b.type === MAIN_CITY && b.owner === 0);
  if (city === undefined) throw new Error("no main city");
  const spears = await own(page, SPEARMAN);
  const ranged = await own(page, RANGED);
  expect(spears.length, "spearmen of ours").toBeGreaterThan(0);
  expect(ranged.length, "two parties of ranged (the main city holds 6)").toBeGreaterThanOrEqual(2);
  const first = ranged.slice(0, Math.min(3, ranged.length - 1));
  const second = ranged.slice(first.length, first.length + 6 - first.length);

  // Spearmen only: the main city does not take them: they walk to it (as #540), nothing said, still selected.
  await select(page, spears);
  let p = await onBuilding(page, city.id);
  let from = (await orders(page)).length;
  let said = await saidMark(page);
  await page.mouse.click(p.x, p.y, { button: "right" });
  await expect.poll(async () => (await sentSince(page, from)).length).toBeGreaterThan(0);
  let got = await sentSince(page, from);
  expect(got.map((o) => o.c)).toEqual(["retreat"]);
  expect(sorted(got[0].u ?? [])).toEqual(spears);
  expect(got[0].x).toBeGreaterThanOrEqual(city.cx);
  expect(got[0].x).toBeLessThan(city.cx + city.size);
  expect(sorted(await selection(page))).toEqual(spears);
  await page.waitForTimeout(300);
  await expectNotSaid(page, "進不去", said);

  // Ranged only: they hide in it, and leave what is selected.
  await select(page, first);
  p = await onBuilding(page, city.id);
  from = (await orders(page)).length;
  said = await saidMark(page);
  await page.mouse.click(p.x, p.y, { button: "right" });
  await expect.poll(async () => (await sentSince(page, from)).length).toBeGreaterThan(0);
  got = await sentSince(page, from);
  expect(got).toHaveLength(1);
  expect(got[0]).toMatchObject({ c: "garrison", u: first, building: city.id });
  expect(await selection(page)).toEqual([]);
  await expectSaid(page, `${first.length} 名躲進主城`, {}, { from: said });

  // Spearmen and ranged: the ranged go in, the spearmen walk to it and stay selected.
  await select(page, sorted([...spears, ...second]));
  p = await onBuilding(page, city.id);
  from = (await orders(page)).length;
  await page.mouse.click(p.x, p.y, { button: "right" });
  await expect.poll(async () => (await sentSince(page, from)).length).toBe(2);
  got = await sentSince(page, from);
  expect(got[0]).toMatchObject({ c: "garrison", u: second, building: city.id });
  expect(got[1].c).toBe("retreat");
  expect(sorted(got[1].u ?? [])).toEqual(spears);
  expect(sorted(await selection(page))).toEqual(spears);
  check();
});

test("右鍵點滿了的箭樓：全部走過去，說箭樓滿了；沒滿時遠程躲進去", async ({ page }) => {
  const check = watchErrors(page);
  await start(page);
  const city = (await buildings(page)).find((b) => b.type === MAIN_CITY && b.owner === 0);
  if (city === undefined) throw new Error("no main city");
  const spot = await page.evaluate(([x, y]) => window.__proto?.game?.buildSpotNear(10, x, y) ?? null, [city.cx + 6, city.cy - 6] as const);
  if (spot === null) throw new Error("no room for a tower");
  const tower = await page.evaluate(([t, x, y]) => window.__proto?.game?.addBuilding(t, x, y) ?? -1, [ARROW_TOWER, spot.x, spot.y] as const);
  expect(tower).toBeGreaterThan(0);
  const ranged = await own(page, RANGED);
  expect(ranged.length, "more ranged than the tower holds (3)").toBeGreaterThan(3);
  const three = ranged.slice(0, 3);
  const rest = ranged.slice(3);

  // Room: three go in.
  await select(page, three);
  let p = await onBuilding(page, tower);
  let from = (await orders(page)).length;
  await page.mouse.click(p.x, p.y, { button: "right" });
  await expect.poll(async () => (await sentSince(page, from)).length).toBeGreaterThan(0);
  const went = await sentSince(page, from);
  expect(went).toHaveLength(1);
  expect(went[0]).toMatchObject({ c: "garrison", u: three, building: tower });
  expect(await selection(page)).toEqual([]);
  // On their way in (its room counts them from then on: Game.hidingComing).
  await expect.poll(async () => (await units(page)).filter((u) => three.includes(u.id) && (u.order === GARRISON_ORDER || u.action === GARRISONED)).length).toBe(3);

  // Full: the others walk to it, and it says why none went in.
  await select(page, rest);
  p = await onBuilding(page, tower);
  from = (await orders(page)).length;
  const said = await saidMark(page);
  await page.mouse.click(p.x, p.y, { button: "right" });
  await expect.poll(async () => (await sentSince(page, from)).length).toBeGreaterThan(0);
  const got = await sentSince(page, from);
  expect(got.map((o) => o.c)).toEqual(["retreat"]);
  expect(sorted(got[0].u ?? [])).toEqual(rest);
  expect(sorted(await selection(page))).toEqual(rest);
  await expectSaid(page, "箭樓滿了（最多 3 名），沒有人進去", {}, { from: said });
  check();
});

test("右鍵點自己治理的城：選的兵照進駐的標籤駐軍（guard），從選取拿掉", async ({ page }) => {
  const check = watchErrors(page);
  await start(page);
  const me = await page.evaluate(() => window.__proto?.game?.me() ?? 0);
  const soldiers = sorted([...(await own(page, SPEARMAN)), ...(await own(page, RANGED)), ...(await own(page, 3))]);
  // What 進駐's tag says for them there: who goes in.
  await select(page, soldiers);
  await page.locator(".cmds").getByRole("button", { name: /^進駐/ }).click();
  await expect.poll(async () => (await page.evaluate(() => window.__proto?.game?.enter().tags ?? [])).some((t) => t.id.startsWith("t") && !t.off)).toBe(true);
  const tag = (await page.evaluate(() => window.__proto?.game?.enter().tags ?? [])).find((t) => t.id.startsWith("t") && !t.off);
  await page.locator(".cmds").getByRole("button", { name: /^取消\s*進駐/ }).click();
  await expect.poll(() => page.evaluate(() => window.__proto?.game?.mode())).toBe("normal");
  const townId = Number(tag?.id.slice(1));
  const town = (await page.evaluate(() => window.__proto?.game?.towns() ?? [])).find((t) => t.id === townId);
  if (town === undefined || town.owner !== me) throw new Error("no town of ours");
  const going = Number(/進 (\d+) 名/.exec(tag?.head ?? "")?.[1] ?? 0);
  expect(going).toBeGreaterThan(0);

  // Open ground in it, a little off its middle: nothing of the enemy's picked there.
  await page.evaluate(([x, y]) => window.__proto?.game?.centerOn(x + 0.5, y + 0.5, 1), [town.cx, town.cy] as const);
  await page.waitForTimeout(300);
  let p: { x: number; y: number } | null = null;
  for (const [dx, dy] of [
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
    [2, 0],
    [0, 2],
  ]) {
    const q = await page.evaluate(([x, y]) => window.__proto?.game?.cellToScreen(x, y) ?? { x: 0, y: 0 }, [town.cx + 0.5 + dx, town.cy + 0.5 + dy] as const);
    const hit = await page.evaluate(([x, y]) => window.__proto?.game?.pickIdAt(x, y) ?? null, [q.x, q.y] as const);
    const mine = hit === null || hit.kind === "town" || (await units(page)).some((u) => u.id === hit.id && u.owner === me);
    if (mine && (await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.tagName === "CANVAS", [q.x, q.y] as const))) {
      p = q;
      break;
    }
  }
  if (p === null) throw new Error("no open ground in the town");
  await select(page, soldiers);
  const from = (await orders(page)).length;
  const said = await saidMark(page);
  await page.mouse.click(p.x, p.y, { button: "right" });
  await expect.poll(async () => (await sentSince(page, from)).length).toBeGreaterThan(0);
  const got = await sentSince(page, from);
  expect(got.map((o) => o.c)).toEqual(["guard"]);
  expect(got[0].town).toBe(townId);
  expect(got[0].u?.length, "as many as its tag said").toBe(going);
  expect(await selection(page)).toEqual([]);
  await expectSaid(page, `${going} 名駐軍在`, {}, { from: said });
  check();
});
