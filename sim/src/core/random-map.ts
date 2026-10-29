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
// on it is exactly between the two starts. A 2 x 2 tower cannot sit on a one-column axis, so on
// adjacent maps the big city's tower is 3 x 3 (GameMap.towerSize), centred on the town; its hp,
// range and damage stay the same.
//
// The towns' castles (D-089) are stamped in generation coordinates after the mirror copy, before
// the fill of what the starts cannot reach; a square round each castle and the way out of each gate
// are kept clear of rock, forest and resources.
//
// Natural obstacles (R6-51) go on player 0's side with the rest: a river from the map's edge to the
// axis with bridges and fords where it meets the ways between the towns, a lake, rock ridges with
// a gap, a cliff, rock heaps and dense forest. A map whose walks come out too long (main city to
// main city more than 1.40 times the open walk, to a town more than 1.60) is drawn again.
//
// Integer maths and the seeded Rng only (sqrt only for the second gold mine's offset and the
// obstacles' directions, which IEEE 754 defines exactly).

import { type Frame, MIRROR_XY, invert, mirrorX, rotation, then, toCanon } from "../frame.ts";
import { crossingTerrain, NodeKind, Terrain, TownSize, walkableTerrain } from "../protocol.ts";
import { dir16, Rng } from "./fixed.ts";
import { type CastleMap, castleOf } from "./castle.ts";
import { farTrees, type GameMap, type NodeSpec, stampCastles, type TownSpec, turnedTerrain } from "./map.ts";
import { forestCells, homeForests } from "./forests.ts";
import { KEEP, NODE_AMOUNT, RICH, TOWNS } from "./rules.ts";

export type Layout = "diagonal" | "adjacent";

/**
 * Water a castle's walls left 1 cell wide becomes open ground (ceo 2026-10-29: D-100's bigger castles cut a
 * river's corner on seed 30): a water cell beside a wall (8 round it) in no 2 x 2 of water and crossings, round after
 * round until none is left. The same rule turned or mirrored, so the map stays its own mirror image. On; off only for
 * the tests that compare the maps without it.
 */
export const WATER_TRIM = { on: true };

function trimWater(n: number, ground: Uint8Array, wall: Uint8Array): void {
  const wet = (x: number, y: number) => x >= 0 && y >= 0 && x < n && y < n && wall[y * n + x] === 0 && (ground[y * n + x] === Terrain.Water || crossingTerrain(ground[y * n + x]));
  const byWall = (x: number, y: number) => {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (x + dx >= 0 && y + dy >= 0 && x + dx < n && y + dy < n && wall[(y + dy) * n + x + dx] === 1) return true;
    return false;
  };
  const in2x2 = (x: number, y: number) =>
    [[0, 0], [-1, 0], [0, -1], [-1, -1]].some(([dx, dy]) => wet(x + dx, y + dy) && wet(x + dx + 1, y + dy) && wet(x + dx, y + dy + 1) && wet(x + dx + 1, y + dy + 1));
  // Each round from the map as it was at its start (not cell by cell), so the order of the cells does not count.
  for (;;) {
    const dry: number[] = [];
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const i = y * n + x;
        if (wall[i] === 0 && ground[i] === Terrain.Water && !in2x2(x, y) && byWall(x, y)) dry.push(i);
      }
    }
    if (dry.length === 0) return;
    for (const i of dry) ground[i] = Terrain.Open;
  }
}

export interface RandomMap extends GameMap {
  layout: Layout;
  /** 0-3: quarter turns; 4-7: the x <-> y flip, then quarter turns. */
  orientation: number;
  /** The map's own symmetry in real coordinates: it carries player 0's side onto player 1's. */
  mirror: Frame;
  /** How many draws were thrown away before this one (R6-51's measurement); ATTEMPTS - 1 or more: a plain draw. */
  redraws: number;
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
/** The same with KEEP on (D-100): the castles are 15 and 19 cells across instead of 11 and 14. */
const TOWN_GAP_KEEP = 26;
export const ATTEMPTS = 40;
const TRIES = 400;
/** The longest walks a map may have, against the open walk (D-089 / R6-51, ceo 2026-10-20). */
export const WALK_CAPS = { mainCity: 1.4, town: 1.6 };
/** Why draws were thrown away, counted over every map made (R6-51's measurement; not game state). */
export const THROWN_AWAY: Record<string, number> = {};
const away = (why: string): null => {
  THROWN_AWAY[why] = (THROWN_AWAY[why] ?? 0) + 1;
  return null;
};
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
  for (let attempt = 0; attempt < 2 * ATTEMPTS; attempt++) {
    // From the last attempt on, no obstacles, random rock or forest: only the town layout can fail.
    const g = attemptMap(n, rng, lay, towns, attempt < ATTEMPTS - 1);
    if (g !== null) return orient(seed, g, rng.below(8), rng.below(2) === 1, attempt);
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
  /** Castle walls (D-089). */
  wall: Uint8Array;
  /** Water, fords, bridges and cliffs (R6-51): Terrain values, 0 elsewhere. */
  ground: Uint8Array;
  kind: Int8Array;
  spawns: Pt[];
  towns: { size: TownSize; x: number; y: number }[];
  tower: Pt;
  towerSize: number;
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
  /** The 3-cell ways between the towns (also reserved): a river crosses them by a ford or a bridge. */
  const corridor = new Uint8Array(n * n);
  const ground = new Uint8Array(n * n);
  const crossingEnds: number[] = [];

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
  const clearOfTowns = (p: Pt) => placed.every((t) => far(d2(townHalf(p), townHalf(t)), KEEP.on ? TOWN_GAP_KEEP : TOWN_GAP));
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
  if (large === null) return away("big city");
  placed.push({ size: TownSize.Large, ...large });
  const home = privatePair((p) => within(fromSpawn(P0, p), HOME_TOWN.min, HOME_TOWN.max));
  if (home === null) return away("home town");
  addPair(home);
  const pairs: Pt[] = [home];
  for (let i = 1; i < (townCount - 1) >> 1; i++) {
    const p =
      i === 1
        ? privatePair((q) => within(fromSpawn(P0, q), SECOND_TOWN.min, SECOND_TOWN.max))
        : privatePair((q) => far(fromSpawn(P0, q), OTHER_TOWN_MIN));
    if (p === null) return away("other town");
    addPair(p);
    pairs.push(p);
  }
  if (townCount % 2 === 0) {
    const p = pick(
      () => onAxis(52),
      (q) => inMargin(q, TownSize.Small) && clearOfTowns(q) && far(fromSpawn(P0, q), OTHER_TOWN_MIN),
    );
    if (p === null) return away("other town");
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
  if (vein === null) return away("crystal vein");

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
      const cx = p.x + Math.trunc(((q.x - p.x) * i) / steps);
      const cy = p.y + Math.trunc(((q.y - p.y) * i) / steps);
      reserveDisc(cx, cy, 1);
      for (let y = cy - 1; y <= cy + 1; y++) for (let x = cx - 1; x <= cx + 1; x++) if (inside(x, y) && (x - cx) * (x - cx) + (y - cy) * (y - cy) <= 1) corridor[y * n + x] = 1;
    }
  };
  // The castles (D-089) in generation coordinates: the tower's top-left is at the big city's centre - 1.
  // D-100 (KEEP): every town's keep 3 x 3 on its centre cell.
  const towerSize = KEEP.on || layout === "adjacent" ? 3 : 2;
  const tower = { x: large.x - 1, y: large.y - 1 };
  const castles: CastleMap = { tower: { cellX: tower.x, cellY: tower.y }, towerSize, towns: placed.map((t) => ({ size: t.size, cellX: t.x, cellY: t.y })) };
  reserveDisc(P0.x, P0.y, 9);
  // A square two cells round each castle's walls, and five cells out from each gate.
  for (const t of placed) {
    const c = castleOf(t.size, castles);
    for (let y = t.y + c.inside.y0 - 3; y <= t.y + c.inside.y1 + 3; y++) {
      for (let x = t.x + c.inside.x0 - 3; x <= t.x + c.inside.x1 + 3; x++) if (inside(x, y)) reserved[y * n + x] = 1;
    }
    c.gate.forEach(([gx, gy], i) => {
      const [ox, oy] = c.outside[i];
      for (let k = 1; k <= 5; k++) {
        const x = t.x + gx + (ox - gx) * k;
        const y = t.y + gy + (oy - gy) * k;
        if (inside(x, y)) reserved[y * n + x] = 1;
      }
    });
  }
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
  // D-101 (RICH.forests): more forests by the main city, its back to the map's middle first.
  if (RICH.on && RICH.forests > 0) {
    const back = dir16(P0.x - (n >> 1), P0.y - (n >> 1));
    for (const [cx, cy] of homeForests(P0.x, P0.y, RICH.forests, back, (x, y) => inside(x, y) && free(x, y))) for (const [x, y] of forestCells(cx, cy)) setNode(x, y, NodeKind.Tree);
  }
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
    if (!done) return away("second gold mine");
  }
  // A gold mine 8-10 cells from the second town (the third town's: every other map); with KEEP on
  // (D-100) 10-12, as far out from the walls (2 cells further out).
  const goldNear = (t: Pt): boolean => {
    const [lo, hi] = KEEP.on ? [10, 12] : [8, 10];
    const p = pick(anyCell, (q) => {
      const dd = d2(q, t);
      return dd >= lo * lo && dd <= hi * hi && block(q.x, q.y, 2, 2).every(([x, y]) => free(x, y));
    });
    if (p === null) return false;
    for (const [x, y] of block(p.x, p.y, 2, 2)) kind[y * n + x] = NodeKind.GoldMine;
    return true;
  };
  if (pairs.length > 1 && !goldNear(pairs[1])) return away("gold by a town");
  // D-101 (RICH.contested): by the third town on every map, where it fits (the map is not drawn again for it).
  if (RICH.on && RICH.contested) {
    if (pairs.length > 2) goldNear(pairs[2]);
  } else if (pairs.length > 2 && rng.below(2) === 0 && !goldNear(pairs[2])) return away("gold by a town");
  // D-101 (RICH.contested): contested gold on the axis, the big city's other side from the vein, shaped as
  // the vein (its own mirror image), as far from the towns as the vein is.
  if (RICH.on && RICH.contested) {
    const away1 = vein.y > large.y || (vein.y === large.y && vein.x > large.x) ? -1 : 1;
    const p = pick(
      () => {
        const d = k(14) + rng.below(k(10) + 1);
        return layout === "diagonal" ? { x: large.x + away1 * d, y: large.y + away1 * d } : { x: a, y: large.y + away1 * d };
      },
      (q) => {
        const c = veinCells(layout, q);
        return c.every(([x, y]) => x >= 6 && y >= 6 && x <= s - 6 && y <= s - 6 && reserved[y * n + x] === 0 && rock[y * n + x] === 0 && kind[y * n + x] === -1) &&
          placed.every((t) => d2(q, t) >= (TOWNS[t.size].radius + 4) * (TOWNS[t.size].radius + 4));
      },
    );
    if (p === null) return away("contested gold");
    for (const [x, y] of veinCells(layout, p)) kind[y * n + x] = NodeKind.GoldMine;
  }

  // Natural obstacles (R6-51), then random rock and forest, on player 0's side.
  if (scatter) {
    const mid = { x: (spawns[0].x + spawns[1].x) >> 1, y: (spawns[0].y + spawns[1].y) >> 1 };
    obstacles({ n, rng, layout, mine, side, reserved, corridor, rock, kind, ground, free, setNode, blob, k, p0: P0, mid, crossingEnds });
  }
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
      // Across the diagonal a bridge's way turns (north-south becomes east-west).
      ground[y * n + x] = layout === "diagonal" ? turnedTerrain(ground[m.y * n + m.x]) : ground[m.y * n + m.x];
    }
  }
  for (const [x, y] of veinCells(layout, vein)) kind[y * n + x] = NodeKind.CrystalVein;
  const wall = stampCastles(n, rock, kind, castles);
  if (WATER_TRIM.on) trimWater(n, ground, wall);

  // Fill what the starts cannot reach (4-connected over open, node-free cells; fords and bridges
  // are walked).
  const passable = (i: number) => rock[i] === 0 && kind[i] === -1 && wall[i] === 0 && walkableTerrain(ground[i]);
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
  if (seen[spawns[1].y * n + spawns[1].x] !== 1) return away("main city cut off");
  for (const t of placed) if (seen[t.y * n + t.x] !== 1) return away("town cut off");
  for (let i = 0; i < n * n; i++) {
    if (kind[i] === -1 || kind[i] === NodeKind.Tree) continue;
    const x = i % n;
    const y = (i - x) / n;
    const nbs = [x + 1 < n ? i + 1 : -1, x > 0 ? i - 1 : -1, y + 1 < n ? i + n : -1, y > 0 ? i - n : -1];
    if (!nbs.some((nb) => nb >= 0 && seen[nb] === 1) && !interior(kind, n, x, y)) return away("resource cut off");
  }
  // Every forest has a tree farmers can walk up to (R6-51: dense forest and water must not shut
  // one in); every gate is reached from outside.
  if (!forestsReached(n, kind, seen)) return away("forest cut off");
  // Both ends of every ford and bridge are reached (a crossing to nowhere would be filled in).
  for (const i of crossingEnds) if (seen[i] !== 1) return away("crossing cut off");
  for (const t of placed) {
    const c = castleOf(t.size, castles);
    for (const [dx, dy] of c.outside) if (seen[(t.y + dy) * n + t.x + dx] !== 1) return away("gate cut off");
  }
  // Walks no longer than the caps, trees standing (R6-51); the other side is the mirror image.
  if (scatter) {
    const blocked = new Uint8Array(n * n);
    for (let i = 0; i < n * n; i++) if (!passable(i)) blocked[i] = 1;
    for (const sp of spawns) for (let y = sp.y - 2; y < sp.y + 2; y++) for (let x = sp.x - 2; x < sp.x + 2; x++) blocked[y * n + x] = 0;
    for (let y = tower.y; y < tower.y + towerSize; y++) for (let x = tower.x; x < tower.x + towerSize; x++) blocked[y * n + x] = 0;
    // From each of the 4 cells round the main city's centre (a cell corner): once the map is turned,
    // any of them can be the one a walk is measured from.
    for (const [ox, oy] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) {
      const from = { x: P0.x + ox, y: P0.y + oy };
      const dist = octileWalk(n, blocked, from.y * n + from.x);
      const ratio = (q: Pt) => dist[q.y * n + q.x] / openWalk(from, q);
      for (const [qx, qy] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) if (ratio({ x: spawns[1].x + qx, y: spawns[1].y + qy }) > WALK_CAPS.mainCity) return away("main city walk");
      for (const t of placed) if (ratio(t) > WALK_CAPS.town) return away("town walk");
    }
  }

  // The tower: 2 x 2 with its centre on the town centre's top-left corner, on the diagonal; 3 x 3
  // centred on the town centre on a vertical axis. Either way its own mirror image.
  return { n, layout, rock, wall, ground, kind, spawns, towns: placed, tower, towerSize, M };
}

/** The walk with nothing in the way, in octile steps (10 straight, 14 diagonal). */
function openWalk(p: Pt, q: Pt): number {
  const ax = Math.abs(q.x - p.x);
  const ay = Math.abs(q.y - p.y);
  return Math.max(ax, ay) * 10 + Math.min(ax, ay) * 4;
}

/** Walks from `from` in octile steps (10 / 14) over cells not blocked, never cutting a blocked corner. */
function octileWalk(n: number, blocked: Uint8Array, from: number): Int32Array {
  const dist = new Int32Array(n * n).fill(1 << 30);
  const buckets: number[][] = [[from]];
  dist[from] = 0;
  for (let d = 0; d < buckets.length; d++) {
    const b = buckets[d];
    if (b === undefined) continue;
    for (const c of b) {
      if (dist[c] !== d) continue;
      const x = c % n;
      const y = (c - x) / n;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if ((dx === 0 && dy === 0) || nx < 0 || ny < 0 || nx >= n || ny >= n || blocked[ny * n + nx] === 1) continue;
          if (dx !== 0 && dy !== 0 && (blocked[y * n + nx] === 1 || blocked[ny * n + x] === 1)) continue;
          const nd = d + (dx !== 0 && dy !== 0 ? 14 : 10);
          if (nd < dist[ny * n + nx]) {
            dist[ny * n + nx] = nd;
            (buckets[nd] ??= []).push(ny * n + nx);
          }
        }
      }
    }
  }
  return dist;
}

/** Every 4-connected group of trees has a tree with a reached (seen) neighbour. */
function forestsReached(n: number, kind: Int8Array, seen: Uint8Array): boolean {
  const done = new Uint8Array(n * n);
  for (let i = 0; i < n * n; i++) {
    if (kind[i] !== NodeKind.Tree || done[i] === 1) continue;
    let reached = false;
    const stack = [i];
    done[i] = 1;
    while (stack.length > 0) {
      const c = stack.pop()!;
      const x = c % n;
      for (const nb of [x + 1 < n ? c + 1 : -1, x > 0 ? c - 1 : -1, c + n < n * n ? c + n : -1, c - n]) {
        if (nb < 0) continue;
        if (seen[nb] === 1) reached = true;
        if (kind[nb] === NodeKind.Tree && done[nb] === 0) {
          done[nb] = 1;
          stack.push(nb);
        }
      }
    }
    if (!reached) return false;
  }
  return true;
}

interface ObstacleScope {
  n: number;
  rng: Rng;
  layout: Layout;
  mine: (x: number, y: number) => boolean;
  side: (x: number, y: number) => number;
  reserved: Uint8Array;
  corridor: Uint8Array;
  rock: Uint8Array;
  kind: Int8Array;
  ground: Uint8Array;
  free: (x: number, y: number) => boolean;
  setNode: (x: number, y: number, kd: NodeKind) => void;
  blob: (cx: number, cy: number, r: number, paint: (x: number, y: number) => void) => void;
  k: (d: number) => number;
  /** Player 0's main city, and the middle of the way between the two main cities. */
  p0: Pt;
  mid: Pt;
  /** Filled in: the cells just beyond each end of each crossing (they must be reached). */
  crossingEnds: number[];
}

/**
 * R6-51's obstacles on player 0's side (the caller mirrors them). Across the way from the main city
 * to the middle of the map (so the walk between the main cities gets longer): a river 2-3 cells
 * wide across player 0's side, crossed by two or three bridges or fords 3 cells wide (a bridge
 * first); rock ridges 1-2 wide with a 3-cell gap; a cliff 1 cell wide. Anywhere: a lake, rock heaps and dense forest (trees, 甲). Off the castles, the
 * main city, the resources and (but for the river's crossings) the ways.
 */
function obstacles(o: ObstacleScope): void {
  const { n, rng, mine, side, reserved, corridor, rock, kind, ground, free, setNode, blob, p0, mid, crossingEnds } = o;
  const s = n - 1;
  const area = n * n;
  const per = (count: number) => Math.max(1, Math.trunc((count * area) / 16641));
  const at = (x: number, y: number) => y * n + x;
  // A cell next to (or on) a resource other than trees: obstacles keep off it, so every mine,
  // bush and vein keeps an open side.
  const byResource = new Uint8Array(area);
  for (let i = 0; i < area; i++) {
    if (kind[i] === -1 || kind[i] === NodeKind.Tree) continue;
    const x = i % n;
    const y = Math.trunc(i / n);
    for (let yy = Math.max(0, y - 1); yy <= Math.min(s, y + 1); yy++) for (let xx = Math.max(0, x - 1); xx <= Math.min(s, x + 1); xx++) byResource[at(xx, yy)] = 1;
  }
  const line = (p: Pt, q: Pt, each: (x: number, y: number, i: number, steps: number) => void) => {
    const steps = Math.max(Math.abs(q.x - p.x), Math.abs(q.y - p.y), 1);
    for (let i = 0; i <= steps; i++) each(p.x + Math.trunc(((q.x - p.x) * i) / steps), p.y + Math.trunc(((q.y - p.y) * i) / steps), i, steps);
  };
  const cell = (): Pt => ({ x: rng.below(n), y: rng.below(n) });
  const minePt = (): Pt | null => {
    for (let i = 0; i < TRIES; i++) {
      const p = cell();
      if (mine(p.x, p.y)) return p;
    }
    return null;
  };

  // A line across the way from the main city to the middle, `permille` of the way out (give or take
  // 6 cells), tilted up to 30 degrees: its centre and the point `len` cells along it from there.
  const across = (permille: number) => {
    const dx = mid.x - p0.x;
    const dy = mid.y - p0.y;
    const c = { x: p0.x + Math.trunc((dx * permille) / 1000) + rng.below(13) - 6, y: p0.y + Math.trunc((dy * permille) / 1000) + rng.below(13) - 6 };
    const tilt = rng.below(7) - 3;
    const px = -dy + Math.trunc((dx * tilt) / 6);
    const py = dx + Math.trunc((dy * tilt) / 6);
    const norm = Math.sqrt(px * px + py * py);
    const to = (len: number): Pt => ({ x: c.x + Math.trunc((px * len) / norm), y: c.y + Math.trunc((py * len) / norm) });
    return { c, to };
  };

  // --- the river, across player 0's side -------------------------------------------------------------
  for (let tries = 0; tries < 8; tries++) if (river()) break;
  function river(): boolean {
    const { c, to } = across(300 + rng.below(301));
    const width = 2 + rng.below(2);
    // Off the castles, the main city, the vein and every resource; across the ways only.
    const wettable = (x: number, y: number) => {
      for (let yy = y; yy < y + width; yy++) {
        for (let xx = x; xx < x + width; xx++) {
          if (!mine(xx, yy)) continue;
          const i = at(xx, yy);
          if ((reserved[i] === 1 && corridor[i] === 0) || kind[i] !== -1 || byResource[i] === 1) return false;
        }
      }
      return true;
    };
    if (!mine(c.x, c.y) || !wettable(c.x, c.y)) return false;
    // Out both ways to the edge of player 0's side (the map's edge or the axis), or to the first
    // thing it must keep off (it ends there, by a castle or a resource).
    const end = (sgn: number): Pt => {
      let len = 0;
      while (len < 2 * n) {
        const q = to(sgn * (len + 1));
        if (!mine(q.x, q.y) || !wettable(q.x, q.y)) break;
        len++;
      }
      return to(sgn * len);
    };
    const e1 = end(1);
    const e2 = end(-1);
    if (Math.max(Math.abs(e1.x - e2.x), Math.abs(e1.y - e2.y)) < 12) return false;
    const water = new Uint8Array(area);
    for (const [p, q] of [[c, e1], [c, e2]] as const) {
      line(p, q, (cx, cy) => {
        for (let y = cy; y < cy + width; y++) for (let x = cx; x < cx + width; x++) if (mine(x, y)) water[at(x, y)] = 1;
      });
    }
    // Two or three crossings anywhere along it, 12 cells apart or more (not just where it meets a
    // way: those ways would be the walk's shortcut over it).
    const crossings: Pt[] = [];
    const want = 2 + rng.below(2);
    for (let tries = 0; crossings.length < want && tries < TRIES; tries++) {
      const i = rng.below(area);
      if (water[i] !== 1) continue;
      const p = { x: i % n, y: Math.trunc(i / n) };
      if (crossings.every((c) => Math.abs(c.x - p.x) + Math.abs(c.y - p.y) > 12)) crossings.push(p);
    }
    if (crossings.length < 2) return false;
    const kinds: number[] = [];
    const bands: number[][] = [];
    const ends: number[] = [];
    for (const [j, c] of crossings.entries()) {
      const band = crossingBand(water, c);
      if (band === null) return false;
      bands.push(band.cells);
      ends.push(...band.ends);
      kinds.push(j % 2 === 1 ? Terrain.Ford : band.ns ? Terrain.BridgeNS : Terrain.BridgeEW);
    }
    for (let i = 0; i < area; i++) if (water[i] === 1) ground[i] = Terrain.Water;
    bands.forEach((b, j) => {
      for (const i of b) ground[i] = kinds[j];
    });
    // Two rows of open ground beyond each end, kept clear of rock and forest (ui's bridges have them
    // on the fixed map too).
    for (const i of ends) if (ground[i] === 0) reserved[i] = 1;
    crossingEnds.push(...ends.filter((i) => ground[i] === 0 && rock[i] === 0 && kind[i] === -1));
    for (let i = 0; i < area; i++) {
      if (ground[i] === 0) continue;
      rock[i] = 0;
      kind[i] = -1;
    }
    return true;
  }
  /**
   * A crossing 3 cells wide through the river at c, north-south or east-west, whichever is shorter
   * (at most 4 cells of water a line), with walkable ground at both ends and 3 cells off the axis.
   */
  function crossingBand(water: Uint8Array, c: Pt): { ns: boolean; cells: number[]; ends: number[] } | null {
    let best: { ns: boolean; cells: number[]; ends: number[]; len: number } | null = null;
    for (const ns of [true, false]) {
      const cells: number[] = [];
      const ends: number[] = [];
      let len = 0;
      let ok = true;
      for (let j = -1; j <= 1 && ok; j++) {
        // Along the way: from c, back and forth to the river's banks.
        const px = ns ? c.x + j : c.x;
        const py = ns ? c.y : c.y + j;
        const step = (d: number) => (ns ? { x: px, y: py + d } : { x: px + d, y: py });
        const wet = (q: Pt) => q.x >= 0 && q.y >= 0 && q.x < n && q.y < n && water[at(q.x, q.y)] === 1;
        if (!wet(step(0))) {
          ok = false;
          break;
        }
        let lo = 0;
        let hi = 0;
        while (wet(step(lo - 1))) lo--;
        while (wet(step(hi + 1))) hi++;
        len = Math.max(len, hi - lo + 1);
        for (const e of [step(lo - 1), step(hi + 1)]) {
          if (e.x < 0 || e.y < 0 || e.x >= n || e.y >= n || !mine(e.x, e.y) || rock[at(e.x, e.y)] === 1 || kind[at(e.x, e.y)] !== -1) ok = false;
        }
        for (const e of [step(lo - 1), step(lo - 2), step(hi + 1), step(hi + 2)]) if (e.x >= 0 && e.y >= 0 && e.x < n && e.y < n && mine(e.x, e.y) && !wet(e)) ends.push(at(e.x, e.y));
        for (let d = lo; d <= hi; d++) {
          const q = step(d);
          if (side(q.x, q.y) < 3) ok = false;
          cells.push(at(q.x, q.y));
        }
      }
      if (ok && len <= 4 && (best === null || len < best.len)) best = { ns, cells, ends, len };
    }
    return best === null ? null : { ns: best.ns, cells: best.cells, ends: best.ends };
  }

  // --- a lake (every other map) ------------------------------------------------------------------------
  if (rng.below(2) === 0) {
    const c = minePt();
    if (c !== null) {
      const r = 3 + rng.below(3);
      blob(c.x, c.y, r, (x, y) => {
        if (free(x, y) && ground[at(x, y)] === 0) ground[at(x, y)] = Terrain.Water;
      });
    }
  }
  // Water at least 2 cells wide: a water cell stays only in a whole 2 x 2 of water (or crossings).
  const wet = (x: number, y: number) => x >= 0 && y >= 0 && x < n && y < n && ground[at(x, y)] !== 0 && ground[at(x, y)] !== Terrain.Cliff;
  const keepWater = new Uint8Array(area);
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      if (wet(x, y) && wet(x + 1, y) && wet(x, y + 1) && wet(x + 1, y + 1)) for (const i of [at(x, y), at(x + 1, y), at(x, y + 1), at(x + 1, y + 1)]) keepWater[i] = 1;
    }
  }
  for (let i = 0; i < area; i++) if (ground[i] === Terrain.Water && keepWater[i] === 0) ground[i] = 0;

  const dry = (x: number, y: number) => free(x, y) && ground[at(x, y)] === 0 && byResource[at(x, y)] === 0;
  // The ridges and the cliff may cut a way between the towns too (a ridge keeps its gap; a map that
  // ends up too round-about is drawn again), but never the castles, the main city or a resource.
  const dryAcross = (x: number, y: number) => {
    if (!mine(x, y)) return false;
    const i = at(x, y);
    return (reserved[i] === 0 || corridor[i] === 1) && rock[i] === 0 && kind[i] === -1 && ground[i] === 0 && byResource[i] === 0;
  };
  // --- 5-7 rock ridges across the way, 1-2 wide and 14-24 long, with a 3-cell gap somewhere along --------
  // (5-7, not the plan's 2-4: the walk between the main cities is 1.10 times the open walk or more
  // on half the maps only from 5 on; ceo 2026-10-20 had the numbers tuned to that.)
  // D-100 (KEEP): two more, as the bigger castles keep more of the ground clear (R6-51's walk median 1.10).
  for (let r = 0, count = per(KEEP.on ? 7 : 5) + rng.below(per(3)); r < count; r++) {
    const { to } = across(250 + rng.below(601));
    const half = 7 + rng.below(6);
    const p = to(-half);
    const q = to(half);
    const width = 1 + rng.below(2);
    const steps = Math.max(Math.abs(q.x - p.x), Math.abs(q.y - p.y), 1);
    const gap = 2 + rng.below(Math.max(1, steps - 6));
    line(p, q, (cx, cy, i) => {
      if (i >= gap && i < gap + 3) return;
      for (let y = cy; y < cy + width; y++) for (let x = cx; x < cx + width; x++) if (dryAcross(x, y)) rock[at(x, y)] = 1;
    });
  }
  // --- a cliff across the way, 1 wide, 10-16 long ------------------------------------------------------
  {
    const { to } = across(250 + rng.below(601));
    const half = 5 + rng.below(4);
    const cells: number[] = [];
    let open = true;
    line(to(-half), to(half), (x, y) => {
      if (!open) return;
      if (!dryAcross(x, y)) open = false;
      else cells.push(at(x, y));
    });
    if (cells.length >= 3) for (const i of cells) ground[i] = Terrain.Cliff;
  }
  // --- rock heaps and dense forest ---------------------------------------------------------------------
  for (let h = 0, count = per(3) + rng.below(per(4)); h < count; h++) {
    const p = minePt();
    if (p === null) continue;
    blob(p.x, p.y, 1 + rng.below(2), (x, y) => {
      if (dry(x, y)) rock[at(x, y)] = 1;
    });
  }
  for (let f = 0, count = per(1) + rng.below(per(3)); f < count; f++) {
    const p = minePt();
    if (p === null) continue;
    blob(p.x, p.y, 3 + rng.below(3), (x, y) => {
      if (dry(x, y)) setNode(x, y, NodeKind.Tree);
    });
  }
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
function orient(seed: number, g: Generated, orientation: number, across: boolean, redraws: number): RandomMap {
  const n = g.n;
  const R = orientation < 4 ? rotation(orientation, n) : then(MIRROR_XY, rotation(orientation - 4, n));
  // A turn or flip that trades x for y turns a bridge's way too.
  const turned = R.m[0] === 0;
  const terrain = new Uint8Array(n * n);
  const kind = new Int8Array(n * n).fill(-1);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const r = toCanon(R, x, y);
      const gr = g.ground[y * n + x];
      terrain[r.v * n + r.u] = g.wall[y * n + x] === 1 ? Terrain.Wall : gr !== 0 ? (turned ? turnedTerrain(gr) : gr) : g.rock[y * n + x] === 1 ? Terrain.Blocked : Terrain.Open;
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
  // D-101 (RICH.farTree): the trees far from both main cities.
  if (RICH.on && RICH.farTree > 0) farTrees(nodes, spawns.map((s) => ({ x: s.cellX, y: s.cellY })));
  const towns: TownSpec[] = g.towns.map((t, id) => {
    const r = toCanon(R, t.x, t.y);
    return { id, size: t.size, cellX: r.u, cellY: r.v, radius: TOWNS[t.size].radius };
  });
  const tw = rectImage(R, g.tower.x, g.tower.y, g.towerSize);
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
    towerSize: g.towerSize,
    frames: [back, then(then(invert(R), g.M), flip)],
    mode: "random",
    posts,
    layout: g.layout,
    orientation,
    mirror: then(then(invert(R), g.M), R),
    redraws,
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
