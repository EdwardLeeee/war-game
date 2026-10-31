// R10: the start screen with the saved map, on R6's approved mock (design/r6/mock/ui.html, the R6-10 card; the real
// client's card is still the prototype's until the formal UI is on). One raw PNG and one measurement JSON a job.
//   node design/r10/common/shoot.mjs THUMB.png RAW_DIR
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(HERE, "../../../client/package.json"));
const { chromium } = require("@playwright/test");
const [thumb, raw] = process.argv.slice(2);
const url = pathToFileURL(join(HERE, "../../r6/mock/ui.html")).href;
const thumbUrl = `data:image/png;base64,${readFileSync(thumb).toString("base64")}`;
const NOTE = "隨機地圖裡挑出來的一張，有好幾個關口";
const LAND = { w: 814, h: 380 }, PORT = { w: 380, h: 814 };   // R6's frames (INV-17 is 380 x 814)

// [job, frame, state, name of the new map (null: as it is today), thumbnail]
const JOBS = [
  ["01-0-land", LAND, "INV-01", null, false], ["01-0-port", PORT, "INV-17", null, false],
  ["01-A-land", LAND, "INV-01", "關口", false], ["01-A-port", PORT, "INV-01", "關口", false],
  ["01-B-land", LAND, "INV-01", "雙河關", false], ["01-B-port", PORT, "INV-01", "雙河關", false],
  ["01-C-land", LAND, "INV-01", "雙橋", false], ["01-C-port", PORT, "INV-01", "雙橋", false],
  ["02-B-land", LAND, "INV-01", "雙河關", true], ["02-B-port", PORT, "INV-01", "雙河關", true],
];

const CSS = `
.start .opts .row.map3 { gap: 5px; }
.start .opts .row.map3 .b { min-width: 0; flex: 1 1 0; padding-left: 4px; padding-right: 4px; white-space: nowrap; }
.start .mapthumb { display: flex; justify-content: center; margin: 4px 0 0; }
.start .mapthumb img { width: 92px; height: 92px; border: 1px solid rgba(232,190,110,.6); border-radius: 4px; image-rendering: auto; }
.upright .start { width: 356px !important; }
.upright .start .cols { grid-template-columns: 1fr; row-gap: 8px; }
.upright .start .rcol .note { text-align: center; }
.upright .start .desc { margin-left: 0; text-align: center; }
.upright .start .opts { grid-template-columns: 46px 1fr; }
.upright .start .opts .row:not(.map3) .b { flex: 1 1 0; min-width: 0; }
.upright .start .opts .aside { display: none; }
#screen.upright { background-size: auto 100%; background-repeat: no-repeat; background-position: center; }
`;

const browser = await chromium.launch();
for (const [job, f, state, name, withThumb] of JOBS) {
  const ctx = await browser.newContext({ viewport: { width: f.w, height: f.h }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    locale: "zh-TW", colorScheme: "light", reducedMotion: "reduce" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${url}?theme=a&state=${state}`);
  await page.waitForFunction(() => document.getElementById("screen")?.childElementCount > 0);
  await page.evaluate(() => document.fonts.ready);
  const m = await page.evaluate(({ f, name, withThumb, thumbUrl, CSS, NOTE, upright }) => {
    const screen = document.getElementById("screen");
    if (name !== null || upright) {
      const st = document.createElement("style"); st.textContent = CSS; document.head.append(st);
    }
    if (name !== null) {
      if (upright) { screen.classList.add("upright"); screen.style.width = `${f.w}px`; screen.style.height = `${f.h}px`; }   // R6's portrait frame
      const k = [...document.querySelectorAll(".start .opts .k")].find((e) => e.textContent === "地圖");
      const row = k.nextElementSibling;
      row.classList.add("map3");
      const buttons = [...row.children];
      const add = buttons[0].cloneNode(true);                  // the same button; the new map chosen
      buttons[1].after(add);
      const lb = (b) => b.querySelector(".lb") ?? b;
      lb(add).textContent = name;
      const on = buttons.find((b) => b.classList.contains("pri"));
      const off = buttons.find((b) => b !== on);
      add.className = on.className;
      for (const b of buttons) b.className = off.className;
      document.querySelector(".start .desc").textContent = NOTE;
      if (withThumb) {
        const t = document.createElement("div");
        t.className = "mapthumb";
        t.innerHTML = `<img alt="" src="${thumbUrl}">`;
        document.querySelector(".start .rcol").append(t);
      }
    }
    const box = (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, r: r.right, b: r.bottom }; };
    const card = document.querySelector(".start");
    if (!card) return { card: null };
    const k = [...document.querySelectorAll(".start .opts .k")].find((e) => e.textContent === "地圖");
    const row = k.nextElementSibling;
    const col = document.querySelector(".start .lcol");
    const desc = document.querySelector(".start .desc");
    const buttons = [...row.children].map((b) => ({ t: b.textContent.trim(), w: Math.round(b.getBoundingClientRect().width), h: Math.round(b.getBoundingClientRect().height),
      clipped: b.scrollWidth > b.clientWidth }));
    const lh = parseFloat(getComputedStyle(desc).lineHeight) || 16;
    return { card: box(card), rowRight: box(row).r, colRight: box(col).r, buttons, descLines: Math.round(desc.getBoundingClientRect().height / lh),
      screen: { w: f.w, h: f.h } };
  }, { f, name, withThumb, thumbUrl, CSS, NOTE, upright: f.w < f.h });
  await page.waitForTimeout(200);
  await page.screenshot({ path: join(raw, `${job}.png`) });
  if (errors.length) console.log("ERRORS", job, errors.join(" | "));
  writeFileSync(join(raw, `${job}.json`), JSON.stringify(m, null, 1));
  console.log(job, m.card ? `card ${Math.round(m.card.w)}x${Math.round(m.card.h)} bottom ${Math.round(m.card.b)}/${f.h} row→${Math.round(m.rowRight)} col→${Math.round(m.colRight)} note ${m.descLines} 行 ${m.buttons.map((b) => `${b.t} ${b.w}x${b.h}${b.clipped ? " 截字" : ""}`).join("、")}` : "（沒有卡片）");
  await ctx.close();
}
await browser.close();
