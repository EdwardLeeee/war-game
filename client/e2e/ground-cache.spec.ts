// 地面快取 (render/ground-cache.ts; ceo b2 2026-11-07): while the camera stands still the realistic ground's land
// comes from a picture of the screen taken once, its water drawn over it every frame. The picture the same to the
// eye: the same frame (the game paused, the battlefield's clock held) with the cache off and on, compared pixel by
// pixel: at most 0.05% off by more than 2, none by more than 32 (b2, over what client measured: up to 110 of 2.8
// million pixels by more than 2, at most 23, on a river's banks). Taken once while the camera stands still, again
// once it moved; art-v6's water (art.lock.json) and R9's (art-lab.lock.json). The 量測 panel's row and
// ?test=1&gcache=0 turn it off (test pages, to compare on the iPhone).

import { expect, type Page, test } from "@playwright/test";
import { openLab } from "./helpers.ts";

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

const cache = (page: Page) => page.evaluate(() => window.__proto?.game?.groundCache() ?? null);
const setCache = (page: Page, on: boolean) => page.evaluate((v) => window.__proto?.game?.setGroundCache(v), on);

for (const [name, q, r9] of [
  ["art-v6 的水（art.lock.json）", "art=x2", false],
  ["R9 的地面和水（art-lab.lock.json）", "art=x2&artlab=1", true],
] as const) {
  test(`地面快取（${name}）：同一格關和開比一比，看不出差別；鏡頭不動只畫一次快取，動了以後重畫一次，畫面照樣對`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto(`./?test=1&watch=1&ai=0&ground=real&${q}`);
    await page.getByRole("button", { name: "開始" }).tap();
    await page.waitForFunction(() => window.__proto?.ready === true, null, { timeout: 90_000 });
    await expect.poll(() => page.evaluate(() => window.__proto?.game?.groundLook() ?? null), { timeout: 60_000 }).toMatchObject({ real: true, water: true, r9water: r9 });
    await page.evaluate(() => window.__proto?.game?.pause());
    // The river and its bank, then its bridge (ground.spec.ts's places).
    for (const [x, y, z] of [
      [24, 62, 1.6],
      [18.5, 59.5, 1.2],
    ] as const) {
      await page.evaluate(([cx, cy, s]) => window.__proto?.game?.centerOn(cx, cy, s), [x, y, z] as const);
      await frames(page);
      await page.evaluate(() => window.__proto?.game?.freezeClock(true));
      await setCache(page, false);
      await frames(page);
      const off = await page.screenshot();
      expect((await cache(page))?.shown, "off: the ground drawn whole").toBe(false);
      await setCache(page, true);
      await frames(page);
      const taken = (await cache(page))?.taken ?? 0;
      expect(await cache(page), "on: its picture over the ground, taken at least once").toMatchObject({ on: true, shown: true });
      expect(taken).toBeGreaterThan(0);
      const on = await page.screenshot();
      // Still: not taken again.
      await frames(page);
      expect((await cache(page))?.taken, "taken once while the camera stands still").toBe(taken);
      const d = await compare(page, off, on);
      console.log(`GCACHE ${name} ${x},${y} ${JSON.stringify(d)}`);
      expect(d.over2 / d.total, `${x},${y}: off by more than 2 at most 0.05% (${JSON.stringify(d)})`).toBeLessThanOrEqual(0.0005);
      expect(d.most, `${x},${y}: by at most 32 (${JSON.stringify(d)})`).toBeLessThanOrEqual(32);
      await page.evaluate(() => window.__proto?.game?.freezeClock(false));
    }
    expect((await cache(page))?.mb ?? 0, "its picture: the screen's pixels").toBeGreaterThan(0);
  });
}

test("地面快取：開著時鏡頭一動就照原本畫整片地面，停下才重畫快取（拖的時候不是每格都畫一次快取）", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("./?test=1&watch=1&ai=0&ground=real&art=x2");
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true, null, { timeout: 90_000 });
  await expect.poll(() => page.evaluate(() => window.__proto?.game?.groundLook()?.real ?? false), { timeout: 60_000 }).toBe(true);
  await frames(page);
  const before = (await cache(page))?.taken ?? 0;
  // Ten frames in a row, the camera somewhere else each: none of them taken, the picture not shown (read at the
  // last move, before the frame after it stands still).
  const during = await page.evaluate(
    () =>
      new Promise<{ taken: number; shown: boolean[] }>((done) => {
        let i = 0;
        const shown: boolean[] = [];
        const step = () => {
          if (i > 0) shown.push(window.__proto?.game?.groundCache()?.shown ?? true);
          window.__proto?.game?.centerOn(30 + i, 50, 1);
          i++;
          if (i < 10) requestAnimationFrame(step);
          else done({ taken: window.__proto?.game?.groundCache()?.taken ?? -1, shown });
        };
        requestAnimationFrame(step);
      }),
  );
  expect(during.taken, "not taken while it moves").toBe(before);
  expect(during.shown.slice(1), "the ground drawn whole while it moves").not.toContain(true);
  await frames(page);
  expect((await cache(page))?.taken, "once it stands still").toBeGreaterThan(before);
});

test("地面快取：量測面板一列開／關，馬上生效、網址帶著；?test=1&gcache=0 一開始就關", async ({ page }) => {
  await page.goto("./?test=1&mock=1&tps=20");
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true);
  await openLab(page);
  const group = page.getByRole("radiogroup", { name: "地面快取" });
  await expect(group.getByRole("radio")).toHaveText(["開", "關"]);
  await expect(group.getByRole("radio", { name: "開" })).toHaveAttribute("aria-checked", "true");
  expect((await cache(page))?.on).toBe(true);
  await group.getByRole("radio", { name: "關" }).tap();
  await expect(group.getByRole("radio", { name: "關" })).toHaveAttribute("aria-checked", "true");
  expect((await cache(page))?.on).toBe(false);
  expect(new URL(page.url()).searchParams.get("gcache")).toBe("0");
  await expect(page.getByText("地面快取：關")).toBeVisible();
  await group.getByRole("radio", { name: "開" }).tap();
  expect(new URL(page.url()).searchParams.get("gcache")).toBeNull();
  // From the address.
  await page.goto("./?test=1&mock=1&tps=20&gcache=0");
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true);
  expect((await cache(page))?.on).toBe(false);
  await openLab(page);
  await expect(page.getByRole("radiogroup", { name: "地面快取" }).getByRole("radio", { name: "關" })).toHaveAttribute("aria-checked", "true");
});

test("地面快取：量測結果寫這次開著還是關著", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("./?test=1&mock=1&tps=20&gcache=0");
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true);
  await openLab(page);
  await page.getByRole("button", { name: "量測 120 人" }).tap();
  await expect(page.locator(".lab-result")).toContainText("地面快取：關", { timeout: 90_000 });
});
