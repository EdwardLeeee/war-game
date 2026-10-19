// 礦場的晶 (the user 2026-10-20: 「礦場目前不能把村民叫過去採集晶礦，要修一下」; ceo) on the fake
// world with two mines of ours (?test=1&mock=1&mine=1, src/mock/mock-port.ts): a tap on a mine
// shows 金 and 晶, each with − and ＋ (D-066). ＋ on 晶 sends an idle villager to the vein by it
// (`gather`, the player's own); − lets the one there go (`release`); the mine with no vein near
// says so.

import { expect, type Page, test } from "@playwright/test";
import { shot, watchErrors } from "./helpers.ts";
import { tap } from "./touch.ts";

const MINE = 3;
const CRYSTAL_VEIN = 3;

const lastSent = (page: Page) => page.evaluate(() => window.__proto?.game?.sent().at(-1) as Record<string, unknown> | undefined);
const sentCount = (page: Page) => page.evaluate(() => (window.__proto?.game?.sent() ?? []).length);
const toScreen = (page: Page, c: { x: number; y: number }) => page.evaluate(([x, y]) => window.__proto?.game?.cellToScreen(x, y) ?? { x: 0, y: 0 }, [c.x, c.y] as const);

type Building = { id: number; cx: number; cy: number; size: number };

/** Tap the middle of an own building, nothing selected, and wait for its panel. */
async function open(page: Page, b: Building): Promise<void> {
  await page.evaluate(() => window.__proto?.game?.select([]));
  await page.evaluate(([x, y]) => window.__proto?.game?.centerOn(x, y, 1.2), [b.cx + b.size / 2, b.cy + b.size / 2] as const);
  await tap(page, await toScreen(page, { x: b.cx + b.size / 2 - 0.5, y: b.cy + b.size / 2 - 0.5 }));
  await expect.poll(async () => (await page.evaluate(() => window.__proto?.game?.selection()))?.building).toBe(b.id);
  await expect(page.locator(".sel-info .sel-head")).toContainText("礦場");
}

test("礦場的晶（使用者 2026-10-20）：礦場有金、晶兩列；晶的＋派閒置的村民去旁邊的晶脈、確認訊息條；－讓他放下工作；附近沒有晶脈時提示", async ({ page }, info) => {
  const check = watchErrors(page);
  await page.goto("./?test=1&mock=1&tps=20&mine=1");
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true);
  const me = await page.evaluate(() => window.__proto?.game?.me() ?? 0);
  const mines = (await page.evaluate(() => window.__proto?.game?.buildings() ?? [])).filter((b) => b.owner === me && b.type === MINE).sort((a, b) => a.cy - b.cy);
  expect(mines.length).toBe(2);
  const [byVein, noVein] = mines;
  const vein = (await page.evaluate(() => window.__proto?.game?.nodes() ?? [])).find((n) => n.kind === CRYSTAL_VEIN && n.cx === byVein.cx + 3);
  if (vein === undefined) throw new Error("no vein by the mine");

  // Two rows: 金 and 晶.
  await open(page, byVein);
  const panel = page.locator(".sel-info");
  await expect(panel.locator(".depot-count")).toHaveText(["附近有 0 名村民在採金", "附近有 0 名村民在採晶"]);
  await expect(panel.getByRole("button", { name: "少派 1 名村民採晶" })).toBeDisabled();
  await shot(page, info, "mine-crystal-panel");

  // ＋ on 晶: an idle villager to the vein, the player's own order; the dark line with a check.
  const idle = await page.evaluate(() => {
    const g = window.__proto?.game;
    return (g?.units() ?? []).filter((u) => u.owner === g?.me() && u.type === 0 && u.order === 0).map((u) => u.id);
  });
  expect(idle.length).toBeGreaterThan(0);
  await panel.getByRole("button", { name: "多派 1 名村民採晶" }).tap();
  await expect.poll(() => lastSent(page)).toMatchObject({ c: "gather", node: vein.id });
  const sent = (await lastSent(page))?.u as number[];
  expect(sent.length).toBe(1);
  expect(idle, "an idle one first").toContain(sent[0]);
  await expect(page.locator(".toast")).toHaveText("已派 1 名去採晶");
  await expect(page.locator(".toast")).toHaveClass(/\btoast-ok\b/);
  await expect(panel.locator(".depot-count").nth(1)).toHaveText("附近有 1 名村民在採晶");
  await shot(page, info, "mine-crystal-sent");

  // － on 晶: the one there lets go (back to the economy ratio).
  await panel.getByRole("button", { name: "少派 1 名村民採晶" }).tap();
  await expect.poll(() => lastSent(page)).toMatchObject({ c: "release", u: [sent[0]] });
  await expect(page.locator(".toast")).toHaveText("1 名採晶的村民放下工作，交給經濟分配");
  await expect(panel.locator(".depot-count").nth(1)).toHaveText("附近有 0 名村民在採晶");

  // The other mine: no vein within reach, so it says so and sends no one.
  await open(page, noVein);
  const mark = await sentCount(page);
  await panel.getByRole("button", { name: "多派 1 名村民採晶" }).tap();
  await expect(page.locator(".toast")).toHaveText("附近沒有晶脈");
  expect(await sentCount(page)).toBe(mark);
  check();
});
