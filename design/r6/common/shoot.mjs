// R6 B.2: screenshots of the mock pages (design/r6/mock/screen.html) at the phone's 3 px a pt.
//   node design/r6/common/shoot.mjs NAME QUERY [NAME QUERY ...]   -> design/r6/build/shot-NAME.png
// Playwright from client/node_modules (npm ci there first).
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(HERE, "../../../client/package.json"));
const { chromium } = require("@playwright/test");
const page_url = pathToFileURL(join(HERE, "../mock/screen.html")).href;
const out = join(HERE, "../build");
const args = process.argv.slice(2);
const browser = await chromium.launch();
for (let i = 0; i < args.length; i += 2) {
  const [name, query] = [args[i], args[i + 1]];
  const states = query.includes("states=1");
  const ctx = await browser.newContext({ viewport: states ? { width: 640, height: 400 } : { width: 814, height: 380 }, deviceScaleFactor: 3 });
  const page = await ctx.newPage();
  await page.goto(`${page_url}?${query}`);
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  // every tappable thing at least 44 x 44 pt (brief; client/e2e checks the same)
  // (layout size: a pressed button's shrink animation does not change where the finger can land)
  const small = await page.evaluate(() => [...document.querySelectorAll("button, .b")].map((b) => (
    { t: (b.textContent || "").trim().slice(0, 12), w: b.offsetWidth, h: b.offsetHeight }
  )).filter((r) => r.w < 44 || r.h < 44));
  if (small.length) {
    console.log(`TOO SMALL in ${name}:`, JSON.stringify(small));
    process.exitCode = 1;
  }
  const el = states ? page.locator(".states") : page.locator("#screen");
  await el.screenshot({ path: join(out, `shot-${name}.png`) });
  console.log("wrote", name);
  await ctx.close();
}
await browser.close();
