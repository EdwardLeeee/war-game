// 哨所的圖 (art-v5.1, war-game-ui 2026-10-22; R8-13/14 approved): our outpost and the enemy's drawn
// from the buildings' atlases, not as shapes, and one going up (施工) from its own first stage.
// Pictures for ceo to check against the approved drafts.

import { expect, type Page, test } from "@playwright/test";
import { shot, watchErrors } from "./helpers.ts";
import { tap } from "./touch.ts";

const OUTPOST_TYPE = 12;
const OUTPOST = { x: 12, y: 66 };
const FOE_OUTPOST = { x: 31, y: 61 };

const buildings = (page: Page) => page.evaluate(() => window.__proto?.game?.buildings() ?? []);
const art = (page: Page) => page.evaluate(() => window.__proto?.game?.art() ?? null);
const at = (page: Page, x: number, y: number) => page.evaluate(([cx, cy]) => window.__proto?.game?.cellToScreen(cx, cy) ?? { x: 0, y: 0 }, [x, y] as const);
const centre = (page: Page, x: number, y: number, scale = 2) => page.evaluate(([cx, cy, s]) => window.__proto?.game?.centerOn(cx, cy, s), [x, y, scale] as const);

test("哨所（art-v5.1）：自己的（蓋好、蓋到一半）和敵方的都從圖集畫，不是形狀", async ({ page }, info) => {
  test.setTimeout(120_000);
  const check = watchErrors(page);
  await page.goto("./?test=1&mock=1&r7=1&outpost=1&tps=100&art=x3");
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true, null, { timeout: 60_000 });
  await expect.poll(async () => (await art(page))?.buildings ?? 0, { timeout: 30_000 }).toBeGreaterThan(0);
  const me = await page.evaluate(() => window.__proto?.game?.me() ?? 0);
  // Every building in view drawn from the pictures: the two outposts too (with art-v5 they were shapes).
  await expect.poll(async () => (await art(page))?.buildings).toBe((await buildings(page)).length);
  // The enemy's, at the neutral town's north wall, in view (a spearman of ours beside it; out of
  // view it is drawn grey, as last seen): selected, so its ring and panel say which.
  const [spear] = (await page.evaluate(() => window.__proto?.game?.units() ?? [])).filter((u) => u.owner === me && u.type === 1).map((u) => u.id);
  await page.evaluate(([id, x, y]) => window.__proto?.game?.place([id], [{ x, y }]), [spear, FOE_OUTPOST.x - 2, FOE_OUTPOST.y + 3] as const);
  await centre(page, FOE_OUTPOST.x + 1, FOE_OUTPOST.y + 0.3, 2.4);
  await tap(page, await at(page, FOE_OUTPOST.x + 1, FOE_OUTPOST.y + 1));
  await expect(page.locator(".sel-info .sel-head")).toContainText("哨所");
  await expect(page.locator(".sel-info .sel-status")).toContainText("堅守中");
  await page.waitForTimeout(400);
  await shot(page, info, "outpost-art-enemy");
  // One of ours going up on open ground south of the main city (8, 80), nothing in front of it: its first stage, then done.
  await page.evaluate(() => window.__proto?.game?.select([]));
  const spot = await page.evaluate(([x, y]) => window.__proto?.game?.buildSpotNear(12, x, y) ?? null, [8, 90] as const);
  if (spot === null) throw new Error("no spot for an outpost");
  await page.evaluate(([x, y]) => window.__proto?.game?.send({ c: "build", u: [], type: 12, x, y }), [spot.x, spot.y] as const);
  const site = async () => (await buildings(page)).find((b) => b.type === OUTPOST_TYPE && b.cx === spot.x && b.cy === spot.y);
  await expect.poll(async () => (await site())?.progress ?? -1).toBeGreaterThanOrEqual(0);
  await page.getByRole("button", { name: "暫停", exact: true }).tap();
  await expect.poll(() => page.evaluate(() => window.__proto?.game?.header().paused)).toBe(true);
  await centre(page, spot.x + 1, spot.y + 0.3);
  await expect(page.locator(".toast")).toBeHidden({ timeout: 10_000 });
  await shot(page, info, "outpost-art-building");
  await page.getByRole("button", { name: "繼續", exact: true }).tap();
  await expect.poll(async () => (await site())?.progress ?? -1, { timeout: 30_000 }).toBe(1000);
  await page.waitForTimeout(300);
  await shot(page, info, "outpost-art-ours");
  expect(OUTPOST.x).toBe(12);
  check();
});
