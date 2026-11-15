// R25: the highlight's flash, A and B (the user's rule: what moves gets a GIF). Frames of 3a (a button)
// at eight points of one flash; boards_r25.py's gif() lays them side by side.
//   node design/r25/common/gif_r25.mjs OUT
import { fileURLToPath } from "node:url";
import { browserType, open } from "../../r24/common/lib.mjs";

const OUT = process.argv[2];
const R24_JS = fileURLToPath(new URL("../../r24/common/r24-page.js", import.meta.url));
const R25_JS = fileURLToPath(new URL("./tutorial-page.js", import.meta.url));
const browser = await browserType.launch();
try {
  for (const style of ["A", "B"]) {
    const { ctx, page: p } = await open(browser, "r6", "a", "&r7=1&outpost=1&siege=1");
    await p.addScriptTag({ path: R24_JS });
    await p.addScriptTag({ path: R25_JS });
    await p.evaluate((s) => window.R25.setStyle(s), style);
    const v = await p.evaluate(() => {
      const g = window.__proto.game;
      const u = g.units().filter((x) => x.owner === g.me() && x.type === 0)[0];
      g.select([u.id]);
      return u.id;
    });
    await p.waitForTimeout(300);
    await p.evaluate(() => {
      window.R24.bar({ title: "村民", state: window.R24.st("閒置", "idle"), stateUnder: true });
      window.R25.card({ n: 3, title: "蓋兵營", body: "選著村民，按右下的<b>建造</b>。" });
      window.R25.spot({ sel: "#hud .cmds button", text: "建造" }, { arrow: "up" });
    });
    for (let i = 0; i < 8; i++) {
      const phase = (1 - Math.cos((i / 8) * 2 * Math.PI)) / 2;
      await p.evaluate((ph) => document.querySelector(".r25-layer").style.setProperty("--p", `${ph}`), phase);
      await p.waitForTimeout(120);
      await p.screenshot({ path: `${OUT}/gif-${style}-${i}.png` });
    }
    void v;
    await ctx.close();
  }
} finally {
  await browser.close();
}
