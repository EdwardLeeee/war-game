// R14: every state of r14.html (r14-states.js, r14-stats.js) at 814 x 380 pt, 3 px a pt, one raw PNG and one measurement JSON a job.
//   node design/r14/common/shoot.mjs [RAW_DIR] [state-prefix ...]       (default RAW_DIR design/r14/build/raw; all R14 states)
// Measured (design/r13/common/shoot.mjs, plus R6's type rule): buttons under 44 pt, text cut off (scrollWidth > clientWidth), text
// outside the 814 x 380 screen, panels over each other, and the type: R6's own small pieces may be 10 pt (a button's second line)
// or 11 pt (the help list, 目前：, the 地圖 button, count badges), everything else at least 12 pt (R13 and R14's rule for new text).
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(HERE, "../../../client/package.json"));
const { chromium } = require("@playwright/test");
const args = process.argv.slice(2);
const raw = args[0] && !args[0].startsWith("R14") ? args.shift() : join(HERE, "../build/raw");
const only = args;
mkdirSync(raw, { recursive: true });
const url = pathToFileURL(join(HERE, "r14.html")).href;
const opts = { viewport: { width: 814, height: 380 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: "zh-TW", colorScheme: "light", reducedMotion: "reduce" };

const browser = await chromium.launch();
let bad = 0, ids = [];
try {
  const ctx = await browser.newContext(opts);
  const first = await ctx.newPage();
  const broken = [];
  first.on("pageerror", (e) => broken.push(String(e)));
  await first.goto(`${url}?theme=a&state=base`);
  await first.waitForFunction(() => document.getElementById("screen")?.childElementCount > 0);
  ids = (await first.evaluate(() => Object.keys(window.R6_STATES).filter((k) => k.startsWith("R14-")))).filter((k) => !only.length || only.some((p) => k.startsWith(p)));
  await first.close();
  // a script that throws leaves states out: stop rather than shoot fewer
  if (broken.length || !ids.length) throw new Error(`r14.html: ${broken.join(" | ") || "no R14 states"}`);
  // a page a job; a crash is tried again once
  for (const id of ids) {
    for (let k = 0; ; k++) {
      const page = await ctx.newPage();
      try { bad += await shoot(page, id); await page.close(); break; } catch (e) { await page.close().catch(() => {}); if (k === 1) throw e; console.log(id, "again:", String(e).split("\n")[0]); }
    }
  }
} finally {
  await browser.close();
}
console.log(ids.length, "shots in", raw, bad ? `(${bad} with something to look at)` : "");

async function shoot(page, id) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${url}?theme=a&state=${id}`);
  await page.waitForFunction(() => document.getElementById("screen")?.childElementCount > 0);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => window.R14_AFTER?.());
  await page.waitForTimeout(120);
  const m = await page.evaluate(() => {
    const screen = document.getElementById("screen");
    const vis = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none"; };
    const H = window.innerHeight;
    const inView = (r) => r.bottom > 0 && r.right > 0 && r.top < H && r.left < 814;
    const box = (e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
    const away = (e) => {
      const r = e.getBoundingClientRect();
      for (let p = e.parentElement; p && p !== screen; p = p.parentElement) {
        const cs = getComputedStyle(p);
        if (/(auto|scroll|hidden)/.test(cs.overflowY)) { const q = p.getBoundingClientRect(); if (r.bottom <= q.top + 1 || r.top >= q.bottom - 1) return true; }
      }
      return false;
    };
    const shown = (e) => !away(e) && inView(e.getBoundingClientRect());
    const cut = (e) => {
      const r = e.getBoundingClientRect();
      for (let p = e.parentElement; p && p !== screen; p = p.parentElement) {
        if (/(auto|scroll|hidden)/.test(getComputedStyle(p).overflowY)) { const q = p.getBoundingClientRect(); if (r.bottom > q.bottom + 1 || r.top < q.top - 1) return true; }
      }
      return false;
    };
    const buttons = [...screen.querySelectorAll(".b, button, .tab")].filter((b) => vis(b) && shown(b));
    const small = buttons.filter((b) => { const r = b.getBoundingClientRect(); return r.width < 43.5 || r.height < 43.5; })
      .map((b) => ({ t: b.textContent.trim().slice(0, 14), ...box(b) }));
    const inButton = buttons.flatMap((b) => {
      const q = b.getBoundingClientRect();
      return [...b.querySelectorAll(".lb, .sub")].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.left < q.left - 0.5 || r.right > q.right + 0.5 || r.bottom > q.bottom + 0.5); })
        .map((e) => "按鈕外:" + e.textContent.trim().slice(0, 12));
    });
    const clipped = [...screen.querySelectorAll(".lb, .sub, .line, .t, .pt span, .r13tag, .r13name, .r13chip, .tab, .sv, .tile *, .ev, .mt, .mw, .townlabel, .st, .chips .now, .help li, .num")]
      .filter((e) => vis(e) && shown(e) && e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow !== "visible").map((e) => e.textContent.trim().slice(0, 16)).concat(inButton);
    // the type: every text node that shows; R6's own small pieces apart
    const R6_SMALL = ".sub, .help, .chips .now, .maptab, .cnt, .badge, .gtag, .queue .b, .callout, .idlebox, .gp2 .t small";
    const sizes = {}, under = [];
    const walker = document.createTreeWalker(screen, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent.trim()) continue;
      const e = n.parentElement;
      if (!vis(e) || !shown(e)) continue;
      const cs = getComputedStyle(e);
      if (parseFloat(cs.opacity) === 0) continue;
      const svg = e.closest("svg");
      const fs = parseFloat(cs.fontSize) * (svg ? (svg.getBoundingClientRect().width / (svg.viewBox?.baseVal?.width || svg.getBoundingClientRect().width)) : 1);
      const k = Math.round(fs * 2) / 2;
      (sizes[k] ||= []).push(n.textContent.trim().slice(0, 10));
      const r6 = !!e.closest(R6_SMALL);
      if (k < (r6 ? 10 : 12)) under.push(`${n.textContent.trim().slice(0, 10)} ${k}`);
    }
    const fonts = Object.keys(sizes).map(Number).sort((a, b) => a - b);
    let newMin = null;
    {
      const w2 = document.createTreeWalker(screen, NodeFilter.SHOW_TEXT);
      for (let n = w2.nextNode(); n; n = w2.nextNode()) {
        const e = n.parentElement;
        if (!n.textContent.trim() || !vis(e) || !shown(e) || e.closest(R6_SMALL)) continue;
        const svg = e.closest("svg");
        const fs = parseFloat(getComputedStyle(e).fontSize) * (svg ? (svg.getBoundingClientRect().width / (svg.viewBox?.baseVal?.width || svg.getBoundingClientRect().width)) : 1);
        newMin = newMin === null ? fs : Math.min(newMin, fs);
      }
    }
    const out = [...screen.querySelectorAll(".panel, .b, .r13tag, .r13name, .toast, .townlabel")].filter((e) => vis(e) && !away(e) && !cut(e)).filter((e) => {
      const r = e.getBoundingClientRect(); return r.left < -0.5 || r.top < -0.5 || r.right > 814.5 || r.bottom > H + 0.5;
    }).map((e) => e.className.split(" ")[0] + ":" + e.textContent.trim().slice(0, 10));
    const cmds = screen.querySelector(".cmds");
    const rows = cmds ? new Set([...cmds.querySelectorAll(".b")].map((b) => Math.round(b.getBoundingClientRect().top))).size : 0;
    const panels = {};
    for (const [k, q] of [["sel", ".sel"], ["cmds", ".cmds"], ["prompt", ".prompt"], ["toast", ".toast"], ["groups", ".groups"], ["retreat", ".retreat-all"], ["res", ".res"], ["top", ".topright"], ["idle", ".idlebox"], ["map", ".maptab"]]) {
      const e = screen.querySelector(q);
      if (e && vis(e)) panels[k] = box(e);
    }
    const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    const keys = Object.keys(panels), overlaps = [];
    for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) if (hit(panels[keys[i]], panels[keys[j]])) overlaps.push(`${keys[i]}×${keys[j]}`);
    const tags = [...screen.querySelectorAll(".r13tag, .r13chip, .r13arrow")].map(box);
    const tagHits = [];
    for (let i = 0; i < tags.length; i++) for (let j = i + 1; j < tags.length; j++) if (hit(tags[i], tags[j])) tagHits.push(`${i}×${j}`);
    const props = screen.querySelectorAll(".prop, .cmds:has(.b:nth-child(13))").length;
    return { buttons: buttons.length, small, clipped, fonts, minFont: fonts[0] ?? null, minFontWho: sizes[fonts[0]]?.slice(0, 4) ?? [], newMin: newMin === null ? null : Math.round(newMin * 2) / 2,
      under, out, cmdsRows: rows, panels, overlaps, tagHits, props, overlay: !!document.querySelector("vite-error-overlay") };
  });
  for (let k = 0; ; k++) {
    try { await page.screenshot({ path: join(raw, `${id}.png`), timeout: 20000 }); break; } catch (e) { if (k === 2) throw e; await page.waitForTimeout(500); }
  }
  writeFileSync(join(raw, `${id}.json`), JSON.stringify({ ...m, errors }, null, 1));
  const flag = errors.length || m.overlay || m.small.length || m.clipped.length || m.out.length || m.under.length;
  console.log(id, `字最小 ${m.minFont}（新字 ${m.newMin}）`, `選取資訊 ${m.panels.sel ? m.panels.sel.h : "-"} pt`, m.small.length ? `小於44: ${m.small.map((s) => `${s.t} ${s.w}x${s.h}`).join("、")}` : "",
    m.clipped.length ? `截字: ${m.clipped.join("、")}` : "", m.out.length ? `出界: ${m.out.join("、")}` : "", m.under.length ? `字太小: ${m.under.join("、")}` : "",
    m.overlaps.length ? `疊: ${m.overlaps.join(" ")}` : "", m.tagHits.length ? `標籤疊: ${m.tagHits.join(" ")}` : "", errors.length ? `ERRORS ${errors.join(" | ")}` : "");
  return flag ? 1 : 0;
}
