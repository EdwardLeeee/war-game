// 浮空大陸's sea of clouds a layer in one pass (render/cloud-pass.ts; ceo b2 2026-11-07): each layer's two tiles,
// the second half a tile on and cross-faded over the first, read and blended by one pass over the screen instead
// of two TilingSprites. The same picture: the same frame (the game paused, the battlefield's clock held) drawn
// both ways at the map's corner, compared pixel by pixel: at most 0.05% off by more than 2, none by more than 8
// (b2; client measured at most 4, the blend rounded once instead of twice); at two moments of the cross-fade;
// with the test page's stand-ins and with art.lock.json's clouds.

import { expect, type Page, test } from "@playwright/test";
import { watchErrors } from "./helpers.ts";

const frames = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 400)))));

/** Two screenshots compared in the page: pixels off at all, by more than 2, the most, of how many. */
async function compare(page: Page, a: Buffer, b: Buffer): Promise<{ off: number; over2: number; most: number; total: number }> {
  return page.evaluate(async ([a64, b64]) => {
    const load = (s: string) =>
      new Promise<ImageData>((done) => {
        const img = new Image();
        img.onload = () => {
          const c = document.createElement("canvas");
          c.width = img.width;
          c.height = img.height;
          const x = c.getContext("2d") as CanvasRenderingContext2D;
          x.drawImage(img, 0, 0);
          done(x.getImageData(0, 0, c.width, c.height));
        };
        img.src = `data:image/png;base64,${s}`;
      });
    const [p, q] = await Promise.all([load(a64), load(b64)]);
    let off = 0;
    let over2 = 0;
    let most = 0;
    for (let i = 0; i < p.data.length; i += 4) {
      const d = Math.max(Math.abs(p.data[i] - q.data[i]), Math.abs(p.data[i + 1] - q.data[i + 1]), Math.abs(p.data[i + 2] - q.data[i + 2]));
      if (d > 0) off++;
      if (d > 2) over2++;
      if (d > most) most = d;
    }
    return { off, over2, most, total: p.width * p.height };
  }, [a.toString("base64"), b.toString("base64")] as const);
}

for (const [name, query] of [
  ["測試圖", "scenario=e2e&ai=0&tps=60&art=test&view=diamond&edge=1"],
  ["美術的雲（art.lock.json）", "watch=1&ai=0&art=x2"],
] as const) {
  test(`雲海一層一次畫完（${name}）：地圖下角同一格，兩張疊和一次畫比一比，看不出差別；淡入淡出的兩個時刻`, async ({ page }) => {
    test.setTimeout(180_000);
    const check = watchErrors(page);
    await page.goto(`./?test=1&${query}`);
    await page.getByRole("button", { name: "開始" }).tap();
    await page.waitForFunction(() => window.__proto?.ready === true, null, { timeout: 90_000 });
    await expect.poll(() => page.evaluate(() => window.__proto?.game?.edge().on ?? false), { timeout: 60_000 }).toBe(true);
    expect((await page.evaluate(() => window.__proto?.game?.edge()))?.onePass, "on by default").toBe(true);
    await page.evaluate(() => window.__proto?.game?.pause());
    const n = await page.evaluate(() => window.__proto?.game?.mapSize() ?? 96);
    await page.evaluate(([x, y]) => window.__proto?.game?.centerOn(x, y, 0.6), [n - 4, n - 4] as const);
    await expect.poll(() => page.evaluate(() => window.__proto?.game?.edge().shown ?? false)).toBe(true);
    // The battlefield alone: the interface's own animations (an alert's arrow) are not on the battlefield's clock.
    await page.addStyleTag({ content: "#hud { visibility: hidden !important; }" });
    for (const wait of [0, 2500]) {
      await page.waitForTimeout(wait);
      await page.evaluate(() => window.__proto?.game?.freezeClock(true));
      await page.evaluate(() => window.__proto?.game?.setEdgeOnePass(false));
      await frames(page);
      const two = await page.screenshot();
      await page.evaluate(() => window.__proto?.game?.setEdgeOnePass(true));
      await frames(page);
      const one = await page.screenshot();
      const d = await compare(page, two, one);
      console.log(`CLOUDS ${name} +${wait} ms ${JSON.stringify(d)}`);
      expect(d.over2 / d.total, `off by more than 2 at most 0.05% (${JSON.stringify(d)})`).toBeLessThanOrEqual(0.0005);
      expect(d.most, `by at most 8 (${JSON.stringify(d)})`).toBeLessThanOrEqual(8);
      await page.evaluate(() => window.__proto?.game?.freezeClock(false));
    }
    check();
  });
}
