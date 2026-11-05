// 牆上守軍換邊 (D-119, core's scenario wallshift, the real simulation): the archers on the other
// walls walk along them towards the enemy at the east gate, over the gates, drawn on the walk all the
// way: never on the ground under a gate (client's wall-stand.ts).

import { expect, test } from "@playwright/test";
import { watchErrors } from "./helpers.ts";

const ARCHERS = 11;

test("牆上守軍換邊（D-119）：弓手沿著牆走，經過城門上方時也畫在牆上", async ({ page }) => {
  test.setTimeout(120_000);
  const check = watchErrors(page);
  await page.goto("./?test=1&scenario=wallshift&ai=0&tps=20&art=x3");
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true, null, { timeout: 60_000 });
  const cells = await page.evaluate(() => window.__proto?.game?.castleCells(0) ?? null);
  if (cells === null) throw new Error("no castle");
  await page.evaluate(([x, y]) => window.__proto?.game?.centerOn(x, y, 0.6), [(cells.inside.x0 + cells.inside.x1) / 2, (cells.inside.y0 + cells.inside.y1) / 2] as const);
  const look = () =>
    page.evaluate((gate) => {
      const g = window.__proto?.game;
      const me = g?.me();
      const over = (g?.units() ?? []).filter((u) => u.owner === me && u.action === 1 && gate.some(([x, y]) => x === u.cx && y === u.cy));
      return { over: over.length, lifted: g?.wallLifted() ?? 0 };
    }, cells.gate);
  // Someone crossing a gate, and all of them still drawn up on the walls.
  await expect.poll(async () => (await look()).over, { timeout: 60_000 }).toBeGreaterThan(0);
  expect((await look()).lifted).toBe(ARCHERS);
  check();
});
