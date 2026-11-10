import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire(new URL("../../../client/package.json", import.meta.url));
const { chromium, devices } = require("@playwright/test");
const { defaultBrowserType, ...phone } = devices["iPhone 14 Pro Max landscape"];
export const TL = (g) => JSON.parse(readFileSync(`${process.env.R17_TIMELINES ?? "../review/r17/timelines"}/${g}.json`, "utf8"));
export async function open(browser, theme = "a") {
  const ctx = await browser.newContext({ ...phone, viewport: { width: 932, height: 336 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(90000);
  page.on("pageerror", (e) => console.log("pageerror", e.message));
  await page.addInitScript((t) => localStorage.setItem("war-game.proto.theme", t), theme);
  await page.goto("http://127.0.0.1:5199/?test=1&mock=1&tps=20&ui=r6&art=x3&ground=real");
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true);
  await page.evaluate(() => { const r = document.documentElement.style; r.setProperty("--safe-t", "0px"); r.setProperty("--safe-r", "59px"); r.setProperty("--safe-b", "21px"); r.setProperty("--safe-l", "59px"); });
  return { ctx, page, me: await page.evaluate(() => window.__proto.game.me()) };
}
export async function endWith(page, me, g) {
  const t = TL(g);
  await page.evaluate(([w, tl]) => window.__proto.game.endGame(w, 0, tl), [t.result === "win" ? me : 1 - me, t.timeline]);
  await page.waitForSelector(".stats-card");
  await page.waitForTimeout(800);
}
export async function tab(page, name) {
  await page.evaluate((n) => [...document.querySelectorAll(".stats-card [role=tab]")].find((t) => t.textContent.trim() === n).click(), name);
  await page.waitForTimeout(700);
}
export { chromium };
