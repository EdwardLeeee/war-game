// R13-01-B2 (ceo 2026-11-05, D-125): option B's two gaps, as a spec: tags when the buildings are crowded, and buildings off the screen.
// The marks are computed by r13-tags.js from the interface's real boxes, after everything else is drawn.
"use strict";
(() => {
  const S = window.R6_STATES;
  const SCENES = window.R13_B2, T = window.R13Tags;
  const B = (label, o) => btn(label, o);
  const S2 = Math.SQRT1_2;
  // the footprint on the diamond: x east, y south
  const ring = (b, z) => {
    const w = b.w, d = b.d ?? b.w, k = 20 * z;
    const pt = (x, y) => [b.at[0] + k * (x + y) * S2, b.at[1] + k * 0.5 * (y - x) * S2];
    return [pt(-w / 2, -d / 2), pt(-w / 2, d / 2), pt(w / 2, d / 2), pt(w / 2, -d / 2)];
  };
  const svgRing = (pts, how) => {
    const p = pts.map((q) => q.map((v) => v.toFixed(1)).join(",")).join(" ");
    if (how === "off") return `<polygon points="${p}" fill="rgba(20,16,12,.25)" stroke="rgba(230,225,215,.8)" stroke-width="1.6" stroke-dasharray="5 4" stroke-linejoin="round"/>`;
    return `<polygon points="${p}" fill="rgba(255,214,102,.16)" stroke="#ffd666" stroke-width="5" stroke-linejoin="round" opacity=".45" filter="url(#glowb2)"/>` +
      `<polygon points="${p}" fill="none" stroke="#ffe08a" stroke-width="2.5" stroke-linejoin="round"/>`;
  };
  const isUi = (e) => !e.matches(".r13w, .r13b2, .worldsvg, .hp") && e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().width * e.getBoundingClientRect().height < 814 * 380 * 0.5;
  const measure = (cls, html) => {
    const n = el(`<div class="${cls} r13b2" style="left:0;top:0;visibility:hidden">${html}</div>`);
    screen.append(n);
    const r = n.getBoundingClientRect();
    n.remove();
    return [Math.ceil(r.width), Math.ceil(r.height)];
  };

  PIECES.r13b2 = (s) => {
    const w = s.r13b2;
    if (!w) return;
    const sc = SCENES[w.scene], z = sc.zoom;
    const kids = [...screen.children].flatMap((e) => (e.matches(".left") ? [...e.children] : [e]));
    const blockers = kids.filter(isUi).map((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, c: e.className }; });
    const frame = { x: 4, y: 4, w: 806, h: 372 };
    const onScreen = (b) => b.at[0] > 0 && b.at[0] < 814 && b.at[1] > 0 && b.at[1] < 380;       // the ring's middle
    const items = [], rings = [], far = [];
    for (const b of sc.buildings) {
      const t = w.tags[b.id];
      if (!t) continue;
      const pts = ring(b, z);
      if (!onScreen(b)) {
        if (!t.off) far.push({ id: b.id, name: b.name, x: b.at[0], y: b.at[1], d: Math.hypot(b.at[0] - sc.squad.at[0], b.at[1] - sc.squad.at[1]), short: t.short });
        continue;
      }
      rings.push(svgRing(pts, t.off ? "off" : "on"));
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      const [tw, th] = measure("r13tag", t.html);
      const [cw, ch] = measure("r13chip", t.chip ?? "");
      items.push({ id: b.id, cx: b.at[0], cy: b.at[1], hw: (Math.max(...xs) - Math.min(...xs)) / 2, hh: (Math.max(...ys) - Math.min(...ys)) / 2,
        top: b.at[1] - b.ay * z, w: tw, h: th, cw, ch, off: !!t.off, say: b.name + t.html, html: t.html, chip: t.chip, topPt: pts.reduce((a, p) => (p[1] < a[1] ? p : a)) });
    }
    const out = T.placeTags(items, blockers, frame, sc.squad.at);
    const lines = [], tags = [];
    for (const it of items) {
      const g = out[it.id];
      if (g.mode === "full") {
        const b = g.box;
        tags.push(`<div class="r13tag r13b2 ${it.off ? "off" : ""}" style="left:${b.x + b.w / 2}px;top:${b.y + b.h / 2}px">${it.html}</div>`);
        if (g.leader) {
          const tx = Math.max(b.x + 8, Math.min(b.x + b.w - 8, it.topPt[0])), ty = b.y + b.h / 2 < it.topPt[1] ? b.y + b.h : b.y;
          lines.push(`<line x1="${tx}" y1="${ty}" x2="${it.topPt[0]}" y2="${it.topPt[1]}" stroke="rgba(20,14,8,.75)" stroke-width="3.5"/><line x1="${tx}" y1="${ty}" x2="${it.topPt[0]}" y2="${it.topPt[1]}" stroke="#ffe08a" stroke-width="1.5"/><circle cx="${it.topPt[0]}" cy="${it.topPt[1]}" r="3" fill="#ffe08a" stroke="rgba(20,14,8,.75)"/>`);
        }
      } else if (g.mode === "chip") {
        const b = g.box;
        tags.push(`<div class="r13chip r13b2" style="left:${b.x + b.w / 2}px;top:${b.y + b.h / 2}px">${it.chip}</div>`);
      }
    }
    // the squad's rings: as many as are on the screen
    const rs = [];
    const R = [[0, 0], [24, 10], [-22, 8], [10, 26], [-30, 28], [38, 30], [-8, -18], [30, -14], [-40, -8], [52, 6], [-54, 16], [58, 28]];
    const k = z * 1.25;
    for (const [dx, dy] of R.slice(0, sc.squad.n)) {
      const x = sc.squad.at[0] + dx * k, y = sc.squad.at[1] + dy * k;
      if (x > 0 && x < 814 && y > 0 && y < 380) rs.push(`<ellipse cx="${x}" cy="${y}" rx="${Math.max(7, 16 * z)}" ry="${Math.max(3.5, 8 * z)}" fill="none" stroke="#fff3b0" stroke-width="1.6"/>`);
    }
    const under = el(`<svg class="worldsvg r13w" width="814" height="380" viewBox="0 0 814 380"><defs><filter id="glowb2" x="-30%" y="-60%" width="160%" height="220%"><feGaussianBlur stdDeviation="3"/></filter></defs>${rs.join("")}${rings.join("")}${lines.join("")}</svg>`);
    screen.prepend(under);
    for (const h of tags) add(h);
    // the arrows (the free area: inside the interface's left, top, right columns)
    if (far.length) {
      const free = { x: 78, y: 106, w: 622, h: 160 };
      const [aw, ah] = [104, 44];
      const ringBoxes = items.map((i) => ({ x: i.cx - i.hw, y: i.cy - i.hh, w: i.hw * 2, h: i.hh * 2 }));     // an arrow never over a ring
      for (const g of T.edgeArrows(far, free, blockers.concat(tagsBoxes(), ringBoxes), frame, [aw, ah])) {
        if (!g.box) throw new Error("no room for the arrow to " + g.name);
        const deg = g.angle * 180 / Math.PI;
        const right = Math.cos(g.angle) > 0;
        add(`<button class="r13arrow r13b2 ${right ? "right" : ""}" style="left:${g.box.x}px;top:${g.box.y}px;width:${aw}px;height:${ah}px" aria-label="鏡頭移到${g.name}">
          <svg class="dir" width="16" height="16" viewBox="-8 -8 16 16"><path transform="rotate(${deg.toFixed(0)})" d="M7 0 L-4.5 -5.5 L-2 0 L-4.5 5.5 Z" fill="#ffe08a" stroke="rgba(20,14,8,.8)" stroke-width="1"/></svg>
          <span class="tx"><b>${g.name}${g.n > 1 ? ` ×${g.n}` : ""}</b><small>${g.short}</small></span></button>`);
      }
    }
    // the town's badge belongs to the battlefield: under the interface
    if (w.town) for (const b of sc.buildings) if (b.id === "gate" && onScreen(b)) under.after(el(`<div class="townglyph r13glyph r13b2" style="left:${b.at[0] - 12}px;top:${b.at[1] - b.ay * z - 22}px;--tint:#2e6ed6">城</div>`));
    // nothing may overlap (the board's promise): a failure here shows up as an error on the board
    const shown = [...screen.querySelectorAll(".r13tag, .r13chip, .r13arrow")].map((e) => e.getBoundingClientRect());
    for (let i = 0; i < shown.length; i++) {
      for (let j = i + 1; j < shown.length; j++) if (T.hit(shown[i], shown[j])) throw new Error("tags overlap");
      for (const k2 of blockers) if (T.hit(shown[i], k2)) throw new Error("a tag under the interface: " + k2.c);
    }
    function tagsBoxes() { return Object.values(out).filter((g) => g.box).map((g) => g.box); }
  };
  ORDER.push("r13b2");

  const FULL_RES = { food: 640, wood: 410, gold: 380, crys: 45, pop: "64", cap: "98", time: "14:32" };
  const G = (active) => [1, 2, 3, 4].map((n) => ({ n, sub: { 1: "12/12", 2: "6/6" }[n], st: n === active ? "active" : "" }));
  const MIX = { title: "已選 12 個單位", chips: [["槍兵", 6], ["遠程兵", 4], ["法師", 2]], now: "目前：待命 12" };
  const SPEAR = { title: "已選 6 個單位", chips: [["槍兵", 6]], now: "目前：待命 6" };
  const CMDS = () => [B("攻擊", { ic: "attack", cls: "red", sub: "地面或敵人" }), B("移動", { ic: "retreat", cls: "blue", sub: "點地面" }), B("堅守", { ic: "hold", cls: "gold", sub: "原地不動" }), B("停止", { ic: "stop", cls: "sec" }),
    B("隊形：密集", { ic: "formation", cls: "sec wide", sub: "按一下改成散開" }), B("整理隊形", { ic: "ranks", cls: "sec", sub: "槍兵在前" }), B("取消", { ic: "enter", cls: "sec enter", sub: "進駐", state: "active" })];
  const PROMPT = { text: "點亮起來的建築：標籤寫誰進去、誰留下", buttons: [B("取消", { cls: "sec" })], at: "high" };
  const TAG = {
    gate: { html: "<b>進</b> 12 名全進城<small>遠程、法師上牆</small>", chip: "<b>進</b> 12", short: "進 12 名" },
    main: { html: "<b>進</b> 遠程 4・法師 2<small>留 槍兵 6</small>", chip: "<b>進</b> 6", short: "進 6 名" },
    tower: { html: "<b>進</b> 最近的 3 名<small>留 9 名</small>", chip: "<b>進</b> 3", short: "進 3 名" },
    post: { html: "<b>進</b> 槍兵 6<small>留 遠程 4・法師 2</small>", chip: "<b>進</b> 6", short: "進 6 名" },
  };
  const base = (field, o) => ({ hp: false, field, res: FULL_RES, groups: G(1), army: 18, left: { idle: 3, map: "closed" }, folded: true, sel: { kind: "units", ...MIX, help: [] }, cmds: CMDS(), prompt: PROMPT, ...o });
  const all = (scene) => Object.fromEntries(SCENES[scene].buildings.filter((b) => b.id !== "barracks").map((b) => [b.id, TAG[b.id.startsWith("t") ? "tower" : b.id]]));
  Object.assign(S, {
    "R13-01-B2-1": base("r13-b2-crowd", { r13b2: { scene: "crowd", tags: all("crowd"), town: true } }),
    "R13-01-B2-2": base("r13-b2-dense", { r13b2: { scene: "dense", tags: all("dense") } }),
    "R13-01-B2-3": base("r13-b2-clamp", { r13b2: { scene: "clamp", tags: all("clamp"), town: true } }),
    "R13-01-B2-4": base("r13-b2-far", { r13b2: { scene: "far", tags: all("far"), town: true } }),
    "R13-01-B2-5": base("r13-b2-moved", { r13b2: { scene: "moved", tags: all("moved"), town: true } }),
    "R13-01-B2-6": base("r13-b2-none", { sel: { kind: "units", ...SPEAR, help: [] }, groups: G(2),
      prompt: { text: "選的兵沒有地方可以進駐：槍兵只能進自己的城和哨所", buttons: [B("取消", { cls: "sec" })], at: "high" },
      r13b2: { scene: "none", tags: { main: { off: 1, html: "槍兵進不去" }, tower: { off: 1, html: "槍兵進不去" } } } }),
  });
})();
