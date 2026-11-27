// R27: the battlefield behind each facing, the twin-rivers map watched (nothing fogged), its interface hidden, paused at
// the start (nobody there yet). Each scene: a 3 x 3 footprint (its top left cell), where the screen has it.
//   node design/r27/common/scenes.mjs OUT
import { writeFileSync } from "node:fs";
import { chromium, twinRivers, cells } from "./lib.mjs";

const OUT = process.argv[2];
// x0, y0: the footprint's top left cell. The map (sim/src/core/twin-rivers-data.ts): the north river y 49-51, its
// bridge x 30-32; the rock ridge y 54 with a gap x 3-5; two cliff lines closing a valley to 3 cells (x 14-16) and 1 (x 17-19).
export const SCENES = {
  bridge: { x0: 30, y0: 46, zoom: 1.6, what: "橋頭：北邊的河，橋 3 格寬" },
  ridge: { x0: 3, y0: 53, zoom: 1.6, what: "岩脊缺口：一道岩脊中間缺 3 格" },
  valley: { x0: 14, y0: 63, zoom: 1.6, what: "兩山之間：兩道懸崖夾出的山谷，這裡剛好 3 格寬" },
  mouth: { x0: 20, y0: 63, zoom: 1.6, what: "兩山之間：同一條山谷的東口（谷底最窄 1 格）" },
  openSE: { x0: 49, y0: 41, zoom: 1.6, what: "空曠地：北邊玩家的主城在左上（18, 16）" },
  openNE: { x0: 53, y0: 85, zoom: 1.6, what: "空曠地：南邊玩家的主城在左下（18, 113）" },
  openSW: { x0: 77, y0: 41, zoom: 1.6, what: "空曠地" },
  openNW: { x0: 77, y0: 85, zoom: 1.6, what: "空曠地" },
};

const browser = await chromium.launch();
const meta = {};
try {
  const { ctx, page } = await twinRivers(browser);
  await page.evaluate(() => { document.getElementById("hud").style.visibility = "hidden"; });
  for (const [name, s] of Object.entries(SCENES)) {
    const cx = s.x0 + 1.5;
    const cy = s.y0 + 1.5;
    await page.evaluate(([x, y, z]) => window.__proto.game.centerOn(x, y, z), [cx, cy, s.zoom]);
    await page.waitForTimeout(1800);
    await page.screenshot({ path: `${OUT}/bg-${name}.png` });
    const pts = await cells(page, [[cx, cy], [s.x0, s.y0], [s.x0 + 3, s.y0], [s.x0 + 3, s.y0 + 3], [s.x0, s.y0 + 3], [cx + 1, cy], [cx, cy + 1]]);
    const grid = [];
    for (let k = 0; k <= 3; k++) grid.push(await cells(page, [[s.x0 + k, s.y0], [s.x0 + k, s.y0 + 3], [s.x0, s.y0 + k], [s.x0 + 3, s.y0 + k]]));
    meta[name] = { ...s, centre: pts[0], corners: pts.slice(1, 5), east: pts[5], south: pts[6], grid, dpr: await page.evaluate(() => devicePixelRatio) };
    console.log(name, JSON.stringify(pts[0]));
  }
  await ctx.close();
} finally {
  await browser.close();
  writeFileSync(`${OUT}/scenes.json`, JSON.stringify(meta, null, 1));
}
