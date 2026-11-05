// art-v7.3 (ceo 2026-11-06: check the diamond terrain with the client's own drawing, not a composite): the fixed map's
// north-south bridge, east-west bridge and cliffs, as client/ draws them on the diamond camera, at the phone's pixels.
//   (cd client && npx vite build && npx vite preview --host 127.0.0.1 --port 5199)   with art.lock's tag unpacked in
//   client/public/art/<tag>/x3 (or its dist/art/<tag>/x3 swapped for the atlas being checked)
//   node design/r11/common/shoot_terrain.mjs "http://127.0.0.1:5199/?test=1&map=fixed&watch=1&seed=1&art=x3" OUT_PREFIX
import { createRequire } from "node:module";
const require = createRequire(new URL("../../../client/package.json", import.meta.url));
const { chromium } = require("playwright");
const [url, out] = process.argv.slice(2);
// [name, cell x, cell y, zoom] on the fixed map (sim/src/core/fixed-terrain.ts: | at 17-19 x 58-60, = at 58-60 x 17-19, K 52-56 x 70-81)
const spots = [["bridge_ns", 18, 59, 1.0], ["bridge_ew", 59, 18, 1.0], ["cliff", 54, 76, 0.8], ["cliff_far", 54, 76, 0.5]];
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 814, height: 380 }, deviceScaleFactor: 3 });
  page.on("pageerror", (e) => console.log("pageerror", e.message));
  await page.goto(url);
  await page.getByRole("button", { name: /^開始/ }).click();
  await page.waitForFunction(() => window.__proto?.ready && window.__proto.game?.terrain(), null, { timeout: 120000 });
  await page.waitForTimeout(4000);
  console.log("terrain", JSON.stringify(await page.evaluate(() => window.__proto.game.terrain())));
  for (const [name, x, y, s] of spots) {
    await page.evaluate(([x, y, s]) => window.__proto.game.centerOn(x, y, s), [x, y, s]);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${out}_${name}.png` });
  }
} finally {
  await browser.close();
}
