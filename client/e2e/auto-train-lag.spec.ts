// 自動訓練 with the page behind its snapshots (ceo 2026-10-25: the user plays on iPhone WebKit,
// which at the start of a game sees the simulation take an order 40 steps and more after it was
// sent): the fake world takes commands 40 steps late, and the main city still gets one villager
// at a time, the next once the first is trained. And with the cap at its ceiling, 自動訓練's stop
// says 人口已到上限, not 蓋民居.

import { expect, type Page, test } from "@playwright/test";
import { watchErrors } from "./helpers.ts";
import { tap } from "./touch.ts";

const FARMER = 0;
const MAIN_CITY = 0;

let checkErrors: () => void;

test.beforeEach(async ({ page }) => {
  checkErrors = watchErrors(page);
  await page.goto("./?test=1&mock=1&tps=60");
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true);
});

test.afterEach(() => {
  checkErrors();
});

const me = (page: Page) => page.evaluate(() => window.__proto?.game?.me() ?? 0);
const units = (page: Page) => page.evaluate(() => window.__proto?.game?.units() ?? []);
const sent = (page: Page) => page.evaluate(() => (window.__proto?.game?.sent() ?? []) as Record<string, unknown>[]);
const toast = (page: Page, text: string) => page.getByRole("status").filter({ hasText: text });

async function mainCity(page: Page): Promise<{ id: number; cx: number; cy: number; size: number }> {
  const m = await me(page);
  const city = (await page.evaluate(() => window.__proto?.game?.buildings() ?? [])).find((b) => b.owner === m && b.type === MAIN_CITY);
  if (city === undefined) throw new Error("no main city");
  return city;
}

test("畫面落後快照（模擬晚 40 步才接指令）：主城一次只排一個村民，第一個練好才排下一個", async ({ page }) => {
  const m = await me(page);
  const city = await mainCity(page);
  const trains = async () => (await sent(page)).filter((c) => c.c === "train" && c.auto === true && c.building === city.id);
  const farmers = async () => (await units(page)).filter((u) => u.owner === m && u.type === FARMER).length;
  const before = await farmers();
  await page.evaluate(() => {
    const g = window.__proto?.game;
    g?.lag(40);
    g?.autoArmy(true);
  });
  await expect.poll(async () => (await trains()).length, { timeout: 60_000 }).toBe(1);
  // From then until it is trained (40 steps late into the queue, 60 to train in the fake world):
  // nothing sent again. Both counts read at the same moment in the page: on CI's slow WebKit a
  // check at a tick read from here could fall after the villager was trained, when the next
  // order is right (CI run 40804899732).
  const sample = () =>
    page.evaluate(
      ([owner, building]) => {
        const g = window.__proto?.game;
        return {
          farmers: (g?.units() ?? []).filter((u) => u.owner === owner && u.type === 0).length,
          trains: ((g?.sent() ?? []) as Record<string, unknown>[]).filter((c) => c.c === "train" && c.auto === true && c.building === building).length,
          tick: g?.header().tick ?? -1,
        };
      },
      [m, city.id] as const,
    );
  const start = await sample();
  for (let s = start; s.farmers === before; s = await sample()) {
    expect(s.trains, `one at a time until the first is trained (tick ${s.tick})`).toBe(1);
    if (s.tick > start.tick + 2000) throw new Error("the first villager was never trained");
    await page.waitForTimeout(100);
  }
  expect((await sample()).tick - start.tick, "well past the 40 steps it waited").toBeGreaterThan(40);
  // Trained: then the next one.
  await expect.poll(async () => (await trains()).length, { timeout: 60_000 }).toBe(2);
  expect(await farmers()).toBe(before + 1);
});

test("人口已到上限（含城鎮）：自動訓練停下來時訊息列和主城都說人口已到上限，不叫人蓋民居", async ({ page }) => {
  const m = await me(page);
  const living = (await units(page)).filter((u) => u.owner === m).length;
  // The cap full, and as high as it goes.
  await page.evaluate((n) => {
    const g = window.__proto?.game;
    g?.population({ room: 0, ceiling: n });
    g?.autoArmy(true);
  }, living);
  await expect(toast(page, "人口已到上限")).toBeVisible({ timeout: 30_000 });
  const city = await mainCity(page);
  const c = { x: city.cx + city.size / 2, y: city.cy + city.size / 2 };
  await page.evaluate(([x, y]) => window.__proto?.game?.centerOn(x, y, 1), [c.x, c.y] as const);
  await tap(page, await page.evaluate(([x, y]) => window.__proto?.game?.cellToScreen(x, y) ?? { x: 0, y: 0 }, [c.x, c.y] as const));
  await expect(page.locator(".sel-info .auto-train-line")).toHaveText(/^村民 \d+／40，人口已到上限$/);
});
