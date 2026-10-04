// The prototype's 1 v 1 map: 96 x 96, mirror-symmetric across the main diagonal (x <-> y),
// generated from a fixed seed. Player 0 starts bottom-left, player 1 top-right; the small
// town, the big city, the crystal vein and the two corner towns (top-left and bottom-right,
// round 6, D-054) sit on the axis, so both starts are equally far from each (GDD section
// 17). No river in the prototype: rock and forest make the chokes.
//
// Features are generated in the half below the diagonal (x < y) and copied to the other
// half, so symmetry holds by construction. Then every open cell the starts cannot reach
// becomes rock, and the required places are checked to be reachable.

import { type Frame, IDENTITY, MIRROR_XY } from "../frame.ts";
import { NodeKind, Terrain, TownSize } from "../protocol.ts";
import { Rng } from "./fixed.ts";
import { NODE_AMOUNT, TOWNS } from "./rules.ts";

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
  /** Top-left cell of the big city's tower (2 x 2, on the axis). */
  tower: { cellX: number; cellY: number };
  /** Each player's symmetry frame onto player 0's side (frame.ts): identity, and the x <-> y mirror. */
  frames: Frame[];
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

  // Fill what the starts cannot reach (4-connected over open, node-free cells).
  const passable = (i: number) => rock[i] === 0 && kind[i] === -1;
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
  for (let i = 0; i < n * n; i++) terrain[i] = rock[i] === 1 ? Terrain.Blocked : Terrain.Open;

  return {
    seed,
    size: n,
    terrain,
    nodes,
    spawns: [
      { player: 0, cellX: P0.x, cellY: P0.y },
      { player: 1, cellX: P0.y, cellY: P0.x },
    ],
    towns: [
      { id: 0, size: TownSize.Small, cellX: SMALL.x, cellY: SMALL.y, radius: TOWNS[TownSize.Small].radius },
      { id: 1, size: TownSize.Large, cellX: LARGE.x, cellY: LARGE.y, radius: TOWNS[TownSize.Large].radius },
      ...CORNERS.map((c, k) => ({ id: 2 + k, size: TownSize.Small, cellX: c.x, cellY: c.y, radius: TOWNS[TownSize.Small].radius })),
    ],
    tower: { cellX: LARGE.x - 1, cellY: LARGE.y - 1 },
    frames: [IDENTITY, MIRROR_XY],
  };
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
