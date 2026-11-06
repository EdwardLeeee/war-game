// 正式介面's start card and dialogs (D-127, ?ui=r6): R6-10's card in two columns (你的陸, 難度, 地圖 on
// the left with 電腦：… after 你的陸; 開始 on the right), its title without 原型; R6-20's dialogs panels
// with the interface's buttons, the main (gold) or 投降 (red) at the right end; B's lacquer on the card,
// not over the whole screen. The prototype's start card as it was.

import { expect, type Page, test } from "@playwright/test";

const box = async (page: Page, selector: string) => {
  const b = await page.locator(selector).first().boundingBox();
  if (b === null) throw new Error(`no ${selector}`);
  return b;
};

for (const theme of ["a", "b"] as const) {
  test(`正式介面的開局（R6-10，${theme === "a" ? "A 銅木" : "B 墨漆金線"}）：兩欄；你的陸在最上面、後面寫電腦穿哪一陸；開始在右邊；標題沒有「原型」`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem("war-game.proto.theme", t), theme);
    await page.goto("./?test=1&mock=1&tps=20&ui=r6");
    await expect(page.getByRole("heading", { name: "war-game", exact: true })).toBeVisible();
    await expect(page.locator("#start .card")).toHaveClass(/\bpanel\b/);
    const culture = await box(page, "#start .culture");
    const difficulty = await box(page, "#start .difficulty:not(.culture):not(.map-mode)");
    const start = await box(page, "#start-game");
    expect(culture.y, "你的陸 above 難度").toBeLessThan(difficulty.y);
    expect(start.x, "開始 right of the choices").toBeGreaterThan(culture.x + culture.width);
    expect(start.height).toBeGreaterThanOrEqual(44);
    await expect(page.locator("#start .computer-culture")).toHaveText("電腦：西陸");
    await page.getByRole("radio", { name: "西陸" }).tap();
    await expect(page.locator("#start .computer-culture")).toHaveText("電腦：東陸");
    await page.getByRole("radio", { name: "東陸" }).tap();
    // The card is a box of its own, not the whole screen (B's lacquer on ::before).
    const card = await box(page, "#start .card");
    expect(card.width, "the card 640 at most").toBeLessThanOrEqual(641);
    expect(await page.locator("#start .card").evaluate((e) => getComputedStyle(e).position)).toBe("relative");
  });

  test(`正式介面的對話框（R6-20，${theme === "a" ? "A 銅木" : "B 墨漆金線"}）：選單是面板、按鈕是正式介面的；確定投降的「投降」紅色、在「取消」右邊`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem("war-game.proto.theme", t), theme);
    await page.goto("./?test=1&mock=1&tps=20&ui=r6");
    await page.getByRole("button", { name: "開始" }).tap();
    await page.waitForFunction(() => window.__proto?.ready === true);
    await page.getByRole("button", { name: "選單" }).tap();
    const dialog = page.locator(".dialog");
    await expect(dialog.locator(".dialog-card")).toHaveClass(/\bpanel\b/);
    expect(await dialog.locator(".dialog-card").evaluate((e) => getComputedStyle(e).position)).toBe("relative");
    const buttons = dialog.locator(".dialog-card button");
    const n = await buttons.count();
    expect(n).toBeGreaterThan(5);
    for (let i = 0; i < n; i++) {
      await expect(buttons.nth(i)).toHaveClass(/\bb\b/);
      expect((await buttons.nth(i).boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    await dialog.getByRole("button", { name: "投降" }).tap();
    const yes = dialog.getByRole("button", { name: "投降" });
    const no = dialog.getByRole("button", { name: "取消" });
    await expect(yes).toHaveClass(/\bred\b/);
    const y = await yes.boundingBox();
    const c = await no.boundingBox();
    expect((y?.x ?? 0) > (c?.x ?? 0), "投降 at the right end").toBe(true);
    await no.tap();
    await expect(dialog).toBeHidden();
  });
}

test("原型的開局照舊：標題「war-game 原型」，不是面板，沒有「電腦：…」", async ({ page }) => {
  await page.goto("./?test=1&mock=1&tps=20");
  await expect(page.getByRole("heading", { name: "war-game 原型" })).toBeVisible();
  await expect(page.locator("#start .card")).not.toHaveClass(/\bpanel\b/);
  await expect(page.locator("#start .computer-culture")).toHaveCount(0);
  await expect(page.locator("#start button.b")).toHaveCount(0);
});
