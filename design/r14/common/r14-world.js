// R14: what the game draws on the battlefield (client/src/render/world.ts; R6-23, R6-23b), from build/r14-layout.js
// (scene_r14.py: where each unit, building, gate and town of a scene is on the screen, pt). A state says what to mark:
//   w: { scene, sel: [unit ids or "group.*"], hp: {id: 0..100}, building: "id" (its frame and bar), bar: {id: [0..1, colour]},
//        target: "id" (the attack feedback ring), siege: ["unit id"] (its three rings), stones: [[from id, to id, 0..1]],
//        shots: [[from, to]], tap: "id" (a tap that went wrong), town: [{t, glyph, tint, text, timer}], path: [[[x, y] ...]] (示意) }
"use strict";
(() => {
  const L = window.R14_LAYOUT || {};
  const TEAM = { own: "#3f7fe0", enemy: "#d9433a", neutral: "#d8d2c0", ruin: "#6d6258" };     // R6-24 甲
  window.R14_TEAM = TEAM;

  PIECES.r14w = (s) => {
    const w = s.w;
    if (!w) return;
    const name = w.scene || s.field;
    const sc = L[name];
    if (!sc) throw new Error("no layout for " + name + " (run scene_r14.py)");
    const [z, ox, oy] = sc.cam;
    const S2 = Math.SQRT1_2;
    const pt = (x, y, up = 0) => [((x - y) * 40 * S2 - ox) * z + 407, ((x + y) * 20 * S2 - oy) * z + 190 - up * z];
    const find = (id) => sc.units.find((u) => u.id === id) || sc.buildings[id] || sc.gates[id] || (() => { throw new Error("nothing called " + id + " in " + name); })();
    const where = (id) => { const t = find(id); return t.foot ? t.at : t.at; };
    const sel = (u, list) => (list || []).some((k) => k === u.id || (k.endsWith(".*") && u.group === k.slice(0, -2)) || (k === "all" && u.team === "blue"));
    const poly = (pts) => pts.map((p) => p.map((v) => v.toFixed(1)).join(",")).join(" ");
    const g = [], air = [];
    const bar = (x, y, wd, frac, col) => air.push(`<rect x="${(x - wd / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${wd.toFixed(1)}" height="4" rx="2" fill="#201a18" opacity=".85"/>` +
      `<rect x="${(x - wd / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${(wd * frac).toFixed(1)}" height="4" rx="2" fill="${col}"/>`);
    const ell = (x, y, rx, ry, st) => `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="${rx.toFixed(1)}" ry="${ry.toFixed(1)}" fill="none" ${st}/>`;
    // 攻城砲 selected: at buildings (faint), at units (white), the ground it cannot shoot (red, dashed): world.ts drawSiegeRanges
    for (const id of w.siege || []) {
      const [x, y] = find(id).at;
      const r = (c) => [c * 40 * z, c * 20 * z];
      g.push(ell(x, y, ...r(10), 'stroke="#fff3b0" stroke-width="2" opacity=".55"'), ell(x, y, ...r(6), 'stroke="#ffffff" stroke-width="2" opacity=".7"'),
        ell(x, y, ...r(3), 'stroke="#ff5a4f" stroke-width="2.5" stroke-dasharray="6 5" opacity=".9"'));
    }
    // a building selected: its footprint and its bar in its owner's colour (R6-23 INV-138)
    if (w.building) {
      const b = find(w.building);
      const c = [b.foot[0], b.foot[1], b.foot[2], b.foot[3]];
      g.push(`<polygon points="${poly(c)}" fill="rgba(255,243,176,.08)" stroke="#fff3b0" stroke-width="2.5" stroke-linejoin="round"/>`);
    }
    for (const [id, [frac, col]] of Object.entries(w.bar || {})) {
      const b = find(id);
      const wd = Math.max(30, Math.abs(b.foot[1][0] - b.foot[3][0]) * 0.5);
      bar(b.at[0], b.top - 8, wd, frac, TEAM[col] || col);
    }
    // the attack feedback (指令回饋圈, R6-25-10: red), round what was tapped
    if (w.target) {
      const t = find(w.target);
      const rx = t.foot ? Math.abs(t.foot[1][0] - t.foot[3][0]) * 0.42 : 14 * Math.max(z, 0.6);
      g.push(ell(t.at[0], t.at[1], rx, rx / 2, 'stroke="#ff5a4f" stroke-width="2.5" opacity=".95"'), ell(t.at[0], t.at[1], rx * 0.6, rx * 0.3, 'stroke="#ff5a4f" stroke-width="2" opacity=".6"'));
    }
    // selected units: the ring at their feet (ghostRings), their life over them
    const rx = Math.max(7, 16 * z);
    for (const u of sc.units) {
      if (!sel(u, w.sel)) continue;
      if (!u.up) g.push(ell(u.at[0], u.at[1], rx, rx / 2, 'stroke="#fff3b0" stroke-width="1.6"'));
      const hp = (w.hp || {})[u.id] ?? (w.hp || {})[u.group + ".*"] ?? u.hp;
      bar(u.at[0], u.top - 6, Math.max(16, 22 * z), hp / 100, hp > 40 ? "#78d05f" : "#e7c35a");
    }
    // 攻城砲's stones in the air, arrows from towers (R6-23 INV-145)
    for (const [a, b, k] of w.stones || []) {
      const [x0, y0] = where(a), [x1, y1] = where(b);
      const top = Math.min(y0, y1) - 70 * z - Math.abs(x1 - x0) * 0.2;
      const q = (t) => [(1 - t) ** 2 * x0 + 2 * (1 - t) * t * ((x0 + x1) / 2) + t * t * x1, (1 - t) ** 2 * (y0 - 14 * z) + 2 * (1 - t) * t * top + t * t * y1];
      const [sx, sy] = q(k);
      air.push(`<path d="M${x0} ${y0 - 14 * z} Q ${(x0 + x1) / 2} ${top} ${x1} ${y1}" fill="none" stroke="rgba(255,240,200,.35)" stroke-width="1.5" stroke-dasharray="3 5"/>` +
        `<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="${(4 * Math.max(z, 0.7)).toFixed(1)}" fill="#5a5048" stroke="#1d1712" stroke-width="1.2"/>`);
    }
    for (const [a, b] of w.shots || []) {
      const s0 = find(a), s1 = find(b);
      const x0 = s0.at[0], y0 = (s0.top ?? s0.at[1]) + 6, x1 = s1.at[0], y1 = s1.at[1] - 10 * z, t = 0.6;
      const px = x0 + (x1 - x0) * t, py = y0 + (y1 - y0) * t - 18, ang = Math.atan2(y1 - y0 + 30, x1 - x0) * 180 / Math.PI;
      air.push(`<path d="M${x0} ${y0} Q ${(x0 + x1) / 2} ${Math.min(y0, y1) - 40} ${x1} ${y1}" fill="none" stroke="rgba(255,240,200,.35)" stroke-width="1.5" stroke-dasharray="3 5"/>` +
        `<g transform="translate(${px.toFixed(1)} ${py.toFixed(1)}) rotate(${ang.toFixed(0)})"><line x1="-7" y1="0" x2="5" y2="0" stroke="#2a1c10" stroke-width="3"/><line x1="-7" y1="0" x2="5" y2="0" stroke="#f4e2b0" stroke-width="1.6"/>` +
        `<path d="M5 -3 L10 0 L5 3 z" fill="#f4e2b0" stroke="#2a1c10" stroke-width=".8"/></g>`);
    }
    // design notes only (示意, not the game's): a way along the walls, in world cells, with its arrowhead
    for (const p of w.path || []) {
      const ps = p.map(([x, y, up]) => pt(x, y, up || 0));
      const d = "M" + ps.map((q) => q.map((v) => v.toFixed(1)).join(" ")).join(" L");
      const [a, b] = [ps[ps.length - 2], ps[ps.length - 1]];
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI;
      air.push(`<path d="${d}" fill="none" stroke="rgba(20,14,8,.7)" stroke-width="5" stroke-linejoin="round"/><path d="${d}" fill="none" stroke="#ffe45c" stroke-width="2.5" stroke-dasharray="7 5" stroke-linejoin="round"/>` +
        `<g transform="translate(${b[0].toFixed(1)} ${b[1].toFixed(1)}) rotate(${ang.toFixed(0)})"><path d="M2 0 L-9 -6 L-6 0 L-9 6 Z" fill="#ffe45c" stroke="rgba(20,14,8,.8)"/></g>`);
    }
    if (w.tap) {
      const t = find(w.tap);
      const x = t.at[0], y = (t.top ?? t.at[1]) + 16;
      air.push(`<circle cx="${x}" cy="${y}" r="15" fill="rgba(200,48,44,.35)" stroke="#ff6a5e" stroke-width="2.5"/><path d="M${x - 6} ${y - 6} l12 12 M${x + 6} ${y - 6} l-12 12" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>`);
    }
    const svg = add(`<svg class="worldsvg r14w" width="814" height="380" viewBox="0 0 814 380">${g.join("")}${air.join("")}</svg>`);
    screen.insertBefore(svg, screen.querySelector(".res"));
    // the town's 鎮／城 and its state words (R6-23b), drawn by the game: under the interface
    for (const t of w.town || []) {
      const T = sc.towns[t.t];
      const glyph = el(`<div class="townglyph r14glyph" style="left:${T.top[0] - 13}px;top:${T.top[1] - 13}px;--tint:${TEAM[t.tint] || t.tint}">${t.glyph}</div>`);
      screen.insertBefore(glyph, screen.querySelector(".res"));
      const [lx, ly] = t.at || T.south;
      // its words under the bottom corner (world.ts): off the screen, nothing to draw
      if (t.text && lx > 30 && lx < 784 && ly < 362) {
        const lab = el(`<div class="townlabel r14label" style="left:${lx}px;top:${ly}px">${t.text}${t.timer !== undefined ? `<span class="tbar"><i style="width:${t.timer * 100}%"></i></span>` : ""}</div>`);
        screen.insertBefore(lab, screen.querySelector(".res"));
      }
    }
  };
  ORDER.splice(ORDER.indexOf("res"), 0, "r14w");
})();
