// ＋遠程 with nobody near（D-138 B; the user 2026-11-10: 「我的主堡按駐守還是會跳周圍沒有兵可以叫進來，如果附近沒有那就等兵營造出來
// 自己走進去」, and chose 「每按一次多練一名」）on the fake world (round 7): with no range, it says none can be trained; with one,
// the main city keeps a place, 自動訓練 trains one more ranged there and the new one walks in, not to a group; 全部離開 gives
// the places up.

import { expect, type Page, test } from "@playwright/test";
import { expectSaid, recordToasts, watchErrors } from "./helpers.ts";
import { tap } from "./touch.ts";

const MAIN_CITY = 0;
const RANGE = 7;
const RANGED = 2;

const sent = (page: Page) => page.evaluate(() => (window.__proto?.game?.sent() ?? []) as Record<string, unknown>[]);

async function tapBuilding(page: Page, id: number): Promise<void> {
  const b = (await page.evaluate(() => window.__proto?.game?.buildings() ?? [])).find((v) => v.id === id);
  if (b === undefined) throw new Error(`no building ${id}`);
  await page.evaluate(([x, y]) => window.__proto?.game?.centerOn(x, y, 1), [b.cx + b.size / 2, b.cy + b.size / 2] as const);
  await page.waitForTimeout(300);
  for (let y = b.cy; y < b.cy + b.size; y++) {
    for (let x = b.cx; x < b.cx + b.size; x++) {
      const at = await page.evaluate(([cx, cy]) => window.__proto?.game?.cellToScreen(cx + 0.5, cy + 0.5) ?? { x: 0, y: 0 }, [x, y] as const);
      if ((await page.evaluate(([sx, sy]) => window.__proto?.game?.pickAt(sx, sy) ?? null, [at.x, at.y] as const)) !== "building") continue;
      await tap(page, at);
      await expect.poll(() => page.evaluate(() => window.__proto?.game?.selection().building ?? null)).toBe(id);
      return;
    }
  }
  throw new Error(`building ${id} not tappable`);
}

test("＋遠程 附近沒有遠程：沒有射場就說練不出來；有射場就留位子、多練一名、練好走進主城；全部離開取消位子", async ({ page }) => {
  test.setTimeout(240_000);
  const check = watchErrors(page);
  await page.goto("./?test=1&mock=1&r7=1&tps=60");
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true, null, { timeout: 60_000 });
  await recordToasts(page);
  const me = await page.evaluate(() => window.__proto?.game?.me() ?? 0);
  const city = (await page.evaluate(() => window.__proto?.game?.buildings() ?? [])).find((b) => b.owner === me && b.type === MAIN_CITY);
  if (city === undefined) throw new Error("no main city");
  // Our ranged far off (more than 30 cells from the city): nobody to call.
  const ranged = (await page.evaluate(() => window.__proto?.game?.units() ?? [])).filter((u) => u.owner === me && u.type === RANGED).map((u) => u.id);
  await page.evaluate((ids) => window.__proto?.game?.place(ids, ids.map((_, k) => ({ x: 80 + k, y: 20 }))), ranged);
  await page.evaluate(() => window.__proto?.game?.stock({ food: 2000, wood: 2000, gold: 2000, crystal: 0 }));
  // 自動訓練 on (the fake world has it off unless a test turns it on), the villagers' paused (they would take the room).
  await page.evaluate(() => {
    window.__proto?.game?.autoArmy(true);
    window.__proto?.game?.villagersPaused(true);
  });
  await tapBuilding(page, city.id);
  const call = page.locator(".sel-info").getByRole("button", { name: "叫 1 名遠程兵躲進來" });
  const waiting = page.locator(".sel-info .call-waiting");
  // No range: nothing to train it.
  await call.tap();
  await expectSaid(page, "沒有射場，練不出遠程");
  await expect(waiting).toBeHidden();
  // A range of ours: a place kept, one more trained there, and it walks into the city.
  const range = await page.evaluate(([t, x, y]) => window.__proto?.game?.addBuilding(t, x, y) ?? -1, [RANGE, city.cx + 8, city.cy - 6] as const);
  expect(range).toBeGreaterThan(0);
  await call.tap();
  await expectSaid(page, "附近沒有遠程：射場會多練一名，練好走進來");
  await expect(waiting).toHaveText("等新兵：遠程 1");
  await expect.poll(async () => (await sent(page)).some((c) => c.auto === true && c.c === "train" && c.building === range && c.type === RANGED), { timeout: 60_000 }).toBe(true);
  await expect.poll(async () => (await sent(page)).some((c) => c.auto === true && c.c === "garrison" && c.building === city.id), { timeout: 120_000 }).toBe(true);
  await expect(waiting).toBeHidden();
  // Kept again (自動訓練 off now: it waits), then 全部離開: given up.
  await page.evaluate(() => window.__proto?.game?.autoArmy(false));
  await call.tap();
  await expect(waiting).toHaveText("等新兵：遠程 1");
  await page.locator(".sel-info").getByRole("button", { name: "全部離開" }).tap();
  await expectSaid(page, "等新兵取消");
  await expect(waiting).toBeHidden();
  check();
});
