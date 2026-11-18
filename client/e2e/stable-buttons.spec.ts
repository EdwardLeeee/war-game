// 按下去以後，手指或滑鼠底下的按鈕不動 (the user 2026-11-18: 「點交易、兵種、加減符號那些一直跳來跳去」). A computer's
// window (1920 × 950, 1366 × 768) and a phone held sideways (932 × 336), on the fake world: each button clicked ten times
// where it was, every click lands on it, and what the click changes moves nothing beside it — the bar's kinds after
// 只選槍兵; ✕ and 收起 as the first one goes into a queue; ＋遠程／＋法師／全部離開 and 村民目標 as those called in get
// there (the lines that come and go are over them, ceo 2026-11-18); − and + as their numbers go past 9 and 100.

import { expect, type Page, test } from "@playwright/test";
import { watchErrors } from "./helpers.ts";

test.use({ isMobile: false, hasTouch: false, deviceScaleFactor: 1 });

type Box = { x: number; y: number; w: number; h: number };
const MARKET = 15;
const BARRACKS = 6;
const MAIN = 0;

async function start(page: Page, size: { width: number; height: number }): Promise<void> {
  await page.setViewportSize(size);
  await page.goto("./?test=1&mock=1&tps=20&market=1");
  await page.getByRole("button", { name: "開始", exact: true }).click();
  await page.waitForFunction(() => window.__proto?.ready === true && window.__proto.screen === "battle");
  await page.waitForFunction(() => (window.__proto?.game?.header().tick ?? 0) > 5);
  await page.evaluate(() => window.__proto?.game?.stock({ food: 99999, wood: 99999, gold: 99999, crystal: 999 }));
}

async function box(page: Page, selector: string): Promise<Box> {
  // The bar's cells are made anew when the selection changes (a cell taken a moment ago can be gone): looked up again.
  const got: { b: { x: number; y: number; width: number; height: number } | null } = { b: null };
  await expect.poll(async () => {
    got.b = await page.locator(selector).filter({ visible: true }).first().boundingBox().catch(() => null);
    return got.b !== null;
  }).toBe(true);
  const b = got.b;
  if (b === null) throw new Error(`no ${selector}`);
  return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
}

/** Our building of this type (made beside home when there is none) clicked: its panel open. */
async function openBuilding(page: Page, type: number): Promise<void> {
  const ours = () => page.evaluate((t) => (window.__proto?.game?.buildings() ?? []).filter((b) => b.type === t && b.owner === window.__proto?.game?.me()), type);
  let b = (await ours())[0];
  if (b === undefined) {
    const home = await page.evaluate(() => window.__proto?.game?.home() ?? { cx: 20, cy: 70 });
    const spot = await page.evaluate(([t, x, y]) => window.__proto?.game?.buildSpotNear(t, x, y) ?? null, [type, home.cx + 5, home.cy + 5] as const);
    if (spot === null) throw new Error("no spot");
    await page.evaluate(([t, x, y]) => window.__proto?.game?.addBuilding(t, x, y), [type, spot.x, spot.y] as const);
    await expect.poll(async () => (await ours()).length).toBeGreaterThan(0);
    b = (await ours())[0];
  }
  await page.evaluate(() => window.__proto?.game?.select([]));
  const mid = { x: b.cx + b.size / 2 - 0.5, y: b.cy + b.size / 2 - 0.5 };
  await page.evaluate(([x, y]) => window.__proto?.game?.centerOn(x, y, 1), [mid.x, mid.y] as const);
  await page.waitForTimeout(300);
  const at = await page.evaluate(([x, y]) => window.__proto?.game?.cellToScreen(x, y) ?? { x: 0, y: 0 }, [mid.x, mid.y] as const);
  await page.mouse.click(at.x, at.y);
  await expect.poll(() => page.evaluate(() => window.__proto?.game?.selection().building ?? null)).toBe(b.id);
}

/** Ten clicks where `name` was at first: each lands on it (the button under the pointer is the same one). */
async function tenClicks(page: Page, name: string | RegExp): Promise<void> {
  const button = page.getByRole("button", { name }).first();
  const b = await button.boundingBox();
  if (b === null) throw new Error(`no ${name}`);
  const x = b.x + b.width / 2;
  const y = b.y + b.height / 2;
  const label = (await button.getAttribute("aria-label")) ?? (await button.textContent()) ?? "";
  for (let i = 0; i < 10; i++) {
    const under = await page.evaluate(([px, py]) => {
      const e = document.elementFromPoint(px, py)?.closest("button") ?? null;
      return e === null ? null : (e.getAttribute("aria-label") ?? e.textContent ?? "");
    }, [x, y] as const);
    expect(under?.replace(/[0-9]+/g, "#"), `click ${i + 1} on the same button`).toBe(label.replace(/[0-9]+/g, "#"));
    await page.mouse.click(x, y);
    await page.waitForTimeout(200);
  }
}

for (const size of [
  { width: 1920, height: 950 },
  { width: 1366, height: 768 },
  { width: 932, height: 336 },
]) {
  test.describe(`${size.width}×${size.height}`, () => {
    test("兵種：點選兵那一條的「只選槍兵」，那一格不動，點十下都點在它上面", async ({ page }) => {
      const check = watchErrors(page);
      await start(page, size);
      await page.locator(".army-btn").click();
      await expect.poll(() => page.evaluate(() => window.__proto?.game?.selection().units.length ?? 0)).toBeGreaterThan(0);
      const chip = '.sel-bar [aria-label="只選槍兵"]';
      const before = await box(page, chip);
      await tenClicks(page, "只選槍兵");
      expect(await box(page, chip)).toEqual(before);
      check();
    });

    test("訓練：第一個進佇列、排滿五個，點十下都點在「訓練槍兵」上，它不動（佇列在面板裡往上長）", async ({ page }) => {
      const check = watchErrors(page);
      await start(page, size);
      await openBuilding(page, BARRACKS);
      const train = await box(page, '.cmds [aria-label^="訓練槍兵"], .cmds button:has-text("訓練槍兵")');
      await tenClicks(page, /^訓練槍兵/);
      await expect(page.locator(".sel-info .queue-item").first()).toBeVisible();
      expect(await box(page, '.cmds [aria-label^="訓練槍兵"], .cmds button:has-text("訓練槍兵")')).toEqual(train);
      check();
    });

    test("主城＋遠程：點十下都點在「＋遠程」上；叫進來的到了、召回出現，＋遠程、＋法師還在原地", async ({ page }) => {
      test.setTimeout(120_000);
      const check = watchErrors(page);
      await start(page, size);
      // Our ranged soldiers beside the main city, so that those called get there soon.
      await page.evaluate(() => {
        const g = window.__proto?.game;
        const home = g?.home();
        const ranged = (g?.units() ?? []).filter((u) => u.owner === g?.me() && u.type === 2).map((u) => u.id);
        if (home != null && ranged.length > 0) g?.place(ranged, ranged.map((_, i) => ({ x: home.cx + 4 + (i % 3), y: home.cy + 4 + Math.floor(i / 3) })));
      });
      await openBuilding(page, MAIN);
      const pressed = ['.sel-info [aria-label^="叫 1 名遠程兵"]', '.sel-info [aria-label^="叫 1 名法師"]', '.sel-info [aria-label^="村民目標少"]', '.sel-info [aria-label^="村民目標多"]'];
      const before = await Promise.all(pressed.map((p) => box(page, p)));
      await tenClicks(page, /^叫 1 名遠程兵/);
      // Someone got there: whose they are, with 召回 (a line over them).
      await expect(page.locator(".sel-info .seat-groups").getByRole("button", { name: /召回$/ }).first()).toBeVisible({ timeout: 60_000 });
      expect(await Promise.all(pressed.map((p) => box(page, p)))).toEqual(before);
      // 村民目標 + ten times (40 → 90, then past 100): − and + stay.
      await tenClicks(page, /^村民目標多/);
      await tenClicks(page, /^村民目標多/);
      expect(await Promise.all(pressed.map((p) => box(page, p)))).toEqual(before);
      check();
    });

    test("交易、加減：市場的買賣、經濟分配和軍團畫面的＋－，點十下都點在同一顆上", async ({ page }) => {
      test.setTimeout(180_000);
      const check = watchErrors(page);
      await start(page, size);
      await openBuilding(page, MARKET);
      await tenClicks(page, /^買 100 糧/);
      await tenClicks(page, /^賣 100 木/);
      await openBuilding(page, MAIN);
      await page.getByRole("button", { name: "經濟分配" }).click();
      // Up to 100% and back: − stays as the number goes past 100.
      const less = await box(page, '.dialog [aria-label="糧少一點"]');
      await tenClicks(page, "糧多一點");
      await tenClicks(page, "糧多一點");
      expect(await box(page, '.dialog [aria-label="糧少一點"]')).toEqual(less);
      await tenClicks(page, "金少一點");
      await page.getByRole("dialog").getByRole("button", { name: "取消" }).first().click();
      await page.evaluate(() => window.__proto?.game?.select([]));
      await page.locator(".army-btn").click();
      await page.locator(".groups > button").first().click();
      await page.getByRole("button", { name: /^改成剛才選的/ }).click();
      // 槍兵 past 9 and 10, then 20: − stays.
      const fewer = await box(page, '.sel-info [aria-label="少要 1 名槍兵"]');
      await tenClicks(page, "多要 1 名槍兵");
      await tenClicks(page, "多要 1 名槍兵");
      expect(await box(page, '.sel-info [aria-label="少要 1 名槍兵"]')).toEqual(fewer);
      await tenClicks(page, "少要 1 名遠程兵");
      check();
    });
  });
}
