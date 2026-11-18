// R26 現況: the screens as they are on a desktop (1920 × 950, a mouse), with what the brief asks to measure:
// the buttons' sizes in px and as a share of the window's height, the minimap, the panels, the text.
//   node design/r26/common/r26-now.mjs OUT [big|small]
import { readFileSync, writeFileSync } from "node:fs";
import { battlefield, chromium, own, SIZES, startScreen } from "./lib.mjs";

const OUT = process.argv[2];
const SIZE = SIZES[process.argv[3] ?? "big"];
const TAG = process.argv[3] === "small" ? "1366" : "1920";
// The client's e2e fixture: a 92-minute game the user lost (局後統計's tabs need a timeline).
const LOST = JSON.parse(readFileSync(new URL("../../../client/e2e/fixtures/r17-lost-92m.json", import.meta.url), "utf8"));
const browser = await chromium.launch();
const table = {};

async function measure(p) {
  return p.evaluate(() => {
    const H = innerHeight;
    const vis = (e) => {
      const r = e.getBoundingClientRect();
      const s = getComputedStyle(e);
      return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && e.closest("[hidden]") === null && r.bottom > 0 && r.top < H;
    };
    const bs = [...document.querySelectorAll("button")].filter(vis).map((b) => b.getBoundingClientRect());
    const hs = bs.map((r) => Math.round(r.height)).sort((a, b) => a - b);
    const font = (sel) => {
      const e = [...document.querySelectorAll(sel)].find(vis);
      return e ? parseFloat(getComputedStyle(e).fontSize) : null;
    };
    const box = (sel) => {
      const e = [...document.querySelectorAll(sel)].find(vis);
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)];
    };
    return {
      buttons: bs.length,
      buttonH: hs.length ? { min: hs[0], median: hs[Math.floor(hs.length / 2)], max: hs[hs.length - 1] } : null,
      buttonShare: hs.length ? Math.round((hs[Math.floor(hs.length / 2)] / H) * 1000) / 10 : null,
      buttonFont: font("#hud button, #start button, .dialog button"),
      textFont: font(".sel-info, .dialog-card p, .r25-card, .tutor, #start p, .dialog-card"),
      minimap: box("#hud .minimap:not(.closed)"),
      panel: box("#hud .sel-info"),
      dialog: box(".dialog-card"),
      cmds: box("#hud .cmds"),
    };
  });
}

async function shot(p, name) {
  await p.waitForTimeout(500);
  await p.screenshot({ path: `${OUT}/now-${TAG}-${name}.png` });
  table[name] = await measure(p);
  const m = table[name];
  console.log(`${name}: ${m.buttons} buttons, height ${JSON.stringify(m.buttonH)} px (${m.buttonShare}% of ${SIZE.height}), font ${m.buttonFont}/${m.textFont}px, minimap ${m.minimap}, panel ${m.panel}, cmds ${m.cmds}`);
}

const clickText = (p, sel, text) => p.evaluate(([s, t]) => [...document.querySelectorAll(s)].find((e) => (e.textContent || "").includes(t) && e.getBoundingClientRect().width > 0)?.click(), [sel, text]);

try {
  {
    const { ctx, page: p } = await startScreen(browser, SIZE);
    await shot(p, "01-開局畫面");
    await ctx.close();
  }
  {
    const { ctx, page: p } = await battlefield(browser, SIZE);
    await shot(p, "02-沒選東西");
    await p.evaluate((i) => window.__proto.game.select(i), await own(p));
    await shot(p, "03-選了部隊");
    // 編隊 1 from them, then its 軍團畫面
    await p.evaluate(() => document.querySelector(".groups > button")?.click());
    await p.waitForTimeout(500);
    const save = p.getByRole("button", { name: /改成剛才選的/ }).first();
    if (await save.isVisible().catch(() => false)) await save.click();
    await p.waitForTimeout(500);
    await shot(p, "04-軍團畫面");
    await ctx.close();
  }
  {
    const { ctx, page: p } = await battlefield(browser, SIZE);
    const [v] = await own(p, [0]);
    await p.evaluate((i) => window.__proto.game.select([i]), v);
    await p.waitForTimeout(300);
    await clickText(p, "#hud .cmds button", "建造");
    await shot(p, "05-建造選單");
    await ctx.close();
  }
  {
    const { ctx, page: p } = await battlefield(browser, SIZE);
    const b = await p.evaluate(() => { const x = window.__proto.game.buildings().find((y) => y.id === 3); return [x.cx + x.size / 2, x.cy + x.size / 2]; });
    await p.evaluate(([x, y]) => window.__proto.game.centerOn(x + 4, y, 1.1), b);
    await p.waitForTimeout(300);
    const s = await p.evaluate(([x, y]) => window.__proto.game.cellToScreen(x, y), b);
    await p.mouse.click(s.x, s.y);
    await shot(p, "06-兵營");
    await ctx.close();
  }
  {
    const { ctx, page: p, me } = await battlefield(browser, SIZE);
    await p.evaluate(() => window.__proto.game.centerOn(30, 66, 1.1));
    await p.evaluate((m) => window.__proto.game.setTown(0, 1, m), me);
    await p.getByRole("button", { name: /繼續/ }).first().click();
    await p.waitForFunction(() => (window.__proto.game.towns() ?? []).find((t) => t.id === 0)?.state === 1, null, { timeout: 30000 });
    await p.evaluate((m) => window.__proto.game.inject({ k: "town_captured", town: 0, by: m }), me);
    await p.evaluate(() => window.__proto.game.pause());
    await p.locator(".choice-govern").first().waitFor({ timeout: 20000 });
    await shot(p, "07-搶或治理");
    await ctx.close();
  }
  {
    const { ctx, page: p, me } = await battlefield(browser, SIZE);
    await shot(p, "08-暫停");
    await p.getByRole("button", { name: /選單/ }).first().click();
    await shot(p, "09-選單");
    await p.getByRole("button", { name: /^設定/ }).first().click();
    await shot(p, "10-設定");
    await ctx.close();
    const o = await battlefield(browser, SIZE);
    await o.page.evaluate(([l]) => window.__proto.game.endGame(l.winner, l.reason, l.timeline), [LOST]);
    await o.page.waitForTimeout(1200);
    await shot(o.page, "11-局後統計");
    void me;
    await o.ctx.close();
  }
  {
    // 新手教學: the real game (the tutorial scene), its first card.
    const { ctx, page: p } = await startScreen(browser, SIZE, "");
    const t = p.getByRole("button", { name: /新手教學/ }).first();
    if (await t.isVisible().catch(() => false)) {
      await t.click();
      await p.waitForFunction(() => window.__proto?.ready === true, null, { timeout: 120000 }).catch(() => {});
      await p.waitForTimeout(4000);
      await shot(p, "12-新手教學");
    } else console.log("no 新手教學 on the start screen");
    await ctx.close();
  }
} finally {
  await browser.close();
  writeFileSync(`${OUT}/now-${TAG}.json`, JSON.stringify(table, null, 1));
}
