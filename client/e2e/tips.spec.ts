// 滑鼠說明 (R26 03 A, design/r26/spec.md section 03; ceo 2026-11-20), a computer's window (a mouse, no touch: where it goes at 1920 × 950, what it says at 1366 × 768)
// on the fake world: the pointer still on a button 0.4 s, a tip over it (6 above, its right edge on the button's, in the
// window) with the name, the key, the price and the line (？'s for an order; ceo's for a building and a soldier); to the
// next button at once; gone when pressed and on Esc. On the phone never.

import { expect, type Locator, type Page, test } from "@playwright/test";
import { tapOwnBuilding, watchErrors } from "./helpers.ts";

const W = 1920;
const H = 950;
const BARRACKS = 6;

const tip = (page: Page) => page.locator(".tip");
const shown = (page: Page) => page.evaluate(() => {
  const t = document.querySelector<HTMLElement>(".tip");
  return t !== null && !t.hidden ? (t.textContent ?? "") : null;
});

async function start(page: Page, flags = ""): Promise<void> {
  await page.goto(`./?test=1&mock=1&tps=20${flags}`);
  await page.getByRole("button", { name: "開始", exact: true }).click();
  await page.waitForFunction(() => window.__proto?.ready === true && window.__proto.screen === "battle");
  await page.waitForFunction(() => (window.__proto?.game?.header().tick ?? 0) > 5);
  await page.evaluate(() => window.__proto?.game?.pause());
}

/** The pointer onto the middle of `b`. */
async function hover(page: Page, b: Locator, steps = 2): Promise<{ x: number; y: number; right: number; top: number; bottom: number }> {
  // Drawn (the command area may be built again between two looks: the next look finds the new one).
  await expect.poll(async () => (await b.boundingBox()) !== null).toBe(true);
  const r = await b.boundingBox();
  if (r === null) throw new Error("not drawn");
  await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2, { steps });
  return { x: r.x, y: r.y, right: r.x + r.width, top: r.y, bottom: r.y + r.height };
}

// Where a tip goes, at the user's own size (1920 × 1080, a Chromium browser; ceo 2026-11-21: what is about layout keeps a
// test at 1920 × 950 in Chromium).
test.describe("滑鼠 1920×950", () => {
  test.use({ viewport: { width: W, height: H }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 });
  // Chromium on CI draws 1920 × 950 with the CPU (as mouse.spec).
  test.describe.configure({ timeout: 120_000 });

  test("指令：停 0.4 秒出現（名字、按鍵、？那一行），在按鈕上方 6、右邊對齊；移到隔壁馬上換；按下去、Esc 就收起", async ({ page }) => {
    const check = watchErrors(page);
    await start(page);
    const me = await page.evaluate(() => window.__proto?.game?.me() ?? 0);
    const army = (await page.evaluate(() => window.__proto?.game?.units() ?? [])).filter((u) => u.owner === me && [1, 2, 3].includes(u.type)).map((u) => u.id);
    await page.evaluate((u) => window.__proto?.game?.select(u), army);
    const cmds = page.locator(".cmds");
    const attack = cmds.getByRole("button", { name: /^攻擊/ });
    await expect(attack).toBeVisible();
    // When the pointer last moved and when the tip came, timed in the page (a busy page may answer the test late).
    await page.evaluate(() => {
      const w = window as unknown as { tipTimes: { moved: number; shown: number } };
      w.tipTimes = { moved: 0, shown: 0 };
      document.addEventListener("pointermove", () => (w.tipTimes.moved = performance.now()), true);
      const t = document.querySelector(".tip");
      if (t !== null) new MutationObserver(() => {
        if (!(t as HTMLElement).hidden && w.tipTimes.shown === 0) w.tipTimes.shown = performance.now();
      }).observe(t, { attributes: true, attributeFilter: ["hidden"] });
    });
    const b = await hover(page, attack);
    await expect(tip(page)).toBeVisible();
    // Not at once: 0.4 s after the pointer stopped on it.
    const times = await page.evaluate(() => (window as unknown as { tipTimes: { moved: number; shown: number } }).tipTimes);
    expect(times.shown - times.moved, "0.4 s after the pointer stopped").toBeGreaterThanOrEqual(395);
    await expect(tip(page)).toContainText("攻擊");
    await expect(tip(page).locator(".tip-key")).toHaveText("Q");
    await expect(tip(page)).toContainText("點地面或敵人：邊走邊打，或集中打它");
    // Over the button: its foot 6 above it (as large as the interface is drawn), its right edge on the button's.
    const k = await page.evaluate(() => {
      const hud = document.getElementById("hud");
      return hud === null || hud.offsetWidth === 0 ? 1 : hud.getBoundingClientRect().width / hud.offsetWidth;
    });
    const t = await tip(page).boundingBox();
    if (t === null) throw new Error("no tip");
    expect(Math.abs(t.y + t.height - (b.top - 6 * k)), "6 above").toBeLessThan(2);
    expect(Math.abs(t.x + t.width - Math.min(b.right, W - 4 * k)), "right edge on the button's").toBeLessThan(2);
    expect(t.x).toBeGreaterThanOrEqual(4 * k - 1);
    // The command area built again under the still pointer (another selection): the new 攻擊's tip, the pointer not moved.
    const before = await attack.evaluate((e) => ((e as unknown as { mark?: number }).mark = 1));
    expect(before).toBe(1);
    await page.evaluate((u) => window.__proto?.game?.select(u), army.slice(0, 2));
    await expect.poll(() => attack.evaluate((e) => (e as unknown as { mark?: number }).mark ?? 0)).toBe(0);
    await expect(tip(page)).toBeVisible();
    await expect(tip(page)).toContainText("攻擊");
    // The next button: at once (within 0.3 s of the last going; straight there, one move: a busy page may take longer
    // than that between two).
    await hover(page, cmds.getByRole("button", { name: /^移動/ }), 1);
    expect(await shown(page), "at once").toContain("移動");
    // Pressed: gone, and not again while the pointer stays on it.
    await page.mouse.down();
    expect(await shown(page)).toBeNull();
    await page.mouse.up();
    await expect.poll(() => page.evaluate(() => window.__proto?.game?.mode())).toBe("retreat");
    await page.waitForTimeout(600);
    expect(await shown(page), "still on it after a press: none").toBeNull();
    await page.keyboard.press("Escape");
    await expect.poll(() => page.evaluate(() => window.__proto?.game?.mode())).toBe("normal");
    // Esc: gone.
    await hover(page, cmds.getByRole("button", { name: /^更多/ }));
    await expect(tip(page)).toBeVisible();
    await expect(tip(page)).toContainText("更多");
    await page.keyboard.press("Escape");
    await expect(tip(page)).toBeHidden();
    check();
  });

});

// What the tips say, at 1366 × 768 (ceo 2026-11-21: what is not about layout runs at the smaller window, a third less for
// Chromium to draw on CI; its 1920 × 950 build and train test took 53 s of 120 on a Xeon 8370C, run 44845805329).
test.describe("滑鼠 1366×768", () => {
  test.use({ viewport: { width: 1366, height: 768 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 });
  test.describe.configure({ timeout: 120_000 });

  test("建造、訓練：價錢和那一句；變灰的寫要先蓋什麼", async ({ page }) => {
    const check = watchErrors(page);
    await start(page, "&siege=1");
    await page.evaluate(() => window.__proto?.game?.select([]));
    await page.locator(".cmds").getByRole("button", { name: /^建造/ }).click();
    await expect(page.locator(".cmds.build-page")).toBeVisible();
    const page1 = page.locator(".cmds.build-page");
    await hover(page, page1.getByRole("button", { name: /^兵營/ }));
    await expect(tip(page)).toBeVisible();
    await expect(tip(page).locator(".tip-cost")).toHaveText(/^木\d+/);
    await expect(tip(page)).toContainText("訓練槍兵。");
    // Grey: what to build first.
    await hover(page, page1.getByRole("button", { name: /^砲坊/ }));
    await expect(tip(page)).toContainText("砲坊");
    await expect(tip(page)).toContainText("訓練攻城砲。");
    await expect(tip(page)).toContainText("要先蓋射場");
    await page.keyboard.press("Escape");
    // The barracks: 訓練槍兵's price, its 剋／怕, the spearman's line.
    const b = (await page.evaluate(() => window.__proto?.game?.buildings() ?? [])).find((v) => v.type === BARRACKS && v.owner === 0);
    if (b === undefined) throw new Error("no barracks");
    await tapOwnBuilding(page, b.id, 1);
    const train = page.locator(".cmds").getByRole("button", { name: /^訓練槍兵/ });
    await expect(train).toBeVisible();
    await hover(page, train);
    await expect(tip(page)).toBeVisible();
    await expect(tip(page).locator(".tip-cost")).toHaveText(/糧\d+/);
    await expect(tip(page)).toContainText("近戰，便宜耐打。");
    check();
  });
});

test.describe("手機", () => {
  test("手指點按鈕不會出現說明", async ({ page }) => {
    const check = watchErrors(page);
    await page.goto("./?test=1&mock=1&tps=20");
    await page.getByRole("button", { name: "開始", exact: true }).tap();
    await page.waitForFunction(() => window.__proto?.ready === true && window.__proto.screen === "battle");
    await page.evaluate(() => window.__proto?.game?.pause());
    await page.locator(".cmds").getByRole("button", { name: /^建造/ }).tap();
    await page.waitForTimeout(700);
    expect(await shown(page)).toBeNull();
    check();
  });
});
