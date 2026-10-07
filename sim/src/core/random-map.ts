// Random 1 v 1 maps (D-074): a new map every game, fair to both sides by construction.
//
// The map is generated in "generation" coordinates with player 0 near the bottom-left corner,
// then turned or flipped as a whole to one of 8 orientations, so the starting corner is random
// too. Player 1 starts at the mirror image of player 0:
// - diagonal: the other end of the diagonal, mirrored across x <-> y (like the fixed map);
// - adjacent: the bottom-right corner, mirrored across the vertical midline.
// Everything is generated on player 0's side (the axis included) and copied to the other side.
// Towns on the axis (the big city) and the crystal vein are their own mirror images.
//
// The side is always odd (129 for "128"), so the midline is a whole column and a town centre
// on it is exactly between the two starts. The big city's 2 x 2 tower cannot sit on a
// one-column axis: on adjacent maps it leans one cell to a side the seed picks.
//
// Integer maths and the seeded Rng only (sqrt only for the second gold mine's offset, which
// IEEE 754 defines exactly).

import { type Frame, MIRROR_XY, invert, mirrorX, rotation, then, toCanon } from "../frame.ts";
import { NodeKind, Terrain, TownSize } from "../protocol.ts";
import { Rng } from "./fixed.ts";
import type { GameMap, NodeSpec, TownSpec } from "./map.ts";
import { NODE_AMOUNT, TOWNS } from "./rules.ts";

export type Layout = "diagonal" | "adjacent";

export interface RandomMap extends GameMap {
  layout: Layout;
  /** 0-3: quarter turns; 4-7: the x <-> y flip, then quarter turns. */
  orientation: number;
  /** The map's own symmetry in real coordinates: it carries player 0's side onto player 1's. */
  mirror: Frame;
}

export const RANDOM_MAP = {
  /** "128" (D-074); made odd, so 129. */
  size: 129,
  /** The big city plus 3 pairs: each side's home town, second town and one more (GDD: 6-8). */
  towns: 7,
};

/** Distances are in cells for a 129 map and scale with the side. */
const HOME_TOWN = { min: 26, max: 34 };
const SECOND_TOWN = { min: 45, max: 60 };
/** Any other town keeps this far from both main cities. */
const OTHER_TOWN_MIN = 40;
/** Town centres at least this far apart (mirror images included). */
const TOWN_GAP = 20;
const ATTEMPTS = 40;
const TRIES = 400;
/**
 * Militia posts in generation coordinates (scenarios.ts POSTS on the fixed map): the first 3, 6
 * and 12 (the militia of a small town after a revolt, a small town, a big city) are each closed
 * under the generation mirror, so a town and its mirror image get mirror-image militia.
 */
const POSTS_DIAGONAL = [
  [2, 0], [0, 2], [-2, -2], [-2, 0], [0, -2], [2, 2],
  [2, -2], [-2, 2], [3, 0], [0, 3], [-3, 0], [0, -3],
] as const;
const POSTS_ADJACENT = [
  [0, -2], [2, 0], [-2, 0], [0, 2], [2, 2], [-2, 2],
  [2, -2], [-2, -2], [3, 0], [-3, 0], [0, 3], [0, -3],
] as const;

interface Pt {
  x: number;
  y: number;
}

export function generateRandomMap(
  seed: number,
  size: number = RANDOM_MAP.size,
  towns: number = RANDOM_MAP.towns,
  layout?: Layout,
): RandomMap {
  const n = size | 1;
  const rng = new Rng(mix(seed));
  const coin = rng.below(2);
  const lay: Layout = layout ?? (coin === 0 ? "diagonal" : "adjacent");
  if (lay === "adjacent" && towns % 2 === 0) throw new Error("map: adjacent maps take an odd number of towns");
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    // The last attempt has no random rock or forest, so only the town layout can fail.
    const g = attemptMap(n, rng, lay, towns, attempt < ATTEMPTS - 1);
    if (g !== null) return orient(seed, g, rng.below(8), rng.below(2) === 1);
  }
  throw new Error(`map: no layout for seed ${seed}, size ${n}`);
}

/** A fixed integer hash, so neighbouring seeds give unrelated maps. */
export function mix(seed: number): number {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

interface Generated {
  n: number;
  layout: Layout;
  rock: Uint8Array;
  kind: Int8Array;
  spawns: Pt[];
  towns: { size: TownSize; x: number; y: number }[];
  tower: Pt;
  M: Frame;
}

function attemptMap(n: number, rng: Rng, layout: Layout, townCount: number, scatter: boolean): Generated | null {
  const s = n - 1;
  const a = s >> 1;
  const k = (d: number) => Math.trunc((d * n + 64) / 129);
  const M = layout === "diagonal" ? MIRROR_XY : mirrorX(n);
  const mir = (p: Pt): Pt => {
    const c = toCanon(M, p.x, p.y);
    return { x: c.u, y: c.v };
  };
  // > 0: player 0's side, 0: the axis, < 0: player 1's side.
  const side = (x: number, y: number) => (layout === "diagonal" ? y - x : a - x);
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < n && y < n;
  const mine = (x: number, y: number) => inside(x, y) && side(x, y) >= 0;

  const rock = new Uint8Array(n * n);
  const kind = new Int8Array(n * n).fill(-1);
  const reserved = new Uint8Array(n * n);

  const P0 = { x: 16, y: s - 17 };
  const P1 = rectImage(M, P0.x - 2, P0.y - 2, 4);
  const spawns = [P0, { x: P1.x + 2, y: P1.y + 2 }];
  // Distances in half cells: a main city's centre is a cell corner, a town's a cell centre.
  const spawnHalf = (p: Pt) => ({ x: 2 * p.x, y: 2 * p.y });
  const townHalf = (p: Pt) => ({ x: 2 * p.x + 1, y: 2 * p.y + 1 });
  const d2 = (p: Pt, q: Pt) => (p.x - q.x) * (p.x - q.x) + (p.y - q.y) * (p.y - q.y);
  const fromSpawn = (sp: Pt, t: Pt) => d2(spawnHalf(sp), townHalf(t));
  const within = (dd: number, lo: number, hi: number) => dd >= 4 * k(lo) * k(lo) && dd <= 4 * k(hi) * k(hi);
  const far = (dd: number, lo: number) => dd >= 4 * k(lo) * k(lo);

  const placed: { size: TownSize; x: number; y: number }[] = [];
  const clearOfTowns = (p: Pt) => placed.every((t) => far(d2(townHalf(p), townHalf(t)), TOWN_GAP));
  const inMargin = (p: Pt, size: TownSize) => {
    const m = TOWNS[size].radius + 3;
    return p.x >= m && p.y >= m && p.x <= s - m && p.y <= s - m;
  };
  const pick = (gen: () => Pt, ok: (p: Pt) => boolean): Pt | null => {
    for (let i = 0; i < TRIES; i++) {
      const p = gen();
      if (ok(p)) return p;
    }
    return null;
  };
  const anyCell = (): Pt => ({ x: rng.below(n), y: rng.below(n) });
  const onAxis = (spread: number): Pt => {
    const t = a - k(spread) + rng.below(2 * k(spread) + 1);
    return layout === "diagonal" ? { x: t, y: t } : { x: a, y: t };
  };
  // A town on player 0's side and its mirror image, both clear of every other town.
  const privatePair = (ok: (p: Pt) => boolean): Pt | null =>
    pick(anyCell, (p) => {
      if (!mine(p.x, p.y) || !inMargin(p, TownSize.Small) || !clearOfTowns(p) || !ok(p)) return false;
      const q = mir(p);
      return far(d2(townHalf(p), townHalf(q)), TOWN_GAP) && placed.every((t) => far(d2(townHalf(q), townHalf(t)), TOWN_GAP));
    });
  const addPair = (p: Pt) => {
    placed.push({ size: TownSize.Small, ...p }, { size: TownSize.Small, ...mir(p) });
  };

  const large = pick(
    () => onAxis(10),
    (p) => inMargin(p, TownSize.Large) && far(fromSpawn(P0, p), 24),
  );
  if (large === null) return null;
  placed.push({ size: TownSize.Large, ...large });
  const home = privatePair((p) => within(fromSpawn(P0, p), HOME_TOWN.min, HOME_TOWN.max));
  if (home === null) return null;
  addPair(home);
  const pairs: Pt[] = [home];
  for (let i = 1; i < (townCount - 1) >> 1; i++) {
    const p =
      i === 1
        ? privatePair((q) => within(fromSpawn(P0, q), SECOND_TOWN.min, SECOND_TOWN.max))
        : privatePair((q) => far(fromSpawn(P0, q), OTHER_TOWN_MIN));
    if (p === null) return null;
    addPair(p);
    pairs.push(p);
  }
  if (townCount % 2 === 0) {
    const p = pick(
      () => onAxis(52),
      (q) => inMargin(q, TownSize.Small) && clearOfTowns(q) && far(fromSpawn(P0, q), OTHER_TOWN_MIN),
    );
    if (p === null) return null;
    placed.push({ size: TownSize.Small, ...p });
  }

  // The crystal vein on the axis, 14-24 cells from the big city: 2 x 2 on the diagonal, 1 x 4
  // along a vertical axis (a 2 x 2 cannot be its own mirror image there).
  const vein = pick(
    () => {
      const d = k(14) + rng.below(k(10) + 1);
      const sgn = rng.below(2) === 0 ? -1 : 1;
      return layout === "diagonal" ? { x: large.x + sgn * d, y: large.y + sgn * d } : { x: a, y: large.y + sgn * d };
    },
    (p) => {
      const c = veinCells(layout, p);
      return c.every(([x, y]) => x >= 6 && y >= 6 && x <= s - 6 && y <= s - 6) &&
        placed.every((t) => d2(p, t) >= (TOWNS[t.size].radius + 4) * (TOWNS[t.size].radius + 4));
    },
  );
  if (vein === null) return null;

  // Reserved: kept clear of rock and forest.
  const reserveDisc = (cx: number, cy: number, r: number) => {
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        if (inside(x, y) && (x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r) reserved[y * n + x] = 1;
      }
    }
  };
  // Straight corridor, 3 cells wide, integer DDA.
  const reserveLine = (p: Pt, q: Pt) => {
    const steps = Math.max(Math.abs(q.x - p.x), Math.abs(q.y - p.y), 1);
    for (let i = 0; i <= steps; i++) {
      reserveDisc(p.x + Math.trunc(((q.x - p.x) * i) / steps), p.y + Math.trunc(((q.y - p.y) * i) / steps), 1);
    }
  };
  reserveDisc(P0.x, P0.y, 9);
  for (const t of placed) if (mine(t.x, t.y)) reserveDisc(t.x, t.y, TOWNS[t.size].radius + 2);
  reserveDisc(vein.x, vein.y, 3);
  const nearest = (p: Pt, options: Pt[]) =>
    options.reduce((b, o) => (d2(p, o) < d2(p, b) ? o : b), options[0]);
  reserveLine(P0, home);
  reserveLine(home, large);
  reserveLine(large, vein);
  for (let i = 1; i < pairs.length; i++) {
    if (i === 1) reserveLine(P0, pairs[i]);
    reserveLine(pairs[i], nearest(pairs[i], [large, ...pairs.slice(0, i)]));
  }
  for (const t of placed) if (t.size === TownSize.Small && side(t.x, t.y) === 0) reserveLine(t, nearest(t, [large, ...pairs]));

  const free = (x: number, y: number) => mine(x, y) && reserved[y * n + x] === 0 && rock[y * n + x] === 0 && kind[y * n + x] === -1;
  const setNode = (x: number, y: number, kd: NodeKind) => {
    if (free(x, y)) kind[y * n + x] = kd;
  };
  const blob = (cx: number, cy: number, r: number, paint: (x: number, y: number) => void) => {
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r + 1) paint(x, y);
      }
    }
  };
  const block = (x: number, y: number, w: number, h: number) => {
    const cells: [number, number][] = [];
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) cells.push([x + i, y + j]);
    return cells;
  };

  // Player 0's home, as on the fixed map: two forests, a gold mine, berries.
  blob(P0.x - 10, P0.y - 8, 4, (x, y) => setNode(x, y, NodeKind.Tree));
  blob(P0.x + 8, P0.y + 13, 4, (x, y) => setNode(x, y, NodeKind.Tree));
  for (const [x, y] of block(P0.x + 10, P0.y + 6, 2, 2)) kind[y * n + x] = NodeKind.GoldMine;
  for (const [x, y] of block(P0.x - 8, P0.y + 8, 3, 2)) kind[y * n + x] = NodeKind.Berries;
  // A second gold mine beside the way to the home town, about half way.
  {
    const dx = home.x - P0.x;
    const dy = home.y - P0.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    const mx = P0.x + (dx >> 1);
    const my = P0.y + (dy >> 1);
    const first = rng.below(2) === 0 ? 1 : -1;
    let done = false;
    for (const off of [6, 8, 10]) {
      for (const sgn of [first, -first]) {
        if (done) continue;
        const gx = mx + Math.trunc((-dy * off * sgn) / len);
        const gy = my + Math.trunc((dx * off * sgn) / len);
        const cells = block(gx, gy, 2, 2);
        if (cells.every(([x, y]) => free(x, y))) {
          for (const [x, y] of cells) kind[y * n + x] = NodeKind.GoldMine;
          done = true;
        }
      }
    }
    if (!done) return null;
  }
  // A gold mine 8-10 cells from the second town (the third town's: every other map).
  const goldNear = (t: Pt): boolean => {
    const p = pick(anyCell, (q) => {
      const dd = d2(q, t);
      return dd >= 64 && dd <= 100 && block(q.x, q.y, 2, 2).every(([x, y]) => free(x, y));
    });
    if (p === null) return false;
    for (const [x, y] of block(p.x, p.y, 2, 2)) kind[y * n + x] = NodeKind.GoldMine;
    return true;
  };
  if (pairs.length > 1 && !goldNear(pairs[1])) return null;
  if (pairs.length > 2 && rng.below(2) === 0 && !goldNear(pairs[2])) return null;

  // Random rock and forest on player 0's side, about as dense as the fixed map.
  if (scatter) {
    const area = n * n;
    const centre = (): Pt | null => pick(anyCell, (p) => mine(p.x, p.y));
    for (let i = 0, count = Math.trunc((11 * area) / 16641); i < count; i++) {
      const c = centre();
      if (c === null) continue;
      const r = 1 + rng.below(3);
      blob(c.x, c.y, r, (x, y) => {
        if (free(x, y)) rock[y * n + x] = 1;
      });
    }
    for (let i = 0, count = Math.trunc((16 * area) / 16641); i < count; i++) {
      const c = centre();
      if (c === null) continue;
      const r = 2 + rng.below(3);
      blob(c.x, c.y, r, (x, y) => setNode(x, y, NodeKind.Tree));
    }
  }

  // Player 0's side onto player 1's.
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (side(x, y) >= 0) continue;
      const m = mir({ x, y });
      rock[y * n + x] = rock[m.y * n + m.x];
      kind[y * n + x] = kind[m.y * n + m.x];
    }
  }
  for (const [x, y] of veinCells(layout, vein)) kind[y * n + x] = NodeKind.CrystalVein;

  // Fill what the starts cannot reach (4-connected over open, node-free cells).
  const passable = (i: number) => rock[i] === 0 && kind[i] === -1;
  const seen = new Uint8Array(n * n);
  const queue = new Int32Array(n * n);
  let head = 0;
  let tail = 0;
  seen[P0.y * n + P0.x] = 1;
  queue[tail++] = P0.y * n + P0.x;
  while (head < tail) {
    const c = queue[head++];
    const x = c % n;
    const y = (c - x) / n;
    for (const nb of [x + 1 < n ? c + 1 : -1, x > 0 ? c - 1 : -1, y + 1 < n ? c + n : -1, y > 0 ? c - n : -1]) {
      if (nb < 0 || seen[nb] === 1 || !passable(nb)) continue;
      seen[nb] = 1;
      queue[tail++] = nb;
    }
  }
  for (let i = 0; i < n * n; i++) if (passable(i) && seen[i] === 0) rock[i] = 1;
  if (seen[spawns[1].y * n + spawns[1].x] !== 1) return null;
  for (const t of placed) if (seen[t.y * n + t.x] !== 1) return null;
  for (let i = 0; i < n * n; i++) {
    if (kind[i] === -1 || kind[i] === NodeKind.Tree) continue;
    const x = i % n;
    const y = (i - x) / n;
    const nbs = [x + 1 < n ? i + 1 : -1, x > 0 ? i - 1 : -1, y + 1 < n ? i + n : -1, y > 0 ? i - n : -1];
    if (!nbs.some((nb) => nb >= 0 && seen[nb] === 1) && !interior(kind, n, x, y)) return null;
  }

  // The tower's 2 x 2 footprint: centred on the diagonal; one cell to a seeded side of a vertical axis.
  const lean = layout === "adjacent" ? rng.below(2) : 1;
  const tower = { x: large.x - lean, y: large.y - 1 };
  return { n, layout, rock, kind, spawns, towns: placed, tower, M };
}

function veinCells(layout: Layout, p: Pt): [number, number][] {
  return layout === "diagonal"
    ? [[p.x, p.y], [p.x + 1, p.y], [p.x, p.y + 1], [p.x + 1, p.y + 1]]
    : [[p.x, p.y - 2], [p.x, p.y - 1], [p.x, p.y], [p.x, p.y + 1]];
}

/** Top-left cell of the image of a size x size footprint. */
function rectImage(f: Frame, x: number, y: number, size: number): Pt {
  const p = toCanon(f, x, y);
  const q = toCanon(f, x + size - 1, y + size - 1);
  return { x: Math.min(p.u, q.u), y: Math.min(p.v, q.v) };
}

/**
 * Turn or flip the generated map into place; frames carry each side back onto player 0's.
 * Canonically each player starts bottom-left and the enemy is top-right (diagonal) or
 * bottom-right (adjacent). On adjacent maps `across` flips the canonical frames of both players
 * across the anti-diagonal (the enemy is then top-left), so a frame does not tell which
 * neighbouring corner the enemy is in.
 */
function orient(seed: number, g: Generated, orientation: number, across: boolean): RandomMap {
  const n = g.n;
  const R = orientation < 4 ? rotation(orientation, n) : then(MIRROR_XY, rotation(orientation - 4, n));
  const terrain = new Uint8Array(n * n);
  const kind = new Int8Array(n * n).fill(-1);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const r = toCanon(R, x, y);
      terrain[r.v * n + r.u] = g.rock[y * n + x] === 1 ? Terrain.Blocked : Terrain.Open;
      kind[r.v * n + r.u] = g.kind[y * n + x];
    }
  }
  const nodes: NodeSpec[] = [];
  for (let i = 0; i < n * n; i++) {
    const kd = kind[i];
    if (kd === -1) continue;
    const amount =
      kd === NodeKind.Tree
        ? NODE_AMOUNT.tree
        : kd === NodeKind.GoldMine
          ? NODE_AMOUNT.goldCell
          : kd === NodeKind.Berries
            ? NODE_AMOUNT.bush
            : NODE_AMOUNT.crystalCell;
    nodes.push({ kind: kd as NodeKind, cellX: i % n, cellY: Math.trunc(i / n), amount });
  }
  const spawns = g.spawns.map((p, player) => {
    const r = rectImage(R, p.x - 2, p.y - 2, 4);
    return { player, cellX: r.x + 2, cellY: r.y + 2 };
  });
  const towns: TownSpec[] = g.towns.map((t, id) => {
    const r = toCanon(R, t.x, t.y);
    return { id, size: t.size, cellX: r.u, cellY: r.v, radius: TOWNS[t.size].radius };
  });
  const tw = rectImage(R, g.tower.x, g.tower.y, 2);
  const flip: Frame = g.layout === "adjacent" && across ? { m: [0, -1, -1, 0], t: [n - 1, n - 1] } : { m: [1, 0, 0, 1], t: [0, 0] };
  const back = then(invert(R), flip);
  const [a, b, c, d] = R.m;
  const posts = (g.layout === "diagonal" ? POSTS_DIAGONAL : POSTS_ADJACENT).map(([dx, dy]) => [(a * dx + b * dy) | 0, (c * dx + d * dy) | 0] as const);
  return {
    seed,
    size: n,
    terrain,
    nodes,
    spawns,
    towns,
    tower: { cellX: tw.x, cellY: tw.y },
    frames: [back, then(then(invert(R), g.M), flip)],
    mode: "random",
    posts,
    layout: g.layout,
    orientation,
    mirror: then(then(invert(R), g.M), R),
  };
}

/** A node surrounded by same-kind nodes on all four sides is reached through its neighbours. */
function interior(kind: Int8Array, n: number, x: number, y: number): boolean {
  const kd = kind[y * n + x];
  return [[1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dy]) => {
    const nx = x + dx;
    const ny = y + dy;
    return nx >= 0 && ny >= 0 && nx < n && ny < n && kind[ny * n + nx] === kd;
  });
}
