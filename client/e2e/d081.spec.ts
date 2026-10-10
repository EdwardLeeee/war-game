// D-081 on the fake world (?test=1&mock=1): 閃紅提醒 (a group down to fewer than half of what it
// attacked with flashes red, reads 剩 a/b, and the strip says it once) and 「退1」–「退4」 beside an
// advancing group's button (one tap: the group back to the main city; the selection stays). Both on
// the phone held sideways, 814 × 380, in WebKit and Chromium: 「退」 at least 44 pt, on screen, and
// the flash and 「退」 clear of each other and of every other button.

import { expect, type Page, test } from "@playwright/test";
import { saveGroup, selectForCommands, shot, visibleBoxes, watchErrors } from "./helpers.ts";

const GROUP_1 = ".groups > button:nth-child(1)";
const GROUP_2 = ".groups > button:nth-child(2)";
const TICKS = { timeout: 30_000 };

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

const sent = (page: Page) => page.evaluate(() => (window.__proto?.game?.sent() ?? []) as Record<string, unknown>[]);
const lastOrder = async (page: Page) => (await sent(page)).filter((c) => c.auto !== true).at(-1);
const toast = (page: Page, text: string | RegExp) => page.getByRole("status").filter({ hasText: text });
const retreat = (page: Page, n: number) => page.getByRole("button", { name: `編隊 ${n} 撤回主城` });

async function ownIds(page: Page, type: number): Promise<number[]> {
  const me = await page.evaluate(() => window.__proto?.game?.me() ?? 0);
  return (await page.evaluate(() => window.__proto?.game?.units() ?? [])).filter((u) => u.owner === me && u.type === type).map((u) => u.id).sort((a, b) => a - b);
}

/** Groups 1 (the six spearmen) and 2 (the four ranged), nothing selected after. */
async function twoGroups(page: Page): Promise<{ g1: number[]; g2: number[] }> {
  const g1 = await ownIds(page, 1);
  const g2 = await ownIds(page, 2);
  await selectForCommands(page, g1);
  await saveGroup(page, GROUP_1);
  await selectForCommands(page, g2);
  await saveGroup(page, GROUP_2);
  await selectForCommands(page, []);
  return { g1, g2 };
}

/** The group goes forward (前進 far off, so it is still on its way for a while). */
const advance = (page: Page, ids: number[]) => page.evaluate((u) => window.__proto?.game?.send({ c: "move", u, x: 40, y: 20 }), ids);

/** Every visible button and the group buttons: at least 44 pt, on screen, none over another. */
async function clear(page: Page, what: string): Promise<void> {
  const { width, height } = page.viewportSize() ?? { width: 0, height: 0 };
  const boxes = await visibleBoxes(page, "button");
  for (const b of boxes) {
    expect.soft(Math.min(b.width, b.height), `${what}: ${b.label} size`).toBeGreaterThanOrEqual(44);
    expect.soft(b.x >= 0 && b.y >= 0 && b.x + b.width <= width && b.y + b.height <= height, `${what}: ${b.label} on screen`).toBe(true);
  }
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      const overlap = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 1 && Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 1;
      if (overlap) expect.soft(`${a.label} ↔ ${b.label}`, `${what}: overlapping`).toBe("");
    }
  }
}

test("「退」：只有進攻中的軍團有，寫編號；只有 2 進攻、1 和 2 都進攻時都在畫面裡、不擋別的按鈕；按退1，軍團 1 撤回主城、選取不變（D-081）", async ({ page }, info) => {
  const { g1, g2 } = await twoGroups(page);
  await expect(retreat(page, 1)).toBeHidden();
  await expect(retreat(page, 2)).toBeHidden();
  // Only 2 advances.
  await advance(page, g2);
  await expect(retreat(page, 2)).toBeVisible(TICKS);
  await expect(retreat(page, 2)).toHaveText("退2");
  await expect(retreat(page, 1)).toBeHidden();
  await clear(page, "only 2");
  await shot(page, info, "d081-retreat-only-2");
  // 1 too: 退1 right beside the buttons, 退2 one further out, in the same row.
  await advance(page, g1);
  await expect(retreat(page, 1)).toBeVisible(TICKS);
  const r1 = await retreat(page, 1).boundingBox();
  const r2 = await retreat(page, 2).boundingBox();
  const b1 = await page.locator(GROUP_1).boundingBox();
  if (r1 === null || r2 === null || b1 === null) throw new Error("no boxes");
  expect(Math.round(r1.y)).toBe(Math.round(b1.y));
  expect(Math.round(r2.y)).toBe(Math.round(b1.y));
  expect(r1.x + r1.width).toBeLessThanOrEqual(b1.x);
  expect(r2.x + r2.width).toBeLessThanOrEqual(r1.x);
  await clear(page, "1 and 2");
  await shot(page, info, "d081-retreat-1-and-2");
  // A tap: group 1 back home (the cell in front of the main city), nothing selected still.
  await retreat(page, 1).tap();
  await expect.poll(() => lastOrder(page)).toMatchObject({ c: "retreat", u: g1, x: 12, y: 79 });
  await expect(toast(page, "編隊 1 撤回主城")).toBeVisible();
  expect((await page.evaluate(() => window.__proto?.game?.selection()))?.units).toEqual([]);
  await expect(retreat(page, 1)).toBeHidden(TICKS);
  await expect(retreat(page, 2)).toBeVisible();
});

test("閃紅提醒：軍團 1 剩不到進攻時的一半，按鈕變紅、寫剩 a/b、提示只跳一次，和「退1」都看得清楚；撤退後提醒消失（D-081）", async ({ page }, info) => {
  const { g1 } = await twoGroups(page);
  await advance(page, g1);
  await expect(retreat(page, 1)).toBeVisible(TICKS);
  await expect(page.locator(GROUP_1)).not.toHaveClass(/alarm/);
  // Three fall: 3 of 6 is half, not fewer.
  await page.evaluate((ids) => window.__proto?.game?.remove(ids), g1.slice(0, 3));
  await expect(page.locator(GROUP_1)).toHaveText("1·3/6", TICKS);
  await expect(page.locator(GROUP_1)).not.toHaveClass(/alarm/);
  // A fourth: 2 of 6.
  await page.evaluate((ids) => window.__proto?.game?.remove(ids), g1.slice(3, 4));
  await expect(page.locator(GROUP_1)).toHaveClass(/alarm/, TICKS);
  await expect(page.locator(GROUP_1)).toHaveText("1·剩 2/6");
  await expect(toast(page, "編隊 1 快撐不住了（剩 2/6）")).toBeVisible();
  expect(await page.locator(GROUP_1).evaluate((e) => getComputedStyle(e).animationName)).toBe("group-alarm");
  await expect(retreat(page, 1)).toBeVisible();
  await clear(page, "alarm with 退1");
  await shot(page, info, "d081-alarm-and-retreat");
  // Back home: no longer advancing, the alarm goes.
  await retreat(page, 1).tap();
  await expect(page.locator(GROUP_1)).not.toHaveClass(/alarm/, TICKS);
  await expect(page.locator(GROUP_1)).toHaveText("1·2/6");
  await expect(retreat(page, 1)).toBeHidden();
});

test("待命的軍團：自動補兵的新兵走過來時（前進中）不出現「退」、不閃紅；玩家按進攻後「退」照常出現（D-081）", async ({ page }) => {
  const { g1 } = await twoGroups(page);
  // One falls: group 1 is short of a spearman, and the next one trained walks to it.
  await page.evaluate((ids) => window.__proto?.game?.remove(ids), g1.slice(0, 1));
  await expect(page.locator(GROUP_1)).toHaveText("1·5/6", TICKS);
  await page.evaluate(() => window.__proto?.game?.centerOn(5, 75));
  const barracks = await page.evaluate(() => window.__proto?.game?.cellToScreen(5.5, 75.5) ?? { x: 0, y: 0 });
  await page.touchscreen.tap(barracks.x, barracks.y);
  await expect(page.locator(".sel-info")).toContainText("兵營");
  await page.getByRole("button", { name: /^訓練槍兵/ }).tap();
  await expect(toast(page, /^新的槍兵補進編隊 1，正走過去$/)).toBeVisible(TICKS);
  const recruit = (await ownIds(page, 1)).find((id) => !g1.includes(id));
  // On his way (an order of 自動補兵's, not the player's): the group is not attacking.
  await expect.poll(async () => (await page.evaluate(() => window.__proto?.game?.units() ?? [])).find((u) => u.id === recruit)?.order, TICKS).toBe(1);
  for (let k = 0; k < 6; k++) {
    await expect(retreat(page, 1)).toBeHidden();
    await expect(page.locator(GROUP_1)).not.toHaveClass(/alarm/);
    await page.waitForTimeout(500);
  }
  // The player sends the group on: 「退1」 as always.
  await advance(page, [...g1.slice(1), recruit as number]);
  await expect(retreat(page, 1)).toBeVisible(TICKS);
});
