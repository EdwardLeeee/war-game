// R24-02, R24-03 (D-150, ui's boards R24-02-選取資訊面板 and R24-03-常駐按鈕), 正式介面: with soldiers selected, a bar 44
// high along the foot (from 8 right of 地圖 to 8 left of the commands) in place of the panel; ？ opens what the orders
// do over it, a group's 軍團 opens 軍團畫面 (at most 46% of the screen, the user's choice), a tap outside shuts either
// and still does what it does. The commands one row: 攻擊, 移動, 進駐, 更多; 更多 holds 隊形, 堅守, 整理隊形, 停止.
// Villagers keep theirs. The prototype (?ui=proto) is as it was.

import { expect, type Page, test } from "@playwright/test";
import { injectSafeArea, selectForCommands, watchErrors } from "./helpers.ts";

const bar = (page: Page) => page.locator(".sel-bar");
const help = (page: Page) => page.locator(".sel-help");
const panel = (page: Page) => page.locator(".sel-info");
const cmds = (page: Page) => page.locator(".cmds");

async function start(page: Page, extra = ""): Promise<number[]> {
  await page.setViewportSize({ width: 932, height: 336 });
  await page.goto(`./?test=1&mock=1&r7=1&outpost=1&tps=20&ui=r6${extra}`);
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true);
  await page.waitForFunction(() => (window.__proto?.game?.header().tick ?? 0) > 5);
  await injectSafeArea(page);
  await page.evaluate(() => {
    window.__proto?.game?.pause();
    window.__proto?.game?.centerOn(14, 76, 1.1);
  });
  const me = await page.evaluate(() => window.__proto?.game?.me() ?? 0);
  return (await page.evaluate(() => window.__proto?.game?.units() ?? [])).filter((u) => u.owner === me && [1, 2, 3].includes(u.type)).map((u) => u.id);
}

const boxOf = async (page: Page, selector: string) => {
  const b = await page.locator(selector).first().boundingBox();
  if (b === null) throw new Error(`no ${selector}`);
  return b;
};

/** Open ground away from everyone and clear of the interface, on screen: where a tap orders the soldiers selected. */
async function groundSpot(page: Page): Promise<{ x: number; y: number }> {
  const spot = await page.evaluate(() => {
    const g = window.__proto?.game;
    if (g == null) return null;
    const units = g.units();
    const c0 = g.centreCell();
    for (let r = 0; r < 14; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (const dy of [-r, r]) {
          const c = { x: Math.floor(c0.x) + dx, y: Math.floor(c0.y) + dy };
          const open = g.openCellNear(c.x, c.y);
          if (open === null || open.x !== c.x || open.y !== c.y) continue;
          if (units.some((u) => (u.fx - c.x - 0.5) ** 2 + (u.fy - c.y - 0.5) ** 2 < 9)) continue;
          const at = g.cellToScreen(c.x + 0.5, c.y + 0.5);
          if (at.x < 150 || at.x > 600 || at.y < 90 || at.y > 230) continue;
          const hit = document.elementFromPoint(at.x, at.y);
          if (hit === null || hit.tagName !== "CANVAS" || g.pickAt(at.x, at.y) !== null) continue;
          return at;
        }
      }
    }
    return null;
  });
  if (spot === null) throw new Error("no open ground on screen");
  return spot;
}

test("選兵後只剩貼底邊的一條（R24-02）：44 高，從「地圖」右邊 8 到指令區左邊 8；選了幾名、在做什麼、每種兵一格；點一格只選那種", async ({ page }) => {
  const check = watchErrors(page);
  const soldiers = await start(page);
  await selectForCommands(page, soldiers);
  await expect(bar(page)).toBeVisible();
  await expect(panel(page)).toBeHidden();
  const b = await boxOf(page, ".sel-bar");
  const map = await boxOf(page, ".map-btn");
  const area = await boxOf(page, ".cmds");
  expect(Math.round(b.height)).toBe(44);
  expect(Math.round(b.x - (map.x + map.width)), "8 right of 地圖").toBe(8);
  expect(Math.round(area.x - (b.x + b.width)), "8 left of the commands").toBe(8);
  expect(Math.round(b.y + b.height), "4 above the safe bottom").toBe(336 - 21 - 4);
  await expect(bar(page).locator(".bar-title")).toContainText(`已選${soldiers.length}`);
  await expect(bar(page).locator(".bar-title .t2")).toContainText("待命");
  const chips = bar(page).locator(".bar-chip");
  await expect(chips).toHaveText(["槍兵6", "遠程兵4", "法師2"]);
  // Every cell 44 high or more, none narrower than 44.
  for (const cell of await bar(page).locator("button:visible").all()) {
    const c = await cell.boundingBox();
    expect(c !== null && c.width >= 44 && c.height >= 44, `${await cell.getAttribute("aria-label")} ${JSON.stringify(c)}`).toBe(true);
  }
  await bar(page).getByRole("button", { name: "只選遠程兵" }).tap();
  await expect.poll(() => page.evaluate(() => window.__proto?.game?.selection().units.length)).toBe(4);
  await expect(bar(page).locator(".bar-title")).toContainText("已選4");
  // One: its name over what it does, its life.
  await selectForCommands(page, [soldiers[0]]);
  await expect(bar(page).locator(".bar-title")).toContainText("槍兵");
  await expect(bar(page).locator(".bar-hp")).toContainText("100");
  check();
});

test("「？」打開說明（R24-02）：在那一條上面、不超過畫面高的 40%；點外面就收起，那一下照樣下指令；兵死了不會收起", async ({ page }) => {
  const check = watchErrors(page);
  const soldiers = await start(page);
  await selectForCommands(page, soldiers);
  await expect(help(page)).toBeHidden();
  await bar(page).getByRole("button", { name: "說明" }).tap();
  await expect(help(page)).toBeVisible();
  await expect(help(page)).toContainText("指令說明");
  await expect(help(page)).toContainText("攻擊");
  const h = await boxOf(page, ".sel-help");
  const b = await boxOf(page, ".sel-bar");
  expect(h.height).toBeLessThanOrEqual(336 * 0.4 + 0.5);
  expect(Math.round(b.y - (h.y + h.height)), "4 above the bar").toBe(4);
  // One of them dies (the fake world running, so that it goes): it stays open.
  await page.evaluate((id) => window.__proto?.game?.remove([id]), soldiers[soldiers.length - 1]);
  await page.locator(".top-right").getByRole("button", { name: /繼續/ }).evaluate((b) => (b as HTMLButtonElement).click());
  await expect.poll(() => page.evaluate(() => window.__proto?.game?.selection().units.length)).toBe(soldiers.length - 1);
  await page.evaluate(() => window.__proto?.game?.pause());
  await page.waitForTimeout(300);
  await expect(help(page)).toBeVisible();
  // A tap on the ground: shut, and the soldiers ordered there all the same.
  const sent = await page.evaluate(() => window.__proto?.game?.sent().length ?? 0);
  const spot = await groundSpot(page);
  await page.touchscreen.tap(spot.x, spot.y);
  await expect(help(page)).toBeHidden();
  await expect.poll(() => page.evaluate((n) => (window.__proto?.game?.sent() ?? []).slice(n).map((c) => (c as { c: string }).c), sent)).toEqual(expect.arrayContaining([expect.stringMatching(/^(move|attack|retreat)$/)]));
  check();
});

test("編隊（R24-02）：點了照舊只選取、預設收起；「軍團」打開軍團畫面（不超過畫面高的 46%），再按或點外面就收起；空的編隊直接打開", async ({ page }) => {
  const check = watchErrors(page);
  const soldiers = await start(page);
  await selectForCommands(page, soldiers);
  // Empty: 軍團畫面 at once, 改成剛才選的 in it.
  await page.locator(".groups > button").first().tap();
  await expect(panel(page)).toBeVisible();
  await expect(bar(page).locator(".bar-title")).toContainText("編隊 1");
  await expect(bar(page).getByRole("button", { name: "軍團畫面" })).toHaveAttribute("aria-expanded", "true");
  await panel(page).getByRole("button", { name: /^改成剛才選的 \d+ 名$/ }).tap();
  await expect.poll(() => page.evaluate(() => window.__proto?.game?.groups()[0]?.length ?? 0)).toBe(soldiers.length);
  await bar(page).getByRole("button", { name: "取消選取" }).tap();
  await expect(bar(page)).toBeHidden();
  // With soldiers: selected, folded; the bar has 軍團.
  await page.locator(".groups > button").first().tap();
  await expect.poll(() => page.evaluate(() => window.__proto?.game?.selection().units.length)).toBe(soldiers.length);
  await expect(bar(page).locator(".bar-title")).toContainText(`編隊 1${soldiers.length}/${soldiers.length}`);
  await page.waitForTimeout(300);
  await expect(panel(page)).toBeHidden();
  const legion = bar(page).getByRole("button", { name: "軍團畫面" });
  await legion.tap();
  await expect(panel(page)).toBeVisible();
  const p = await boxOf(page, ".sel-info");
  const b = await boxOf(page, ".sel-bar");
  expect(p.height).toBeLessThanOrEqual(336 * 0.46 + 0.5);
  expect(Math.round(p.width), "as wide as the bar").toBe(Math.round(b.width));
  await legion.tap();
  await expect(panel(page)).toBeHidden();
  // Open, then a tap on the ground: shut, and the group ordered there.
  await legion.tap();
  await expect(panel(page)).toBeVisible();
  const sent = await page.evaluate(() => window.__proto?.game?.sent().length ?? 0);
  const spot = await groundSpot(page);
  await page.touchscreen.tap(spot.x, spot.y);
  await expect(panel(page)).toBeHidden();
  await expect.poll(() => page.evaluate((n) => (window.__proto?.game?.sent() ?? []).slice(n).map((c) => (c as { c: string }).c), sent)).toEqual(expect.arrayContaining([expect.stringMatching(/^(move|attack|retreat)$/)]));
  check();
});

test("指令區一排四顆（R24-03）：攻擊、移動、進駐、更多；「更多」裡依序是隊形、堅守、整理隊形、停止，按了就收起；點外面也收起", async ({ page }) => {
  const check = watchErrors(page);
  const soldiers = await start(page);
  await selectForCommands(page, soldiers);
  const row = cmds(page).locator(":scope > button");
  await expect(row).toHaveCount(4);
  const names = await row.evaluateAll((bs) => bs.map((b) => b.querySelector(".label")?.textContent ?? ""));
  expect(names).toEqual(["攻擊", "移動", "進駐", "更多"]);
  const tops = await row.evaluateAll((bs) => bs.map((b) => Math.round(b.getBoundingClientRect().top)));
  expect(new Set(tops).size, "one row").toBe(1);
  const more = cmds(page).getByRole("button", { name: /^更多/ });
  await more.tap();
  const pop = cmds(page).locator(".cmds-more");
  await expect(pop).toBeVisible();
  expect(await pop.locator("button .label").allTextContents()).toEqual(["隊形", "堅守", "整理隊形", "停止"]);
  // Clear of 全軍 and the group buttons to the right.
  const p = await boxOf(page, ".cmds-more");
  const army = await boxOf(page, ".army-btn");
  expect(p.y, "under 全軍").toBeGreaterThanOrEqual(army.y + army.height);
  const sent = await page.evaluate(() => window.__proto?.game?.sent().length ?? 0);
  await pop.getByRole("button", { name: /^堅守/ }).tap();
  await expect(pop).toBeHidden();
  await expect.poll(() => page.evaluate((n) => (window.__proto?.game?.sent() ?? []).slice(n).map((c) => (c as { c: string }).c), sent)).toEqual(["stop", "stance"]);
  await more.tap();
  await expect(pop).toBeVisible();
  const spot = await groundSpot(page);
  await page.touchscreen.tap(spot.x, spot.y);
  await expect(pop).toBeHidden();
  // Open, then 攻擊 in the row: shut, and 攻擊 does what it does (not rebuilt under the finger).
  await selectForCommands(page, soldiers);
  await more.tap();
  await expect(pop).toBeVisible();
  await cmds(page).getByRole("button", { name: /^攻擊/ }).tap();
  await expect(pop).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.__proto?.game?.mode())).toBe("advance");
  check();
});

test("選村民時照舊（R24-03）：移動、停止、建造，沒有「更多」；原型（?ui=proto）沒有那一條", async ({ page }) => {
  const check = watchErrors(page);
  await start(page);
  const farmers = (await page.evaluate(() => window.__proto?.game?.units() ?? [])).filter((u) => u.owner === 0 && u.type === 0).map((u) => u.id);
  await selectForCommands(page, farmers.slice(0, 2));
  await expect(bar(page)).toBeVisible();
  await expect(cmds(page).getByRole("button", { name: /^建造/ })).toBeVisible();
  await expect(cmds(page).getByRole("button", { name: /^更多/ })).toHaveCount(0);
  check();
  await page.goto("./?test=1&mock=1&tps=20&ui=proto");
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true);
  const me = await page.evaluate(() => window.__proto?.game?.me() ?? 0);
  const soldiers = (await page.evaluate(() => window.__proto?.game?.units() ?? [])).filter((u) => u.owner === me && [1, 2, 3].includes(u.type)).map((u) => u.id);
  await selectForCommands(page, soldiers);
  await expect(panel(page)).toBeVisible();
  await expect(page.locator(".sel-bar")).toHaveCount(0);
  await expect(cmds(page).getByRole("button", { name: /^堅守/ })).toBeVisible();
});
