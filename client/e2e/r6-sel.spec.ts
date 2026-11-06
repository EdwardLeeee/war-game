// 正式介面's selection info (D-127, ?ui=r6) on the fake world: R14's words under several soldiers
// (ceo 2026-11-06: 「正式介面照 R14 的稿換字，包含多選時的『進駐』那行…原型不改」), 市場's four buttons on
// one line (R14-03), a 3 × 3 outpost's squares and count on one line, whose they are last (R14-05).

import { expect, type Page, test } from "@playwright/test";
import { saveGroup, selectForCommands } from "./helpers.ts";
import { tap } from "./touch.ts";

const panel = (page: Page) => page.locator(".sel-info");

async function start(page: Page, flags: string): Promise<void> {
  await page.goto(`./?test=1&mock=1&${flags}&tps=20&ui=r6`);
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true);
  await page.waitForFunction(() => (window.__proto?.game?.header().tick ?? 0) > 5);
}

/** Tap one of our buildings where the picker finds it; its panel opens. */
async function tapBuilding(page: Page, id: number): Promise<void> {
  const b = (await page.evaluate(() => window.__proto?.game?.buildings() ?? [])).find((v) => v.id === id);
  if (b === undefined) throw new Error(`no building ${id}`);
  await page.evaluate(([x, y]) => window.__proto?.game?.centerOn(x, y, 1), [b.cx + b.size / 2, b.cy + b.size / 2] as const);
  for (let y = b.cy; y < b.cy + b.size; y++) {
    for (let x = b.cx; x < b.cx + b.size; x++) {
      const at = await page.evaluate(([cx, cy]) => window.__proto?.game?.cellToScreen(cx + 0.5, cy + 0.5) ?? { x: 0, y: 0 }, [x, y] as const);
      if ((await page.evaluate(([sx, sy]) => window.__proto?.game?.pickAt(sx, sy) ?? null, [at.x, at.y] as const)) !== "building") continue;
      await tap(page, at);
      await expect.poll(() => page.evaluate(() => window.__proto?.game?.selection().building ?? null)).toBe(id);
      return;
    }
  }
  throw new Error(`no cell of building ${id} to tap`);
}

const ownSoldiers = async (page: Page) => {
  const me = await page.evaluate(() => window.__proto?.game?.me() ?? 0);
  return (await page.evaluate(() => window.__proto?.game?.units() ?? [])).filter((u) => u.owner === me && [1, 2, 3].includes(u.type));
};

test("正式介面：多選的說明照 R14 的字，多一行進駐；「目前：」在兵種鈕那一列；只選一種兵時剋怕在說明裡（原型照舊）", async ({ page }) => {
  await start(page, "r7=1&outpost=1");
  const soldiers = await ownSoldiers(page);
  await selectForCommands(page, soldiers.map((u) => u.id));
  const note = panel(page).locator(".sel-note");
  await expect(note.locator(".order-meaning").first()).toHaveText("攻擊點地面或敵人：邊走邊打，或集中打它");
  await expect(note.locator(".order-meaning .k").first()).toHaveText("攻擊");
  await expect(note.locator(".enter-meaning")).toHaveText("進駐再點自己的城、主城、箭樓或哨所：那棟決定誰進去");
  await expect(panel(page).locator(".sel-chips .now")).toHaveText(/^目前：/);
  // One kind: 剋怕 the last line of the help, no line of its own above it.
  await selectForCommands(page, soldiers.filter((u) => u.type === 1).map((u) => u.id));
  await expect(note.locator(".counter-meaning")).toHaveText(/^剋怕剋：/);
  await expect(panel(page).locator(".sel-counters")).toHaveCount(0);
  await expect(note.locator(".enter-meaning")).toHaveCount(1);
});

test("原型：說明照舊（沒有進駐那行、剋怕自己一行）", async ({ page }) => {
  await page.goto("./?test=1&mock=1&r7=1&outpost=1&tps=20&ui=proto");
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true);
  const soldiers = await ownSoldiers(page);
  await selectForCommands(page, soldiers.filter((u) => u.type === 1).map((u) => u.id));
  const note = panel(page).locator(".sel-note");
  await expect(note.locator(".order-meaning").first()).toHaveText(/^攻擊：點地面或小地圖攻擊移動/);
  await expect(note.locator(".enter-meaning")).toHaveCount(0);
  await expect(panel(page).locator(".sel-counters")).toHaveCount(1);
});

test("正式介面的市場（R14-03）：買賣糧、買賣木四顆在同一列，說明在下面", async ({ page }) => {
  await start(page, "market=1");
  const market = (await page.evaluate(() => window.__proto?.game?.buildings() ?? [])).find((b) => b.type === 15);
  if (market === undefined) throw new Error("no market");
  await tapBuilding(page, market.id);
  const buttons = panel(page).locator(".market button");
  await expect(buttons).toHaveCount(4);
  const tops = await buttons.evaluateAll((bs) => bs.map((b) => Math.round(b.getBoundingClientRect().top)));
  expect(new Set(tops).size, `the four on one line: ${tops}`).toBe(1);
  const note = await panel(page).locator(".market-note").boundingBox();
  const first = await buttons.first().boundingBox();
  if (note !== null && first !== null) expect(note.y).toBeGreaterThan(first.y + first.height - 1);
  for (const b of await buttons.all()) expect((await b.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
});

test("正式介面的 3×3 哨所（R14-05）：方塊和幾名在同一列，正過來的方塊另外畫；誰的兵和召回在最後一列", async ({ page }) => {
  await start(page, "r7=1&outpost=1&hide=1");
  const post = (await page.evaluate(() => window.__proto?.game?.buildings() ?? [])).find((b) => b.type === 12 && b.owner === 0);
  if (post === undefined) throw new Error("no outpost");
  const spears = (await ownSoldiers(page)).filter((u) => u.type === 1).map((u) => u.id);
  await selectForCommands(page, spears);
  await saveGroup(page, ".groups > button:nth-child(1)");
  await page.evaluate(([u, b]) => window.__proto?.game?.send({ c: "post", u, building: b }), [spears, post.id] as const);
  await page.evaluate(() => window.__proto?.game?.select([]));
  await tapBuilding(page, post.id);
  const row = panel(page).locator(".seat-row").first();
  await expect(row.locator(".seat")).toHaveCount(9);
  await expect.poll(async () => (await row.locator(".seat:not(.empty)").count()) > 0, { timeout: 30_000 }).toBe(true);
  const count = await row.locator(".outpost-count").boundingBox();
  const seat = await row.locator(".seat").last().boundingBox();
  if (count === null || seat === null) throw new Error("no squares");
  expect(Math.abs(count.y + count.height / 2 - (seat.y + seat.height / 2)), "the count beside the squares").toBeLessThan(8);
  const groups = panel(page).locator(".outpost-groups");
  await expect(groups).toContainText(/^編隊 1：\d+ 名召回$/);
  // The last row (the fade at the foot of what scrolls, .sel-more, is not one).
  const last = await panel(page).locator(".sel-body > :not(.sel-more)").last().getAttribute("class");
  expect(last).toContain("outpost-groups");
});
