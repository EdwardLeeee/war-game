// 戰事標記 (R17-03, ui's board; the user 2026-11-10: 「可以，照這樣做」): under the time axis of 資源, 兵力 and 城鎮 a
// row of marks where each 進攻, 防守 and 團戰 began, a small legend at the end of the legend row; a tap anywhere on the
// chart opens the card of the nearest (two lines, 上一件／下一件, which of how many, 關閉), its mark gold. The fake
// world ends with one of the player's own games (e2e/fixtures/r17-lost-92m.json: 92:39, lost; 進攻 17, 防守 20,
// 團戰 13), on the iPhone's 932 × 336 with its safe area, both interfaces.

import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { injectSafeArea, IPHONE_SAFE } from "./helpers.ts";

const LOST = JSON.parse(readFileSync(new URL("./fixtures/r17-lost-92m.json", import.meta.url), "utf8")) as { winner: number; reason: number; ticks: number; timeline: unknown };
const S = 20;
/** lineChart's time axis (ui/stats/charts.ts LINE_SPAN): from 46 to its width less 96. */
const SPAN = { left: 46, right: 96 };

async function endWith(page: Page, ui: "r6" | "proto"): Promise<void> {
  await page.setViewportSize({ width: 932, height: 336 });
  await page.goto(`./?test=1&mock=1&tps=20&ui=${ui}`);
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true);
  await injectSafeArea(page);
  expect(await page.evaluate(() => window.__proto?.game?.me() ?? -1), "the game's player 0, as in the fixture").toBe(0);
  await page.evaluate(([w, r, tl]) => window.__proto?.game?.endGame(w as number, r as number, tl as never), [LOST.winner, LOST.reason, LOST.timeline] as const);
  await expect(page.getByRole("dialog", { name: "失敗" })).toBeVisible();
}

/** Tap the chart at a time (ticks), on its plot. */
async function tapAt(page: Page, tick: number): Promise<void> {
  const svg = page.locator(".st-chart svg").first();
  const b = await svg.boundingBox();
  if (b === null) throw new Error("no chart");
  const pw = b.width - SPAN.left - SPAN.right;
  await page.touchscreen.tap(b.x + SPAN.left + (tick / LOST.ticks) * pw, b.y + b.height * 0.55);
}

for (const ui of ["r6", "proto"] as const) {
  test(`戰事標記（${ui === "r6" ? "正式介面" : "原型"}，932×336 安全區）：三張圖的時間軸下一排 50 個記號、圖例在那一列右端；點圖跳出最近那件的卡，上一件／下一件、關閉`, async ({ page }) => {
    test.setTimeout(120_000);
    await endWith(page, ui);
    const dialog = page.getByRole("dialog", { name: "失敗" });
    for (const tab of ["資源", "兵力", "城鎮"]) {
      await dialog.getByRole("tab", { name: tab }).tap();
      await expect(dialog.locator(".st-chart svg .st-wm"), tab).toHaveCount(50);
      await expect(dialog.locator(".st-chart svg .st-wm.raid"), tab).toHaveCount(17);
      await expect(dialog.locator(".st-chart svg .st-wm.defend"), tab).toHaveCount(20);
      await expect(dialog.locator(".st-chart svg .st-wm.battle"), tab).toHaveCount(13);
      const key = dialog.locator(".st-wkey");
      await expect(key, tab).toContainText("進攻");
      await expect(key, tab).toContainText("防守");
      await expect(key, tab).toContainText("團戰");
      // At the end of its row: its right edge at the row's.
      const k = await key.boundingBox();
      const row = await key.locator("xpath=..").boundingBox();
      expect(k !== null && row !== null && Math.abs(k.x + k.width - (row.x + row.width)) <= 2, `${tab}: the legend at the row's end`).toBe(true);
    }

    await dialog.getByRole("tab", { name: "兵力" }).tap();
    await tapAt(page, (39 * 60 + 30) * S);
    const card = dialog.getByRole("group", { name: "戰事 22／50" });
    await expect(card).toBeVisible();
    await expect(card).toContainText("防守 39:30");
    await expect(card).toContainText("敵方最多 39 名");
    await expect(card).toContainText("失守後搶回");
    await expect(card).toContainText("敵死 2、我死 1");
    await expect(card).toContainText("22 / 50");
    await expect(dialog.locator(".st-chart svg .st-wm.on")).toHaveCount(1);
    // Inside the screen and its safe area; its buttons 44 pt; nothing cut.
    const fit = await card.evaluate((c, safe) => {
      const r = c.getBoundingClientRect();
      const small = [...c.querySelectorAll("button")].filter((b) => b.offsetWidth < 44 || b.offsetHeight < 44).map((b) => b.textContent ?? "");
      const cut = [...c.querySelectorAll("p, span, b")].filter((e) => (e as HTMLElement).scrollWidth > (e as HTMLElement).clientWidth + 1).map((e) => e.textContent ?? "");
      return { inside: r.left >= safe.left - 0.5 && r.right <= innerWidth - safe.right + 0.5 && r.top >= safe.top - 0.5 && r.bottom <= innerHeight - safe.bottom + 0.5, small, cut, buttons: c.querySelectorAll("button").length };
    }, IPHONE_SAFE);
    expect(fit).toEqual({ inside: true, small: [], cut: [], buttons: 3 });

    await card.getByRole("button", { name: "下一件" }).tap();
    await expect(dialog.getByRole("group", { name: "戰事 23／50" })).toContainText("23 / 50");
    await dialog.getByRole("button", { name: "上一件" }).tap();
    await expect(dialog.getByRole("group", { name: "戰事 22／50" })).toBeVisible();
    // It stays from chart to chart.
    await dialog.getByRole("tab", { name: "資源" }).tap();
    await expect(dialog.getByRole("group", { name: "戰事 22／50" })).toBeVisible();
    await dialog.getByRole("tab", { name: "城鎮" }).tap();
    await expect(dialog.getByRole("group", { name: "戰事 22／50" })).toBeVisible();
    // The first has no 上一件, the last no 下一件.
    await dialog.getByRole("tab", { name: "兵力" }).tap();
    await tapAt(page, 0);
    await expect(dialog.getByRole("group", { name: "戰事 1／50" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "上一件" })).toBeDisabled();
    await tapAt(page, LOST.ticks);
    await expect(dialog.getByRole("group", { name: "戰事 50／50" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "下一件" })).toBeDisabled();
    await dialog.getByRole("button", { name: "關閉" }).tap();
    await expect(dialog.getByRole("group", { name: /^戰事/ })).toHaveCount(0);
    await expect(dialog.locator(".st-chart svg .st-wm.on")).toHaveCount(0);
  });
}
