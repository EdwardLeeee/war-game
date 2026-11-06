// The placement preview over the buildings (ceo 2026-11-06, R6-19 INV-115): put on the main city, where a
// house cannot go, it shows red there, ✓ grey beside it. It lay on the ground under the buildings, so
// the city's picture hid it and the player saw no reason for the grey ✓ (with no art the buildings are
// shapes on the ground, under it anyway). The square view and the diamond (D-117), with the art.

import { expect, type Page, test } from "@playwright/test";
import { selectForCommands } from "./helpers.ts";
import { tap } from "./touch.ts";

/** The colour the screen shows round (x, y): the page decodes Playwright's own screenshot. */
async function colourAt(page: Page, x: number, y: number): Promise<{ r: number; g: number; b: number }> {
  const png = await page.screenshot({ clip: { x: x - 5, y: y - 5, width: 10, height: 10 } });
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext("2d");
    if (g === null) throw new Error("no 2d");
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let r = 0;
    let gg = 0;
    let b = 0;
    for (let i = 0; i < d.length; i += 4) {
      r += d[i];
      gg += d[i + 1];
      b += d[i + 2];
    }
    const n = d.length / 4;
    return { r: r / n, g: gg / n, b: b / n };
  }, png.toString("base64"));
}

// The diamond's buildings are art-v7's (the art-v7 量測 pack: art-v6.4 has none for it).
for (const [view, name] of [["", "方形斜看"], ["&view=diamond&artlab=1", "菱形"]] as const) {
  for (const [ui, uiName] of [["", "原型"], ["&ui=r6", "正式介面"]] as const) {
    test(`放建築的預覽畫在建築上面（${name}、${uiName}）：拖到主城上，主城那裡變紅、✓ 變灰`, async ({ page }) => {
      test.setTimeout(90_000);
      await page.goto(`./?test=1&mock=1&tps=20&art=x3${view}${ui}`);
      await page.getByRole("button", { name: "開始" }).tap();
      await page.waitForFunction(() => window.__proto?.ready === true);
      await page.waitForFunction(() => (window.__proto?.game?.header().tick ?? 0) > 5);
      await expect.poll(() => page.evaluate(() => window.__proto?.game?.art()?.buildings ?? 0), { timeout: 60_000 }).toBeGreaterThan(0);
      await page.evaluate(() => window.__proto?.game?.pause());
      const me = await page.evaluate(() => window.__proto?.game?.me() ?? 0);
      const city = (await page.evaluate(() => window.__proto?.game?.buildings() ?? [])).find((b) => b.owner === me && b.type === 0);
      if (city === undefined) throw new Error("no main city");
      const farmers = (await page.evaluate(() => window.__proto?.game?.units() ?? [])).filter((u) => u.owner === me && u.type === 0).map((u) => u.id);
      const mid = { x: city.cx + city.size / 2, y: city.cy + city.size / 2 };
      await page.evaluate(([x, y]) => window.__proto?.game?.centerOn(x, y, 1.2), [mid.x, mid.y] as const);
      await selectForCommands(page, farmers);
      // The city's picture alone, before the preview.
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      const sample = await page.evaluate(([x, y]) => window.__proto?.game?.cellToScreen(x, y) ?? { x: 0, y: 0 }, [mid.x, mid.y] as const);
      const before = await colourAt(page, sample.x, sample.y);
      await page.locator(".cmds").getByRole("button", { name: /^建造/ }).tap();
      await page.locator(".cmds").getByRole("button", { name: /^民居/ }).tap();
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      // A house is 2 × 2: its preview on the city's middle cells, the cell under the finger its corner.
      const at = await page.evaluate(([x, y]) => window.__proto?.game?.cellToScreen(x, y) ?? { x: 0, y: 0 }, [mid.x - 0.5, mid.y - 0.5] as const);
      await tap(page, at);
      await expect.poll(() => page.evaluate(() => window.__proto?.game?.placement()?.valid ?? null)).toBe(false);
      await expect(page.getByRole("button", { name: "確定蓋在這裡" })).toBeDisabled();
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      const after = await colourAt(page, sample.x, sample.y);
      // The red over the city: redder, less green and blue than the city alone.
      expect(after.r - before.r + (before.g - after.g), `red over the city: ${JSON.stringify({ before, after })}`).toBeGreaterThan(40);
    });
  }
}
