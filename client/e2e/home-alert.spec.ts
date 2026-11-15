// 主城被打的警示 (D-141; the user 2026-11-11: 「我覺得沒有必要 有提示可以了」): the enemy's soldiers the screen sees within
// 12 cells of our main city, before they hit it, said on the strip in red, 「敵軍 N 名接近主城」, again when 5 more come; the
// main city hit, the prototype says 「家裡被攻擊：主城附近有敵兵」 as 正式介面 does (its 全體回城 as before). The red arrow
// to an attack off the screen keeps off the buttons and the minimap (正式介面's 地圖 at 932 × 336 was under it). The
// fake world, the camera away from home, the iPhone's 932 × 336 with its safe area, both interfaces.

import { expect, type Page, test } from "@playwright/test";
import { expectNotSaid, expectSaid, injectSafeArea, recordToasts, watchErrors } from "./helpers.ts";

const FIXED = 1024;
const FOE = 1;

async function start(page: Page, ui: "proto" | "r6"): Promise<void> {
  await page.setViewportSize({ width: 932, height: 336 });
  await page.goto(`./?test=1&mock=1&tps=20&ui=${ui}`);
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true);
  await injectSafeArea(page);
  await recordToasts(page);
  // Away from home (8, 80): the army's front, say.
  await page.evaluate(() => window.__proto?.game?.centerOn(60, 50, 1.1));
}

/** The enemy's soldiers to put by our main city. */
const foes = (page: Page) => page.evaluate(() => (window.__proto?.game?.units() ?? []).filter((u) => u.owner === 1 && u.type !== 0).map((u) => u.id));

/** Put these at cells 6–8 east of our main city's footprint (8, 80, 4 × 4), three to a row. */
const putNearHome = (page: Page, ids: number[], from: number) =>
  page.evaluate(([list, k]) => window.__proto?.game?.place(list, list.map((_, i) => ({ x: 18 + ((k + i) % 3), y: 76 + Math.floor((k + i) / 3) }))), [ids, from] as const);

for (const ui of ["proto", "r6"] as const) {
  test(`主城警示（${ui === "r6" ? "正式介面" : "原型"}）：敵軍進到主城 12 格內就說「敵軍 N 名接近主城」，多來 5 名再說；主城被打時說「家裡被攻擊」；紅箭頭不蓋按鈕和小地圖`, async ({ page }) => {
    test.setTimeout(120_000);
    const check = watchErrors(page);
    await start(page, ui);
    const ids = await foes(page);
    expect(ids.length, "the fake world's enemy soldiers").toBeGreaterThanOrEqual(6);
    await putNearHome(page, ids.slice(0, 1), 0);
    await expectSaid(page, "敵軍 1 名接近主城");
    // Two more (3): not again so soon.
    const said = await page.evaluate(() => (window as unknown as { __said?: unknown[] }).__said?.length ?? 0);
    await putNearHome(page, ids.slice(1, 3), 1);
    await page.waitForTimeout(1500);
    await expectNotSaid(page, /敵軍 \d+ 名接近主城/, said);
    // Three more (6, 5 more than said): again.
    await putNearHome(page, ids.slice(3, 6), 3);
    await expectSaid(page, "敵軍 6 名接近主城");

    // The main city hit: said (the prototype too), the red arrow off the buttons and the minimap.
    const city = await page.evaluate(() => (window.__proto?.game?.buildings() ?? []).find((b) => b.owner === window.__proto?.game?.me() && b.type === 0));
    if (city === undefined) throw new Error("no main city");
    await page.evaluate(([id, x, y, by]) => window.__proto?.game?.inject({ k: "attacked", x, y, target: id, by }), [city.id, Math.round((city.cx + 2) * FIXED), Math.round((city.cy + 2) * FIXED), FOE] as const);
    await expectSaid(page, "家裡被攻擊：主城附近有敵兵");
    const arrow = page.locator(".alert-arrow").first();
    await expect(arrow).toBeVisible();
    await page.waitForTimeout(400);
    const covered = await page.evaluate(() => {
      const a = document.querySelector(".alert-arrow")?.getBoundingClientRect();
      if (a === undefined) return ["no arrow"];
      const out: string[] = [];
      for (const e of document.querySelectorAll<HTMLElement>("#hud button, #hud canvas")) {
        if (e.closest(".alert-arrows") !== null) continue;
        const r = e.getBoundingClientRect();
        if (r.width === 0 || r.height === 0 || r.width > innerWidth * 0.8) continue;
        if (Math.min(a.right, r.right) - Math.max(a.left, r.left) > 0 && Math.min(a.bottom, r.bottom) - Math.max(a.top, r.top) > 0) out.push(e.getAttribute("aria-label") || e.textContent || e.className);
      }
      return out;
    });
    expect(covered, "the arrow over nothing").toEqual([]);
    if (ui === "r6") await expect(page.locator(".recall-btn")).toContainText("家裡被攻擊");
    check();
  });
}
