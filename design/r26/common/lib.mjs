// R26 電腦版: the real page in a desktop browser (a mouse, no touch), 1920 × 950 (a 1920 × 1080 screen less
// the browser's frame) or 1366 × 768, the fake world with art-v7.11 (the tutorial: the real game).
import { createRequire } from "node:module";

const require = createRequire(new URL("../../../client/package.json", import.meta.url));
const { chromium } = require("@playwright/test");
export { chromium };

export const PAGE = process.env.R26_PAGE ?? "http://127.0.0.1:5199/";
export const SIZES = { big: { width: 1920, height: 950 }, small: { width: 1366, height: 768 } };

export async function context(browser, size = SIZES.big) {
  const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: 1, isMobile: false, hasTouch: false });
  await ctx.addInitScript(() => {
    localStorage.setItem("war-game.proto.theme", "a");
    localStorage.setItem("war-game.proto.grade", "off");
  });
  return ctx;
}

/** The start screen (nothing pressed yet). */
export async function startScreen(browser, size, extra = "&mock=1") {
  const ctx = await context(browser, size);
  const page = await ctx.newPage();
  page.setDefaultTimeout(90000);
  page.on("pageerror", (e) => console.log("pageerror", e.message));
  await page.goto(`${PAGE}?test=1&tps=20&art=x3&ground=real${extra}`);
  await page.getByRole("button", { name: "開始" }).waitFor();
  await page.waitForTimeout(800);
  return { ctx, page };
}

/** The fake world's battlefield, paused, the camera where R24's shots were. */
export async function battlefield(browser, size = SIZES.big, extra = "") {
  const { ctx, page } = await startScreen(browser, size, `&mock=1${extra}`);
  await page.getByRole("button", { name: "開始" }).click();
  await page.waitForFunction(() => window.__proto?.ready === true);
  await page.waitForFunction(() => (window.__proto?.game?.art()?.units ?? 0) > 0, null, { timeout: 90000 });
  await page.evaluate(() => {
    window.__proto.game.pause();
    window.__proto.game.centerOn(14, 76, 1.1);
  });
  await page.waitForTimeout(800);
  return { ctx, page, me: await page.evaluate(() => window.__proto.game.me()) };
}

export const own = (page, types = [1, 2, 3]) =>
  page.evaluate((t) => window.__proto.game.units().filter((u) => u.owner === window.__proto.game.me() && t.includes(u.type)).map((u) => u.id), types);
