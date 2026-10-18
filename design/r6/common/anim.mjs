// R6-25: the frames of each animation (design/r6/common/anim.py lists them), shot from ui.html at 2 px a pt.
//   node design/r6/common/anim.mjs < frames.json     (one line per frame: {state, t, theme, crop, out})
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(HERE, "../../../client/package.json"));
const { chromium } = require("@playwright/test");
const url = pathToFileURL(join(HERE, "../mock/ui.html")).href;
const frames = JSON.parse(readFileSync(0, "utf8"));
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 814, height: 380 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
for (const f of frames) {
  await page.goto(`${url}?theme=${f.theme}&state=${f.state}&t=${f.t}`);
  await page.waitForFunction(() => document.getElementById("screen")?.childElementCount > 0);
  await page.evaluate(() => document.fonts.ready);
  const [x, y, w, h] = f.crop;
  await page.screenshot({ path: f.out, clip: { x, y, width: w, height: h } });
}
await browser.close();
console.log("shot", frames.length);
