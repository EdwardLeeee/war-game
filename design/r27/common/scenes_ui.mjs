// R27-02: the bridge head behind the interface boards, in each screen: the iPhone in the app (932 x 430) and in Safari
// (932 x 336) with the outpost in the middle, the app again with it up and to the right (the outpost's panel takes the
// middle of the phone's screen), the desktop window (1920 x 950). Same data as scenes.mjs (scenes.json).
//   node design/r27/common/scenes_ui.mjs OUT
import { readFileSync, writeFileSync } from "node:fs";
import { cells, chromium, DESKTOP, PHONE_APP, PHONE_SAFARI, twinRivers } from "./lib.mjs";

const OUT = process.argv[2];
const ONLY = process.argv.slice(3);
const X0 = 30;
const Y0 = 46;                                 // the bridge head (scenes.mjs "bridge")
const SHOTS = [
  ["app", PHONE_APP, true, 1.6, null],
  ["appUp", PHONE_APP, true, 1.6, [650, 150]],  // the footprint's middle there (CSS px): clear of the panel and 1-4
  ["safari", PHONE_SAFARI, true, 1.6, null],
  ["desk", DESKTOP, false, 2.0, null],
];
const browser = await chromium.launch();
const meta = JSON.parse(readFileSync(`${OUT}/scenes.json`, "utf8"));
try {
  for (const [name, size, phone, zoom, at] of SHOTS.filter(([n]) => ONLY.length === 0 || ONLY.includes(n))) {
    const { ctx, page } = await twinRivers(browser, size, phone);
    await page.evaluate(() => { document.getElementById("hud").style.visibility = "hidden"; });
    const cx = X0 + 1.5;
    const cy = Y0 + 1.5;
    await page.evaluate(([x, y, z]) => window.__proto.game.centerOn(x, y, z), [cx, cy, zoom]);
    await page.waitForTimeout(800);
    if (at !== null) {
      // move the camera so that the footprint's middle lands at `at`: the cell steps on the screen, solved
      const [c, e, s] = await cells(page, [[cx, cy], [cx + 1, cy], [cx, cy + 1]]);
      const ex = [e.x - c.x, e.y - c.y];
      const sy = [s.x - c.x, s.y - c.y];
      const dx = at[0] - c.x;
      const dy = at[1] - c.y;
      const det = ex[0] * sy[1] - ex[1] * sy[0];
      const a = (dx * sy[1] - dy * sy[0]) / det;
      const b = (ex[0] * dy - ex[1] * dx) / det;
      await page.evaluate(([x, y, z]) => window.__proto.game.centerOn(x, y, z), [cx - a, cy - b, zoom]);
    }
    await page.waitForTimeout(1800);
    await page.screenshot({ path: `${OUT}/bg-ui-${name}.png` });
    const pts = await cells(page, [[cx, cy], [X0, Y0], [X0 + 3, Y0], [X0 + 3, Y0 + 3], [X0, Y0 + 3], [cx + 1, cy], [cx, cy + 1]]);
    const grid = [];
    for (let k = 0; k <= 3; k++) grid.push(await cells(page, [[X0 + k, Y0], [X0 + k, Y0 + 3], [X0, Y0 + k], [X0 + 3, Y0 + k]]));
    meta[`ui-${name}`] = { x0: X0, y0: Y0, zoom, what: "橋頭", centre: pts[0], corners: pts.slice(1, 5), east: pts[5], south: pts[6], grid, dpr: await page.evaluate(() => devicePixelRatio) };
    console.log(name, JSON.stringify(pts[0]));
    await ctx.close();
  }
} finally {
  await browser.close();
  writeFileSync(`${OUT}/scenes.json`, JSON.stringify(meta, null, 1));
}
