// 正式介面's 建造 page against 全軍 (PR 5, ceo 2026-11-06 modification 3 and 2026-11-07 option B): the
// longest page, four columns (the fake world's twelve) and five (the real simulation's fourteen, R14-04),
// at R6's 814 × 380 stays under 全軍; at 932 × 336 (Safari with its tab bar, the user's iPhone) it cannot,
// so the right column (編隊 1–4, 全軍) is out of sight, in its place, while the page is open. Every
// button at least 44 pt, no words cut.

import { expect, type Page, test } from "@playwright/test";
import { selectForCommands } from "./helpers.ts";

const SETUPS = [
  { name: "四欄", query: "mock=1&tps=20&r7=1&outpost=1", cols5: false },
  { name: "五欄", query: "scenario=e2e&ai=0", cols5: true },
] as const;

async function buildPage(page: Page, query: string, size: { width: number; height: number }): Promise<void> {
  await page.setViewportSize(size);
  await page.goto(`./?test=1&ui=r6&${query}`);
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true, null, { timeout: 90_000 });
  const me = await page.evaluate(() => window.__proto?.game?.me() ?? 0);
  const farmers = (await page.evaluate(() => window.__proto?.game?.units() ?? [])).filter((u) => u.owner === me && u.type === 0).map((u) => u.id);
  await selectForCommands(page, farmers);
  await page.locator(".cmds").getByRole("button", { name: "建造" }).tap();
  await expect(page.locator(".cmds").getByRole("button", { name: "返回" })).toBeVisible();
}

/** The page's buttons: at least 44 pt, nothing cut; the page's top and 全軍's bottom. */
const measure = (page: Page) =>
  page.evaluate(() => {
    const buttons = [...document.querySelectorAll<HTMLElement>(".cmds button")].filter((b) => b.getBoundingClientRect().width > 0);
    const cut = buttons.filter((b) => [b, ...b.querySelectorAll<HTMLElement>("*")].some((e) => e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1)).map((b) => b.textContent);
    const small = buttons.filter((b) => Math.min(b.getBoundingClientRect().width, b.getBoundingClientRect().height) < 44).map((b) => b.textContent);
    const army = document.querySelector(".army-btn")?.getBoundingClientRect();
    return { cols5: document.querySelector(".cmds")?.classList.contains("cols5") ?? false, top: document.querySelector(".cmds")?.getBoundingClientRect().top ?? 0, armyBottom: army === undefined ? 0 : army.bottom, cut, small };
  });

/** Where the other buttons are (the left column, the top right, 全軍撤退): hiding the right column moves none. */
const others = (page: Page) => page.evaluate(() => [...document.querySelectorAll<HTMLElement>(".side-left button, .top-right button, .retreat-all-btn")].map((b) => { const r = b.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y)]; }));

for (const s of SETUPS) {
  test(`建造選單（${s.name}，814×380，R6 的大小）：在全軍下面、不重疊，右邊照稿不收；按鈕至少 44 pt、沒有字被切掉`, async ({ page }) => {
    test.setTimeout(120_000);
    await buildPage(page, s.query, { width: 814, height: 380 });
    const m = await measure(page);
    expect(m.cols5).toBe(s.cols5);
    expect(m.top, "the page under 全軍").toBeGreaterThanOrEqual(m.armyBottom);
    expect(m.small, "at least 44 pt").toEqual([]);
    expect(m.cut, "no words cut").toEqual([]);
    await expect(page.locator(".side-right")).toBeVisible();
    await expect(page.locator(".army-btn")).toBeVisible();
  });

  test(`建造選單（${s.name}，932×336，Safari 有分頁列）：放不下時右邊的編隊和全軍收起，其他按鈕不動；返回、選好建築就放回來`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 932, height: 336 });
    await page.goto(`./?test=1&ui=r6&${s.query}`);
    await page.getByRole("button", { name: "開始" }).tap();
    await page.waitForFunction(() => window.__proto?.ready === true, null, { timeout: 90_000 });
    const me = await page.evaluate(() => window.__proto?.game?.me() ?? 0);
    const farmers = (await page.evaluate(() => window.__proto?.game?.units() ?? [])).filter((u) => u.owner === me && u.type === 0).map((u) => u.id);
    await selectForCommands(page, farmers);
    const before = await others(page);
    await expect(page.locator(".army-btn")).toBeVisible();
    await page.locator(".cmds").getByRole("button", { name: "建造" }).tap();
    await expect(page.locator(".cmds").getByRole("button", { name: "返回" })).toBeVisible();
    const m = await measure(page);
    expect(m.cols5).toBe(s.cols5);
    expect(m.small, "at least 44 pt").toEqual([]);
    expect(m.cut, "no words cut").toEqual([]);
    await expect(page.locator(".side-right"), "編隊 1–4 and 全軍 out of sight").toBeHidden();
    await expect(page.locator(".army-btn")).toBeHidden();
    expect(await others(page), "the other buttons where they were").toEqual(before);
    // 返回: back at once.
    await page.locator(".cmds").getByRole("button", { name: "返回" }).tap();
    await expect(page.locator(".army-btn")).toBeVisible();
    expect(await others(page)).toEqual(before);
    // A building chosen: back too.
    await page.locator(".cmds").getByRole("button", { name: "建造" }).tap();
    await expect(page.locator(".side-right")).toBeHidden();
    await page.locator(".cmds").getByRole("button", { name: /^民居/ }).tap();
    await expect(page.locator(".army-btn")).toBeVisible();
  });
}
