// R26 電腦版: every 現況 and 改法 frame on the real page (1920 × 950, a mouse; one check at 1366 × 768),
// the changes drawn in by r26-page.js. Prints, for each frame, the buttons over one another or out of the
// window and the smallest text on screen (after the zoom).
//   node design/r26/common/r26.mjs OUT [items...]      items: 1 2 3 4 5 6 7
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { battlefield, chromium, own, SIZES, startScreen } from "./lib.mjs";

const OUT = process.argv[2];
const ONLY = process.argv.slice(3);
const JS = fileURLToPath(new URL("./r26-page.js", import.meta.url));
const LOST = JSON.parse(readFileSync(new URL("../../../client/e2e/fixtures/r17-lost-92m.json", import.meta.url), "utf8"));
const browser = await chromium.launch();
const report = {};
const marks = {};
const on = (n) => ONLY.length === 0 || ONLY.includes(String(n));

async function field(size = SIZES.big, extra = "") {
  const o = await battlefield(browser, size, extra);
  await o.page.addScriptTag({ path: JS });
  return o;
}

async function shot(p, name) {
  await p.waitForTimeout(450);
  await p.screenshot({ path: `${OUT}/${name}.png` });
  const c = await p.evaluate(() => {
    const W = innerWidth;
    const H = innerHeight;
    const vis = (e) => {
      const r = e.getBoundingClientRect();
      const s = getComputedStyle(e);
      return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && e.closest("[hidden]") === null;
    };
    const bs = [...document.querySelectorAll("button")].filter(vis).filter((b) => !b.closest(".dialog") || document.querySelector(".dialog:not([hidden])") === b.closest(".dialog"));
    const box = (b) => { const r = b.getBoundingClientRect(); return { t: (b.getAttribute("aria-label") || b.textContent || "").trim().slice(0, 10), x: r.x, y: r.y, r: r.right, b: r.bottom, h: r.height }; };
    const xs = bs.map(box);
    const over = [];
    for (let i = 0; i < xs.length; i++) for (let j = i + 1; j < xs.length; j++) {
      const a = xs[i];
      const c2 = xs[j];
      if (bs[i].contains(bs[j]) || bs[j].contains(bs[i])) continue;
      // under an open dialog is not over
      const dlg = (e) => e.closest(".dialog") !== null;
      if (dlg(bs[i]) !== dlg(bs[j])) continue;
      if (a.x < c2.r - 1 && c2.x < a.r - 1 && a.y < c2.b - 1 && c2.y < a.b - 1) over.push(`${a.t} × ${c2.t}`);
    }
    const out = xs.filter((a) => a.x < -1 || a.y < -1 || a.r > W + 1 || a.b > H + 1).map((a) => a.t);
    // The smallest text in sight (px on the screen, after the zoom).
    let small = 99;
    for (const e of document.querySelectorAll("#hud *, #start *")) {
      if (!vis(e) || ![...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim() !== "")) continue;
      let z = 1;
      for (let p = e; p !== null; p = p.parentElement) z *= parseFloat(p.style?.zoom || "1") || 1;
      small = Math.min(small, parseFloat(getComputedStyle(e).fontSize) * z);
    }
    const hs = xs.map((a) => Math.round(a.h)).sort((a, b) => a - b);
    return { buttons: xs.length, buttonH: hs[Math.floor(hs.length / 2)] ?? 0, over, out, smallText: Math.round(small * 10) / 10 };
  });
  report[name] = c;
  console.log(`${name}: ${c.buttons} buttons, ${c.buttonH} px, smallest text ${c.smallText} px${c.over.length ? ` | over ${JSON.stringify(c.over)}` : ""}${c.out.length ? ` | out ${JSON.stringify(c.out)}` : ""}`);
}

const click = (p, sel, text) => p.evaluate(([s, t]) => { const e = [...document.querySelectorAll(s)].find((x) => (x.textContent || "").includes(t) && x.getBoundingClientRect().width > 0); if (!e) throw new Error(`no ${s} ${t}`); e.click(); }, [sel, text]);
const zoom = (p, s) => p.evaluate((v) => window.R26.scale(v ?? window.R26.auto()), s ?? null);
const selectArmy = async (p) => { await p.evaluate((i) => window.__proto.game.select(i), await own(p)); await p.waitForTimeout(300); };
const selectVillager = async (p) => { const [v] = await own(p, [0]); await p.evaluate((i) => window.__proto.game.select([i]), v); await p.waitForTimeout(300); };
async function groupScreen(p) {
  await selectArmy(p);
  await p.evaluate(() => document.querySelector(".groups > button")?.click());
  await p.waitForTimeout(500);
  const save = p.getByRole("button", { name: /改成剛才選的/ }).first();
  if (await save.isVisible().catch(() => false)) await save.click();
  await p.waitForTimeout(500);
}
async function townChoice(p, me) {
  await p.evaluate(() => window.__proto.game.centerOn(30, 66, 1.1));
  await p.evaluate((m) => window.__proto.game.setTown(0, 1, m), me);
  await p.getByRole("button", { name: /繼續/ }).first().click();
  await p.waitForFunction(() => (window.__proto.game.towns() ?? []).find((t) => t.id === 0)?.state === 1, null, { timeout: 30000 });
  await p.evaluate((m) => window.__proto.game.inject({ k: "town_captured", town: 0, by: m }), me);
  await p.evaluate(() => window.__proto.game.pause());
  await p.locator(".choice-govern").first().waitFor({ timeout: 20000 });
}
const screenOf = (p, cx, cy) => p.evaluate(([x, y]) => window.__proto.game.cellToScreen(x, y), [cx, cy]);

try {
  if (on(1)) {
    { const { ctx, page: p } = await field(); await selectArmy(p); await shot(p, "1-army-now"); await zoom(p); await shot(p, "1-army-A"); await zoom(p, 1.25); await shot(p, "1-army-B125"); await ctx.close(); }
    { const { ctx, page: p } = await field(); await groupScreen(p); await shot(p, "1-group-now"); await zoom(p); await shot(p, "1-group-A"); await ctx.close(); }
    {
      const { ctx, page: p } = await field();
      await p.getByRole("button", { name: /選單/ }).first().click();
      await p.getByRole("button", { name: /^設定/ }).first().click();
      await p.waitForTimeout(400);
      await shot(p, "1-settings-now");
      await zoom(p, 1.25);
      await p.evaluate(() => window.R26.settingsScale("125%"));
      await shot(p, "1-settings-B");
      await ctx.close();
    }
    { const { ctx, page: p } = await startScreen(browser, SIZES.big); await p.addScriptTag({ path: JS }); await zoom(p); await shot(p, "1-start-A"); await ctx.close(); }
    { const { ctx, page: p } = await field(); await zoom(p); await p.getByRole("button", { name: /選單/ }).first().click(); await shot(p, "1-menu-A"); await ctx.close(); }
    { const { ctx, page: p, me } = await field(); await townChoice(p, me); await zoom(p); await shot(p, "1-town-A"); await ctx.close(); }
    { const { ctx, page: p } = await field(); await selectVillager(p); await click(p, "#hud .cmds button", "建造"); await zoom(p); await shot(p, "1-build-A"); await ctx.close(); }
    { const { ctx, page: p } = await field(); await p.evaluate(([l]) => window.__proto.game.endGame(l.winner, l.reason, l.timeline), [LOST]); await p.waitForTimeout(1000); await zoom(p); await shot(p, "1-stats-A"); await ctx.close(); }
    { const { ctx, page: p } = await field(SIZES.small); await selectArmy(p); await zoom(p); await shot(p, "1-army-1366-A"); await ctx.close(); }
    {
      // 新手教學: the real game.
      const { ctx, page: p } = await startScreen(browser, SIZES.big, "");
      await p.getByRole("button", { name: /新手教學/ }).first().click();
      await p.waitForFunction(() => window.__proto?.ready === true, null, { timeout: 120000 }).catch(() => {});
      await p.waitForTimeout(4000);
      await p.addScriptTag({ path: JS });
      await zoom(p);
      await shot(p, "1-tut-A");
      await ctx.close();
    }
  }
  if (on(2)) {
    for (const s of ["A", "B"]) {
      { const { ctx, page: p } = await field(); await selectArmy(p); await zoom(p); await p.evaluate((x) => window.R26.keys(x), s); await shot(p, `2-army-${s}`); await click(p, "#hud .cmds button", "更多"); await p.evaluate((x) => window.R26.keys(x), s); await shot(p, `2-more-${s}`); await ctx.close(); }
      { const { ctx, page: p } = await field(); await selectVillager(p); await click(p, "#hud .cmds button", "建造"); await zoom(p); await p.evaluate((x) => window.R26.keys(x, true), s); await shot(p, `2-build-${s}`); await ctx.close(); }
    }
    { const { ctx, page: p } = await field(); await selectVillager(p); await click(p, "#hud .cmds button", "建造"); await zoom(p); await shot(p, "2-build-now"); await ctx.close(); }
    { const { ctx, page: p } = await field(); await selectArmy(p); await zoom(p); await shot(p, "2-army-now"); await ctx.close(); }
  }
  if (on(3)) {
    for (const s of ["A", "B"]) {
      {
        const { ctx, page: p } = await field(); await selectArmy(p); await zoom(p);
        const at = await p.evaluate((x) => window.R26.tip(x, "#hud .cmds button", "攻擊", { title: "攻擊", key: "A", lines: ["點地面：一路走過去，遇到敵人就打。", "點敵人：集中打他。"] }), s);
        await p.evaluate(([x, y]) => window.R26.cursor("arrow", x, y), [at.x, at.y]);
        await shot(p, `3-cmd-${s}`); await ctx.close();
      }
      {
        const { ctx, page: p } = await field(); await selectVillager(p); await click(p, "#hud .cmds button", "建造"); await zoom(p);
        const at = await p.evaluate((x) => window.R26.tip(x, "#hud .cmds button", "兵營", { title: "兵營", key: "B", cost: "木 150", lines: ["練槍兵。", "設了軍團，就會自己練兵補滿。"] }), s);
        await p.evaluate(([x, y]) => window.R26.cursor("arrow", x, y), [at.x, at.y]);
        await shot(p, `3-build-${s}`); await ctx.close();
      }
    }
    { const { ctx, page: p } = await field(); await selectArmy(p); await zoom(p); const r = await p.evaluate(() => { const b = [...document.querySelectorAll("#hud .cmds button")].find((e) => e.textContent.includes("攻擊")).getBoundingClientRect(); return { x: r0(b.x + b.width * 0.55), y: r0(b.y + b.height * 0.6) }; function r0(v) { return Math.round(v); } }); await p.evaluate(([x, y]) => window.R26.cursor("arrow", x, y), [r.x, r.y]); await shot(p, "3-cmd-now"); await ctx.close(); }
  }
  if (on(4)) {
    { const { ctx, page: p } = await field(); await selectArmy(p); await zoom(p); await shot(p, "4-now"); await p.evaluate(() => window.R26.minimap()); await p.getByRole("button", { name: /繼續/ }).first().click(); await p.waitForTimeout(400); await p.evaluate(() => window.__proto.game.pause()); await shot(p, "4-new"); await ctx.close(); }
  }
  if (on(5)) {
    const cur = async (name, kind, cell, select) => {
      const { ctx, page: p } = await field();
      await p.evaluate(() => window.__proto.game.centerOn(20, 66, 1.1));
      await p.waitForTimeout(300);
      if (select === "army") await selectArmy(p);
      if (select === "villager") await selectVillager(p);
      await zoom(p);
      const s = await screenOf(p, cell[0], cell[1]);
      await p.evaluate(([k, x, y]) => window.R26.cursor(k, x, y), [kind, s.x, s.y]);
      marks[name] = { x: Math.round(s.x), y: Math.round(s.y) };
      await shot(p, name);
      await ctx.close();
    };
    const foe = await (async () => { const { ctx, page: p } = await field(); const f = await p.evaluate(() => { const g = window.__proto.game; const u = g.units().find((v) => v.owner === 1 && v.type === 1); return [u.fx ?? u.cx, u.fy ?? u.cy]; }); await ctx.close(); return f; })();
    await cur("5-ground", "arrow", [22, 72], "army");
    await cur("5-enemy", "attack", [foe[0], foe[1] - 0.3], "army");
    await cur("5-town", "enter", [18, 62], "army");
    await cur("5-tree", "gather", [8.5, 64.5], "villager");
    await cur("5-now", "arrow", [foe[0], foe[1] - 0.3], "army");
  }
  if (on(6)) {
    const box = async (p) => p.evaluate(() => { const g = window.__proto.game; const ps = g.units().filter((u) => u.owner === g.me() && [1, 2, 3].includes(u.type)).map((u) => g.cellToScreen(u.fx ?? u.cx, u.fy ?? u.cy)); const xs = ps.map((q) => q.x); const ys = ps.map((q) => q.y); return [Math.min(...xs) - 30, Math.min(...ys) - 50, Math.max(...xs) + 30, Math.max(...ys) + 20]; });
    for (const s of ["now", "A", "B"]) {
      const { ctx, page: p } = await field();
      await p.evaluate(() => window.__proto.game.centerOn(20.5, 68.5, 1.1));
      await p.waitForTimeout(300);
      await zoom(p);
      const b = await box(p);
      await p.evaluate(([x0, y0, x1, y1]) => window.R26.marquee(x0, y0, x1, y1), b);
      await p.evaluate(([x, y]) => window.R26.cursor("arrow", x, y), [b[2], b[3]]);
      marks[`6-${s}`] = { x0: Math.round(b[0]), y0: Math.round(b[1]), x1: Math.round(b[2]), y1: Math.round(b[3]) };
      await shot(p, `6-${s}`);
      await ctx.close();
    }
  }
  if (on(7)) {
    { const { ctx, page: p } = await field(); await p.evaluate(([l]) => window.__proto.game.endGame(l.winner, l.reason, l.timeline), [LOST]); await p.waitForTimeout(1000); await shot(p, "7-now"); await zoom(p); await p.evaluate(() => window.R26.stats()); await shot(p, "7-new"); await ctx.close(); }
  }
} finally {
  await browser.close();
  const f = `${OUT}/checks.json`;
  let old = {};
  try { old = JSON.parse(readFileSync(f, "utf8")); } catch { /* none yet */ }
  writeFileSync(f, JSON.stringify({ ...old, ...report, marks: { ...(old.marks ?? {}), ...marks } }, null, 1));
}
