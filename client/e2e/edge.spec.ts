// 浮空大陸的邊緣（R11 C, D-118; render/edge.ts）with make-test-atlas.ts's stand-ins: the diamond
// draws the sea of clouds, the cliff under the two lower edges, the waterfalls and the clouds over
// the upper edges; only round the map (in the middle of it nothing is drawn); a tap still falls on
// the map. Square on, or without the art asking for it (art-release.json's view), it is not drawn.

import { expect, type Page, test } from "@playwright/test";
import { shot, watchErrors } from "./helpers.ts";
import { tap } from "./touch.ts";

async function start(page: Page, query: string): Promise<void> {
  await page.goto(`./?test=1&scenario=e2e&ai=0&tps=60&art=test&${query}`);
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true, null, { timeout: 60_000 });
}
const edge = (page: Page) => page.evaluate(() => window.__proto?.game?.edge() ?? null);
const look = (page: Page, x: number, y: number, s: number) => page.evaluate(([a, b, c]) => window.__proto?.game?.centerOn(a, b, c), [x, y, s] as const);

test("菱形＋邊緣：崖面排滿兩條下緣（每 8 格一段＋3 轉角），河到邊上的地方有瀑布；畫面在地圖中間時不畫，到邊上才畫；點兵照樣選得到", async ({ page }, info) => {
  test.setTimeout(180_000);
  const check = watchErrors(page);
  await start(page, "view=diamond&edge=1");
  const e = await edge(page);
  expect(e).toMatchObject({ on: true });
  // art-v7's layout (the stand-ins have it): from the bottom corner one piece every 16 m (8 cells), as
  // many as fit between the bottom's 8 m and the far corner's 10 m, one more against it when they do
  // not end on it; and the three corners (the e2e map: 96 cells a side, 11 a side).
  const n = await page.evaluate(() => window.__proto?.game?.mapSize() ?? 0);
  const room = n * 2 - 18;
  expect(e?.pieces).toBe(2 * (Math.floor(room / 16) + (room % 16 > 0 ? 1 : 0)) + 3);
  expect(e?.falls).toBeGreaterThan(0);
  await page.getByRole("button", { name: "暫停" }).tap();
  // In the middle of the map: nothing of the edge drawn.
  await look(page, 64, 64, 1.2);
  await expect.poll(async () => (await edge(page))?.shown).toBe(false);
  // At the bottom corner: drawn.
  await look(page, n - 4, n - 4, 0.45);
  await expect.poll(async () => (await edge(page))?.shown).toBe(true);
  await page.waitForTimeout(500);
  await shot(page, info, "edge-bottom-corner");
  // A tap on one of ours by its home still selects it (the edge is never tapped).
  const me = await page.evaluate(() => window.__proto?.game?.me() ?? 0);
  const soldier = (await page.evaluate(() => window.__proto?.game?.units() ?? [])).find((u) => u.owner === me && u.type === 1);
  if (soldier === undefined) throw new Error("no spearman");
  await look(page, soldier.fx, soldier.fy, 1.4);
  await page.waitForTimeout(300);
  const p = await page.evaluate((id) => (window.__proto?.game?.units() ?? []).find((u) => u.id === id), soldier.id);
  await tap(page, { x: p?.sx ?? 0, y: (p?.sy ?? 0) - 8 });
  await expect.poll(async () => (await page.evaluate(() => window.__proto?.game?.selection().units ?? [])).includes(soldier.id)).toBe(true);
  check();
});

test("邊緣只跟菱形：方形斜看（?view=oblique）就算有 edge=1 也不畫；美術包沒寫 view 時（測試圖）照舊方形、不畫", async ({ page }) => {
  const check = watchErrors(page);
  await start(page, "view=oblique&edge=1");
  expect(await edge(page)).toMatchObject({ on: false });
  await start(page, "");
  expect(await edge(page)).toMatchObject({ on: false });
  expect(await page.evaluate(() => window.__proto?.game?.projection() ?? null)).toBe("oblique");
  check();
});
