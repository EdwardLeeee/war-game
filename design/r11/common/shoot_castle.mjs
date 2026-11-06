// art-v7.6 (the user 2026-11-06: 「圖裡面的城門方向不太對」): the castles as client/ draws them on the diamond camera, at the
// phone's pixels: every town of the fixed map in the real sim (KEEP on: D-100's castles), and the e2e fake world's two
// walled towns with the militia on the walls (client/e2e/walls.spec.ts: ours at (18, 62), the neutral one at (30, 66)).
//   (cd client && ART_TAG=<tag> npx vite build && npx vite preview --host 127.0.0.1 --port 5199)   with the tag's x3 unpacked
//   in client/public/art/<tag>/x3 (or its dist/art/<tag>/x3 swapped for the atlas being checked)
//   node design/r11/common/shoot_castle.mjs http://127.0.0.1:5199 OUT_PREFIX
import { createRequire } from "node:module";
const require = createRequire(new URL("../../../client/package.json", import.meta.url));
const { chromium } = require("playwright");
const [base, out] = process.argv.slice(2);
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 814, height: 380 }, deviceScaleFactor: 3 });
  page.on("pageerror", (e) => console.log("pageerror", e.message));
  await page.goto(`${base}/?test=1&map=fixed&watch=1&seed=1&art=x3`);
  await page.getByRole("button", { name: /^開始/ }).click();
  await page.waitForFunction(() => window.__proto?.ready && (window.__proto.game?.towns() ?? []).length > 0, null, { timeout: 120000 });
  await page.waitForTimeout(4000);
  const towns = await page.evaluate(() => window.__proto.game.towns());
  console.log("towns", JSON.stringify(towns.map((t) => [t.id, t.size, t.cx, t.cy])));
  for (const t of towns) {
    await page.evaluate(([x, y, s]) => window.__proto.game.centerOn(x, y, s), [t.cx + 0.5, t.cy + 0.5, t.size > 1 ? 0.55 : 0.7]);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${out}_town${t.id}.png` });
  }
  await page.goto(`${base}/?test=1&mock=1&walls=1&tps=20&art=x3`);
  await page.getByRole("button", { name: "開始" }).click();
  await page.waitForFunction(() => window.__proto?.ready === true, null, { timeout: 60000 });
  await page.waitForTimeout(5000);
  for (const [name, x, y, s] of [["ours", 18.5, 62.5, 1.1], ["neutral", 30.5, 66.5, 1.1], ["neutral_south", 30.5, 70.5, 2.0]]) {
    await page.evaluate(([x, y, s]) => window.__proto.game.centerOn(x, y, s), [x, y, s]);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${out}_walls_${name}.png` });
  }
  console.log("lifted", await page.evaluate(() => window.__proto.game.wallLifted()));
} finally {
  await browser.close();
}
