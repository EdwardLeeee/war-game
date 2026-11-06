// 正式介面's 選取資訊 and 軍團畫面 under 全軍撤退 (PR 5, ceo 2026-11-07): with five kinds (the real
// simulation's rules: 槍兵、遠程兵、法師、騎兵、攻城砲) or a long explanation, at R6's 814 × 380 and at
// 932 × 336 (Safari with its tab bar) with the iPhone's safe area, the panel reaches neither over
// 全軍撤退 nor over the top bar; what does not fit scrolls inside it (#402), a fade and a ⌄ at the foot
// of what scrolls until its end (the ⌄ scrolls a row); the 軍團畫面's 改成剛才選的／清空／自動補兵 row
// pinned under it, always in sight (ui 2026-11-07); its ✕ and title line stay in reach; every button
// at least 44 pt.

import { expect, type Page, test } from "@playwright/test";
import { injectSafeArea, openPanel } from "./helpers.ts";
import { tapOn } from "./touch.ts";

const SIZES = [
  { width: 814, height: 380 },
  { width: 932, height: 336 },
] as const;

async function start(page: Page, size: { width: number; height: number }): Promise<void> {
  await page.setViewportSize(size);
  await page.goto("./?test=1&ui=r6&scenario=e2e&ai=0");
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true, null, { timeout: 90_000 });
  await injectSafeArea(page);
}

/** The panel against what is above it, and its buttons' sizes. */
const look = (page: Page) =>
  page.evaluate(() => {
    const p = document.querySelector(".sel-info")?.getBoundingClientRect();
    if (p === undefined) return null;
    const over = (s: string) => [...document.querySelectorAll(s)].some((e) => {
      const b = e.getBoundingClientRect();
      return b.width > 0 && Math.min(p.right, b.right) - Math.max(p.left, b.left) > 0 && Math.min(p.bottom, b.bottom) - Math.max(p.top, b.top) > 0;
    });
    const small = [...document.querySelectorAll<HTMLElement>(".sel-info button")]
      .filter((b) => b.getClientRects().length > 0)
      .filter((b) => Math.min(b.getBoundingClientRect().width, b.getBoundingClientRect().height) < 44)
      .map((b) => b.textContent || b.getAttribute("aria-label"));
    return { top: p.top, overRetreat: over(".retreat-all-btn"), overTop: over(".res-bar") || over(".top-right button"), small };
  });

const body = (page: Page) => page.locator(".sel-info .sel-body");

/**
 * Every button in sight in the panel is what a tap at its middle and 6 above its foot finds (b2
 * 2026-11-07: the ⌄ over the row above took a + tapped low); points scrolled out of sight are skipped.
 */
const tapsTaken = (page: Page) =>
  page.evaluate(() => {
    const frame = document.querySelector(".sel-info")?.getBoundingClientRect();
    const bodyBox = document.querySelector(".sel-info .sel-body")?.getBoundingClientRect();
    if (frame === undefined || bodyBox === undefined) return ["no panel"];
    const taken: string[] = [];
    for (const b of document.querySelectorAll<HTMLElement>(".sel-info button")) {
      const r = b.getBoundingClientRect();
      if (r.width === 0 || b.closest("[hidden]") !== null) continue;
      const clip = b.closest(".sel-body") === null ? frame : bodyBox;
      const x = r.left + r.width / 2;
      for (const y of [r.top + r.height / 2, r.bottom - 6]) {
        if (y < clip.top || y > clip.bottom || x < clip.left || x > clip.right) continue;
        const at = document.elementFromPoint(x, y);
        if (at === null || !b.contains(at)) taken.push(`${b.textContent || b.getAttribute("aria-label")} at ${Math.round(y - r.top)}: ${at?.className || at?.tagName}`);
      }
    }
    return taken;
  });
const fade = (page: Page) => page.locator(".sel-info .sel-more");

for (const size of SIZES) {
  test(`軍團畫面五種兵（${size.width}×${size.height}，安全區）：不蓋全軍撤退和上面那排；放不下在面板裡捲，下面淡出到捲到底；× 和標題列一直在、按得到`, async ({ page }) => {
    test.setTimeout(120_000);
    await start(page, size);
    await tapOn(page, ".groups > button:nth-child(2)");
    await openPanel(page);
    const panel = page.locator(".sel-info");
    await expect(panel.locator(".group-row")).toHaveCount(5);
    const l = await look(page);
    expect(l?.overRetreat, "not over 全軍撤退").toBe(false);
    expect(l?.overTop, "not over the top bar").toBe(false);
    expect(l?.small, "every button at least 44 pt").toEqual([]);
    // Scrolled to its top: a tap on any button in sight is that button's, not the ⌄'s.
    expect(await tapsTaken(page), "taps on the buttons in sight").toEqual([]);
    // 自動補兵 and its row: pinned under what scrolls, in sight without scrolling.
    const refill = panel.getByRole("button", { name: /^自動補兵/ });
    await expect(refill).toBeInViewport({ ratio: 1 });
    expect(await refill.evaluate((b) => b.closest(".sel-body") === null), "out of what scrolls").toBe(true);
    // Too tall here: it scrolls, the fade and its ⌄ say so; the ⌄ scrolls a row down.
    expect(await body(page).evaluate((e) => e.scrollHeight > e.clientHeight + 2), "scrolls inside").toBe(true);
    await expect(fade(page)).toBeVisible();
    const before = await body(page).evaluate((e) => e.scrollTop);
    await panel.getByRole("button", { name: "往下捲" }).tap();
    await expect.poll(() => body(page).evaluate((e) => e.scrollTop), { message: "the ⌄ scrolls down" }).toBeGreaterThan(before + 20);
    // At its end: the last kind in sight, no fade and no ⌄.
    await body(page).evaluate((e) => {
      e.scrollTop = e.scrollHeight;
    });
    await expect(fade(page)).toBeHidden();
    await expect(panel.getByRole("button", { name: "往下捲" })).toBeHidden();
    const last = panel.locator(".group-grid > *").last();
    const [lb, bb] = await Promise.all([last.boundingBox(), body(page).boundingBox()]);
    expect((lb?.y ?? 0) + (lb?.height ?? 0), "the last kind in sight").toBeLessThanOrEqual((bb?.y ?? 0) + (bb?.height ?? 0) + 1);
    // The title line and the ✕ still there (sticky), the ✕ closes it.
    await expect(panel.locator(".sel-head")).toBeInViewport();
    await panel.getByRole("button", { name: "取消選取" }).tap();
    await expect(panel).toBeHidden();
  });

  test(`選取資訊說明很多行（全軍：攻擊、移動、堅守、進駐、晶砲、隊形…，${size.width}×${size.height}，安全區）：不蓋全軍撤退和上面那排；按鈕至少 44`, async ({ page }) => {
    test.setTimeout(120_000);
    await start(page, size);
    await page.locator(".army-btn").tap();
    const panel = page.locator(".sel-info");
    await expect(panel.locator(".order-meaning").first()).toBeVisible();
    // Unfolded (全軍 may fold it, as a group button does).
    const unfold = panel.getByRole("button", { name: "展開選取資訊" });
    if (await unfold.isVisible()) await unfold.tap();
    await expect(panel.locator(".order-meaning")).not.toHaveCount(0);
    const l = await look(page);
    expect(l?.overRetreat, "not over 全軍撤退").toBe(false);
    expect(l?.overTop, "not over the top bar").toBe(false);
    expect(l?.small, "every button at least 44 pt").toEqual([]);
    // Scrolled to its end, no fade.
    await body(page).evaluate((e) => {
      e.scrollTop = e.scrollHeight;
    });
    await expect(fade(page)).toBeHidden();
  });
}

test("軍團畫面三種兵（932×430，安全區）：放得下，不捲、沒有淡出", async ({ page }) => {
  await page.setViewportSize({ width: 932, height: 430 });
  await page.goto("./?test=1&ui=r6&mock=1&tps=20");
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true);
  await injectSafeArea(page);
  await tapOn(page, ".groups > button:nth-child(2)");
  await openPanel(page);
  expect(await body(page).evaluate((e) => e.scrollHeight - e.clientHeight)).toBeLessThanOrEqual(2);
  await expect(fade(page)).toBeHidden();
});
