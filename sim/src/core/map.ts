// The prototype's 1 v 1 map: 96 x 96, mirror-symmetric across the main diagonal (x <-> y),
// generated from a fixed seed. Player 0 starts bottom-left, player 1 top-right; the small
// town, the big city, the crystal vein and the two corner towns (top-left and bottom-right,
// round 6, D-054) sit on the axis, so both starts are equally far from each (GDD section
// 17). No river in the prototype: rock and forest make the chokes.
//
// Features are generated in the half below the diagonal (x < y) and copied to the other
// half, so symmetry holds by construction. Then the towns' castles (D-089) go up: their walls
// are terrain and every cell of a castle and in front of its gates is cleared. Then every open
// cell the starts cannot reach becomes rock, and the required places are checked to be reachable.

import { type Frame, IDENTITY, MIRROR_XY } from "../frame.ts";
import { type MapMode, NodeKind, Terrain, TownSize, walkableTerrain } from "../protocol.ts";
import { type CastleMap, castleOf } from "./castle.ts";
import { Rng } from "./fixed.ts";
import { FIXED_TERRAIN } from "./fixed-terrain.ts";
import { KEEP, NODE_AMOUNT, RICH, TOWNS } from "./rules.ts";

export const MAP_SIZE = 96;
export const MAP_SEED = 20261001;

export interface NodeSpec {
  kind: NodeKind;
  cellX: number;
  cellY: number;
  amount: number;
}
export interface TownSpec {
  id: number;
  size: TownSize;
  cellX: number;
  cellY: number;
  radius: number;
}
export interface GameMap {
  seed: number;
  size: number;
  /** Terrain per cell (rock only; trees are nodes). */
  terrain: Uint8Array;
  /** In cell-index order, so node ids are stable. */
  nodes: NodeSpec[];
  /** Centre cell of each player's main city (footprint top-left = centre - 2). */
  spawns: { player: number; cellX: number; cellY: number }[];
  towns: TownSpec[];
  /** Top-left cell of the big city's tower (2 x 2, on the axis; see towerSize). */
  tower: { cellX: number; cellY: number };
  /**
   * The tower's side in cells. Absent: BUILDINGS[TownTower].size (2). Random maps with adjacent
   * starts: 3, so that it sits exactly on the one-column midline (D-074, the user wants it 100% fair).
   */
  towerSize?: number;
  /** Each player's symmetry frame onto player 0's side (frame.ts): identity, and the x <-> y mirror. */
  frames: Frame[];
  /** Absent: this fixed map. "random": random-map.ts (D-074). */
  mode?: MapMode;
  /**
   * Random maps: militia posts (offsets from a town's centre cell), every prefix that militia
   * fill closed under the map's mirror. Absent: scenarios.ts POSTS.
   */
  posts?: readonly (readonly [number, number])[];
}

const P0 = { x: 16, y: 78 };
const SMALL = { x: 29, y: 29 };
const LARGE = { x: 48, y: 48 };
/** Small towns in the top-left and bottom-right corners (round 6, D-054), about 64 cells from both starts. */
const CORNERS = [
  { x: 14, y: 14 },
  { x: 81, y: 81 },
];
/** Top-left of the 2 x 2 crystal vein, on the axis. */
const VEIN = { x: 66, y: 66 };

/** A cell's Terrain value on the map turned a quarter or mirrored across a diagonal: bridges change way. */
export function turnedTerrain(t: number): number {
  return t === Terrain.BridgeNS ? Terrain.BridgeEW : t === Terrain.BridgeEW ? Terrain.BridgeNS : t;
}

export function generateMap(seed: number = MAP_SEED): GameMap {
  const n = MAP_SIZE;
  const rng = new Rng(seed);
  const rock = new Uint8Array(n * n);
  const kind = new Int8Array(n * n).fill(-1);
  const reserved = new Uint8Array(n * n);
  const inLower = (x: number, y: number) => x >= 0 && y >= 0 && x < n && y < n && x < y;

  const reserveDisc = (cx: number, cy: number, r: number) => {
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        if (x < 0 || y < 0 || x >= n || y >= n) continue;
        if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r) reserved[y * n + x] = 1;
      }
    }
  };
  // Straight corridor, 3 cells wide, integer DDA.
  const reserveLine = (x0: number, y0: number, x1: number, y1: number) => {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let i = 0; i <= steps; i++) {
      const x = x0 + Math.trunc(((x1 - x0) * i) / steps);
      const y = y0 + Math.trunc(((y1 - y0) * i) / steps);
      reserveDisc(x, y, 1);
    }
  };
  reserveDisc(P0.x, P0.y, 9);
  reserveDisc(P0.y, P0.x, 9);
  reserveDisc(SMALL.x, SMALL.y, TOWNS[TownSize.Small].radius + 2);
  reserveDisc(LARGE.x, LARGE.y, TOWNS[TownSize.Large].radius + 2);
  for (const c of CORNERS) reserveDisc(c.x, c.y, TOWNS[TownSize.Small].radius + 2);
  reserveDisc(VEIN.x + 1, VEIN.y + 1, 3);
  for (const [a, b] of [
    [P0, LARGE],
    [P0, SMALL],
    [LARGE, { x: VEIN.x + 1, y: VEIN.y + 1 }],
  ]) {
    reserveLine(a.x, a.y, b.x, b.y);
    reserveLine(a.y, a.x, b.y, b.x);
  }

  const setNode = (x: number, y: number, k: NodeKind) => {
    if (!inLower(x, y) || reserved[y * n + x] === 1 || rock[y * n + x] === 1) return;
    kind[y * n + x] = k;
  };
  const blob = (cx: number, cy: number, r: number, paint: (x: number, y: number) => void) => {
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r + 1) paint(x, y);
      }
    }
  };

  // Home resources for player 0 (mirrored later): two forests, a gold mine, berries.
  blob(6, 70, 4, (x, y) => setNode(x, y, NodeKind.Tree));
  blob(24, 91, 4, (x, y) => setNode(x, y, NodeKind.Tree));
  for (const [x, y] of [[26, 84], [27, 84], [26, 85], [27, 85]]) kind[y * n + x] = NodeKind.GoldMine;
  for (const [x, y] of [[8, 86], [9, 86], [10, 86], [8, 87], [9, 87], [10, 87]]) kind[y * n + x] = NodeKind.Berries;
  // A second gold mine on the way to the small town.
  for (const [x, y] of [[14, 52], [15, 52], [14, 53], [15, 53]]) kind[y * n + x] = NodeKind.GoldMine;

  // Random rock and forest in the lower half.
  for (let i = 0; i < 12; i++) {
    const cx = rng.below(n);
    const cy = rng.below(n);
    const r = 1 + rng.below(3);
    if (!inLower(cx, cy) || cy - cx < 4) continue;
    blob(cx, cy, r, (x, y) => {
      if (inLower(x, y) && reserved[y * n + x] === 0 && kind[y * n + x] === -1) rock[y * n + x] = 1;
    });
  }
  for (let i = 0; i < 18; i++) {
    const cx = rng.below(n);
    const cy = rng.below(n);
    const r = 2 + rng.below(3);
    if (!inLower(cx, cy) || cy - cx < 4) continue;
    blob(cx, cy, r, (x, y) => setNode(x, y, NodeKind.Tree));
  }

  // Mirror the lower half onto the upper half.
  for (let y = 0; y < n; y++) {
    for (let x = y + 1; x < n; x++) {
      rock[y * n + x] = rock[x * n + y];
      kind[y * n + x] = kind[x * n + y];
    }
  }
  // Crystal vein on the axis (symmetric by itself).
  for (const [x, y] of [[VEIN.x, VEIN.y], [VEIN.x + 1, VEIN.y], [VEIN.x, VEIN.y + 1], [VEIN.x + 1, VEIN.y + 1]]) {
    kind[y * n + x] = NodeKind.CrystalVein;
  }

  const towns: TownSpec[] = [
    { id: 0, size: TownSize.Small, cellX: SMALL.x, cellY: SMALL.y, radius: TOWNS[TownSize.Small].radius },
    { id: 1, size: TownSize.Large, cellX: LARGE.x, cellY: LARGE.y, radius: TOWNS[TownSize.Large].radius },
    ...CORNERS.map((c, k) => ({ id: 2 + k, size: TownSize.Small, cellX: c.x, cellY: c.y, radius: TOWNS[TownSize.Small].radius })),
  ];
  const tower = { cellX: LARGE.x - 1, cellY: LARGE.y - 1 };
  const wall = stampCastles(n, rock, kind, { tower, towns });

  // The natural obstacles (R6-51, fixed-terrain.ts): rock, cliffs, water, the fords and bridges,
  // the dense forest. They keep off the castles, the main cities and the resources.
  const ground = new Uint8Array(n * n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const c = FIXED_TERRAIN[y][x];
      if (c === ".") continue;
      if (wall[i] === 1) throw new Error(`map: obstacle ${c} on a castle wall at ${x},${y}`);
      if (c === "T") {
        if (rock[i] === 1 || kind[i] !== -1) throw new Error(`map: a tree added on taken ground at ${x},${y}`);
        kind[i] = NodeKind.Tree;
      } else if (c === "x") {
        if (kind[i] !== NodeKind.Tree) throw new Error(`map: no tree to take away at ${x},${y}`);
        kind[i] = -1;
      } else {
        if (kind[i] !== -1 && kind[i] !== NodeKind.Tree) throw new Error(`map: obstacle ${c} on a resource at ${x},${y}`);
        kind[i] = -1;
        rock[i] = c === "R" ? 1 : 0;
        ground[i] = c === "K" ? Terrain.Cliff : c === "~" ? Terrain.Water : c === "f" ? Terrain.Ford : c === "|" ? Terrain.BridgeNS : c === "=" ? Terrain.BridgeEW : 0;
      }
    }
  }

  // D-101 (RICH): contested gold on the axis, as far from both starts: past the big city toward the
  // vein, and beyond each corner town toward its corner. Each 2 x 2 straddles the diagonal (its own
  // mirror image), on open ground, outside every castle and 2 cells or more from any wall.
  if (RICH.on) {
    const boxes = towns.map((t) => {
      const c = castleOf(t.size, { tower, towns });
      return { x0: t.cellX + c.inside.x0 - 1, y0: t.cellY + c.inside.y0 - 1, x1: t.cellX + c.inside.x1 + 1, y1: t.cellY + c.inside.y1 + 1 };
    });
    const fits = (c: number) => {
      for (let y = c - 2; y <= c + 3; y++) {
        for (let x = c - 2; x <= c + 3; x++) {
          if (x < 0 || y < 0 || x >= n || y >= n) return false;
          if (wall[y * n + x] === 1) return false;
          const block = x >= c && x <= c + 1 && y >= c && y <= c + 1;
          if (block && (rock[y * n + x] === 1 || kind[y * n + x] !== -1 || ground[y * n + x] !== 0)) return false;
          if (block && boxes.some((b) => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1)) return false;
        }
      }
      return true;
    };
    for (const [from, step] of [[LARGE.x + 11, 1], [CORNERS[0].x - 9, -1], [CORNERS[1].x + 9, 1]]) {
      let c = from;
      while (c >= 0 && c + 1 < n && !fits(c)) c += step;
      if (c < 0 || c + 1 >= n) throw new Error(`map: no room for contested gold from ${from}`);
      for (const [x, y] of [[c, c], [c + 1, c], [c, c + 1], [c + 1, c + 1]]) kind[y * n + x] = NodeKind.GoldMine;
    }
  }

  // Fill what the starts cannot reach (4-connected over open, node-free cells; fords and bridges
  // are walked).
  const passable = (i: number) => rock[i] === 0 && kind[i] === -1 && wall[i] === 0 && walkableTerrain(ground[i]);
  const seen = new Uint8Array(n * n);
  const queue = new Int32Array(n * n);
  let head = 0;
  let tail = 0;
  const start = P0.y * n + P0.x;
  seen[start] = 1;
  queue[tail++] = start;
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

  // Required places must be reachable: the other start, every town centre, and a free cell
  // beside every resource node group.
  const need = [P0.x * n + P0.y, SMALL.y * n + SMALL.x, LARGE.y * n + LARGE.x, ...CORNERS.map((c) => c.y * n + c.x)];
  for (const c of need) if (seen[c] !== 1) throw new Error(`map: cell ${c} unreachable`);
  for (let i = 0; i < n * n; i++) {
    if (kind[i] === -1 || kind[i] === NodeKind.Tree) continue;
    const x = i % n;
    const y = (i - x) / n;
    const nbs = [x + 1 < n ? i + 1 : -1, x > 0 ? i - 1 : -1, y + 1 < n ? i + n : -1, y > 0 ? i - n : -1];
    if (!nbs.some((nb) => nb >= 0 && seen[nb] === 1) && !isInteriorOfGroup(kind, n, x, y)) {
      throw new Error(`map: node at ${x},${y} unreachable`);
    }
  }

  const nodes: NodeSpec[] = [];
  for (let i = 0; i < n * n; i++) {
    const k = kind[i];
    if (k === -1) continue;
    const amount =
      k === NodeKind.Tree
        ? NODE_AMOUNT.tree
        : k === NodeKind.GoldMine
          ? NODE_AMOUNT.goldCell
          : k === NodeKind.Berries
            ? NODE_AMOUNT.bush
            : NODE_AMOUNT.crystalCell;
    nodes.push({ kind: k as NodeKind, cellX: i % n, cellY: Math.trunc(i / n), amount });
  }
  const terrain = new Uint8Array(n * n);
  for (let i = 0; i < n * n; i++) terrain[i] = wall[i] === 1 ? Terrain.Wall : ground[i] !== 0 ? ground[i] : rock[i] === 1 ? Terrain.Blocked : Terrain.Open;

  return {
    seed,
    size: n,
    terrain,
    nodes,
    spawns: [
      { player: 0, cellX: P0.x, cellY: P0.y },
      { player: 1, cellX: P0.y, cellY: P0.x },
    ],
    towns,
    tower,
    // D-100 (KEEP): every town's keep 3 x 3; the big city's tower was 2 x 2.
    ...(KEEP.on ? { towerSize: KEEP.size } : {}),
    frames: [IDENTITY, MIRROR_XY],
  };
}

/**
 * The towns' castles (D-089) on a map being made: returns the walls (1 = wall or corner tower) and
 * clears rock and resource nodes from every cell of each castle and the cell in front of each gate.
 */
export function stampCastles(n: number, rock: Uint8Array, kind: Int8Array, map: CastleMap): Uint8Array {
  const wall = new Uint8Array(n * n);
  for (const t of map.towns) {
    const c = castleOf(t.size, map);
    const at = ([dx, dy]: readonly [number, number]) => {
      const x = t.cellX + dx;
      const y = t.cellY + dy;
      if (x < 0 || y < 0 || x >= n || y >= n) throw new Error(`map: town at ${t.cellX},${t.cellY}: its castle leaves the map`);
      return y * n + x;
    };
    const clear = (i: number) => {
      rock[i] = 0;
      kind[i] = -1;
    };
    for (const cell of c.wall) {
      const i = at(cell);
      clear(i);
      wall[i] = 1;
    }
    for (const cell of [...c.gate, ...c.outside]) clear(at(cell));
    for (let dy = c.inside.y0; dy <= c.inside.y1; dy++) for (let dx = c.inside.x0; dx <= c.inside.x1; dx++) clear(at([dx, dy]));
  }
  return wall;
}

/** A node surrounded by same-kind nodes on all four sides is reached through its neighbours. */
function isInteriorOfGroup(kind: Int8Array, n: number, x: number, y: number): boolean {
  const k = kind[y * n + x];
  return [[1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dy]) => {
    const nx = x + dx;
    const ny = y + dy;
    return nx >= 0 && ny >= 0 && nx < n && ny < n && kind[ny * n + nx] === k;
  });
}
