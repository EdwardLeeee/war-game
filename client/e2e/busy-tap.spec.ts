// A quick tap on the ground while the page is busy (a long frame: ceo 2026-11-06, an iPhone dropping
// frames; main's sim.spec:88 sent nothing once on CI): the finger is up 60 ms after it went down, by
// the events' own times, but the page reads the lift only after 400 ms of work, after the long-press
// timer. It is a tap all the same: 移動 there (D-094), the selection kept, no box, no wheel.
// Chromium only: CDP's touch events carry the finger's own times, as a phone's do.

import { expect, type Page, test } from "@playwright/test";
import { selectForCommands } from "./helpers.ts";

/** A bare cell near (x, y) whose screen point is the battlefield itself, the camera on it. */
async function bareGround(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  for (const [dx, dy] of [[4, 4], [-4, 4], [6, 0], [0, 6], [-6, 0], [4, -4], [8, 8]] as const) {
    const cell = await page.evaluate(([cx, cy]) => window.__proto?.game?.openCellNear(cx, cy) ?? null, [x + dx, y + dy] as const);
    if (cell === null) continue;
    // In the upper part of the screen, clear of the selection info.
    await page.evaluate(([cx, cy]) => window.__proto?.game?.centerOn(cx + 0.5, cy + 4.5, 1), [cell.x, cell.y] as const);
    await page.waitForTimeout(200);
    const at = await page.evaluate(([cx, cy]) => window.__proto?.game?.cellToScreen(cx + 0.5, cy + 0.5) ?? { x: 0, y: 0 }, [cell.x, cell.y] as const);
    const bare = await page.evaluate(([sx, sy]) => document.elementFromPoint(sx, sy)?.tagName === "CANVAS" && (window.__proto?.game?.pickAt(sx, sy) ?? null) === null, [at.x, at.y] as const);
    if (bare) return at;
  }
  throw new Error("no bare ground");
}

test("點地面時頁面忙 400 ms（掉格）：手指 60 ms 就放開，照樣是點（移動），不是長按的框選、不清掉選取", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "CDP's touch events, with the finger's own times");
  await page.goto("./?test=1&mock=1&tps=20");
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true);
  await page.waitForFunction(() => (window.__proto?.game?.header().tick ?? 0) > 5);
  const me = await page.evaluate(() => window.__proto?.game?.me() ?? 0);
  const spears = (await page.evaluate(() => window.__proto?.game?.units() ?? [])).filter((u) => u.owner === me && u.type === 1);
  const ids = spears.map((u) => u.id).sort((a, b) => a - b);
  await selectForCommands(page, ids);
  const at = await bareGround(page, spears[0].cx, spears[0].cy);
  const before = (await page.evaluate(() => window.__proto?.game?.sent() ?? [])).length;
  const cdp = await page.context().newCDPSession(page);
  const t0 = Date.now() / 1000;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: at.x, y: at.y }], timestamp: t0 });
  // 400 ms of work on the main thread right after the touch, the lift (60 ms in) waiting meanwhile.
  await page.evaluate(() => {
    setTimeout(() => {
      const t = performance.now();
      while (performance.now() - t < 400) {
        // a long frame
      }
    }, 0);
  });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [], timestamp: t0 + 0.06 });
  await expect
    .poll(async () => (await page.evaluate(() => window.__proto?.game?.sent() ?? [])).slice(before).filter((c) => (c as { auto?: boolean }).auto !== true))
    .toContainEqual(expect.objectContaining({ c: "retreat", u: ids }));
  expect((await page.evaluate(() => window.__proto?.game?.selection()))?.units, "the selection kept").toEqual(ids);
  expect(await page.evaluate(() => window.__proto?.game?.wheel() ?? null)).toBeNull();
  await expect(page.locator(".marquee")).toBeHidden();
});
