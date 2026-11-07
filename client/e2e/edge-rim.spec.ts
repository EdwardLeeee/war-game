// 雲不在島上（the user 2026-11-07: 「邊邊有些地方不是全黑耶 會一圈一圈有點亮」, then of the row of clouds that was on the two upper
// edges, half on the map and over the fog: 「雲不該在島上吧」; render/edge.ts). Not a pixel of cloud on the map, whatever the fog: the
// top corner, not explored, is black to the edge but for the line along it (it was 18% not black with the art's clouds); and an edge
// walked to, seen, is the same with the clouds over the battlefield drawn and not.

import { expect, type Page, test } from "@playwright/test";
import { watchErrors } from "./helpers.ts";

const frames = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 400)))));

/** Of the pixels on the map (its diamond, on the screen now): the share in percent not black in `a`, and how many differ from `b` by more than 2. */
async function onTheMap(page: Page, a: Buffer, b: Buffer = a): Promise<{ notBlack: number; differ: number; total: number }> {
  return page.evaluate(
    async ([a64, b64]) => {
      const game = window.__proto?.game;
      const n = game?.mapSize() ?? 0;
      const corners = ([[0, 0], [n, 0], [n, n], [0, n]] as const).map(([x, y]) => game?.cellToScreen(x - 0.5, y - 0.5) ?? { x: 0, y: 0 });
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
      const k = p.width / window.innerWidth;
      const at = corners.map((c) => ({ x: c.x * k, y: c.y * k }));
      let total = 0;
      let lit = 0;
      let differ = 0;
      for (let py = 0; py < p.height; py++) {
        for (let px = 0; px < p.width; px++) {
          // Clockwise on the screen (top, right, bottom, left): on the map when right of every side.
          const on = at.every((u, i) => {
            const v = at[(i + 1) % 4];
            return (v.x - u.x) * (py + 0.5 - u.y) - (v.y - u.y) * (px + 0.5 - u.x) >= 0;
          });
          if (!on) continue;
          total++;
          const i = (py * p.width + px) * 4;
          if (Math.max(p.data[i], p.data[i + 1], p.data[i + 2]) > 0) lit++;
          if (Math.max(Math.abs(p.data[i] - q.data[i]), Math.abs(p.data[i + 1] - q.data[i + 1]), Math.abs(p.data[i + 2] - q.data[i + 2])) > 2) differ++;
        }
      }
      return { notBlack: (100 * lit) / Math.max(1, total), differ, total };
    },
    [a.toString("base64"), b.toString("base64")] as const,
  );
}

for (const [name, query] of [
  ["測試圖", "scenario=e2e&ai=0&tps=60&art=test&view=diamond&edge=1"],
  ["美術的雲（art.lock.json）", "ai=0&tps=60&art=x2"],
] as const) {
  test(`雲不在島上（${name}）：沒探過的上角全黑到邊，只剩邊界那一圈；走到邊上看得到時，地圖上沒有雲的像素`, async ({ page }) => {
    test.setTimeout(240_000);
    const check = watchErrors(page);
    await page.setViewportSize({ width: 932, height: 336 });
    await page.goto(`./?test=1&${query}`);
    await page.getByRole("button", { name: "開始" }).tap();
    await page.waitForFunction(() => window.__proto?.ready === true, null, { timeout: 90_000 });
    await expect.poll(() => page.evaluate(() => window.__proto?.game?.edge().on ?? false), { timeout: 60_000 }).toBe(true);
    await page.addStyleTag({ content: "#hud, #proto-label { visibility: hidden !important; }" });
    await page.evaluate(() => window.__proto?.game?.centerOn(2, 2, 0.6));
    await expect.poll(() => page.evaluate(() => window.__proto?.game?.edge().shown ?? false)).toBe(true);
    await frames(page);
    const dark = await onTheMap(page, await page.screenshot());
    console.log(`RIM ${name} not explored: ${JSON.stringify(dark)}`);
    expect(dark.total, "the top corner's on the screen").toBeGreaterThan(1000);
    expect(dark.notBlack, "only the line along the edge").toBeLessThan(1);
    // Ours walk to the nearer upper edge and it is ground up to the line, with or without the clouds over the battlefield.
    const to = await page.evaluate(() => {
      const game = window.__proto?.game;
      const me = game?.me();
      const ours = (game?.units() ?? []).filter((u) => u.owner === me);
      const u = ours[0];
      const at = u.fx < u.fy ? game?.openCellNear(2, Math.round(u.fy), false) : game?.openCellNear(Math.round(u.fx), 2, false);
      if (at === undefined || at === null) throw new Error("no open cell by the edge");
      game?.send({ c: "move", u: ours.map((o) => o.id), x: at.x, y: at.y });
      return at;
    });
    const away = () =>
      page.evaluate(([x, y]) => {
        const game = window.__proto?.game;
        const me = game?.me();
        return Math.min(...(game?.units() ?? []).filter((u) => u.owner === me).map((u) => Math.hypot(u.fx - x, u.fy - y)));
      }, [to.x, to.y] as const);
    await expect.poll(away, { timeout: 120_000, intervals: [500] }).toBeLessThan(2);
    await page.evaluate(() => window.__proto?.game?.pause());
    await page.evaluate(([x, y]) => window.__proto?.game?.centerOn(x, y, 0.6), [to.x, to.y] as const);
    await page.evaluate(() => window.__proto?.game?.freezeClock(true));
    await frames(page);
    const drawn = await page.screenshot();
    await page.evaluate(() => window.__proto?.game?.setEdgeOver(false));
    await frames(page);
    const without = await page.screenshot();
    await page.evaluate(() => window.__proto?.game?.setEdgeOver(true));
    const seen = await onTheMap(page, drawn, without);
    console.log(`RIM ${name} seen: ${JSON.stringify(seen)}`);
    expect(seen.notBlack, "the ground's there to see").toBeGreaterThan(5);
    expect(seen.differ, "no cloud on the map").toBe(0);
    check();
  });
}
