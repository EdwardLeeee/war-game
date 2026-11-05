// R13-01-B2: how B's tags keep off each other and how a building off the screen is shown. The mock draws what these functions
// return, so the board is their real output; the rules are written out on the board. Pure: boxes in, boxes out; no DOM.
//   box = {x, y, w, h} (x, y the top left)
"use strict";
window.R13Tags = (() => {
  const hit = (a, b, pad = 0) => a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;
  const around = (cx, cy, w, h) => ({ x: cx - w / 2, y: cy - h / 2, w, h });
  const inside = (b, f) => b.x >= f.x && b.y >= f.y && b.x + b.w <= f.x + f.w && b.y + b.h <= f.y + f.h;

  // Rings that can be tapped sit where they are; tags are placed one by one, the building nearest the selected squad first
  // (in front of it on the screen when equal); the tags of buildings that cannot be entered last, and they give way first.
  //   items: {id, cx, cy (the ring's middle), hw, hh, top (the roof's y), w, h (the full tag), cw, ch (the small tag), off, say (the tag's words)}
  //   blockers: the interface's boxes; frame: the screen; squad: [x, y]
  // Each gets {mode: "full"|"chip"|"ring", box, leader: bool}.
  function placeTags(items, blockers, frame, squad) {
    const dist = (i) => Math.hypot(i.cx - squad[0], i.cy - squad[1]);
    const order = [...items].sort((a, b) => (a.off ? 1 : 0) - (b.off ? 1 : 0) || dist(a) - dist(b) || b.cy - a.cy);
    const placed = [];
    const out = {};
    const said = new Set();                               // the same kind saying the same thing: one full tag is enough
    const free = (b, self) => inside(b, frame) && !blockers.some((k) => hit(b, k, 2)) && !placed.some((k) => hit(b, k, 3)) &&
      !items.some((o) => o !== self && hit(b, around(o.cx, o.cy, 20, 10)));
    for (const it of order) {
      const dx0 = it.cx, dy0 = it.cy - 0.55 * (it.cy - it.top);
      const home = around(dx0, dy0, it.w, it.h);
      const covered = !inside(home, frame) || blockers.some((k) => hit(home, k, 2));
      const reach = covered ? 150 : 72;                   // pushed out by the interface it may go further than from a neighbour
      const tries = [];
      for (let up = 0; up <= reach; up += 12) for (const dx of [0, -24, 24, -48, 48, -72, 72]) tries.push([dx, -up]);
      for (const dx of [0, -24, 24]) tries.push([dx, it.cy + it.hh + it.h / 2 + 6 - dy0]);         // under the ring
      tries.sort((a, b) => Math.hypot(...a) - Math.hypot(...b));
      let got = null;
      if (!(it.off && placed.length >= 3) && !said.has(it.say)) {   // crowded: the grey ones keep only their ring
        for (const [dx, dy] of tries) {
          if (Math.hypot(dx, dy) > reach + 30) break;
          const b = { x: home.x + dx, y: home.y + dy, w: it.w, h: it.h };
          if (free(b, it)) { got = { mode: "full", box: b, leader: Math.hypot(dx, dy) > 14 }; said.add(it.say); break; }
        }
      }
      if (!got && !it.off) {                               // no room: the small tag, on its ring
        for (const [dx, dy] of [[0, 0], [-20, 0], [20, 0], [0, -14], [0, 14], [-20, -14], [20, -14]]) {
          const b = { ...around(it.cx + dx, it.cy + dy, it.cw, it.ch) };
          if (inside(b, frame) && !blockers.some((k) => hit(b, k, 2)) && !placed.some((k) => hit(b, k, 2))) { got = { mode: "chip", box: b, leader: false }; break; }
        }
      }
      got ||= { mode: "ring", box: null, leader: false };  // the ring itself can still be tapped
      if (got.box) placed.push(got.box);
      out[it.id] = got;
    }
    return out;
  }

  // Buildings that can be entered whose ring is wholly off the screen: an arrow on the edge of the free area, on the line from its
  // middle to the building. The same kind within `merge` pt along the edge is one arrow (×n, nearest first).
  //   targets: {id, name, x, y (the ring's middle), d (distance to the squad), short (who goes in)}
  //   free: the battlefield's free box (the middle of the screen, inside the interface); size: the arrow's [w, h]
  function edgeArrows(targets, free, blockers, frame, size, merge = 70) {
    const [W, H] = size;
    const c = [free.x + free.w / 2, free.y + free.h / 2];
    const onEdge = (t) => {
      const dx = t.x - c[0], dy = t.y - c[1];
      const k = Math.min(dx ? (dx > 0 ? (free.x + free.w - W / 2 - c[0]) / dx : (free.x + W / 2 - c[0]) / dx) : 1e9,
        dy ? (dy > 0 ? (free.y + free.h - H / 2 - c[1]) / dy : (free.y + H / 2 - c[1]) / dy) : 1e9);
      return { x: c[0] + dx * k, y: c[1] + dy * k, angle: Math.atan2(dy, dx) };
    };
    const groups = [];
    for (const t of [...targets].sort((a, b) => a.d - b.d)) {
      const e = onEdge(t);
      const g = groups.find((o) => o.name === t.name && Math.hypot(o.x - e.x, o.y - e.y) <= merge);
      if (g) g.n += 1; else groups.push({ ...e, id: t.id, name: t.name, short: t.short, n: 1, d: t.d });
    }
    // slide along the edge off the interface and off each other, nearest first
    const placed = [];
    for (const g of groups) {
      const vertical = Math.abs(Math.cos(g.angle)) * free.h > Math.abs(Math.sin(g.angle)) * free.w;     // on a left or right edge
      for (let s = 0; s <= 260; s += 6) {
        let done = false;
        for (const sign of s ? [1, -1] : [1]) {
          const x = g.x + (vertical ? 0 : sign * s), y = g.y + (vertical ? sign * s : 0);
          const b = around(x, y, W, H);
          if (inside(b, frame) && !blockers.some((k) => hit(b, k, 2)) && !placed.some((k) => hit(b, k, 4))) { g.box = b; placed.push(b); done = true; break; }
        }
        if (done) break;
      }
    }
    return groups;
  }
  return { placeTags, edgeArrows, hit, around };
})();
