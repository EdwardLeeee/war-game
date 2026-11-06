// 正式介面's command area (D-127, ?ui=r6): R6-18's buttons, 56 × 50 in four columns from x 571 (spec
// section 2), 攻擊 red, 移動 blue, 堅守 gold, 隊形 two columns; 建造 in five columns once there are more
// than twelve (R14-04, the real simulation's 砲坊 and 市場), clear of the selection info; the wheel's
// round buttons in the orders' colours (R6-19). The prototype's look stays without ?ui=r6.

import { expect, type Page, test } from "@playwright/test";
import { selectForCommands } from "./helpers.ts";
import { longPress } from "./touch.ts";

const cmds = (page: Page) => page.locator(".cmds");
const box = async (page: Page, selector: string) => {
  const b = await page.locator(selector).first().boundingBox();
  if (b === null) throw new Error(`no ${selector}`);
  return b;
};

async function startMock(page: Page, ui: string): Promise<number[]> {
  await page.goto(`./?test=1&mock=1&r7=1&outpost=1&tps=20${ui}`);
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true);
  await page.waitForFunction(() => (window.__proto?.game?.header().tick ?? 0) > 5);
  const me = await page.evaluate(() => window.__proto?.game?.me() ?? 0);
  return (await page.evaluate(() => window.__proto?.game?.units() ?? [])).filter((u) => u.owner === me && [1, 2, 3].includes(u.type)).map((u) => u.id);
}

test("正式介面的指令區（R6-18）：選了兵時四欄、每顆 56×50，從 x 571 起；攻擊紅、移動藍、堅守金、隊形兩格寬；選位置時那顆亮", async ({ page }) => {
  const soldiers = await startMock(page, "&ui=r6");
  await page.evaluate(() => window.__proto?.game?.centerOn(23, 66, 1));
  await selectForCommands(page, soldiers);
  const area = await box(page, ".cmds");
  const size = page.viewportSize() ?? { width: 814, height: 380 };
  expect(Math.round(size.width - area.x - area.width), "4 from the right").toBe(4);
  expect(Math.round(area.width)).toBe(239);
  const attack = cmds(page).getByRole("button", { name: /^攻擊/ });
  await expect(attack).toHaveClass(/\bb\b.*\bred\b|\bred\b.*\bb\b/);
  await expect(cmds(page).getByRole("button", { name: /^移動/ })).toHaveClass(/\bblue\b/);
  await expect(cmds(page).getByRole("button", { name: /^堅守/ })).toHaveClass(/\bgold\b/);
  const one = await attack.boundingBox();
  expect(one !== null && Math.round(one.width) === 56 && Math.round(one.height) === 50, `攻擊 56 × 50: ${JSON.stringify(one)}`).toBe(true);
  const formation = await cmds(page).getByRole("button", { name: /^隊形/ }).boundingBox();
  expect(Math.round(formation?.width ?? 0), "隊形 two columns").toBe(117);
  await expect(attack.locator("svg.ic")).toHaveCount(1);
  await attack.tap();
  await expect(cmds(page).getByRole("button", { name: /^取消攻擊/ })).toHaveClass(/\bactive\b/);
});

test("正式介面的技能輪盤（R6-19）：長按自己的兵，三顆圓鈕：攻擊紅、移動藍、堅守金", async ({ page }) => {
  const soldiers = await startMock(page, "&ui=r6");
  await page.evaluate(() => window.__proto?.game?.centerOn(23, 66, 1));
  await page.waitForTimeout(200);
  const one = (await page.evaluate(() => window.__proto?.game?.units() ?? [])).find((u) => u.id === soldiers[0]);
  if (one === undefined) throw new Error("no soldier");
  await longPress(page, { x: one.sx, y: one.sy - 12 });
  await expect.poll(() => page.evaluate(() => window.__proto?.game?.wheel() ?? null)).toEqual(["advance", "retreat", "hold"]);
  const items = page.locator(".wheel .wheel-item");
  await expect(items).toHaveCount(3);
  for (const [i, tone] of ["red", "blue", "gold"].entries()) {
    await expect(items.nth(i)).toHaveClass(new RegExp(`\\bb\\b.*\\b${tone}\\b`));
    const b = await items.nth(i).boundingBox();
    expect(Math.round(b?.width ?? 0)).toBe(60);
    expect(await items.nth(i).evaluate((e) => getComputedStyle(e).borderRadius)).toBe("30px");
  }
});

test("正式介面的建造選單（R14-04，真的模擬）：超過 12 顆時五欄，第一列五顆同一高度，不壓到選取資訊", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("./?test=1&scenario=e2e&ai=0&ui=r6");
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true, null, { timeout: 60_000 });
  await page.evaluate(() => window.__proto?.game?.pause());
  const me = await page.evaluate(() => window.__proto?.game?.me() ?? 0);
  const farmers = (await page.evaluate(() => window.__proto?.game?.units() ?? [])).filter((u) => u.owner === me && u.type === 0);
  await page.evaluate(([x, y]) => window.__proto?.game?.centerOn(x, y, 1), [farmers[0].fx, farmers[0].fy] as const);
  await selectForCommands(page, farmers.map((u) => u.id));
  await cmds(page).getByRole("button", { name: /^建造/ }).tap();
  const buttons = cmds(page).locator(".b");
  const n = await buttons.count();
  expect(n, "more than twelve with 砲坊 and 市場").toBeGreaterThan(12);
  await expect(cmds(page)).toHaveClass(/\bcols5\b/);
  const tops = await buttons.evaluateAll((bs) => bs.slice(0, 5).map((b) => Math.round(b.getBoundingClientRect().top)));
  expect(new Set(tops).size, `five on the first line: ${tops}`).toBe(1);
  const area = await box(page, ".cmds");
  const panel = await box(page, ".sel-info");
  expect(area.x, "clear of the selection info").toBeGreaterThanOrEqual(panel.x + panel.width);
  for (const b of await buttons.all()) {
    const r = await b.boundingBox();
    expect(Math.min(r?.width ?? 0, r?.height ?? 0), "a finger across").toBeGreaterThanOrEqual(44);
  }
  // 返回: four columns again.
  await cmds(page).getByRole("button", { name: "返回" }).tap();
  await expect(cmds(page)).not.toHaveClass(/\bcols5\b/);
});

test("原型的指令區照舊：沒有 ?ui=r6 時按鈕不是正式介面的樣子，沒有圖示", async ({ page }) => {
  const soldiers = await startMock(page, "");
  await selectForCommands(page, soldiers);
  await expect(cmds(page).locator(".b")).toHaveCount(0);
  await expect(cmds(page).locator("svg.ic")).toHaveCount(0);
});
