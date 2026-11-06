// D-080 on the fake world (?test=1&mock=1): 攻擊紅、移動藍 (user 2026-10-09: 「攻擊跟撤退可以做成
// 紅色跟藍色的按鈕，不然有點搞不清楚」; D-094 renamed 進攻、撤退) on every 攻擊, 移動 and 撤退 button:
// the command area (and so the 軍團畫面 beside it), the long-press wheel, 全軍撤退 and 回主城; 堅守
// stays as it was. Every one of them is still at least 44 pt.

import { expect, type Locator, type Page, test } from "@playwright/test";
import { selectForCommands, shot, toneOf, watchErrors } from "./helpers.ts";
import { longPress } from "./touch.ts";

const SPEAR = { x: 22, y: 68 };

let checkErrors: () => void;

test.beforeEach(async ({ page }) => {
  checkErrors = watchErrors(page);
  await page.goto("./?test=1&mock=1&tps=20");
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true);
  await page.evaluate(() => window.__proto?.game?.centerOn(22, 71));
});

test.afterEach(() => {
  checkErrors();
});

const spearmen = async (page: Page) => {
  const me = await page.evaluate(() => window.__proto?.game?.me() ?? 0);
  return (await page.evaluate(() => window.__proto?.game?.units() ?? [])).filter((u) => u.owner === me && u.type === 1).map((u) => u.id);
};

/** Red or blue as the interface on screen paints it, only its own colours (ceo 2026-11-06; helpers.ts toneOf). */
async function toned(b: Locator, tone: "red" | "blue"): Promise<void> {
  const l = await toneOf(b);
  expect(l.tone).toBe(tone);
  expect(l.words, "the toned button's words (the prototype's white, 正式介面's ink)").toBe(true);
  expect(Math.min(l.w, l.h), "at least 44 pt").toBeGreaterThanOrEqual(44);
}
const untoned = async (b: Locator) => expect((await toneOf(b)).tone).toBe("other");

test("攻擊紅、移動藍：指令區（軍團畫面也是這一區）、取消攻擊／取消移動、全軍撤退、回主城都上色，堅守照舊（D-080、D-094）", async ({ page }, info) => {
  const cmds = page.locator(".cmds");
  await selectForCommands(page, await spearmen(page));
  await toned(cmds.getByRole("button", { name: /^攻擊/ }), "red");
  await toned(cmds.getByRole("button", { name: /^移動/ }), "blue");
  await untoned(cmds.getByRole("button", { name: /^堅守/ }));
  await toned(page.getByRole("button", { name: "全軍撤退" }), "blue");
  await shot(page, info, "d080-colours-commands");
  // 移動 asks where to: 回主城 is blue too, 取消 is not.
  await cmds.getByRole("button", { name: /^移動/ }).tap();
  await toned(page.locator(".prompt").getByRole("button", { name: "回主城", exact: true }), "blue");
  await untoned(page.locator(".prompt").getByRole("button", { name: "取消", exact: true }));
  await shot(page, info, "d080-colours-retreat-prompt");
  // Attacking (攻擊移動), the button reads 取消攻擊 and stays red.
  await page.locator(".prompt").getByRole("button", { name: "取消", exact: true }).tap();
  const ids = await spearmen(page);
  await page.evaluate((u) => window.__proto?.game?.send({ c: "move", u, x: 22, y: 50 }), ids);
  await expect(cmds.getByRole("button", { name: /^取消攻擊/ })).toBeVisible();
  await toned(cmds.getByRole("button", { name: /^取消攻擊/ }), "red");
});

test("攻擊紅、移動藍：長按輪盤的攻擊、移動上色，堅守照舊（D-080、D-094）", async ({ page }, info) => {
  const p = await page.evaluate(([x, y]) => window.__proto?.game?.cellToScreen(x, y) ?? { x: 0, y: 0 }, [SPEAR.x, SPEAR.y] as const);
  await longPress(page, p);
  await expect.poll(() => page.evaluate(() => window.__proto?.game?.wheel())).toEqual(["advance", "retreat", "hold"]);
  await toned(page.getByRole("menuitem", { name: "攻擊" }), "red");
  await toned(page.getByRole("menuitem", { name: "移動" }), "blue");
  await untoned(page.getByRole("menuitem", { name: "堅守" }));
  await shot(page, info, "d080-colours-wheel");
});
