// 貼圖 ASTC (D-128) and art-v7 量測 on core's real simulation with the stand-in atlases (scripts/
// make-test-atlas.ts writes each page's ASTC 4×4 beside its PNG, and the list art-release-astc.json):
// with ?tex=astc the pages are loaded compressed, a quarter of the bytes on the GPU; a GPU without
// ASTC draws the PNGs (3 倍 at 2 倍); the 量測 panel's art-v7 buttons each open a page straight
// into a measurement of its own, whose result says what the textures cost, and a page reloaded in
// the middle of one says which it was and does not start it again.

import { expect, type Page, test } from "@playwright/test";
import { openLab, shot, watchErrors } from "./helpers.ts";

const art = (page: Page) => page.evaluate(() => window.__proto?.game?.art() ?? null);

/** The stand-ins' pages (10 units: colour, team, shadow; the 2 mages' shields; the 2 effects pages) and their bytes as ASTC 4×4: every size a multiple of 4, so PNG is 4 times as much. */
const PAGES = 10 * 3 + 2 + 2;
const ASTC_BYTES = 10 * (48 * 64 + 48 * 64 + 24 * 12) + 2 * 48 * 64 + 32 * 16 + 48 * 16;

/** As a GPU without ASTC: WebGL says it has no WEBGL_compressed_texture_astc. */
async function noAstc(page: Page): Promise<void> {
  await page.addInitScript(() => {
    for (const C of [WebGLRenderingContext, WebGL2RenderingContext]) {
      const proto = C.prototype as unknown as { getExtension(name: string): unknown };
      const own = proto.getExtension;
      proto.getExtension = function (this: unknown, name: string) {
        return name === "WEBGL_compressed_texture_astc" ? null : own.call(this, name);
      };
    }
  });
}

async function start(page: Page, query: string): Promise<void> {
  await page.goto(`./?test=1&${query}`);
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true, null, { timeout: 60_000 });
}

test("貼圖 ASTC（測試圖）：每頁都從 .astc.ktx 載入，顯示卡上是 PNG 的四分之一；兵照樣從圖集畫", async ({ page }, info) => {
  const check = watchErrors(page);
  await start(page, "art=test&tex=astc&scenario=e2e");
  await expect.poll(async () => (await art(page))?.units ?? 0).toBeGreaterThan(0);
  const a = await art(page);
  expect(a).toMatchObject({ label: "測試圖 ASTC", pages: PAGES, astc: PAGES, bytes: ASTC_BYTES });
  await page.waitForTimeout(500);
  await shot(page, info, "astc-test-atlas");
  // The same game drawn from the PNGs: 4 bytes a pixel.
  await start(page, "art=test&tex=png&scenario=e2e");
  await expect.poll(async () => (await art(page))?.units ?? 0).toBeGreaterThan(0);
  expect(await art(page)).toMatchObject({ label: "測試圖", pages: PAGES, astc: 0, bytes: 4 * ASTC_BYTES });
  await page.waitForTimeout(500);
  await shot(page, info, "astc-test-atlas-png");
  check();
});

test("顯示卡沒有 ASTC：要 ASTC 也是從 PNG 載入，照樣畫（D-128）", async ({ page }) => {
  const check = watchErrors(page);
  await noAstc(page);
  await start(page, "art=test&tex=astc&scenario=e2e");
  await expect.poll(async () => (await art(page))?.units ?? 0).toBeGreaterThan(0);
  expect(await art(page)).toMatchObject({ label: "測試圖", pages: PAGES, astc: 0, bytes: 4 * ASTC_BYTES });
  check();
});

test("D-128（art-v7.4）：沒選過就是 3 倍 ASTC；顯示卡沒有 ASTC 就畫 2 倍的 PNG", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the Release's pages at 3 倍: one browser is enough (WebKit on CI draws in software)");
  const check = watchErrors(page);
  await start(page, "art=x3&scenario=e2e");
  await expect.poll(async () => (await art(page))?.units ?? 0, { timeout: 60_000 }).toBeGreaterThan(0);
  const a = await art(page);
  expect(a).toMatchObject({ label: "3 倍 ASTC" });
  expect(a?.astc).toBe(a?.pages);
  // Without ASTC: 2 倍's PNGs (art-v7's 3 倍 as PNG is more than the iPhone kept).
  await noAstc(page);
  await start(page, "art=x3&scenario=e2e");
  await expect.poll(async () => (await art(page))?.units ?? 0, { timeout: 60_000 }).toBeGreaterThan(0);
  expect(await art(page)).toMatchObject({ label: "2 倍", astc: 0 });
  check();
});

test("art-v7 量測：量測面板寫要用 Wi-Fi，三個鈕依序 x3 ASTC、x2 PNG、x3 PNG；按下去開一頁直接量，網址拿掉 measure；結果寫量測時間、實際畫的、貼圖 MB、地面、ASTC、瀏覽器", async ({ page }, info) => {
  test.setTimeout(240_000);
  const check = watchErrors(page);
  await start(page, "art=test&scenario=e2e&measures=5");
  await openLab(page);
  const group = page.getByRole("group", { name: "art-v7 量測" });
  await expect(group).toContainText("每種要下載 60–160 MB，請用 Wi‑Fi");
  await expect(group.getByRole("button")).toHaveText(["量 x3 ASTC", "量 x2 PNG", "量 x3 PNG"]);
  await expect(page.getByRole("radiogroup", { name: "貼圖" }).getByRole("radio", { name: "ASTC" })).toHaveAttribute("aria-checked", "true");
  await shot(page, info, "astc-lab-panel");
  await group.getByRole("button", { name: "量 x3 ASTC" }).tap();
  // A page of its own, straight into the 360-unit game (no 開始), the address without ?measure=.
  await page.waitForURL(/measure=x3-astc/);
  await page.waitForFunction(() => window.__proto?.ready === true && window.__proto.game?.header().scenario !== undefined, null, { timeout: 90_000 });
  expect(new URL(page.url()).searchParams.get("measure")).toBeNull();
  const result = page.locator(".lab-result");
  await expect(result).toContainText("art-v7 量測：x3 ASTC（實際畫的：測試圖 ASTC）", { timeout: 150_000 });
  await expect(result).toContainText("量測時間：5 秒");
  await expect(result).toContainText(/貼圖：0\.\d MB（\d+ 頁，其中 ASTC \d+ 頁；邊緣 0\.0 MB）/);
  await expect(result).toContainText("地面：");
  await expect(result).toContainText("顯示卡有 ASTC：有");
  await expect(result).toContainText(`瀏覽器：${await page.evaluate(() => navigator.userAgent)}`);
  await shot(page, info, "astc-measure-result");
  check();
});

test("art-v7 量測到一半頁面重新載入了（Safari 記憶體不足）：開局畫面寫是哪一種，不會自己再量一次", async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto("./?test=1&art=test&measure=x2-png&measures=60");
  await page.waitForFunction(() => window.__proto?.ready === true, null, { timeout: 90_000 });
  await page.reload();
  await expect(page.locator("#measure-note")).toContainText(/上次量測到一半，頁面重新載入了（art-v7 x2 PNG/);
  await expect(page.getByRole("button", { name: "開始" })).toBeVisible();
  await page.waitForTimeout(1000);
  expect(await page.evaluate(() => window.__proto?.screen)).toBe("start");
});
