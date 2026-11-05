// 選取資訊 never off the screen (the user 2026-11-06 on the iPhone: 「如果部隊有駐兵到別地方，我選部隊的
// 那個列表會破圖不能點到x關掉」): a group with soldiers stationed in a town and hiding in the main city,
// 軍團畫面 open; on the phone held sideways (814 × 380, the iPhone 14 Pro Max's 932 × 430 and its
// safe areas) the panel stays on the screen under the top bar, its ✕ there and a finger across; on a
// shorter screen what it shows scrolls inside it, its title line (and 收起) at the top. Under the
// prototype's look and under 正式介面 (?ui=r6) alike.

import { expect, type Page, test } from "@playwright/test";
import { injectSafeArea, saveGroup, selectForCommands } from "./helpers.ts";

const GROUP_1 = ".groups > button:nth-child(1)";
const OUR_TOWN = { id: 1, x: 18, y: 62 };
const units = (page: Page) => page.evaluate(() => window.__proto?.game?.units() ?? []);
const buildings = (page: Page) => page.evaluate(() => window.__proto?.game?.buildings() ?? []);

for (const [ui, name] of [["", "原型"], ["&ui=r6", "正式介面"]] as const) {
  test(`軍團畫面（${name}）：編隊有兵駐在城、躲在主城時，面板不超出畫面，× 在畫面內點得到；放不下時內容在面板裡捲，標題列留在上面`, async ({ page }) => {
    test.setTimeout(180_000);
    await injectSafeArea(page);
    await page.goto(`./?test=1&mock=1&r7=1&outpost=1&hide=1&walls=1&tps=20${ui}`);
    await page.getByRole("button", { name: "開始" }).tap();
    await page.waitForFunction(() => window.__proto?.ready === true);
    await page.waitForFunction(() => (window.__proto?.game?.header().tick ?? 0) > 5, null, { timeout: 60_000 });
    const me = await page.evaluate(() => window.__proto?.game?.me() ?? 0);
    const own = (await units(page)).filter((u) => u.owner === me && [1, 2, 3].includes(u.type));
    const ids = own.map((u) => u.id).sort((a, b) => a - b);
    await selectForCommands(page, ids);
    await saveGroup(page, GROUP_1);
    // Three ranged hiding in the main city; the group's spearmen into our town, as the player does it.
    const city = (await buildings(page)).find((b) => b.type === 0 && b.owner === me);
    if (city === undefined) throw new Error("no main city");
    await page.evaluate(([u, b]) => window.__proto?.game?.send({ c: "garrison", u, building: b }), [own.filter((u) => u.type === 2).map((u) => u.id).slice(0, 3), city.id] as const);
    await selectForCommands(page, own.filter((u) => u.type === 1).map((u) => u.id).slice(0, 2));
    await page.locator(".cmds").getByRole("button", { name: /^進駐/ }).tap();
    await expect.poll(() => page.evaluate(() => window.__proto?.game?.mode())).toBe("enter");
    await page.evaluate(([x, y]) => window.__proto?.game?.centerOn(x, y, 1), [OUR_TOWN.x + 0.5, OUR_TOWN.y + 0.5] as const);
    await page.waitForTimeout(400);
    const townAt = await page.evaluate(([x, y]) => window.__proto?.game?.cellToScreen(x, y) ?? { x: 0, y: 0 }, [OUR_TOWN.x + 0.5, OUR_TOWN.y + 0.5] as const);
    await page.touchscreen.tap(townAt.x, townAt.y);
    await expect.poll(async () => (await page.evaluate((t) => window.__proto?.game?.garrison(t) ?? [], OUR_TOWN.id)).length, { timeout: 30_000 }).toBeGreaterThan(0);
    await expect.poll(async () => (await buildings(page)).find((b) => b.id === city.id)?.soldiers ?? 0, { timeout: 30_000 }).toBeGreaterThan(0);
    // 軍團畫面, open.
    await page.evaluate(() => window.__proto?.game?.select([]));
    await page.locator(GROUP_1).tap();
    const panel = page.locator(".sel-info");
    await expect(panel.locator(".sel-head")).toContainText(/^編隊 1/);
    const unfold = panel.getByRole("button", { name: "展開選取資訊" });
    if (await unfold.isVisible()) await unfold.tap();
    await expect(panel.locator(".group-place").first()).toBeVisible();
    const close = panel.getByRole("button", { name: "取消選取" });
    for (const size of [{ width: 814, height: 380 }, { width: 932, height: 430 }, { width: 814, height: 300 }]) {
      await page.setViewportSize(size);
      await page.waitForTimeout(300);
      const p = await panel.boundingBox();
      const x = await close.boundingBox();
      if (p === null || x === null) throw new Error("no panel");
      expect(p.y, `${size.width}×${size.height}: the panel's top on the screen`).toBeGreaterThanOrEqual(0);
      expect(p.y + p.height).toBeLessThanOrEqual(size.height);
      expect(x.y, "the ✕ on the screen").toBeGreaterThanOrEqual(0);
      expect(x.x + x.width).toBeLessThanOrEqual(size.width);
      expect(Math.min(x.width, x.height), "a finger across").toBeGreaterThanOrEqual(44);
    }
    // 814 × 300: it scrolls inside; the title line stays at the top, the last row comes into view.
    const body = panel.locator(".sel-body");
    const sizes = await body.evaluate((e) => ({ scroll: e.scrollHeight, client: e.clientHeight }));
    expect(sizes.scroll).toBeGreaterThan(sizes.client);
    await body.evaluate((e) => e.scrollTo(0, e.scrollHeight));
    const head = await panel.locator(".sel-head").boundingBox();
    const top = await panel.boundingBox();
    expect(head !== null && top !== null && head.y - top.y < 20, "the title line at the top").toBe(true);
    await expect(panel.getByRole("button", { name: /^自動補兵/ })).toBeInViewport();
    // And the ✕ does what it says.
    await close.tap();
    await expect(panel).toBeHidden();
  });
}
