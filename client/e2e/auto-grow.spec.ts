// 自動擴編 (D-141; the user chose 「自動擴編，預設關」): in the 軍團畫面 beside 自動補兵, off by default. On, with the group
// full and the resources well over the reserve, 自動訓練 goes on training in the group's mix and the group wants more;
// the barracks says why (「資源多，自動擴編中」), and with too little it says it waits; off, the numbers it grew to stay.
// The fake world with 自動訓練 on and a finished barracks of ours.

import { expect, type Page, test } from "@playwright/test";
import { openPanel, watchErrors } from "./helpers.ts";
import { tap, tapOn } from "./touch.ts";

const BARRACKS = 6;

const want = (page: Page) => page.evaluate(() => window.__proto?.game?.groupInfo()[0]?.want[1] ?? 0);
const has = (page: Page) => page.evaluate(() => window.__proto?.game?.groupInfo()[0]?.ids.length ?? 0);

async function tapBuilding(page: Page, id: number): Promise<void> {
  const b = (await page.evaluate(() => window.__proto?.game?.buildings() ?? [])).find((v) => v.id === id);
  if (b === undefined) throw new Error(`no building ${id}`);
  await page.evaluate(([x, y]) => window.__proto?.game?.centerOn(x, y, 1), [b.cx + b.size / 2, b.cy + b.size / 2] as const);
  await page.waitForTimeout(300);
  for (let y = b.cy; y < b.cy + b.size; y++) {
    for (let x = b.cx; x < b.cx + b.size; x++) {
      const at = await page.evaluate(([cx, cy]) => window.__proto?.game?.cellToScreen(cx + 0.5, cy + 0.5) ?? { x: 0, y: 0 }, [x, y] as const);
      if ((await page.evaluate(([sx, sy]) => window.__proto?.game?.pickIdAt(sx, sy)?.id ?? null, [at.x, at.y] as const)) !== id) continue;
      await tap(page, at);
      await expect.poll(() => page.evaluate(() => window.__proto?.game?.selection().building ?? null)).toBe(id);
      return;
    }
  }
  throw new Error(`building ${id} not tappable`);
}

test("自動擴編：預設關；補滿後打開，資源多就照比例多練、軍團人數變大，兵營寫「資源多，自動擴編中」；資源不夠就寫不擴編；關掉後人數留著", async ({ page }) => {
  test.setTimeout(240_000);
  const check = watchErrors(page);
  await page.goto("./?test=1&mock=1&tps=60&ui=r6");
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true, null, { timeout: 60_000 });
  const barracks = await page.evaluate((t) => {
    const g = window.__proto?.game;
    g?.autoArmy(true);
    // The villagers would fill the population first (WebKit, slower): room for soldiers.
    g?.villagersPaused(true);
    g?.stock({ food: 3000, wood: 3000, gold: 3000, crystal: 0 });
    const city = g?.buildings().find((b) => b.owner === g.me() && b.type === 0);
    return g?.addBuilding(t, (city?.cx ?? 20) + 6, (city?.cy ?? 20) + 6) ?? -1;
  }, BARRACKS);
  expect(barracks).toBeGreaterThan(0);

  // Group 1 set to two spearmen; 自動補兵 fills it.
  await tapOn(page, ".groups > button:nth-child(1)");
  await openPanel(page);
  const panel = page.locator(".sel-info");
  const grow = panel.getByRole("button", { name: /^自動擴編/ });
  await expect(grow).toHaveAccessibleName("自動擴編：關");
  for (let i = 0; i < 2; i++) await panel.getByRole("button", { name: "多要 1 名槍兵" }).tap();
  await expect.poll(() => want(page)).toBe(2);
  await expect.poll(() => has(page), { timeout: 60_000, message: "filled by 自動補兵" }).toBe(2);
  // Off: full stays full, nothing more.
  await page.waitForTimeout(3000);
  expect(await want(page)).toBe(2);

  // On with too little over the reserve (wood 100: a spearman wants 320): it does not grow and the barracks says why.
  await page.evaluate(() => window.__proto?.game?.stock({ food: 3000, wood: 100, gold: 3000, crystal: 0 }));
  await grow.tap();
  await expect(grow).toHaveAccessibleName("自動擴編：開");
  await tapBuilding(page, barracks);
  await expect(page.locator(".sel-info")).toContainText("資源沒多到預留以上各 300，不擴編", { timeout: 30_000 });
  expect(await want(page)).toBe(2);

  // Plenty: it grows in its mix, the new ones join it, the barracks says so.
  await page.evaluate(() => window.__proto?.game?.stock({ food: 3000, wood: 3000, gold: 3000, crystal: 0 }));
  await expect.poll(() => want(page), { timeout: 60_000, message: "it grows" }).toBeGreaterThanOrEqual(4);
  await expect(page.locator(".sel-info")).toContainText(/資源多，自動擴編|不擴編：人口滿了/);
  await expect.poll(() => has(page), { timeout: 60_000, message: "the new ones join it" }).toBeGreaterThanOrEqual(3);
  const grown = await want(page);

  // Off: the numbers it grew to stay.
  await tapOn(page, ".groups > button:nth-child(1)");
  await openPanel(page);
  await page.locator(".sel-info").getByRole("button", { name: /^自動擴編/ }).tap();
  await expect(page.locator(".sel-info").getByRole("button", { name: /^自動擴編/ })).toHaveAccessibleName("自動擴編：關");
  const off = await want(page);
  expect(off).toBeGreaterThanOrEqual(grown);
  await page.waitForTimeout(3000);
  expect(await want(page), "kept, and no more").toBe(off);
  expect(await page.evaluate(() => window.__proto?.game?.groupInfo()[0]?.want[1] ?? 0)).toBeGreaterThan(2);
  check();
});
