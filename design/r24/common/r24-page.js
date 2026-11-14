// R24 介面健檢: the proposed changes drawn on the real page (正式介面, A 銅木), as R17 did.
// Loaded into the page by r24.mjs (page.addScriptTag). Nothing here is the client's code: it restyles
// what the page already shows, so that the boxes measured and the message strip's place stay real.
(() => {
  const ICON = {
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    army: '<path d="M4 18l4-10 4 6 4-6 4 10z"/>',
    more: '<circle cx="6" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="18" cy="12" r="1.6"/>',
  };
  const svg = (name) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${ICON[name]}</svg>`;

  // The bar (R24-02): as tall as a button, its cells the buttons, edge to edge with no padding, so
  // that 44 pt holds them (a bar of 44 with padded 44-pt buttons inside it cannot be). On the line of
  // 地圖 and the commands' lower row: from 8 right of 地圖 (x 131) to 8 left of the commands (x 622).
  const CSS = `
  :root { --r24-line: rgba(255, 222, 170, 0.2); --r24-left: calc(var(--safe-l) + 72px); --r24-w: 491px; }
  #hud .sel-info.r24-bar, .r24-fakebar {
    position: absolute; left: var(--r24-left) !important; right: auto !important; top: auto !important;
    bottom: calc(var(--safe-b) + 4px) !important; width: var(--r24-w) !important; max-width: none !important;
    height: 44px !important; max-height: 44px !important; min-height: 0 !important; padding: 0 !important;
    overflow: hidden; box-sizing: border-box;
  }
  #hud .sel-info.r24-bar > :not(.r24-row) { display: none !important; }
  .r24-row { display: flex; align-items: stretch; height: 44px; width: 100%; }
  .r24-row > * { flex: none; height: 44px; display: flex; align-items: center; box-sizing: border-box; }
  .r24-row > * + * { border-left: 1px solid var(--r24-line); }
  .r24-row button.r24-cell {
    min-width: 44px; min-height: 44px; padding: 0 8px; gap: 4px; margin: 0; border-radius: 0;
    background: transparent; border-top: 0; border-right: 0; border-bottom: 0; color: inherit; font: inherit;
    font-size: 13px; font-weight: 700; justify-content: center; pointer-events: auto;
  }
  .r24-row button.r24-cell .cnt { font-variant-numeric: tabular-nums; font-weight: 700; color: #f3d48c; }
  .r24-row button.r24-cell .ic { width: 16px; height: 16px; }
  .r24-row .r24-title { padding: 0 6px 0 12px; font-size: 14px; font-weight: 700; gap: 6px; white-space: nowrap; }
  .r24-row .r24-title.two { flex-direction: column; align-items: flex-start; justify-content: center; gap: 1px; }
  .r24-row .r24-title.two .t1 { line-height: 18px; }
  .r24-row .r24-title.two .t2 { font-size: 11px; font-weight: 400; line-height: 15px; }
  .r24-row .r24-title.two .t2 .w { font-weight: 700; }
  .r24-row .r24-title .atk { color: #ff8f7c; } .r24-row .r24-title .idle { color: #e9dcc2; }
  .r24-row .r24-title small { font-size: 11px; font-weight: 400; opacity: 0.8; font-variant-numeric: tabular-nums; }
  .r24-row .r24-hp { gap: 6px; padding: 0 10px; font-size: 12px; font-variant-numeric: tabular-nums; }
  .r24-row .r24-hp i { display: block; width: 54px; height: 6px; border-radius: 3px; background: rgba(0,0,0,0.45); overflow: hidden; }
  .r24-row .r24-hp i b { display: block; height: 100%; background: #6fcf5a; }
  .r24-row .r24-state { flex: 1 1 auto; min-width: 0; padding: 0 10px; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block; line-height: 44px; }
  .r24-row > .r24-state:empty { padding: 0; border-left: 0; }
  .r24-row .r24-state .w { font-weight: 700; }
  .r24-row .r24-state .atk { color: #ff8f7c; } .r24-row .r24-state .move { color: #9cc2ff; }
  .r24-row .r24-state .hold { color: #f2c862; } .r24-row .r24-state .idle { color: #e9dcc2; }
  .r24-row .r24-legion { background: rgba(240, 196, 110, 0.14) !important; }
  .r24-row .r24-q { width: 44px; font-size: 17px !important; }
  .r24-row .r24-x { width: 44px; }
  .r24-row button.r24-cell.on { background: rgba(240, 196, 110, 0.32) !important; color: #fff3d6; }
  /* What opens over the bar (？ or 軍團): no higher than 40% of the screen, its foot 4 above the bar. */
  .r24-pop, #hud .sel-info.r24-capped {
    position: absolute; left: var(--r24-left) !important; right: auto !important; top: auto !important;
    bottom: calc(var(--safe-b) + 52px) !important; max-height: 40vh !important; box-sizing: border-box;
  }
  .r24-pop { z-index: 30; width: 366px; padding: 8px 12px 9px; overflow: hidden; pointer-events: auto; }
  .r24-pop .sel-note { margin: 0 !important; }
  .r24-pop .r24-pop-head { font-size: 12px; font-weight: 700; opacity: 0.85; margin-bottom: 3px; }
  /* 軍團畫面 opened from the bar's 軍團: as wide as the bar, no title line (the bar under it has 編隊 1
     and ✕; 軍團 again closes it), the kinds three to a line, the switches on the line under them. */
  #hud .sel-info.r24-legion-pop { width: var(--r24-w) !important; max-width: none !important; padding: 6px 6px !important; display: flex; flex-direction: column; gap: 6px; }
  #hud .sel-info.r24-legion-pop > .sel-close, #hud .sel-info.r24-legion-pop .sel-body > .sel-head,
  #hud .sel-info.r24-legion-pop .sel-more { display: none !important; }
  #hud .sel-info.r24-legion-pop > .group-actions > .sel-more-btn { margin-left: auto; }
  #hud .sel-info.r24-legion-pop .sel-body { display: grid !important; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 4px 5px; padding: 0 !important; margin: 0 !important; overflow-y: auto; min-height: 0; }
  #hud .sel-info.r24-legion-pop .sel-body > :not(.group-row) { grid-column: 1 / -1; }
  /* Four kinds or more (the page's .group-grid, two to a line, the name over − N +): the same three to a line. */
  #hud .sel-info.r24-legion-pop .group-grid { display: contents !important; }
  #hud .sel-info.r24-legion-pop .group-row > .group-label { grid-column: 1; grid-row: 1 / 3; display: flex !important; flex-direction: column; justify-content: center; align-items: flex-start !important; gap: 0 !important; flex: none !important; min-width: 0; }
  #hud .sel-info.r24-legion-pop .group-row { flex-wrap: nowrap !important; }
  #hud .sel-info.r24-legion-pop .group-row { display: grid !important; grid-template-columns: 1fr 44px 22px 44px; grid-template-rows: 22px 22px; align-items: center; height: 44px; margin: 0 !important; padding: 0 0 0 6px; gap: 0; border-radius: 6px; background: rgba(0, 0, 0, 0.16); }
  #hud .sel-info.r24-legion-pop .group-type { grid-column: 1; grid-row: 1; font-size: 12px; font-weight: 700; align-self: end; width: auto !important; }
  #hud .sel-info.r24-legion-pop .group-has { grid-column: 1; grid-row: 2; font-size: 10px; align-self: start; width: auto !important; min-width: 0 !important; opacity: 0.8; }
  #hud .sel-info.r24-legion-pop .group-row > button:first-of-type { grid-column: 2; grid-row: 1 / 3; }
  #hud .sel-info.r24-legion-pop .group-want { grid-column: 3; grid-row: 1 / 3; text-align: center; width: auto !important; }
  #hud .sel-info.r24-legion-pop .group-row > button:last-of-type { grid-column: 4; grid-row: 1 / 3; }
  #hud .sel-info.r24-legion-pop > .group-actions { position: static !important; margin: 0 !important; padding: 0 !important; display: flex; gap: 5px; }
  /* R24-03: the commands one row at the foot (the grid's second row goes; the area stays anchored
     at the bottom), 更多 last; what 更多 holds over it, in the commands' own look. */
  #hud .cmds.r24-cmds > .r24-gone { display: none !important; }
  #hud .cmds.r24-morepop {
    position: absolute; right: calc(var(--safe-r) + 4px) !important; left: auto !important; top: auto !important;
    bottom: calc(var(--safe-b) + 4px + 50px + 4px) !important; padding: 4px; z-index: 30;
    display: grid !important; grid-template-columns: repeat(4, 56px); grid-auto-rows: 50px; gap: 5px; pointer-events: auto;
  }
  /* 隊形 as wide as the others there: the icon over 隊形, what a tap does under it. */
  #hud .cmds.r24-morepop > .r24-narrow { display: flex !important; width: 56px !important; }
  /* A hint on the message strip (R24-04): the strip as it is, a gold 提示 before the words. */
  .toast .r24-tip { color: #f2c862; font-weight: 700; margin-right: 8px; }
  `;

  function style() {
    if (document.getElementById("r24-style") !== null) return;
    const s = document.createElement("style");
    s.id = "r24-style";
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  /** One row of cells from a spec: title, hp, chips, state, legion, ？, ✕. */
  function row(spec) {
    const r = document.createElement("div");
    r.className = "r24-row";
    const add = (html, cls, tag = "div", label = "") => {
      const e = document.createElement(tag);
      e.className = cls;
      e.innerHTML = html;
      if (tag === "button") {
        e.type = "button";
        if (label) e.setAttribute("aria-label", label);
      }
      r.appendChild(e);
      return e;
    };
    // A group's title takes its state on a second line, so that its chips, 軍團, ？ and ✕ fit.
    const t1 = `${spec.title}${spec.sub ? ` <small>${spec.sub}</small>` : ""}`;
    if (spec.title && spec.stateUnder) add(`<span class="t1">${t1}</span><span class="t2">${spec.state}</span>`, "r24-title two");
    else if (spec.title) add(t1, "r24-title");
    if (spec.hp !== undefined) add(`<i><b style="width:${spec.hp}%"></b></i><span>${spec.hp}</span>`, "r24-hp");
    for (const [name, n] of spec.chips ?? []) add(`<span>${name}</span><span class="cnt">${n}</span>`, "r24-cell r24-chip", "button", `只選${name}`);
    add(spec.stateUnder ? "" : (spec.state ?? ""), "r24-state");
    if (spec.legion) add(`${svg("army")}<span>軍團</span>`, `r24-cell r24-legion${spec.legion === "on" ? " on" : ""}`, "button", "打開軍團畫面");
    add("？", `r24-cell r24-q${spec.q === "on" ? " on" : ""}`, "button", "說明");
    add(svg("close"), "r24-cell r24-x", "button", "取消選取");
    return r;
  }

  const st = (word, kind, n) => `<span class="w ${kind}">${word}</span>${n === undefined ? "" : ` ${n}`}`;

  window.R24 = {
    st,
    /** The real selection panel as the bar. */
    bar(spec) {
      style();
      const f = document.querySelector("#hud .sel-info");
      f.querySelector(":scope > .r24-row")?.remove();
      f.classList.add("r24-bar");
      f.appendChild(row(spec));
    },
    /** A bar drawn beside the page's own (the real panel shows 軍團畫面 above it). */
    fakeBar(spec) {
      style();
      document.querySelector(".r24-fakebar")?.remove();
      const f = document.createElement("div");
      f.className = "panel r24-fakebar";
      f.style.zIndex = "31";
      f.appendChild(row(spec));
      document.getElementById("hud").appendChild(f);
    },
    /** ？ pressed: the explanation the panel shows now, over the bar. */
    explain(head) {
      style();
      const note = document.querySelector("#hud .sel-info .sel-note");
      const p = document.createElement("div");
      p.className = "panel sel-info r24-pop";
      if (head) p.insertAdjacentHTML("beforeend", `<div class="r24-pop-head">${head}</div>`);
      if (note !== null) p.appendChild(note.cloneNode(true));
      document.body.appendChild(p);
      return p.getBoundingClientRect().height;
    },
    /** 軍團畫面 (the real panel, unfolded) at most 40% high, over the bar. */
    capPanel() {
      style();
      document.querySelector("#hud .sel-info").classList.add("r24-capped", "r24-legion-pop");
    },
    /** R24-03: the command area keeps `keep` (by label) and 更多; open, what 更多 holds over it. */
    moreCmds(keep, open) {
      style();
      const c = document.querySelector("#hud .cmds");
      const label = (b) => (b.querySelector(".label")?.textContent ?? b.textContent).trim();
      const rest = [];
      for (const b of [...c.children]) {
        if (b.classList.contains("r24-more")) continue;
        if (!keep.some((k) => label(b).startsWith(k))) {
          b.classList.add("r24-gone");
          rest.push(b);
        }
      }
      c.classList.add("r24-cmds");
      let m = c.querySelector(".r24-more");
      if (m === null) {
        m = document.createElement("button");
        m.type = "button";
        m.className = "b secondary r24-more";
        m.setAttribute("aria-label", "更多指令");
        m.innerHTML = `${svg("more")}<span class="label">更多</span><span class="sub">隊形等</span>`;
        c.appendChild(m);
      }
      document.querySelector(".r24-morepop")?.remove();
      if (open) {
        m.classList.add("active");
        const pop = document.createElement("div");
        pop.className = "cmds panel r24-morepop";
        // By how often they were used (client's 指令次數): 隊形, 堅守, 整理隊形, 停止.
        const order = ["隊形", "堅守", "整理隊形", "停止"];
        rest.sort((a, b) => order.findIndex((k) => label(a).startsWith(k)) - order.findIndex((k) => label(b).startsWith(k)));
        for (const b of rest) {
          const q = b.cloneNode(true);
          q.classList.remove("r24-gone");
          if (q.classList.contains("wide")) {
            q.classList.remove("wide");
            q.classList.add("r24-narrow");
            const now = (q.querySelector(".label")?.textContent ?? "").includes("散開") ? "散開" : "密集";
            q.querySelector(".label").textContent = "隊形";
            q.querySelector(".sub").textContent = now === "密集" ? "密集→散開" : "散開→密集";
          }
          pop.appendChild(q);
        }
        document.getElementById("hud").appendChild(pop);
      }
      return rest.map(label);
    },
    /** A hint on the real message strip, left there (no 2.2 s timer: it is not the game's toast()). */
    hint(text) {
      style();
      const box = document.querySelector(".toast");
      box.classList.remove("toast-ok");
      box.classList.add("toast-info");
      box.querySelector(".toast-text").innerHTML = `<span class="r24-tip">提示</span>${text}`;
      box.hidden = false;
    },
    /** The client's checks (zz-r24.spec.ts): every button in sight, under 44 pt, over another, out of the safe area. */
    check(safe) {
      const W = innerWidth;
      const H = innerHeight;
      const vis = (e) => {
        const r = e.getBoundingClientRect();
        const s = getComputedStyle(e);
        return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && e.closest("[hidden]") === null && r.right > 0 && r.bottom > 0 && r.left < W && r.top < H;
      };
      const bs = [...document.querySelectorAll("button")].filter(vis).filter((b) => {
        // Cut off by a box that hides its overflow (what scrolls in 軍團畫面): not in sight.
        const r = b.getBoundingClientRect();
        for (let p = b.parentElement; p !== null; p = p.parentElement) {
          const o = getComputedStyle(p).overflowY;
          if (o === "hidden" || o === "auto" || o === "scroll") {
            const q = p.getBoundingClientRect();
            if (r.bottom <= q.top + 1 || r.top >= q.bottom - 1) return false;
          }
        }
        return true;
      });
      const box = (b) => {
        const r = b.getBoundingClientRect();
        return { t: (b.getAttribute("aria-label") || b.textContent || "").trim().slice(0, 12), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
      };
      const boxes = bs.map(box);
      const small = boxes.filter((b) => b.w < 44 || b.h < 44);
      const overlaps = [];
      for (let i = 0; i < boxes.length; i++)
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i];
          const c = boxes[j];
          if (bs[i].contains(bs[j]) || bs[j].contains(bs[i])) continue;
          if (a.x < c.x + c.w - 1 && c.x < a.x + a.w - 1 && a.y < c.y + c.h - 1 && c.y < a.y + a.h - 1) overlaps.push(`${a.t} × ${c.t}`);
        }
      const outside = boxes.filter((b) => b.x < safe.left || b.x + b.w > W - safe.right || b.y < safe.top || b.y + b.h > H - safe.bottom);
      return { count: boxes.length, small, overlaps, outside, boxes };
    },
  };
})();
