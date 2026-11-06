// 正式介面's floating pieces (D-127, ?ui=r6) on the fake world: R6-19's prompt strip a panel with
// the interface's buttons (取消 wood, 回主城 blue with the home), ✓ green and ✗ red at 52 × 52 (✓ grey
// where the house cannot go); R14-08's 進駐 tags with a gold rim; 進駐 and 整理隊形 with icons of their own,
// not 建造's house (ceo 2026-11-06).

import { expect, type Page, test } from "@playwright/test";
import { selectForCommands } from "./helpers.ts";
import { tap } from "./touch.ts";

const cmds = (page: Page) => page.locator(".cmds");
const own = async (page: Page, types: number[]) => {
  const me = await page.evaluate(() => window.__proto?.game?.me() ?? 0);
  return (await page.evaluate(() => window.__proto?.game?.units() ?? [])).filter((u) => u.owner === me && types.includes(u.type)).map((u) => u.id);
};

async function start(page: Page): Promise<void> {
  await page.goto("./?test=1&mock=1&r7=1&outpost=1&tps=20&ui=r6");
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true);
  await page.waitForFunction(() => (window.__proto?.game?.header().tick ?? 0) > 5);
}

test("正式介面的提示列（R6-19）：是面板；取消是正式介面的鈕；移動時「回主城」藍色、有房子圖示；每顆至少 44 pt", async ({ page }) => {
  await start(page);
  await page.evaluate(() => window.__proto?.game?.centerOn(23, 66, 1));
  await selectForCommands(page, await own(page, [1, 2, 3]));
  await cmds(page).getByRole("button", { name: /^移動/ }).tap();
  const prompt = page.locator(".prompt");
  await expect(prompt).toBeVisible();
  await expect(prompt).toHaveClass(/\bpanel\b/);
  const home = prompt.getByRole("button", { name: /回主城/ });
  await expect(home).toHaveClass(/\bb\b.*\bblue\b/);
  await expect(home.locator("svg.ic")).toHaveCount(1);
  const cancel = prompt.getByRole("button", { name: "取消" });
  await expect(cancel).toHaveClass(/\bb\b/);
  for (const b of [home, cancel]) expect((await b.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
});

test("正式介面的放建築（R6-19）：✓ 綠、✗ 紅，52×52；放在蓋不了的地方 ✓ 變灰、按不下去", async ({ page }) => {
  await start(page);
  await page.evaluate(() => window.__proto?.game?.centerOn(15, 76, 1));
  await selectForCommands(page, await own(page, [0]));
  await cmds(page).getByRole("button", { name: /^建造/ }).tap();
  await cmds(page).getByRole("button", { name: /^民居/ }).tap();
  const spot = await page.evaluate(() => window.__proto?.game?.buildSpotNear(1, 20, 78) ?? null);
  if (spot === null) throw new Error("no spot");
  await tap(page, await page.evaluate(([x, y]) => window.__proto?.game?.cellToScreen(x + 0.5, y + 0.5) ?? { x: 0, y: 0 }, [spot.x, spot.y] as const));
  const ok = page.getByRole("button", { name: "確定蓋在這裡" });
  const no = page.getByRole("button", { name: "取消放建築" });
  await expect(ok).toBeEnabled();
  const green = await ok.evaluate((e) => getComputedStyle(e).backgroundImage);
  const red = await no.evaluate((e) => getComputedStyle(e).backgroundImage);
  expect(green, "✓ green").toContain("rgb(90, 214, 114)");
  expect(red, "✗ red").toContain("rgb(232, 87, 75)");
  const b = await ok.boundingBox();
  expect(Math.round(b?.width ?? 0)).toBe(52);
  expect(Math.round(b?.height ?? 0)).toBe(52);
  // On the main city: cannot go, ✓ grey and off.
  await tap(page, await page.evaluate(() => window.__proto?.game?.cellToScreen(10, 82) ?? { x: 0, y: 0 }));
  await expect(ok).toBeDisabled();
  expect(await ok.evaluate((e) => getComputedStyle(e).backgroundImage)).not.toContain("rgb(90, 214, 114)");
});

test("正式介面的進駐（R14-08）：進駐、整理隊形有自己的圖示，不是建造的房子；標籤是金邊", async ({ page }) => {
  await start(page);
  await page.evaluate(() => window.__proto?.game?.centerOn(23, 66, 1));
  await selectForCommands(page, await own(page, [1, 2, 3]));
  const icon = (name: RegExp) => cmds(page).getByRole("button", { name }).locator("svg.ic").evaluate((e) => e.innerHTML);
  const enter = await icon(/^進駐/);
  const reform = await icon(/^整理隊形/);
  await selectForCommands(page, await own(page, [0]));
  const build = await icon(/^建造/);
  expect(enter, "進駐 not 建造's house").not.toBe(build);
  expect(reform).not.toBe(build);
  await selectForCommands(page, await own(page, [1, 2, 3]));
  await cmds(page).getByRole("button", { name: /^進駐/ }).tap();
  const tag = page.locator(".enter-tag.shown, .enter-chip.shown").first();
  await expect(tag).toBeVisible({ timeout: 15_000 });
  expect(await tag.evaluate((e) => getComputedStyle(e).borderTopColor)).toBe("rgb(240, 207, 138)");
});
