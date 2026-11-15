// R25 新手教學: the tutorial's card, highlight and gestures drawn on the real page (正式介面, A 銅木), as
// R24 did. Loaded by r25.mjs after design/r24/common/r24-page.js (the bar and the one-row commands
// the client is building, D-150). Nothing here is the client's code.
(() => {
  const GOLD = "#f2c862";
  const GREEN = "#7fdc78";
  const ICON = {
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    go: '<path d="M5 12h13M13 6l6 6-6 6"/>',
    book: '<path d="M4 5.5C6.5 4.5 9.5 4.5 12 6c2.5-1.5 5.5-1.5 8-.5V19c-2.5-1-5.5-1-8 .5-2.5-1.5-5.5-1.5-8-.5z"/><path d="M12 6v13.5"/>',
  };
  const svg = (n, cls = "ic") => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICON[n]}</svg>`;

  // Layers in #hud's own stacking: the dialogs are 30 and the message strip 40, so the dim (33) goes
  // over a dialog and under the strip (守家's alarm stays readable), the card (38) over the dim.
  const CSS = `
  .r25-layer { position: absolute; inset: 0; pointer-events: none; z-index: 33; }
  .r25-card { position: absolute; z-index: 38; pointer-events: auto; box-sizing: border-box; overflow: hidden; }
  .r25-card.top { left: calc(var(--safe-l) + 241px); top: calc(var(--safe-t) + 44px); width: 390px; }
  .r25-card.side { left: calc(var(--safe-l) + 4px); top: calc(var(--safe-t) + 46px); width: 168px; }
  .r25-card .r25-prog { position: absolute; left: 10px; right: 10px; top: 4px; display: flex; gap: 3px; }
  .r25-card .r25-prog i { flex: 1; height: 3px; border-radius: 2px; background: rgba(255, 225, 170, 0.18); }
  .r25-card .r25-prog i.done { background: ${GOLD}; } .r25-card .r25-prog i.now { background: rgba(242, 200, 98, 0.55); }
  .r25-card .r25-head { display: flex; align-items: center; min-height: 44px; }
  .r25-card .r25-step { font-size: 11px; color: ${GOLD}; padding: 0 8px 0 12px; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .r25-card .r25-title { flex: 1; min-width: 0; font-size: 15px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .r25-card .r25-head .b { min-height: 44px; min-width: 44px; padding: 0 9px; font-size: 12px; border-radius: 0; background: transparent; box-shadow: none; border-left: 1px solid rgba(255, 222, 170, 0.2); }
  .r25-card .r25-head .b .ic { width: 16px; height: 16px; }
  .r25-card .r25-body { padding: 0 12px 10px; font-size: 13px; line-height: 1.5; }
  .r25-card .r25-body b { color: ${GOLD}; }
  .r25-card .r25-body small { display: block; font-size: 11px; opacity: 0.8; margin-top: 2px; }
  .r25-card .r25-list { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 2px; }
  .r25-card .r25-list span { white-space: nowrap; }
  .r25-card .r25-list span::before { content: ""; display: inline-block; width: 11px; height: 11px; border-radius: 50%; border: 1.5px solid rgba(255, 225, 170, 0.6); margin-right: 5px; vertical-align: -1px; }
  .r25-card .r25-list span.ok { color: ${GREEN}; }
  .r25-card .r25-list span.ok::before { background: ${GREEN}; border-color: ${GREEN}; }
  .r25-card .r25-wait { margin-top: 5px; height: 6px; border-radius: 3px; background: rgba(0, 0, 0, 0.4); overflow: hidden; }
  .r25-card .r25-wait i { display: block; height: 100%; background: ${GOLD}; }
  .r25-card .r25-go { margin-top: 6px; min-height: 44px; }
  .r25-card.done { box-shadow: inset 0 0 0 2px ${GREEN}, 0 3px 8px rgba(0, 0, 0, 0.45) !important; }
  .r25-card.done .r25-title { color: ${GREEN}; display: flex; align-items: center; gap: 6px; }
  .r25-card.done .r25-title .ok { width: 20px; height: 20px; border-radius: 50%; background: ${GREEN}; color: #142012; display: inline-flex; align-items: center; justify-content: center; }
  .r25-card.done .r25-title .ok .ic { width: 14px; height: 14px; stroke-width: 3; }
  .r25-card.side .r25-head { flex-wrap: wrap; padding-top: 12px; min-height: 0; }
  .r25-card.side .r25-title { white-space: normal; flex-basis: 100%; padding: 0 12px 4px; order: 3; }
  .r25-card.side .r25-step { flex: 1; padding-top: 2px; }
  .r25-card.side .r25-btns { display: flex; flex-direction: column; padding: 0 10px 10px; gap: 6px; }
  .r25-card.side .r25-btns .b { min-height: 44px; width: 100%; font-size: 13px; }
  /* The highlight. A: the rest dimmed (only this answers); B: nothing dimmed, a gold frame and an arrow. */
  .r25-layer { --p: 1; }
  .r25-spot { position: absolute; box-sizing: border-box; border: 3px solid ${GOLD}; border-radius: 10px;
    box-shadow: 0 0 0 2px rgba(40, 24, 8, 0.85), 0 0 calc(6px + 10px * var(--p)) calc(1px + 4px * var(--p)) rgba(242, 200, 98, calc(0.25 + 0.5 * var(--p))); }
  .r25-arrow { translate: 0 calc(-5px * var(--p)); }
  .r25-spot.round { border-radius: 50%; }
  .r25-mask { position: absolute; left: 0; top: 0; }
  .r25-spot.ok { border-color: ${GREEN}; box-shadow: 0 0 0 2px rgba(10, 30, 10, 0.85), 0 0 16px 5px rgba(127, 220, 120, 0.75); }
  .r25-arrow { position: absolute; width: 34px; height: 30px; filter: drop-shadow(0 2px 2px rgba(0, 0, 0, 0.6)); }
  .r25-edge { position: absolute; display: flex; align-items: center; gap: 6px; padding: 6px 10px 6px 6px; border-radius: 22px;
    background: rgba(30, 20, 10, 0.9); border: 2px solid ${GOLD}; color: #fff3d6; font-size: 13px; font-weight: 700; white-space: nowrap; }
  .r25-edge svg { width: 26px; height: 26px; fill: ${GOLD}; }
  .r25-hand { position: absolute; overflow: visible; }
  .r25-confirm { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: 380px; z-index: 39; pointer-events: auto; padding: 16px 18px 14px; box-sizing: border-box; }
  .r25-confirm h3 { margin: 0 0 6px; font-size: 17px; } .r25-confirm p { margin: 0 0 12px; font-size: 13px; line-height: 1.5; }
  .r25-confirm .row { display: flex; gap: 8px; justify-content: flex-end; } .r25-confirm .row .b { min-height: 44px; min-width: 110px; font-size: 14px; }
  .r25-dim { position: absolute; inset: 0; background: rgba(10, 8, 6, 0.55); z-index: 34; }
  .toast .r25-x { display: none; }
  `;

  const hud = () => document.getElementById("hud");
  function style() {
    if (document.getElementById("r25-style") !== null) return;
    const s = document.createElement("style");
    s.id = "r25-style";
    s.textContent = CSS;
    document.head.appendChild(s);
    // The fake world is paused; the tutorial is not: its banner goes.
    const s2 = document.createElement("style");
    s2.textContent = "#hud .paused-banner { display: none !important; }";
    document.head.appendChild(s2);
  }
  let STYLE = "A";
  function layer() {
    let l = document.querySelector(".r25-layer");
    if (l === null) {
      l = document.createElement("div");
      l.className = "r25-layer";
      hud().appendChild(l);
    }
    l.classList.toggle("a", STYLE === "A");
    return l;
  }

  /** Where a target is on the screen: a CSS selector (with optional text), a box, or map cells. */
  function rectOf(t) {
    if (t.sel === null) return t;
    if (t.sel) {
      const es = [...document.querySelectorAll(t.sel)].filter((e) => e.getBoundingClientRect().width > 0 && e.closest("[hidden]") === null);
      const e = t.text ? es.find((x) => (x.textContent || "").includes(t.text)) : es[0];
      if (!e) throw new Error(`no target ${t.sel} ${t.text ?? ""}`);
      const r = e.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    }
    if (t.cell) {
      const g = window.__proto.game;
      const c = g.cellToScreen(t.cell[0], t.cell[1]);
      const r = t.r ?? 26;
      return { x: c.x - r, y: c.y - r * (t.squash ?? 0.75) + (t.dy ?? 0), w: 2 * r, h: 2 * r * (t.squash ?? 0.75), round: true };
    }
    return t;
  }

  function arrowSvg(dir, colour) {
    // A chevron pointing `dir` (down: the target under it).
    const rot = { down: 0, up: 180, left: 90, right: -90 }[dir];
    return `<svg class="r25-arrow" viewBox="0 0 34 30" style="transform: rotate(${rot}deg)"><path d="M3 4h28L17 27z" fill="${colour}" stroke="#2a1806" stroke-width="2.5" stroke-linejoin="round"/></svg>`;
  }

  /** A: the dim, a mask with a hole for each target (and for what must stay readable: the game's prompt). */
  function hole(r, pad = 4) {
    const l = layer();
    let m = l.querySelector(".r25-mask");
    if (m === null) {
      l.insertAdjacentHTML("afterbegin", `<svg class="r25-mask" width="${innerWidth}" height="${innerHeight}"><defs><mask id="r25m"><rect width="100%" height="100%" fill="#fff"/></mask></defs><rect width="100%" height="100%" fill="rgba(10,8,6,0.6)" mask="url(#r25m)"/></svg>`);
      m = l.querySelector(".r25-mask");
    }
    const k = m.querySelector("mask");
    const x = r.x - pad;
    const y = r.y - pad;
    const w = r.w + 2 * pad;
    const h = r.h + 2 * pad;
    k.insertAdjacentHTML("beforeend", r.round ? `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}" fill="#000"/>` : `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="#000"/>`);
  }

  window.R25 = {
    /** A: keep this readable (not dimmed), with no frame. */
    keep(t, pad = 2) {
      if (STYLE === "A") hole(rectOf(t), pad);
    },
    setStyle(s) {
      STYLE = s;
      style();
      layer();
    },
    clear() {
      for (const e of document.querySelectorAll(".r25-layer, .r25-card, .r25-confirm, .r25-dim")) e.remove();
    },
    /**
     * The card. place: top (under the resource bar), slim (head only: the game's own prompt is up),
     * side (a dialog fills the middle); state: do, wait, done.
     */
    card({ n, title, body = "", place = "top", state = "do", list = null, wait = null, go = null, side = null, total = 9 }) {
      style();
      document.querySelector(".r25-card")?.remove();
      const c = document.createElement("div");
      c.className = `panel r25-card ${place === "side" ? "side" : "top"}${state === "done" ? " done" : ""}`;
      const prog = Array.from({ length: total }, (_, i) => `<i class="${i + 1 < n || (i + 1 === n && state === "done") ? "done" : i + 1 === n ? "now" : ""}"></i>`).join("");
      const t = state === "done" ? `<span class="ok">${svg("check")}</span>${title}` : title;
      const buttons = `<button type="button" class="b secondary">${state === "done" ? "下一步" : "跳過這步"}</button><button type="button" class="b secondary" aria-label="離開教學">${svg("close")}</button>`;
      let inner = `<div class="r25-prog">${prog}</div>`;
      if (place === "side") {
        inner += `<div class="r25-head"><span class="r25-step">新手教學 ${n}／${total}</span><span class="r25-title">${t}</span></div>`;
        inner += `<div class="r25-body">${body}</div>`;
        inner += `<div class="r25-btns">${side ?? ""}<button type="button" class="b secondary">跳過這步</button><button type="button" class="b secondary">${svg("close")}離開教學</button></div>`;
      } else {
        inner += `<div class="r25-head"><span class="r25-step">${n}／${total}</span><span class="r25-title">${t}</span>${buttons}</div>`;
        if (place !== "slim") {
          let b = body;
          if (list) b += `<div class="r25-list">${list.map(([s, ok]) => `<span class="${ok ? "ok" : ""}">${s}</span>`).join("")}</div>`;
          if (wait !== null) b += `<div class="r25-wait"><i style="width:${Math.round(wait * 100)}%"></i></div>`;
          if (go) b += `<button type="button" class="b r25-go">${svg("go")}${go}</button>`;
          inner += `<div class="r25-body">${b}</div>`;
        }
      }
      c.innerHTML = inner;
      hud().appendChild(c);
      const r = c.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    },
    /** A target framed; `arrow`: from which side B's arrow points at it (A has none: the dim says it). */
    spot(t, { arrow = "up", ok = false, pad = 4 } = {}) {
      const l = layer();
      const r = rectOf(t);
      if (STYLE === "A") hole(r, pad);
      const s = document.createElement("div");
      s.className = `r25-spot${r.round ? " round" : ""}${ok ? " ok" : ""}`;
      Object.assign(s.style, { left: `${r.x - pad}px`, top: `${r.y - pad}px`, width: `${r.w + 2 * pad}px`, height: `${r.h + 2 * pad}px` });
      l.appendChild(s);
      if (STYLE === "B" && arrow !== null && !ok) {
        const cx = r.x + r.w / 2;
        const cy = r.y + r.h / 2;
        const pos = {
          up: [cx - 17, r.y - pad - 34, "down"],
          down: [cx - 17, r.y + r.h + pad + 4, "up"],
          left: [r.x - pad - 38, cy - 15, "right"],
          right: [r.x + r.w + pad + 4, cy - 15, "left"],
        }[arrow];
        l.insertAdjacentHTML("beforeend", arrowSvg(pos[2], GOLD));
        const a = l.lastElementChild;
        Object.assign(a.style, { left: `${pos[0]}px`, top: `${pos[1]}px` });
      }
      return r;
    },
    /** A finger: tap, drag (from → to), pinch (two fingers apart), press (long press then drag a box). */
    gesture(kind, from, to = null) {
      const l = layer();
      const W = innerWidth;
      const H = innerHeight;
      const tip = (x, y, o = 1) => `<circle cx="${x}" cy="${y}" r="13" fill="rgba(255,255,255,${0.9 * o})" stroke="#2a1806" stroke-width="2.5"/><circle cx="${x}" cy="${y}" r="20" fill="none" stroke="rgba(255,255,255,${0.55 * o})" stroke-width="2"/>`;
      const line = (x1, y1, x2, y2) => `<path d="M${x1} ${y1}L${x2} ${y2}" stroke="#fff" stroke-width="3" stroke-dasharray="7 6" stroke-linecap="round" fill="none" marker-end="url(#r25h)"/>`;
      let g = `<defs><marker id="r25h" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L10 5L0 10z" fill="#fff"/></marker></defs>`;
      if (kind === "tap") g += tip(from.x, from.y);
      if (kind === "drag") g += line(from.x, from.y, to.x, to.y) + tip(from.x, from.y);
      if (kind === "pinch") {
        const d = 34;
        g += line(from.x - 8, from.y + 8, from.x - d - 26, from.y + d + 6) + line(from.x + 8, from.y - 8, from.x + d + 26, from.y - d - 6);
        g += tip(from.x - 10, from.y + 10) + tip(from.x + 10, from.y - 10);
      }
      if (kind === "press") {
        g += `<rect x="${from.x}" y="${from.y}" width="${to.x - from.x}" height="${to.y - from.y}" fill="rgba(255,255,255,0.10)" stroke="#fff" stroke-width="2.5" stroke-dasharray="8 6"/>`;
        g += line(from.x + 10, from.y + 10, to.x - 6, to.y - 6) + tip(from.x, from.y);
        g += `<text x="${from.x + 24}" y="${from.y - 12}" fill="#fff" font-size="13" font-weight="700" stroke="#2a1806" stroke-width="3" paint-order="stroke">長按 0.4 秒再拖</text>`;
      }
      l.insertAdjacentHTML("beforeend", `<svg class="r25-hand" width="${W}" height="${H}" style="left:0;top:0">${g}</svg>`);
    },
    /** A target off the screen: a gold tag at the edge, pointing at it. */
    edge(cell, label) {
      const l = layer();
      const c = window.__proto.game.cellToScreen(cell[0], cell[1]);
      const W = innerWidth;
      const H = innerHeight;
      const cx = W / 2;
      const cy = H / 2;
      const ang = Math.atan2(c.y - cy, c.x - cx);
      // To the edge of the play area, kept off the buttons' columns.
      // Under the card, left of the 編隊 column, over the bar.
      const m = { l: 150, r: W - 250, t: 170, b: H - 110 };
      const t = Math.min(Math.abs((ang > Math.PI / 2 || ang < -Math.PI / 2 ? m.l - cx : m.r - cx) / Math.cos(ang)), Math.abs((ang < 0 ? m.t - cy : m.b - cy) / Math.sin(ang)));
      const x = cx + Math.cos(ang) * t;
      const y = cy + Math.sin(ang) * t;
      const deg = (ang * 180) / Math.PI;
      l.insertAdjacentHTML("beforeend", `<div class="r25-edge" style="left:${x - 60}px;top:${y - 20}px"><svg viewBox="0 0 24 24" style="transform:rotate(${deg}deg)"><path d="M3 6l18 6-18 6 4-6z"/></svg>${label}</div>`);
      return { x, y };
    },
    /** 離開教學 tapped: the confirm. */
    confirmLeave() {
      style();
      const d = document.createElement("div");
      d.className = "r25-dim";
      hud().appendChild(d);
      const c = document.createElement("div");
      c.className = "panel dialog-card r25-confirm";
      c.innerHTML = `<h3>離開新手教學？</h3><p>教學做到哪裡不會存，下次從第一步開始。<br>可以在開局畫面或「設定」再打開。</p><div class="row"><button type="button" class="b secondary">離開</button><button type="button" class="b pri">繼續教學</button></div>`;
      hud().appendChild(c);
    },
    /** 新手教學 opened in a game: leave this game first. */
    confirmEnter() {
      style();
      const d = document.createElement("div");
      d.className = "r25-dim";
      hud().appendChild(d);
      const c = document.createElement("div");
      c.className = "panel dialog-card r25-confirm";
      c.innerHTML = `<h3>開始新手教學？</h3><p>先離開這一局。這一局會存著，教學完回開局畫面按「繼續上一局」就接得上。</p><div class="row"><button type="button" class="b secondary">取消</button><button type="button" class="b pri">開始教學</button></div>`;
      hud().appendChild(c);
    },
    /** The message strip as the game says it (`kind`: alarm red, or info). */
    strip(text, kind = "alarm") {
      const box = document.querySelector(".toast");
      box.classList.remove("toast-ok", "toast-info");
      if (kind === "info") box.classList.add("toast-info");
      box.querySelector(".toast-text").textContent = text;
      box.hidden = false;
    },
    /** The game's own box-select frame (.marquee) shown from (x0, y0) to (x1, y1). */
    marquee(x0, y0, x1, y1) {
      const m = document.querySelector(".marquee");
      if (m === null) return;
      Object.assign(m.style, { left: `${x0}px`, top: `${y0}px`, width: `${x1 - x0}px`, height: `${y1 - y0}px` });
      m.hidden = false;
    },
    svg,
  };
})();
