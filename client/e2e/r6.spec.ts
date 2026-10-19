// R6 正式介面 (D-087, design/r6/spec.md) on the fake world (?test=1&mock=1&ui=r6): R6-1, the looks.
// Off by default (ceo 2026-10-19: the prototype's until R6 is all in). On: A 銅木 the first time;
// 選單 → 設定 → 介面風格 changes it at once and the device keeps it; the top of the battlefield
// (R6-11) and the groups (R6-12) in both, and a button pressed, lit.

import { expect, type Page, test } from "@playwright/test";
import { injectSafeArea, saveGroup, selectForCommands, shot, visibleBoxes, watchErrors } from "./helpers.ts";

const theme = (page: Page) => page.evaluate(() => document.documentElement.dataset.theme);

async function start(page: Page): Promise<void> {
  await page.goto("./?test=1&mock=1&tps=20&ui=r6");
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true);
}

/** Groups 1 and 2 saved (R6-12 shows them with what they have), group 1 selected (lit). */
async function twoGroups(page: Page): Promise<void> {
  const own = await page.evaluate(() => {
    const g = window.__proto?.game;
    const me = g?.me();
    return (g?.units() ?? []).filter((u) => u.owner === me && u.type !== 0).map((u) => u.id).sort((a, b) => a - b);
  });
  await selectForCommands(page, own.slice(0, 6));
  await saveGroup(page, ".groups > button:nth-child(2)");
  await selectForCommands(page, own.slice(6));
  await saveGroup(page, ".groups > button:nth-child(1)");
}

test("正式介面關著（預設）：畫面照原型——原型標示還在、資源列是一行字、選單沒有設定、R6 的樣子不套用（ceo 2026-10-19）", async ({ page }) => {
  const check = watchErrors(page);
  await page.goto("./?test=1&mock=1&tps=20");
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true);
  expect(await page.evaluate(() => document.documentElement.dataset.ui ?? null)).toBeNull();
  await expect(page.getByText("原型介面（非正式設計）")).toBeVisible();
  await expect(page.locator(".res-bar")).toHaveText(/^糧 \d+　木 \d+　金 \d+　晶 \d+　人口 \d+\/\d+/);
  await expect(page.getByRole("button", { name: "速度 正常" })).toHaveText("速度 正常");
  await expect(page.locator("#hud .b")).toHaveCount(0);
  await page.getByRole("button", { name: "選單" }).tap();
  await expect(page.getByRole("button", { name: "設定" })).toHaveCount(0);
  check();
});

test("介面風格（R6-20）：第一次是 A 銅木；選單 → 設定 → B 墨漆金線立刻換、記在這台裝置，重新整理後還是 B", async ({ page }) => {
  const check = watchErrors(page);
  await start(page);
  expect(await theme(page)).toBe("a");
  await page.getByRole("button", { name: "選單" }).tap();
  await page.getByRole("button", { name: "設定" }).tap();
  const row = page.getByRole("radiogroup", { name: "介面風格" });
  await expect(row.getByRole("radio", { name: "A 銅木" })).toHaveAttribute("aria-checked", "true");
  await row.getByRole("radio", { name: "B 墨漆金線" }).tap();
  expect(await theme(page)).toBe("b");
  await expect(row.getByRole("radio", { name: "B 墨漆金線" })).toHaveAttribute("aria-checked", "true");
  expect(await page.evaluate(() => localStorage.getItem("war-game.proto.theme"))).toBe("b");
  await page.reload();
  expect(await theme(page)).toBe("b");
  check();
});

for (const look of ["a", "b"] as const) {
  test(`戰場上方和編隊（R6-11、R6-12）：${look === "a" ? "A 銅木" : "B 墨漆金線"}；資源列是圖示加數字，速度、暫停、選單 52×44，編隊 48×44、全軍 102×44，位置照規格`, async ({ page }, info) => {
    const check = watchErrors(page);
    await page.goto("./?test=1&mock=1&tps=20&ui=r6");
    await page.evaluate((t) => localStorage.setItem("war-game.proto.theme", t), look);
    await page.reload();
    await page.getByRole("button", { name: "開始" }).tap();
    await page.waitForFunction(() => window.__proto?.ready === true);
    expect(await theme(page)).toBe(look);
    await injectSafeArea(page, { top: 0, right: 0, bottom: 0, left: 0 });
    await twoGroups(page);
    // Spec section 2 (the mock's measures), in the 814 × 380 box.
    const box = async (sel: string) => (await visibleBoxes(page, sel))[0];
    const near = (v: number, want: number) => Math.abs(v - want) <= 2;
    const res = await box(".res-bar");
    expect(near(res.x, 4) && near(res.y, 4) && near(res.height, 36), `資源列 ${JSON.stringify(res)}`).toBe(true);
    for (const [name, x] of [["速度 正常", 642], ["暫停", 700], ["選單", 758]] as const) {
      const b = page.getByRole("button", { name, exact: true });
      const bb = await b.boundingBox();
      expect(bb !== null && near(bb.x, x) && near(bb.y, 4) && near(bb.width, 52) && near(bb.height, 44), `${name} ${JSON.stringify(bb)}`).toBe(true);
    }
    const retreat = await box(".retreat-all-btn");
    expect(near(retreat.x, 136) && near(retreat.y, 46) && retreat.height >= 44, `全軍撤退 ${JSON.stringify(retreat)}`).toBe(true);
    const g1 = await box(".groups > button:nth-child(1)");
    expect(near(g1.x, 708) && near(g1.y, 54) && near(g1.width, 48) && near(g1.height, 44), `編隊 1 ${JSON.stringify(g1)}`).toBe(true);
    const army = await box(".army-btn");
    expect(near(army.x, 708) && near(army.y, 154) && near(army.width, 102) && near(army.height, 44), `全軍 ${JSON.stringify(army)}`).toBe(true);
    // Group 1 is what is selected: lit.
    await expect(page.locator(".groups > button:nth-child(1)")).toHaveClass(/is-active/);
    await expect(page.locator(".groups > button:nth-child(3)")).toHaveClass(/empty/);
    await page.evaluate(() => window.__proto?.game?.centerOn(22, 71, 1.2));
    await shot(page, info, `r6-11-12-${look}`);
    // A button pressed (R6-25-01): while the finger is on it.
    const speed = page.getByRole("button", { name: "速度 正常" });
    await speed.dispatchEvent("pointerdown", { pointerType: "touch", isPrimary: true });
    await expect(speed).toHaveClass(/is-pressed/);
    await shot(page, info, `r6-40-pressed-${look}`);
    await speed.dispatchEvent("pointerup", { pointerType: "touch", isPrimary: true });
    await expect(speed).not.toHaveClass(/is-pressed/);
    check();
  });
}
