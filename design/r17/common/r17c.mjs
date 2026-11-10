// R17-03 shots: 現況 and 三種記號 (進攻 ▲, 防守 盾, 團戰 ●) on the time axis of the client's stats page (r17-page.js draw3)
//   R17_TIMELINES=.../review/r17/timelines node design/r17/common/r17c.mjs OUT events3.json [name ...]
import { readFileSync } from "node:fs";
import { chromium, open, endWith, tab } from "./lib.mjs";
const OUT = process.argv[2];
const EV = JSON.parse(readFileSync(process.argv[3], "utf8"));
const PAGE = new URL("./r17-page.js", import.meta.url).pathname;
const only = process.argv.slice(4);
// [name, game, the event tapped: [kind, start s] or null, with the marks]
const SHOTS = [
  ["lose", "33cdaaa5", null, true], ["lose-tap", "33cdaaa5", ["defend", 39 * 60 + 30], true],
  ["win", "2fd2e236", null, true], ["win-tap", "2fd2e236", ["attack", 40 * 60 + 50], true],
  ["short", "62ae4218", null, true], ["short-tap", "62ae4218", ["battle", 15 * 60 + 37], true],
  ["now-lose", "33cdaaa5", null, false], ["now-win", "2fd2e236", null, false],
];
const T0 = Date.now();
const browser = await chromium.launch();
try {
  for (const [name, game, pick, marks] of SHOTS) {
    if (only.length && !only.includes(name)) continue;
    const { ctx, page, me } = await open(browser);
    await endWith(page, me, game);
    await page.evaluate(() => { for (const e of document.querySelectorAll(".stats-card *")) if (e.children.length === 0 && /對手：玩家/.test(e.textContent)) e.textContent = e.textContent.replace("對手：玩家", "對手：電腦・困難"); });
    await tab(page, "兵力");
    if (marks) {
      await page.addScriptTag({ path: PAGE });
      const n = await page.evaluate(([l, t, p]) => window.R17.draw3(l, t, p), [EV[game].list, EV[game].ticks, pick]);
      if (n !== EV[game].list.length) throw new Error(`${name}: ${n} marks`);
    }
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/${name}.png` });
    console.log(`${((Date.now() - T0) / 1000).toFixed(0)}s ${name}`);
    await ctx.close();
  }
} finally {
  await browser.close();
}
