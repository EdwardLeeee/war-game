// R6 B.3: one PNG per artboard (design/r6/mock/board.html), and the checks: every tappable thing in every frame at least
// 44 x 44 pt, every frame's state known.
//   node design/r6/common/shoot-boards.mjs R6-13:a R6-13:b ...   -> design/r6/out/<board>-<name>-<A-銅木|B-墨漆金線>-mobile.png
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(HERE, "../../../client/package.json"));
const { chromium } = require("@playwright/test");
const url = pathToFileURL(join(HERE, "../mock/board.html")).href;
const out = join(HERE, "../out");
const browser = await chromium.launch();
let bad = 0;
for (const arg of process.argv.slice(2)) {
  const [board, theme] = arg.split(":");
  const ctx = await browser.newContext({ viewport: { width: 1800, height: 1000 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${url}?board=${board}&theme=${theme}`);
  await page.waitForLoadState("networkidle");
  // the whole board inside the viewport: frames below the fold are not painted otherwise
  const box = await page.locator("#board").boundingBox();
  await page.setViewportSize({ width: Math.ceil(Math.max(1800, box.width)), height: Math.ceil(box.height) + 10 });
  await page.waitForTimeout(300);
  for (const f of page.frames()) {
    if (f === page.mainFrame()) continue;
    await f.waitForFunction(() => document.getElementById("screen")?.childElementCount > 0, null, { timeout: 15000 });
    await f.evaluate(() => document.fonts.ready);
    const small = await f.evaluate(() => [...document.querySelectorAll("button, .b")].map((b) => (
      { t: (b.textContent || b.getAttribute("aria-label") || "").trim().slice(0, 12), w: b.offsetWidth, h: b.offsetHeight }
    )).filter((r) => r.w < 44 || r.h < 44));
    if (small.length) { bad++; console.log(`TOO SMALL ${board}:${theme} ${f.url().split("state=")[1]}:`, JSON.stringify(small)); }
  }
  if (errors.length) { bad++; console.log(`ERRORS ${board}:${theme}:`, errors.join(" | ")); }
  const name = await page.locator("h1").textContent();
  await page.locator("#board").screenshot({ path: join(out, `${name}.png`) });
  console.log("wrote", name);
  await ctx.close();
}
await browser.close();
process.exitCode = bad ? 1 : 0;
