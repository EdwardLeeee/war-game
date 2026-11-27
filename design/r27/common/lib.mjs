// R27 哨所轉向: the real page, an iPhone 14 Pro Max held sideways in the app (932 x 430, no Safari bars) or in Safari
// (932 x 336), or a desktop window (1920 x 950, a mouse). The twin-rivers map watched (?watch=1: the computer plays both
// sides, nothing fogged) for the passes; the fake world for the interface.
import { createRequire } from "node:module";

const require = createRequire(new URL("../../../client/package.json", import.meta.url));
const { chromium, devices } = require("@playwright/test");
export { chromium };

export const PAGE = process.env.R27_PAGE ?? "http://127.0.0.1:5199/";
export const SAFE = { top: 0, right: 59, bottom: 21, left: 59 };
export const PHONE_APP = { width: 932, height: 430 };
export const PHONE_SAFARI = { width: 932, height: 336 };
export const DESKTOP = { width: 1920, height: 950 };
const { defaultBrowserType, ...iphone } = devices["iPhone 14 Pro Max landscape"];

export async function context(browser, size, phone) {
  const ctx = phone
    ? await browser.newContext({ ...iphone, viewport: size })
    : await browser.newContext({ viewport: size, deviceScaleFactor: 1, isMobile: false, hasTouch: false });
  await ctx.addInitScript(() => {
    localStorage.setItem("war-game.proto.theme", "a");
    localStorage.setItem("war-game.proto.grade", "off");
  });
  return ctx;
}

async function safe(page) {
  await page.evaluate((s) => {
    const r = document.documentElement.style;
    for (const k of ["top", "right", "bottom", "left"]) r.setProperty(`--safe-${k[0]}`, `${s[k]}px`);
  }, SAFE);
}

/** The twin-rivers map, watched, paused at its start. */
export async function twinRivers(browser, size = PHONE_APP, phone = true) {
  const ctx = await context(browser, size, phone);
  const page = await ctx.newPage();
  page.setDefaultTimeout(120000);
  page.on("pageerror", (e) => console.log("pageerror", e.message));
  await page.addInitScript(() => localStorage.setItem("war-game.proto.map", "twin-rivers"));
  await page.goto(`${PAGE}?test=1&watch=1&tps=20&art=x3&ground=real`);
  const go = page.getByRole("button", { name: "開始" });
  if (await go.isVisible().catch(() => false)) await go.evaluate((b) => b.click());
  await page.waitForFunction(() => window.__proto?.ready === true, null, { timeout: 180000 });
  await page.waitForFunction(() => (window.__proto?.game?.art()?.buildings ?? 0) > 0, null, { timeout: 180000 });
  await page.evaluate(() => window.__proto.game.pause());
  if (phone) await safe(page);
  await page.waitForTimeout(500);
  return { ctx, page };
}

/** The fake world, paused, the camera where R24's shots were. */
export async function fakeWorld(browser, size = PHONE_APP, phone = true, extra = "") {
  const ctx = await context(browser, size, phone);
  const page = await ctx.newPage();
  page.setDefaultTimeout(120000);
  page.on("pageerror", (e) => console.log("pageerror", e.message));
  await page.goto(`${PAGE}?test=1&mock=1&tps=20&art=x3&ground=real${extra}`);
  await page.getByRole("button", { name: "開始" }).evaluate((b) => b.click());
  await page.waitForFunction(() => window.__proto?.ready === true);
  await page.waitForFunction(() => (window.__proto?.game?.art()?.units ?? 0) > 0, null, { timeout: 120000 });
  if (phone) await safe(page);
  await page.evaluate(() => window.__proto.game.pause());
  await page.waitForTimeout(600);
  return { ctx, page, me: await page.evaluate(() => window.__proto.game.me()) };
}

/** Screen points (CSS px) of cell coordinates (a cell's corner at integers). */
export const cells = (page, pts) => page.evaluate((ps) => ps.map(([x, y]) => window.__proto.game.cellToScreen(x, y)), pts);
