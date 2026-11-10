// 點地板的圈（the user 2026-11-10: 「為啥第一次選軍團時要點地板兩次才會移動」, then 「沒注意，習慣點兩下」）: a tap on the
// ground with someone selected flashes a ring where the order goes (0.6 s), on the ground, under what stands. With 寫實地面
// (what players see) and without, the frame at the tap minus the one after the ring is gone, near the tap, has its pixels.
// The page's clock is held for those frames (the ring is timed by it too): drawn in software here a frame of 寫實地面 can take
// longer than the ring lasts, and the ring would be missed.

import { expect, type Page, test } from "@playwright/test";
import { watchErrors } from "./helpers.ts";

type U = { id: number; owner: number; type: number; fx: number; fy: number };
const frames = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

/** Pixels within `reach` points of (x, y) that differ by more than 8 between two screenshots. */
async function changedNear(page: Page, a: Buffer, b: Buffer, x: number, y: number, reach: number): Promise<number> {
  return page.evaluate(
    async ([a64, b64, cx, cy, r]) => {
      const load = (s: string) =>
        new Promise<ImageData>((done) => {
          const img = new Image();
          img.onload = () => {
            const c = document.createElement("canvas");
            c.width = img.width;
            c.height = img.height;
            const g = c.getContext("2d") as CanvasRenderingContext2D;
            g.drawImage(img, 0, 0);
            done(g.getImageData(0, 0, c.width, c.height));
          };
          img.src = `data:image/png;base64,${s}`;
        });
      const [p, q] = await Promise.all([load(a64 as string), load(b64 as string)]);
      const k = p.width / window.innerWidth;
      let n = 0;
      for (let py = 0; py < p.height; py++) {
        for (let px = 0; px < p.width; px++) {
          if (Math.hypot(px / k - (cx as number), py / k - (cy as number)) > (r as number)) continue;
          const i = (py * p.width + px) * 4;
          if (Math.max(Math.abs(p.data[i] - q.data[i]), Math.abs(p.data[i + 1] - q.data[i + 1]), Math.abs(p.data[i + 2] - q.data[i + 2])) > 8) n++;
        }
      }
      return n / (k * k);
    },
    [a.toString("base64"), b.toString("base64"), x, y, reach] as const,
  );
}

for (const [name, query] of [
  ["寫實地面（art.lock.json 的美術）", "art=x2&ground=real"],
  ["測試頁的平面地面", ""],
] as const) {
  test(`點地板的圈看得到（${name}）：選一名村民、點地板一下，點的地方閃一圈`, async ({ page }) => {
    test.setTimeout(180_000);
    const check = watchErrors(page);
    await page.setViewportSize({ width: 932, height: 336 });
    await page.goto(`./?test=1&ai=0&ui=proto&${query}`);
    await page.getByRole("button", { name: "開始" }).tap();
    await page.waitForFunction(() => window.__proto?.ready === true, null, { timeout: 90_000 });
    if (query !== "") await page.waitForFunction(() => (window.__proto?.game?.art()?.units ?? 0) > 0, null, { timeout: 60_000 });
    // Paused: nobody walks, so only the ring changes the picture there.
    await page.evaluate(() => window.__proto?.game?.pause());
    await page.addStyleTag({ content: "#hud, #proto-label { visibility: hidden !important; }" });
    const me = await page.evaluate(() => window.__proto?.game?.me() ?? 0);
    const farmer = ((await page.evaluate(() => window.__proto?.game?.units() ?? [])) as U[]).find((u) => u.owner === me && u.type === 0);
    if (farmer === undefined) throw new Error("no farmer");
    await page.evaluate(([x, y]) => window.__proto?.game?.centerOn(x, y, 0.75), [farmer.fx, farmer.fy] as const);
    await page.evaluate((id) => window.__proto?.game?.select([id]), farmer.id);
    await page.waitForTimeout(600);
    // Open ground a few cells off, with nothing a tap would pick there: on a slow machine the others have walked further before
    // the pause, and one standing there took the tap (CI 2026-11-10: it was selected instead, and no order went).
    const spot = await page.evaluate(([fx, fy]) => {
      const g = window.__proto?.game;
      if (g === undefined) return null;
      for (const [dx, dy] of [[5, -5], [5, 5], [-5, 5], [-5, -5], [6, 0], [0, 6], [-6, 0], [0, -6], [4, -7], [7, 4]]) {
        const c = g.openCellNear(Math.round(fx + dx), Math.round(fy + dy), false);
        if (c === null) continue;
        const p = g.cellToScreen(c.x, c.y);
        if (p.x > 60 && p.x < window.innerWidth - 60 && p.y > 40 && p.y < window.innerHeight - 40 && g.pickAt(p.x, p.y) === null) return { to: c, at: p };
      }
      return null;
    }, [farmer.fx, farmer.fy] as const);
    if (spot === null) throw new Error("no open ground to tap");
    const { to, at } = spot;
    const before = (await page.evaluate(() => window.__proto?.game?.sent() ?? [])).length;
    // The page's clock held still: the ring stays as it is at the tap (a slow frame here would miss its 0.6 s).
    await page.evaluate(() => window.__proto?.game?.freezeClock(true));
    await page.touchscreen.tap(at.x, at.y);
    await frames(page);
    await page.waitForTimeout(300);
    const ring = await page.screenshot();
    // The clock on again: 0.6 s later the ring is gone; held again for the same frame without it.
    await page.evaluate(() => window.__proto?.game?.freezeClock(false));
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.__proto?.game?.freezeClock(true));
    await frames(page);
    await page.waitForTimeout(300);
    const gone = await page.screenshot();
    expect((await page.evaluate(() => window.__proto?.game?.sent() ?? [])).slice(before)).toContainEqual(expect.objectContaining({ c: "move", x: to.x, y: to.y }));
    const n = await changedNear(page, ring, gone, at.x, at.y, 40);
    console.log(`ORDER-RING ${name}: ${n.toFixed(0)} points changed near the tap`);
    expect(n, "the ring drawn where the order goes").toBeGreaterThan(40);
    check();
  });
}
