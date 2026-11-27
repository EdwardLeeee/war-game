// R27-02 放哨所的介面: the real page's interface alone (the battlefield hidden, a see-through ground), the fake world's
// HUD in each state, with what R27 adds drawn in: 「旋轉」 by ✓ ✗ while placing, the facing's tag over the preview,
// 「轉向」 in the outpost's panel, the strip's 「已轉向」. boards_r27.py lays it over the twin-rivers battlefield with the
// outpost composed in (compose.py). The preview's place on the screen is the same as there: the camera put so that the
// placed footprint's middle is where the scene's is.
//   node design/r27/common/ui.mjs OUT
import { writeFileSync } from "node:fs";
import { chromium, DESKTOP, fakeWorld, PHONE_APP, PHONE_SAFARI } from "./lib.mjs";

const OUT = process.argv[2];
const SITE = [24, 72];                        // a free spot in the fake world (2 x 2 outposts there: r7)
const DEVICES = [
  ["app", PHONE_APP, true, 1.6],
  ["safari", PHONE_SAFARI, true, 1.6],
  ["desk", DESKTOP, false, 2.0],
];
const browser = await chromium.launch();
const meta = {};

const ICON_TURN = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v5h-5"/></svg>';

async function onlyHud(page, path) {
  await page.evaluate(() => {
    document.getElementById("stage").style.visibility = "hidden";
    for (const e of [document.documentElement, document.body]) e.style.background = "transparent";
    for (const e of document.querySelectorAll("#hud .paused-banner, .prompt-warn")) e.style.display = "none";
  });
  await page.waitForTimeout(250);
  await page.screenshot({ path, omitBackground: true });
}

/** R27's additions, drawn in the interface's own look (the page's classes). */
async function add(page, what, opts) {
  await page.evaluate(([w, o, icon]) => {
    const style = document.getElementById("r27-style") ?? Object.assign(document.createElement("style"), { id: "r27-style" });
    style.textContent = `
      .r27-tag { position: absolute; transform: translate(-50%, -100%); padding: 3px 10px 4px; border-radius: 12px; white-space: nowrap;
        font: 700 13px/18px "PingFang TC","Noto Sans CJK TC",sans-serif; color: #2a1a08; background: #f2c862;
        box-shadow: 0 0 0 1.5px rgba(40,26,10,0.85), 0 2px 5px rgba(0,0,0,0.45); pointer-events: none; z-index: 30; }
      .r27-tag.manual { background: #f3ead8; }
      .r27-tag small { font-weight: 400; margin-left: 4px; }
      .place-confirm .r27-turn { display: inline-flex !important; flex-direction: column !important; align-items: center; justify-content: center;
        gap: 1px !important; padding: 0 !important; font-size: 12px !important; font-weight: 700; line-height: 1.1 !important; }
      .place-confirm .r27-turn span { font-size: 12px !important; }
      .place-confirm .r27-turn .ic { width: 20px; height: 20px; }
      .ic { fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }`;
    document.head.appendChild(style);
    const hud = document.getElementById("hud");
    if (w.tag) {
      const t = document.createElement("div");
      t.className = `r27-tag${w.tag.manual ? " manual" : ""}`;
      t.innerHTML = w.tag.text;
      Object.assign(t.style, { left: `${o.tagAt[0]}px`, top: `${o.tagAt[1]}px` });
      hud.appendChild(t);
    }
    if (w.rotate) {
      const box = document.querySelector(".place-confirm");
      const ok = box.querySelector(".place-ok");
      const b = document.createElement("button");
      b.type = "button";
      b.className = "b r27-turn";
      b.setAttribute("aria-label", "旋轉");
      b.innerHTML = `${icon}<span>旋轉</span>`;
      const r = ok.getBoundingClientRect();
      Object.assign(b.style, { width: `${r.width}px`, height: `${r.height}px`, minWidth: "0" });
      box.insertBefore(b, ok);
      if (w.key) {
        const k = document.createElement("span");
        k.className = "hk";
        k.textContent = "R";
        b.style.position = "relative";
        b.appendChild(k);
      }
    }
    if (w.panelTurn) {
      const chips = [...document.querySelectorAll("#hud .sel-info button.chip")];
      const last = chips[chips.length - 1];
      const b = document.createElement("button");
      b.type = "button";
      b.className = "b chip secondary r27-panel-turn";
      b.innerHTML = `${icon}<span class="label">轉向</span>`;
      last.after(b);
      if (w.key) {
        const k = document.createElement("span");
        k.className = "hk";
        k.textContent = "R";
        b.style.position = "relative";
        b.appendChild(k);
      }
    }
    if (w.toast) {
      const box = document.querySelector(".toast");
      box.classList.add("toast-ok");
      box.querySelector(".toast-text").textContent = w.toast;
      box.hidden = false;
    }
  }, [what, opts, ICON_TURN]);
  await page.waitForTimeout(150);
}

try {
  for (const [dev, size, phone, zoom] of DEVICES) {
    const d = (meta[dev] = { size, zoom });
    // placing: the preview's middle where the camera centres; ✓ ✗ under it
    console.log(dev, "placing");
    {
      const { ctx, page } = await fakeWorld(browser, size, phone, "&r7=1&outpost=1");
      await page.evaluate(([x, y, z]) => window.__proto.game.centerOn(x, y, z), [SITE[0] + 1, SITE[1] + 1, zoom]);
      await page.waitForTimeout(500);
      await page.evaluate(() => window.__proto.game.startPlacement(12));
      await page.waitForTimeout(400);
      const c = await page.evaluate(([x, y]) => window.__proto.game.cellToScreen(x, y), [SITE[0] + 1, SITE[1] + 1]);
      for (let i = 0; i < 2; i++) {
        const ph = await page.evaluate(() => window.__proto.game.placement()?.phase);
        if (ph === "confirm") break;
        if (phone) await page.touchscreen.tap(c.x, c.y); else await page.mouse.click(c.x, c.y);
        await page.waitForTimeout(500);
      }
      d.place = await page.evaluate(() => window.__proto.game.placement());
      console.log(dev, "placement", JSON.stringify(d.place));
      d.centre = await page.evaluate(([x, y]) => window.__proto.game.cellToScreen(x, y), [SITE[0] + 1, SITE[1] + 1]);
      d.confirm = await page.evaluate(() => { const r = document.querySelector(".place-confirm")?.getBoundingClientRect(); return r ? [r.x, r.y, r.width, r.height] : null; });
      // under the preview's footprint, clear of the prompt (top) and of ✓ ✗ (right of the preview)
      const tagAt = [d.centre.x, d.centre.y + (dev === "desk" ? 118 : 88)];
      await add(page, { tag: { text: "自動<small>擋住橋頭</small>" }, rotate: true, key: !phone }, { tagAt });
      d.new = await page.evaluate(() => [".r27-turn", ".r27-tag"].map((q) => { const r = document.querySelector(q)?.getBoundingClientRect(); return r ? [r.x, r.y, r.width, r.height] : null; }));
      await onlyHud(page, `${OUT}/hud-${dev}-place-auto.png`);
      await page.evaluate(() => { const t = document.querySelector(".r27-tag"); t.classList.add("manual"); t.innerHTML = "轉過<small>按「旋轉」轉回去</small>"; });
      await onlyHud(page, `${OUT}/hud-${dev}-place-turned.png`);
      await ctx.close();
    }
    // nothing selected; then our outpost selected (its panel), 「轉向」 in it; then pressed
    {
      const { ctx, page } = await fakeWorld(browser, size, phone, "&r7=1&outpost=1");
      await page.evaluate(([z]) => window.__proto.game.centerOn(14, 68, z), [zoom]);
      await page.waitForTimeout(500);
      await onlyHud(page, `${OUT}/hud-${dev}-plain.png`);
      await page.evaluate(() => { document.getElementById("stage").style.visibility = "visible"; });
      const q = await page.evaluate(() => window.__proto.game.cellToScreen(13, 67));
      if (phone) await page.touchscreen.tap(q.x, q.y); else await page.mouse.click(q.x, q.y);
      await page.waitForTimeout(600);
      d.selected = await page.evaluate(() => window.__proto.game.selection());
      d.panel = await page.evaluate(() => { const r = document.querySelector("#hud .sel-info")?.getBoundingClientRect(); return r ? [r.x, r.y, r.width, r.height] : null; });
      await add(page, { panelTurn: true, key: !phone }, {});
      await onlyHud(page, `${OUT}/hud-${dev}-panel.png`);
      await add(page, { toast: "已轉向" }, {});
      await onlyHud(page, `${OUT}/hud-${dev}-panel-turned.png`);
      d.turnBtn = await page.evaluate(() => { const r = document.querySelector(".r27-panel-turn")?.getBoundingClientRect(); return r ? [r.x, r.y, r.width, r.height] : null; });
      await ctx.close();
    }
    console.log(dev, JSON.stringify(d));
  }
} finally {
  await browser.close();
  writeFileSync(`${OUT}/hud.json`, JSON.stringify(meta, null, 1));
}
