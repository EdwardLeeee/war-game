// R17-02 shots: 現況, 甲 (one kind of mark), 乙 (two kinds) on the time axis of the client's stats page (r17-page.js draw2)
import { readFileSync, writeFileSync } from "node:fs";
import { chromium, open, endWith, tab } from "./lib.mjs";
const OUT = process.argv[2];
const EV = JSON.parse(readFileSync(process.argv[3], "utf8"));
const PAGE = new URL("./r17-page.js", import.meta.url).pathname;
const only = process.argv.slice(4);
// [name, game, variant, tab, the event tapped: [kind, start s] or null]
const TAP_LOSE = ["battle", 43 * 60 + 8];
const TAP_WIN = ["attack", 73 * 60];
const SHOTS = [];
for (const v of ["甲", "乙"]) {
  SHOTS.push([`${v}-lose`, "33cdaaa5", v, "兵力", null], [`${v}-lose-tap`, "33cdaaa5", v, "兵力", TAP_LOSE], [`${v}-win`, "2fd2e236", v, "兵力", null],
    [`${v}-win-tap`, "2fd2e236", v, "兵力", TAP_WIN], [`${v}-short`, "62ae4218", v, "兵力", null]);
}
SHOTS.push(["現況-lose", "33cdaaa5", "現況", "兵力", null], ["現況-win", "2fd2e236", "現況", "兵力", null], ["現況-short", "62ae4218", "現況", "兵力", null]);
let marks = {};
try { marks = JSON.parse(readFileSync(`${OUT}/marks.json`, "utf8")); } catch {}
const T0 = Date.now();
const browser = await chromium.launch();
try {
  for (const [name, game, v, t, pick] of SHOTS) {
    if (only.length && !only.includes(name)) continue;
    const { ctx, page, me } = await open(browser);
    await endWith(page, me, game);
    await page.evaluate(() => { for (const e of document.querySelectorAll(".stats-card *")) if (e.children.length === 0 && /對手：玩家/.test(e.textContent)) e.textContent = e.textContent.replace("對手：玩家", "對手：電腦・困難"); });
    await tab(page, t);
    await page.addScriptTag({ path: PAGE });
    marks[name] = await page.evaluate(([v, ev, pick]) => window.R17.draw2(v, ev, ev.ticks, pick), [v, EV[game], pick]);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/${name}.png` });
    console.log(`${((Date.now() - T0) / 1000).toFixed(0)}s ${name}`);
    await ctx.close();
  }
} finally {
  await browser.close();
}
writeFileSync(`${OUT}/marks.json`, JSON.stringify(marks));
