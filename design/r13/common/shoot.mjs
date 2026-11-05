// R13: every state of r13.html (r13-states.js, r13-stats.js) at 814 x 380 pt, 3 px a pt, one raw PNG and one measurement JSON a job.
//   node design/r13/common/shoot.mjs [RAW_DIR] [state-prefix ...]       (default RAW_DIR design/r13/build/raw; all states)
// Measured: buttons under 44 pt, text cut off (scrollWidth > clientWidth), text outside the 814 x 380 screen, the smallest type,
// how many rows the command area has, where the panels are and whether two of them overlap.
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(HERE, "../../../client/package.json"));
const { chromium } = require("@playwright/test");
const args = process.argv.slice(2);
const raw = args[0] && !args[0].startsWith("R13") ? args.shift() : join(HERE, "../build/raw");
const only = args;
mkdirSync(raw, { recursive: true });
const url = pathToFileURL(join(HERE, "r13.html")).href;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 814, height: 380 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  locale: "zh-TW", colorScheme: "light", reducedMotion: "reduce" });
const first = await ctx.newPage();
await first.goto(`${url}?theme=a&state=base`);
await first.waitForFunction(() => document.getElementById("screen")?.childElementCount > 0);
const ids = (await first.evaluate(() => Object.keys(window.R6_STATES).filter((k) => k.startsWith("R13-")))).filter((k) => !only.length || only.some((p) => k.startsWith(p)));
// B's whole page (1459 pt tall): Chromium cannot capture it at 3 px a pt, so 2
const tall = await first.evaluate(() => Object.keys(window.R6_STATES).filter((k) => window.R6_STATES[k].stats?.tall));
const ctxTall = await browser.newContext({ viewport: { width: 814, height: 380 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  locale: "zh-TW", colorScheme: "light", reducedMotion: "reduce" });
await first.close();
let bad = 0;
// a page a job (Chromium's page crashed now and then on a reused page); a crash is tried again once
for (const id of ids) {
  for (let k = 0; ; k++) {
    const page = await (tall.includes(id) ? ctxTall : ctx).newPage();
    try { bad += await shoot(page, id); await page.close(); break; } catch (e) { await page.close().catch(() => {}); if (k === 1) throw e; console.log(id, "again:", String(e).split("\n")[0]); }
  }
}
await browser.close();
console.log(ids.length, "shots in", raw, bad ? `(${bad} with something to look at)` : "");

async function shoot(page, id) {
  const errors = [];
  const onErr = (e) => errors.push(String(e));
  page.on("pageerror", onErr);
  await page.goto(`${url}?theme=a&state=${id}`);
  await page.waitForFunction(() => document.getElementById("screen")?.childElementCount > 0);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => window.R13_AFTER?.());          // r13-stats.js: scroll positions and the like
  const size = await page.evaluate(() => window.R13_SIZE ?? null);   // B's whole page: the viewport as tall as the page
  await page.setViewportSize(size ?? { width: 814, height: 380 });
  await page.waitForTimeout(120);
  const m = await page.evaluate(() => {
    const screen = document.getElementById("screen");
    const vis = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none"; };
    const H = window.innerHeight;
    const inView = (r) => r.bottom > 0 && r.right > 0 && r.top < H && r.left < 814;
    const box = (e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
    // clipped by a scrolling container (the B page): only what shows on the screen counts
    const away = (e) => {
      const r = e.getBoundingClientRect();
      for (let p = e.parentElement; p && p !== screen; p = p.parentElement) {
        const cs = getComputedStyle(p);
        if (/(auto|scroll|hidden)/.test(cs.overflowY)) { const q = p.getBoundingClientRect(); if (r.bottom <= q.top + 1 || r.top >= q.bottom - 1) return true; }
      }
      return false;
    };
    const shown = (e) => !away(e) && inView(e.getBoundingClientRect());
    // partly under the edge of a panel that scrolls (the group's panel): cut on purpose, counted apart
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
    const clipped = [...screen.querySelectorAll(".lb, .sub, .line, .t, .pt span, .r13tag, .r13name, .r13tab > span, .tab, .sv, .tile *, .ev, .mt")]
      .filter((e) => vis(e) && shown(e) && e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow !== "visible").map((e) => e.textContent.trim().slice(0, 16));
    // the smallest type on the screen (text nodes that show), and what uses it
    const sizes = {};
    const walker = document.createTreeWalker(screen, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent.trim()) continue;
      const e = n.parentElement;
      if (!vis(e) || !shown(e)) continue;
      const cs = getComputedStyle(e);
      if (parseFloat(cs.opacity) === 0) continue;
      const fs = parseFloat(cs.fontSize) * (e.closest("svg") ? (e.closest("svg").getBoundingClientRect().width / (e.closest("svg").viewBox?.baseVal?.width || e.closest("svg").getBoundingClientRect().width)) : 1);
      const k = Math.round(fs * 2) / 2;
      (sizes[k] ||= []).push(n.textContent.trim().slice(0, 10));
    }
    const fonts = Object.keys(sizes).map(Number).sort((a, b) => a - b);
    const out = [...screen.querySelectorAll(".panel, .b, .r13tag, .r13name, .toast")].filter((e) => vis(e) && !away(e) && !cut(e)).filter((e) => {
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
    const extra = window.R13_MEASURE?.() ?? null;
    return { buttons: buttons.length, small, clipped, fonts, minFont: fonts[0] ?? null, minFontWho: sizes[fonts[0]]?.slice(0, 4) ?? [], out, cmdsRows: rows, panels, overlaps, tagHits, extra,
      overlay: !!document.querySelector("vite-error-overlay") };
  });
  page.off("pageerror", onErr);
  for (let k = 0; ; k++) {                                  // Chromium now and then fails a capture: try again
    try { await page.screenshot({ path: join(raw, `${id}.png`), timeout: 20000 }); break; } catch (e) { if (k === 2) throw e; await page.waitForTimeout(500); }
  }
  writeFileSync(join(raw, `${id}.json`), JSON.stringify({ ...m, errors }, null, 1));
  const flag = errors.length || m.overlay || m.small.length || m.clipped.length || m.out.length;
  console.log(id, `字最小 ${m.minFont}`, `指令區 ${m.cmdsRows} 排`, m.small.length ? `小於44: ${m.small.map((s) => `${s.t} ${s.w}x${s.h}`).join("、")}` : "",
    m.clipped.length ? `截字: ${m.clipped.join("、")}` : "", m.out.length ? `出界: ${m.out.join("、")}` : "", m.overlaps.length ? `疊: ${m.overlaps.join(" ")}` : "",
    m.tagHits.length ? `標籤疊: ${m.tagHits.join(" ")}` : "", errors.length ? `ERRORS ${errors.join(" | ")}` : "");
  return flag ? 1 : 0;
}
