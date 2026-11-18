// R26-05: the battlefield behind the cursors, at 1x and 2x (a usual screen and a high-resolution one), with the screen
// points of a grass cell, the barracks and the main city's roof (CSS px), for cursor_board.py.
//   node design/r26/cursor/backdrop.mjs OUT
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(new URL("../../../client/package.json", import.meta.url));
const { chromium } = require("@playwright/test");
const OUT = process.argv[2];
const PAGE = process.env.R26_PAGE ?? "http://127.0.0.1:5199/";
const browser = await chromium.launch();
const at = {};
try {
  for (const dsf of [1, 2]) {
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 950 }, deviceScaleFactor: dsf });
    await ctx.addInitScript(() => { localStorage.setItem("war-game.proto.theme", "a"); localStorage.setItem("war-game.proto.grade", "off"); });
    const p = await ctx.newPage();
    p.setDefaultTimeout(90000);
    await p.goto(`${PAGE}?test=1&tps=20&art=x3&ground=real&mock=1`);
    await p.getByRole("button", { name: "開始" }).click();
    await p.waitForFunction(() => window.__proto?.ready === true);
    await p.waitForFunction(() => (window.__proto?.game?.art()?.units ?? 0) > 0, null, { timeout: 90000 });
    await p.evaluate(() => { window.__proto.game.pause(); window.__proto.game.centerOn(14, 76, 1.3); document.getElementById("hud").style.visibility = "hidden"; });
    await p.waitForTimeout(1200);
    await p.screenshot({ path: `${OUT}/bg-${dsf}x.png` });
    if (dsf === 1) {
      Object.assign(at, await p.evaluate(() => {
        const g = window.__proto.game;
        const b = (id) => { const x = g.buildings().find((y) => y.id === id); return g.cellToScreen(x.cx + x.size / 2, x.cy + x.size / 2); };
        return { grass: g.cellToScreen(19.5, 74.5), barracks: b(3), city: b(1) };
      }));
    }
    await ctx.close();
  }
  writeFileSync(`${OUT}/backdrop.json`, JSON.stringify(at, null, 1));
  console.log(JSON.stringify(at));
} finally {
  await browser.close();
}
