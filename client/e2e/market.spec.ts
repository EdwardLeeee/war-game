// 市場 (D-101, PROTOCOL.md 3.11; the draft the user approved 2026-10-24) on the fake world with its
// switch on (?market=1, features.market; a granary and a finished market of ours south of home):
// 建造 offers 市場 (木 150), greyed until a granary; our market's panel has a line each for food and
// wood, 買 100 and 賣 100 with the gold now; a tap trades one lot at once (`trade`), the toast says
// what was bought or sold and the price moves; not enough, the button greys and says why; refused,
// the line says why in plain words; how prices move, the first time the panel opens only. Off
// (every other page): no market.

import { expect, type Page, test } from "@playwright/test";
import { selectForCommands, shot, watchErrors } from "./helpers.ts";
import { tap } from "./touch.ts";

const MARKET = 15;
const GRANARY = 4;
const NOTE = "每按一下買或賣 100。買了會變貴、賣了會變便宜，之後慢慢回到 100 金。";

let checkErrors: () => void;

test.beforeEach(({ page }) => {
  checkErrors = watchErrors(page);
});

test.afterEach(() => {
  checkErrors();
});

async function start(page: Page, query: string): Promise<void> {
  await page.goto(`./?test=1&mock=1&tps=20${query}`);
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true, null, { timeout: 60_000 });
}

const buildings = (page: Page) => page.evaluate(() => window.__proto?.game?.buildings() ?? []);
const res = (page: Page) => page.evaluate(() => window.__proto?.game?.resources() ?? { food: 0, wood: 0, gold: 0, crystal: 0 });
const stock = (page: Page, c: { food: number; wood: number; gold: number; crystal: number }) => page.evaluate((v) => window.__proto?.game?.stock(v), c);
const sent = (page: Page) => page.evaluate(() => (window.__proto?.game?.sent() ?? []) as Record<string, unknown>[]);
const centre = (page: Page, x: number, y: number, scale = 1) => page.evaluate(([x, y, s]) => window.__proto?.game?.centerOn(x, y, s), [x, y, scale] as const);
const at = (page: Page, c: { x: number; y: number }) => page.evaluate(([x, y]) => window.__proto?.game?.cellToScreen(x, y) ?? { x: 0, y: 0 }, [c.x, c.y] as const);
const toast = (page: Page, text: string) => page.getByRole("status").filter({ hasText: text });

async function ours(page: Page, type: number): Promise<{ id: number; cx: number; cy: number }> {
  const me = await page.evaluate(() => window.__proto?.game?.me() ?? 0);
  const b = (await buildings(page)).find((v) => v.type === type && v.owner === me);
  if (b === undefined) throw new Error(`no building ${type} of ours`);
  return b;
}

/** Our market tapped (nothing else selected), its panel open; the market above the panel. */
async function openMarket(page: Page): Promise<void> {
  const m = await ours(page, MARKET);
  await selectForCommands(page, []);
  // Its panel gone first: else, the interface not updated in between (WebKit on CI, run 40097502995), the
  // tap selects the market again under the old panel, which is not built anew.
  await expect(page.locator(".market")).toHaveCount(0);
  await centre(page, m.cx + 1.5, m.cy + 1.5, 1.2);
  await tap(page, await at(page, { x: m.cx + 1, y: m.cy + 1 }));
  await expect(page.locator(".market")).toBeVisible();
}

test("市場開關關著（其他頁面都是）：建造選單沒有市場", async ({ page }) => {
  await start(page, "&r7=1");
  await selectForCommands(page, []);
  await page.getByRole("button", { name: "建造" }).tap();
  await expect(page.locator(".cmds").getByRole("button", { name: /^馬廄/ })).toBeVisible();
  await expect(page.locator(".cmds").getByRole("button", { name: /^市場/ })).toHaveCount(0);
});

test("市場（D-101）：面板寫買 100、賣 100 的價錢；按一下就成交一份、提示、價格跟著變；說明只在第一次打開時出現", async ({ page }, info) => {
  await start(page, "&market=1");
  await stock(page, { food: 300, wood: 300, gold: 400, crystal: 20 });
  await openMarket(page);
  const panel = page.locator(".market");
  const buyFood = panel.getByRole("button", { name: /^買 100 糧/ });
  const sellWood = panel.getByRole("button", { name: /^賣 100 木/ });
  await expect(buyFood).toContainText("付 100 金");
  await expect(sellWood).toContainText("得 70 金");
  await expect(panel.locator(".market-note")).toHaveText(NOTE);
  await shot(page, info, "market-panel-first");
  // One tap, one lot: food 300 → 400, gold 400 → 300; the price up 5.
  await buyFood.tap();
  await expect.poll(async () => (await sent(page)).filter((c) => c.c === "trade").at(-1)).toMatchObject({ c: "trade", resource: 0, buy: true, lots: 1 });
  await expect.poll(async () => (await res(page)).food, { timeout: 30_000 }).toBe(400);
  await expect(toast(page, "買進 100 糧，付 100 金")).toBeVisible();
  await expect(buyFood).toContainText("付 105 金");
  await expect(panel.getByRole("button", { name: /^賣 100 糧/ })).toContainText("得 73 金");
  // Sell a lot of wood: 70 gold, its price down 5.
  await sellWood.tap();
  await expect.poll(async () => (await res(page)).wood, { timeout: 30_000 }).toBe(200);
  await expect(toast(page, "賣出 100 木，得 70 金")).toBeVisible();
  await expect(sellWood).toContainText("得 66 金");
  // Opened again: no note (this device has seen it).
  await page.locator(".sel-info").getByRole("button", { name: "取消選取" }).tap();
  await openMarket(page);
  await expect(panel.locator(".market-note")).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("war-game.proto.marketHint"))).toBe("seen");
  await shot(page, info, "market-panel-again");
});

test("市場（D-101）：錢或貨不夠時按鈕變灰、寫原因；被拒時白話說原因（金不夠、沒有蓋好的市場）", async ({ page }, info) => {
  await start(page, "&market=1");
  await stock(page, { food: 60, wood: 300, gold: 50, crystal: 20 });
  await openMarket(page);
  const panel = page.locator(".market");
  await expect(panel.getByRole("button", { name: /^買 100 糧/ })).toBeDisabled();
  await expect(panel.getByRole("button", { name: /^買 100 糧/ })).toContainText("金不夠");
  await expect(panel.getByRole("button", { name: /^賣 100 糧/ })).toContainText("糧不到 100");
  await expect(panel.getByRole("button", { name: /^賣 100 木/ })).toBeEnabled();
  await shot(page, info, "market-cannot");
  // Two taps faster than the snapshot: the simulation refuses the second.
  await page.evaluate(() => window.__proto?.game?.send({ c: "trade", resource: 0, buy: true, lots: 1 }));
  await expect(toast(page, "金不夠，買不了 100 糧")).toBeVisible();
  // Our market falls as we tap.
  const m = await ours(page, MARKET);
  await page.evaluate((id) => window.__proto?.game?.remove([id]), m.id);
  await page.evaluate(() => window.__proto?.game?.send({ c: "trade", resource: 1, buy: false, lots: 1 }));
  await expect(toast(page, "沒有蓋好的市場，不能買賣")).toBeVisible();
});

test("市場（D-101）：建造選單有市場（木 150），沒有糧倉時是灰的、寫要先蓋糧倉", async ({ page }) => {
  await start(page, "&market=1");
  await selectForCommands(page, []);
  await page.getByRole("button", { name: "建造" }).tap();
  const market = page.locator(".cmds").getByRole("button", { name: /^市場/ });
  await expect(market).toContainText("木150");
  await expect(market).toBeEnabled();
  const granary = await ours(page, GRANARY);
  await page.evaluate((id) => window.__proto?.game?.remove([id]), granary.id);
  await expect(market).toBeDisabled();
  await expect(market).toContainText("要先蓋糧倉");
});
