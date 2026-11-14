// R24 (D-149, the ceo's brief docs/briefs/2026-11-r24-ui-audit.md): the client's real page, the fake world with the
// published art (art.lock.json), 正式介面 (?ui=r6, A 銅木), the iPhone 14 Pro Max on its side (932 x 336 pt, its safe
// area), set up as war-game-client's own capture (war-game-worktrees/review/r24/zz-r24.spec.ts) does: at home, paused.
import { createRequire } from "node:module";
const require = createRequire(new URL("../../../client/package.json", import.meta.url));
const { chromium, webkit, devices } = require("@playwright/test");
const { defaultBrowserType, ...phone } = devices["iPhone 14 Pro Max landscape"];
export const SAFE = { top: 0, right: 59, bottom: 21, left: 59 };
export const PAGE = process.env.R24_PAGE ?? "http://127.0.0.1:5199/";

export async function open(browser, ui = "r6", theme = "a", extra = "") {
  const ctx = await browser.newContext({ ...phone, viewport: { width: 932, height: 336 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(90000);
  page.on("pageerror", (e) => console.log("pageerror", e.message));
  await page.addInitScript((t) => { localStorage.setItem("war-game.proto.theme", t); localStorage.setItem("war-game.proto.grade", "off"); }, theme);
  await page.goto(`${PAGE}?test=1&mock=1&tps=20&ui=${ui}&art=x3&ground=real${extra}`);
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true);
  await page.waitForFunction(() => (window.__proto?.game?.art()?.units ?? 0) > 0, null, { timeout: 90000 });
  await page.evaluate((s) => { const r = document.documentElement.style; r.setProperty("--safe-t", `${s.top}px`); r.setProperty("--safe-r", `${s.right}px`); r.setProperty("--safe-b", `${s.bottom}px`); r.setProperty("--safe-l", `${s.left}px`); }, SAFE);
  await page.evaluate(() => { window.__proto.game.pause(); window.__proto.game.centerOn(14, 76, 1.1); });
  await page.waitForTimeout(800);
  return { ctx, page, me: await page.evaluate(() => window.__proto.game.me()) };
}

/** Our soldiers of these types (1 槍兵, 2 遠程兵, 3 法師), ids. */
export const own = (page, types = [1, 2, 3]) => page.evaluate((t) => window.__proto.game.units().filter((u) => u.owner === window.__proto.game.me() && t.includes(u.type)).map((u) => u.id), types);

// R24: Chromium, 現況 and 改法 alike, so that the type is the same on both sides (the client's raw/ is
// WebKit's; this machine lacks WebKit's libraries). R24_BROWSER=webkit where it runs.
export const browserType = process.env.R24_BROWSER === "webkit" ? webkit : chromium;
export { chromium, webkit };
