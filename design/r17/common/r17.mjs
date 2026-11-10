// R17 shots: per option and game, the client's stats page at 932 x 336 with the option drawn in (r17-page.js)
import { readFileSync, writeFileSync } from "node:fs";
import { chromium, open, endWith, tab } from "./lib.mjs";
const OUT = process.argv[2];
const EV = JSON.parse(readFileSync(process.argv[3], "utf8"));
const PAGE = new URL("./r17-page.js", import.meta.url).pathname;
const only = process.argv.slice(4);
const marks = {};
const T0 = Date.now();
// [name, game, option, tab, selected event index or null]
const SHOTS = [
  ["A-lose", "33cdaaa5", "A", "兵力", null], ["A-lose-tap", "33cdaaa5", "A", "兵力", 9], ["A-win", "2fd2e236", "A", "兵力", null],
  ["A-short", "62ae4218", "A", "兵力", null], ["A-res", "33cdaaa5", "A", "資源", null],
  ["C-lose", "33cdaaa5", "C", "兵力", null], ["C-lose-tap", "33cdaaa5", "C", "兵力", 9], ["C-win", "2fd2e236", "C", "兵力", null],
  ["C-short", "62ae4218", "C", "兵力", null], ["C-res", "33cdaaa5", "C", "資源", null],
  ["B-lose", "33cdaaa5", "B-list", "戰鬥", null], ["B-lose-tap", "33cdaaa5", "B-list", "戰鬥", 9], ["B-lose-jump", "33cdaaa5", "B-jump", "兵力", 9],
  ["B-win", "2fd2e236", "B-list", "戰鬥", null], ["B-short", "62ae4218", "B-list", "戰鬥", null],
];
const browser = await chromium.launch();
try {
  for (const [name, game, opt, t, sel] of SHOTS) {
    if (only.length && !only.includes(name)) continue;
    const { ctx, page, me } = await open(browser);
    await endWith(page, me, game);
    // the replay's timeline has no computer's name: the game's (hard) in its header, as the real page has it
    await page.evaluate(() => { for (const e of document.querySelectorAll(".stats-card *")) if (e.children.length === 0 && /對手：玩家/.test(e.textContent)) e.textContent = e.textContent.replace("對手：玩家", "對手：電腦・困難"); });
    if (opt === "C") {
      // the strip takes the room of a row under the chart: the chart is laid out again that much shorter
      await page.addStyleTag({ content: ".st-mkey{padding-top:30px !important}" });
      await page.evaluate(() => window.dispatchEvent(new Event("resize")));
      await page.waitForTimeout(400);
    }
    await tab(page, t);
    if (opt === "C") await page.evaluate(() => { const r = document.documentElement.style; window.dispatchEvent(new Event("resize")); });
    await page.waitForTimeout(400);
    await page.addScriptTag({ path: PAGE });
    marks[name] = await page.evaluate(([o, ev, sel]) => window.R17.draw(o, ev, ev.ticks, sel), [opt, EV[game], sel]);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/${name}.png` });
    console.log(`${((Date.now() - T0) / 1000).toFixed(0)}s ${name}`);
    await ctx.close();
  }
} finally {
  await browser.close();
}
let old = {};
try { old = JSON.parse(readFileSync(`${OUT}/marks.json`, "utf8")); } catch {}
writeFileSync(`${OUT}/marks.json`, JSON.stringify({ ...old, ...marks }));
