// R26 電腦版: the proposed changes drawn on the real page (正式介面 A 銅木) in a desktop browser. Loaded by
// r26.mjs; it only restyles and adds to what the page shows (the client's code is not changed).
(() => {
  const GOLD = "#f2c862";
  const css = (id, text) => {
    let s = document.getElementById(id);
    if (s === null) {
      s = document.createElement("style");
      s.id = id;
      document.head.appendChild(s);
    }
    s.textContent = text;
  };

  // 1. The interface (#hud, the start screen) zoomed, the battlefield (#stage) not; the bar and 軍團畫面
  //    no wider than 640 (before the zoom), from the left, apart from the commands.
  function scale(s, cap = true) {
    for (const id of ["hud", "start"]) {
      const e = document.getElementById(id);
      if (e) e.style.zoom = String(s);
    }
    css("r26-cap", cap ? `
      #hud .sel-bar { right: auto !important; width: 640px !important; max-width: 640px !important; }
      #hud .sel-bar .bar-gap { flex: 1 1 0 !important; min-width: 0 !important; }
      #hud .sel-info { max-width: 640px !important; }
      #hud .sel-help { max-width: 640px !important; }
    ` : "");
  }
  /** The auto zoom: the window's height over 633 (1.5 at 950), from 1 to 1.6; under 600 high, none. */
  const auto = () => (innerHeight < 600 ? 1 : Math.min(1.6, Math.max(1, innerHeight / 633)));

  /** 1 B: 設定 with 介面大小 (自動 and 100–150%). */
  function settingsScale(chosen) {
    const card = document.querySelector("#hud .dialog .dialog-card");
    if (!card) throw new Error("no 設定");
    const row = document.createElement("div");
    row.className = "r26-scale-row";
    const opts = ["自動", "100%", "125%", "150%"];
    row.innerHTML = `<div class="r26-scale-top"><span class="r26-scale-lb">介面大小</span><span class="r26-scale-sub">只在電腦上；手機照舊</span></div><div class="r26-scale-btns">${opts.map((o) => `<button type="button" class="b ${o === chosen ? "pri" : "secondary"}">${o}</button>`).join("")}</div>`;
    const anchor = [...card.querySelectorAll("button")].find((b) => (b.textContent || "").includes("開局提示"))?.parentElement;
    card.insertBefore(row, anchor ?? null);
    css("r26-scale-css", `
      .r26-scale-row { margin: 2px 0 10px; }
      .r26-scale-top { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 4px; }
      .r26-scale-btns { display: flex; gap: 6px; }
      .r26-scale-btns .b { flex: 1; white-space: nowrap; }
      .r26-scale-lb { font-weight: 700; font-size: 14px; }
      .r26-scale-sub { font-size: 12px; opacity: 0.8; }
    `);
  }

  // 2. Keys on the buttons: a small chip at the top right corner.
  const KEYS = {
    A: { 攻擊: "A", 移動: "M", 進駐: "E", 建造: "B", 停止: "S", 堅守: "H", 隊形: "F", 整理隊形: "R" },
    B: { 攻擊: "Q", 移動: "W", 進駐: "E", 更多: "R", 隊形: "A", 堅守: "S", 整理隊形: "D", 停止: "F" },
    common: { 全軍撤退: "Bksp", 閒置: ".", 繼續: "Space", 暫停: "Space", 選單: "Esc", 全軍: "F2" },
  };
  function keys(scheme, villager = false) {
    css("r26-key-css", `
      .r26-key { position: absolute; top: 2px; right: 2px; min-width: 15px; height: 15px; padding: 0 3px; box-sizing: border-box;
        border-radius: 4px; background: rgba(18, 12, 6, 0.85); border: 1px solid rgba(242, 200, 98, 0.75); color: ${GOLD};
        font: 700 10px/13px sans-serif; text-align: center; pointer-events: none; z-index: 2; }
      .r26-key.wide { font-size: 9px; }
    `);
    for (const k of document.querySelectorAll(".r26-key")) k.remove();
    const map = { ...KEYS.common, ...KEYS[scheme] };
    if (villager && scheme === "B") Object.assign(map, { 移動: "Q", 停止: "W", 建造: "E" });
    const label = (b) => (b.querySelector(".label, .lb")?.textContent ?? b.textContent ?? "").trim();
    for (const b of document.querySelectorAll("#hud button")) {
      if (b.getBoundingClientRect().width === 0) continue;
      const t = label(b);
      const name = Object.keys(map).find((n) => t.startsWith(n));
      if (!name) continue;
      const k = document.createElement("span");
      k.className = `r26-key${map[name].length > 2 ? " wide" : ""}`;
      k.textContent = map[name];
      if (getComputedStyle(b).position === "static") b.style.position = "relative";
      b.appendChild(k);
    }
    // The build menu, A: each building its English initial (民居 House H ...).
    if (scheme === "A" && document.querySelector("#hud .cmds.build-page")) {
      const BUILD = { 民居: "H", 農田: "F", 伐木場: "L", 礦場: "M", 糧倉: "G", 兵營: "B", 射場: "R", 法術營: "W", 箭樓: "T", 馬廄: "S", 砲坊: "C" };
      for (const b of document.querySelectorAll("#hud .cmds.build-page > button")) {
        const n = Object.keys(BUILD).find((x) => label(b).startsWith(x));
        if (!n || b.getBoundingClientRect().width === 0) continue;
        b.querySelector(".r26-key")?.remove();
        const k = document.createElement("span");
        k.className = "r26-key";
        k.textContent = BUILD[n];
        b.appendChild(k);
      }
    }
    // The build menu's grid, B: QWER / ASDF / ZXCV by place.
    if (scheme === "B") {
      const grid = [..."QWERASDFZXCV"];
      const bs = [...document.querySelectorAll("#hud .cmds.build-page > button, #hud .cmds > button")].filter((b) => b.getBoundingClientRect().width > 0);
      if (document.querySelector("#hud .cmds.build-page")) {
        bs.forEach((b, i) => {
          b.querySelector(".r26-key")?.remove();
          if (i >= grid.length || label(b) === "返回") return;
          const k = document.createElement("span");
          k.className = "r26-key";
          k.textContent = grid[i];
          b.appendChild(k);
        });
      }
    }
  }

  // 3. The tooltip: A by the button (above it), B in a fixed box over the commands.
  function tip(mode, sel, text, { title, key, cost, lines }) {
    const b = [...document.querySelectorAll(sel)].find((e) => (e.textContent || "").includes(text) && e.getBoundingClientRect().width > 0);
    if (!b) throw new Error(`no ${sel} ${text}`);
    css("r26-tip-css", `
      .r26-tip { position: absolute; z-index: 45; width: 240px; box-sizing: border-box; padding: 8px 10px 9px; pointer-events: none; }
      .r26-tip .t { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 700; }
      .r26-tip .t .r26-k { margin-left: auto; padding: 0 5px; border-radius: 4px; border: 1px solid rgba(242, 200, 98, 0.75); color: ${GOLD}; font-size: 11px; line-height: 16px; }
      .r26-tip .c { font-size: 12px; color: ${GOLD}; margin-top: 2px; }
      .r26-tip p { margin: 4px 0 0; font-size: 12px; line-height: 1.45; }
      .r26-hover { outline: 2px solid rgba(255, 240, 200, 0.9); outline-offset: 1px; }
    `);
    document.querySelector(".r26-tip")?.remove();
    b.classList.add("r26-hover");
    const hud = document.getElementById("hud");
    const z = parseFloat(hud.style.zoom || "1");
    const t = document.createElement("div");
    t.className = "panel r26-tip";
    t.innerHTML = `<div class="t">${title}${key ? `<span class="r26-k">${key}</span>` : ""}</div>${cost ? `<div class="c">${cost}</div>` : ""}${lines.map((l) => `<p>${l}</p>`).join("")}`;
    hud.appendChild(t);
    const r = b.getBoundingClientRect();
    const tr = t.getBoundingClientRect();
    if (mode === "A") {
      // Above the button, its right edge on the screen's.
      const x = Math.min(r.right / z - tr.width / z, innerWidth / z - tr.width / z - 4);
      Object.assign(t.style, { left: `${Math.max(4, x)}px`, top: `${r.top / z - tr.height / z - 6}px` });
    } else {
      // B: a fixed box over the commands (where it always is).
      const c = document.querySelector("#hud .cmds").getBoundingClientRect();
      Object.assign(t.style, { left: `${c.right / z - tr.width / z}px`, top: `${c.top / z - tr.height / z - 8}px` });
    }
    return { x: r.x + r.width * 0.55, y: r.y + r.height * 0.6 };
  }

  // 4. The minimap always open on a desktop, at the bottom left; 地圖 right of it (it folds it).
  function minimap() {
    const m = document.querySelector("#hud .minimap");
    // Opened by the game's own 地圖 (so that it draws), then moved.
    if (m.classList.contains("closed")) document.querySelector("#hud .side-left .map-btn")?.click();
    css("r26-mm-css", `
      #hud .minimap.r26-mm { left: 4px !important; bottom: 4px !important; top: auto !important; transform-origin: left bottom; transform: scale(var(--r26-mm-k, 1));
        border-radius: 4px; box-shadow: 0 0 0 1px #b98d4c, 0 0 0 2px rgba(30, 18, 10, 0.9); display: block !important; }
      #hud .side-left .idle-btn.r26-mm-idle { position: fixed !important; left: 4px !important; bottom: 188px !important; top: auto !important; }
      #hud .side-left .map-btn.r26-mm-btn { position: fixed !important; left: 186px !important; bottom: 4px !important; top: auto !important; }
      #hud .sel-bar.r26-mm-bar, #hud .sel-info.r26-mm-bar { left: 252px !important; }
    `);
    m.classList.add("r26-mm");
    // Its own size kept (the game draws it so), scaled up to 176 (before the zoom).
    const w = m.offsetWidth || 112;
    m.style.setProperty("--r26-mm-k", String(176 / w));
    document.querySelector("#hud .side-left .idle-btn")?.classList.add("r26-mm-idle");
    document.querySelector("#hud .side-left .map-btn")?.classList.add("r26-mm-btn");
    for (const e of document.querySelectorAll("#hud .sel-bar, #hud .sel-info")) e.classList.add("r26-mm-bar");
  }

  // 5. The cursor: drawn where the mouse is (an arrow, a sword on an enemy, a gate on our town, an axe on a tree).
  const CURSOR = {
    arrow: '<path d="M2 2 L2 24 L8 18 L12 28 L16 26 L12 16 L20 16 Z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/>',
    attack: '<path d="M3 3 L19 19" stroke="#2a0a06" stroke-width="7" stroke-linecap="round"/><path d="M3 3 L19 19" stroke="#ff7a62" stroke-width="4" stroke-linecap="round"/><path d="M14 22 L22 14" stroke="#2a0a06" stroke-width="6" stroke-linecap="round"/><path d="M14 22 L22 14" stroke="#f2c862" stroke-width="3" stroke-linecap="round"/><path d="M20 20 L27 27" stroke="#2a0a06" stroke-width="6" stroke-linecap="round"/><path d="M20 20 L27 27" stroke="#c98a4a" stroke-width="3" stroke-linecap="round"/>',
    enter: '<path d="M4 28 V12 H26 V28" fill="#3a2410" stroke="#f2c862" stroke-width="2.4"/><path d="M4 12 V6 H8 V9 H12 V6 H18 V9 H22 V6 H26 V12" fill="none" stroke="#f2c862" stroke-width="2.4"/><path d="M15 14 V24 M10.5 20 L15 24.5 L19.5 20" stroke="#fff" stroke-width="2.6" fill="none" stroke-linecap="round"/>',
    gather: '<path d="M8 27 L22 8" stroke="#2a1806" stroke-width="6" stroke-linecap="round"/><path d="M8 27 L22 8" stroke="#c98a4a" stroke-width="3" stroke-linecap="round"/><path d="M17 5 C24 2 29 7 26 13 L20 10 Z" fill="#d8dde2" stroke="#222" stroke-width="1.6"/>',
  };
  function cursor(kind, x, y) {
    const l = document.createElement("div");
    l.className = "r26-cursor";
    Object.assign(l.style, { position: "fixed", left: `${x}px`, top: `${y}px`, zIndex: 999, pointerEvents: "none" });
    l.innerHTML = `<svg width="30" height="30" viewBox="0 0 30 30" style="overflow:visible;filter:drop-shadow(0 1px 1px rgba(0,0,0,.7))">${CURSOR[kind]}</svg>`;
    document.body.appendChild(l);
  }

  // 6. The game's own box-select frame, from (x0, y0) to (x1, y1) (screen px), with the button that draws it.
  function marquee(x0, y0, x1, y1) {
    const m = document.querySelector(".marquee");
    const z = parseFloat(document.getElementById("hud").style.zoom || "1");
    Object.assign(m.style, { left: `${x0 / z}px`, top: `${y0 / z}px`, width: `${(x1 - x0) / z}px`, height: `${(y1 - y0) / z}px` });
    m.hidden = false;
  }

  // 7. 局後統計 on a big screen: no wider than 1240 (before the zoom), in the middle; the army chart under 總覽.
  function stats() {
    const card = document.querySelector("#hud .stats-card");
    const tab = (t) => [...document.querySelectorAll("#hud .st-tab")].find((b) => b.textContent.trim() === t);
    // The game draws its chart to fit the page: drawn in a page as low as the room under 總覽, it fits there.
    card.classList.add("r26-st");
    css("r26-stats-w", "#hud .stats-card.r26-st { left: 50% !important; right: auto !important; width: 1240px !important; max-width: 1240px !important; transform: translateX(-50%); }");
    const page = document.querySelector("#hud .st-page");
    const two = () => document.querySelector("#hud .st-two");
    const room = page.getBoundingClientRect().height / parseFloat(document.getElementById("hud").style.zoom || "1");
    const used = two() ? two().getBoundingClientRect().height / parseFloat(document.getElementById("hud").style.zoom || "1") : 280;
    const h0 = Math.max(160, room - used - 56);
    // Drawn at the page's height h; the chart is as wide as the 兵力 page, so drawn once more taller by the
    // ratio of the widths, it fills the room under 總覽 when fitted to its width.
    const drawAt = (h) => new Promise((ok) => {
      page.style.height = `${h}px`;
      page.style.flex = "none";
      tab("兵力").click();
      setTimeout(() => ok(document.querySelector("#hud .st-page svg.st-svg")), 500);
    });
    return drawAt(h0).then((first) => {
      const k = (page.clientWidth - 8) / parseFloat(first.getAttribute("width"));
      return k < 0.98 ? drawAt(h0 / k) : first;
    }).then((svg) => new Promise((done) => {
      const chart = svg.cloneNode(true);
      const legend = [...document.querySelectorAll("#hud .st-page svg.st-key")].map((k) => k.parentElement.cloneNode(true));
      page.style.height = "";
      page.style.flex = "";
      tab("總覽").click();
      setTimeout(() => {
        css("r26-stats-css", `
          #hud .stats-card.r26-st { left: 50% !important; right: auto !important; width: 1240px !important; max-width: 1240px !important; transform: translateX(-50%); }
          .r26-st-chart { margin-top: 10px; border-top: 1px solid rgba(255, 222, 170, 0.18); padding-top: 8px; }
          .r26-st-chart h3 { margin: 0 0 4px; font-size: 14px; display: flex; gap: 14px; align-items: center; }
          .r26-st-chart h3 span { font-size: 12px; font-weight: 400; display: inline-flex; align-items: center; gap: 4px; }
          .r26-st-chart svg.st-svg { display: block; width: 100% !important; height: auto !important; }
        `);
        card.classList.add("r26-st");
        const box = document.createElement("div");
        box.className = "r26-st-chart";
        const h = document.createElement("h3");
        h.textContent = "兵力";
        for (const l of legend) {
          const s = document.createElement("span");
          s.appendChild(l);
          h.appendChild(s);
        }
        box.appendChild(h);
        box.appendChild(chart);
        document.querySelector("#hud .st-page").appendChild(box);
        done();
      }, 400);
    }));
  }

  window.R26 = { scale, auto, settingsScale, keys, tip, minimap, cursor, marquee, stats };
})();
