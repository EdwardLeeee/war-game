// 進駐's tags and arrows (R13-01-B2, the rules on the approved board; design/r13/common/r13-tags.js is
// what drew it, this the same thing): how the tags keep off each other and the interface, and how a
// building off the screen is shown. Boxes in, boxes out; screen points. Pure, for the unit tests.

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A building with a tag: its ring's middle and half size, its roof's y, and the sizes of its tags. */
export interface TagItem {
  id: string;
  cx: number;
  cy: number;
  hw: number;
  hh: number;
  top: number;
  /** The full tag. */
  w: number;
  h: number;
  /** The small one. */
  cw: number;
  ch: number;
  /** Cannot be entered: placed last, gives way first. */
  off: boolean;
  /** The same kind saying the same thing: one full tag is enough (rule 4). */
  say: string;
}

export type TagPlace = { mode: "full" | "chip"; box: Box; leader: boolean } | { mode: "ring"; box: null; leader: false };

export const hit = (a: Box, b: Box, pad = 0): boolean => a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;
export const around = (cx: number, cy: number, w: number, h: number): Box => ({ x: cx - w / 2, y: cy - h / 2, w, h });
const inside = (b: Box, f: Box): boolean => b.x >= f.x && b.y >= f.y && b.x + b.w <= f.x + f.w && b.y + b.h <= f.y + f.h;

/** Moved further than this (points) from over its roof, a tag has a line back to its ring (rule 3). */
const LEADER_PT = 14;
/** How far a tag looks for room: pushed by a neighbour, pushed by the interface (rule 5). */
const REACH_NEIGHBOUR_PT = 72;
const REACH_INTERFACE_PT = 150;

/**
 * Rules 1 to 5: the rings sit where they are; the tags are placed one by one, the building nearest
 * the selected squad first (in front of it on the screen when equal), the grey ones last.
 */
export function placeTags(items: readonly TagItem[], blockers: readonly Box[], frame: Box, squad: readonly [number, number]): Map<string, TagPlace> {
  const dist = (i: TagItem) => Math.hypot(i.cx - squad[0], i.cy - squad[1]);
  const order = [...items].sort((a, b) => (a.off ? 1 : 0) - (b.off ? 1 : 0) || dist(a) - dist(b) || b.cy - a.cy);
  const placed: Box[] = [];
  const out = new Map<string, TagPlace>();
  const said = new Set<string>();
  const free = (b: Box, self: TagItem) =>
    inside(b, frame) && !blockers.some((k) => hit(b, k, 2)) && !placed.some((k) => hit(b, k, 3)) && !items.some((o) => o !== self && hit(b, around(o.cx, o.cy, 20, 10)));
  for (const it of order) {
    const homeY = it.cy - 0.55 * (it.cy - it.top);
    const home = around(it.cx, homeY, it.w, it.h);
    const covered = !inside(home, frame) || blockers.some((k) => hit(home, k, 2));
    const reach = covered ? REACH_INTERFACE_PT : REACH_NEIGHBOUR_PT;
    const tries: [number, number][] = [];
    for (let up = 0; up <= reach; up += 12) for (const dx of [0, -24, 24, -48, 48, -72, 72]) tries.push([dx, -up]);
    // Under the ring.
    for (const dx of [0, -24, 24]) tries.push([dx, it.cy + it.hh + it.h / 2 + 6 - homeY]);
    tries.sort((a, b) => Math.hypot(...a) - Math.hypot(...b));
    let got: TagPlace | null = null;
    // Crowded: the grey ones keep only their ring.
    if (!(it.off && placed.length >= 3) && !said.has(it.say)) {
      for (const [dx, dy] of tries) {
        if (Math.hypot(dx, dy) > reach + 30) break;
        const b = { x: home.x + dx, y: home.y + dy, w: it.w, h: it.h };
        if (free(b, it)) {
          got = { mode: "full", box: b, leader: Math.hypot(dx, dy) > LEADER_PT };
          said.add(it.say);
          break;
        }
      }
    }
    // No room: the small tag, on its ring.
    if (got === null && !it.off) {
      for (const [dx, dy] of [[0, 0], [-20, 0], [20, 0], [0, -14], [0, 14], [-20, -14], [20, -14]]) {
        const b = around(it.cx + dx, it.cy + dy, it.cw, it.ch);
        if (inside(b, frame) && !blockers.some((k) => hit(b, k, 2)) && !placed.some((k) => hit(b, k, 2))) {
          got = { mode: "chip", box: b, leader: false };
          break;
        }
      }
    }
    const place: TagPlace = got ?? { mode: "ring", box: null, leader: false };
    if (place.box !== null) placed.push(place.box);
    out.set(it.id, place);
  }
  return out;
}

/** A building to enter whose ring's middle is off the screen. */
export interface ArrowTarget {
  id: string;
  name: string;
  x: number;
  y: number;
  /** How far from the squad. */
  d: number;
  /** 「進 12 名」. */
  short: string;
}

export interface EdgeArrow {
  /** The nearest of those it stands for: where a tap goes (rule 10). */
  id: string;
  name: string;
  short: string;
  /** How many it stands for (rule 9: 箭樓 ×2). */
  n: number;
  /** Which way it points, radians. */
  angle: number;
  box: Box | null;
}

/**
 * Rules 7 to 9: an arrow on the edge of the free area, on the line from its middle to the building;
 * the same kind within `merge` points along the edge are one arrow; slid along the edge off the
 * interface and off each other, nearest first.
 */
export function edgeArrows(targets: readonly ArrowTarget[], free: Box, blockers: readonly Box[], frame: Box, size: readonly [number, number], merge = 70): EdgeArrow[] {
  const [W, H] = size;
  const cx = free.x + free.w / 2;
  const cy = free.y + free.h / 2;
  const onEdge = (t: ArrowTarget) => {
    const dx = t.x - cx;
    const dy = t.y - cy;
    const k = Math.min(dx !== 0 ? (dx > 0 ? (free.x + free.w - W / 2 - cx) / dx : (free.x + W / 2 - cx) / dx) : 1e9, dy !== 0 ? (dy > 0 ? (free.y + free.h - H / 2 - cy) / dy : (free.y + H / 2 - cy) / dy) : 1e9);
    return { x: cx + dx * k, y: cy + dy * k, angle: Math.atan2(dy, dx) };
  };
  const groups: (EdgeArrow & { x: number; y: number })[] = [];
  for (const t of [...targets].sort((a, b) => a.d - b.d)) {
    const e = onEdge(t);
    const g = groups.find((o) => o.name === t.name && Math.hypot(o.x - e.x, o.y - e.y) <= merge);
    if (g !== undefined) g.n += 1;
    else groups.push({ ...e, id: t.id, name: t.name, short: t.short, n: 1, box: null });
  }
  const placed: Box[] = [];
  for (const g of groups) {
    // On a left or right edge it slides up and down.
    const vertical = Math.abs(Math.cos(g.angle)) * free.h > Math.abs(Math.sin(g.angle)) * free.w;
    for (let s = 0; s <= 260 && g.box === null; s += 6) {
      for (const sign of s === 0 ? [1] : [1, -1]) {
        const b = around(g.x + (vertical ? 0 : sign * s), g.y + (vertical ? sign * s : 0), W, H);
        if (inside(b, frame) && !blockers.some((k) => hit(b, k, 2)) && !placed.some((k) => hit(b, k, 4))) {
          g.box = b;
          placed.push(b);
          break;
        }
      }
    }
  }
  return groups;
}

/** The least a target is across for a finger (rule 1). */
const FINGER_PT = 44;

/** What a tap may land on: the tag (or small tag), and the ring; `big`: a town, under what stands in it. */
export interface TapItem {
  id: string;
  box: Box | null;
  cx: number;
  cy: number;
  hw: number;
  hh: number;
  big: boolean;
}

/**
 * Rule 1: the ring, the tag and the small tag are all that building; each at least a finger across;
 * where they overlap, the one nearest the finger. A tag held under the finger comes before a ring, a
 * town's whole ring after what stands in it. Null: nothing there.
 */
export function tappedItem(items: readonly TapItem[], x: number, y: number): string | null {
  const within = (b: Box) => {
    const pad = (n: number) => Math.max(0, (FINGER_PT - n) / 2);
    return x >= b.x - pad(b.w) && x <= b.x + b.w + pad(b.w) && y >= b.y - pad(b.h) && y <= b.y + b.h + pad(b.h);
  };
  const nearest = (list: readonly { id: string; d: number }[]) => [...list].sort((a, b) => a.d - b.d)[0]?.id ?? null;
  const tags = items.flatMap((i) => (i.box !== null && within(i.box) ? [{ id: i.id, d: Math.hypot(i.box.x + i.box.w / 2 - x, i.box.y + i.box.h / 2 - y) }] : []));
  if (tags.length > 0) return nearest(tags);
  const rings = items.filter((i) => within(around(i.cx, i.cy, i.hw * 2, i.hh * 2)));
  const small = rings.filter((i) => !i.big);
  return nearest((small.length > 0 ? small : rings).map((i) => ({ id: i.id, d: Math.hypot(i.cx - x, i.cy - y) })));
}
