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

async function startFake(page: Page, flags = ""): Promise<number> {
  await page.goto(`./?test=1&mock=1&tps=20&ui=r6${flags}`);
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true);
  return page.evaluate(() => window.__proto?.game?.me() ?? 0);
}

test("正式介面的選單和設定（R6-20 INV-116、NEW-07）：全體回城、設定有圖示；設定有兩種風格的縮圖和「換了馬上生效」那行", async ({ page }) => {
  await startFake(page);
  await page.getByRole("button", { name: "選單" }).tap();
  const dialog = page.locator(".dialog");
  await expect(dialog.getByRole("button", { name: "全體回城" }).locator("svg.ic")).toHaveCount(1);
  await expect(dialog.getByRole("button", { name: "設定" }).locator("svg.ic")).toHaveCount(1);
  await dialog.getByRole("button", { name: "設定" }).tap();
  await expect(dialog.locator(".theme-thumb")).toHaveCount(2);
  await expect(dialog.locator(".theme-note")).toHaveText("換了馬上生效，下次打開也照這個");
  await expect(dialog.getByRole("radio", { name: /A 銅木/ })).toHaveClass(/\bis-active\b/);
});

test("正式介面的經濟分配、預留（R6-20 INV-120、INV-121）：自動分配和取消、套用同一列；預留第 4 行寫魔晶", async ({ page }) => {
  const me = await startFake(page);
  const city = (await page.evaluate(() => window.__proto?.game?.buildings() ?? [])).find((b) => b.owner === me && b.type === 0);
  if (city === undefined) throw new Error("no main city");
  await page.evaluate(([x, y]) => window.__proto?.game?.centerOn(x, y, 1), [city.cx + 2, city.cy + 2] as const);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const at = await page.evaluate(([x, y]) => window.__proto?.game?.cellToScreen(x, y) ?? { x: 0, y: 0 }, [city.cx + 2, city.cy + 2] as const);
  await page.touchscreen.tap(at.x, at.y);
  await page.locator(".cmds").getByRole("button", { name: /^經濟分配/ }).tap();
  const dialog = page.locator(".dialog");
  const toggle = await dialog.getByRole("button", { name: /^自動分配/ }).boundingBox();
  const apply = await dialog.getByRole("button", { name: "套用" }).boundingBox();
  expect(Math.abs((toggle?.y ?? 0) - (apply?.y ?? 99)), "on one line").toBeLessThan(2);
  expect((toggle?.x ?? 0) < (apply?.x ?? 0), "自動分配 at the left").toBe(true);
  await dialog.getByRole("button", { name: "取消" }).tap();
  await page.locator(".cmds").getByRole("button", { name: /^預留/ }).tap();
  await expect(dialog.locator(".ratio-name").nth(3)).toHaveText("魔晶");
});

test("正式介面的攻下城鎮（R6-20 INV-122、INV-124）：搶和治理共用一個留守，選搶照這個數字留；只能治理時卡片半寬、稍後再決定在右邊", async ({ page }) => {
  const me = await startFake(page);
  await page.evaluate((by) => window.__proto?.game?.inject({ k: "town_captured", town: 0, by }), me);
  const dialog = page.locator(".dialog");
  await expect(dialog.locator(".choice-row .b")).toHaveCount(2);
  await expect(dialog.getByRole("group", { name: /^留守/ })).toHaveCount(1);
  await expect(dialog.getByRole("status", { name: "留守幾名" })).toHaveText("1");

  const once = await startFake(page, "&r7=1");
  await page.evaluate((by) => window.__proto?.game?.inject({ k: "town_captured", town: 0, by }), once);
  const card = await dialog.locator(".choice-row .b").boundingBox();
  const row = await dialog.locator(".choice-row").boundingBox();
  expect((card?.width ?? 999) <= (row?.width ?? 0) / 2 + 1, `治理 half the width: ${JSON.stringify({ card, row })}`).toBe(true);
  const later = await dialog.getByRole("button", { name: /稍後再決定/ }).boundingBox();
  const panel = await dialog.locator(".dialog-card").boundingBox();
  expect((later?.x ?? 0) + (later?.width ?? 0) > (panel?.x ?? 0) + (panel?.width ?? 0) - 40, "稍後再決定 at the right").toBe(true);
});

test("正式介面的勝利（R6-21 INV-130）：標題「勝利」金色、置中，回開局畫面和重來兩顆，重來在右邊", async ({ page }) => {
  const me = await startFake(page);
  await page.evaluate((w) => window.__proto?.game?.endGame(w, 0), me);
  const result = page.locator(".dialog.result.won");
  await expect(result.locator("h2")).toHaveText("勝利");
  expect(await result.locator("h2").evaluate((e) => getComputedStyle(e).textAlign)).toBe("center");
  const again = await result.getByRole("button", { name: "重來" }).boundingBox();
  const home = await result.getByRole("button", { name: "回開局畫面" }).boundingBox();
  expect((again?.x ?? 0) > (home?.x ?? 0), "重來 at the right end").toBe(true);
});
