// Flow fields on the live grid (the engine spike's method, extended): Dijkstra from a set of
// goal cells with integer costs (10 straight, 14 diagonal, no corner cutting), using a
// 15-bucket ring (Dial). A unit's step is the neighbour with the lowest dist + step cost,
// ties to the lowest direction index, worked out when asked (fieldStep) rather than for
// every cell up front. Distances are unique, so the field does not depend on queue order.
//
// Fields are cached per goal key. A field is rebuilt when cells have become blocked since
// it was built (a building placed: the old field may lead through it), when a drop-off
// field's set of drop-off buildings changed, or when cells have opened (a node used up, a
// building gone) and the field is at least OPEN_REFRESH ticks old: an opened cell only
// offers a shorter way, the old field still leads around it, so that rebuild can wait.
//
// Each owner (player, or the neutral side) may build at most REBUILDS_PER_OWNER fields per
// tick, so a new building (which makes every cached field stale) does not stall one tick.
// Past its budget a stale field is used as it is for this tick, and a unit with no field at
// all heads straight for its goal. Units ask in id order, so which of one owner's units get
// the fresh fields first is deterministic; the budget is per owner so that a side with lower
// ids does not take the other side's share.

import { NO_DIR } from "./fixed.ts";
import type { World } from "./world.ts";

const INF = 0x3fffffff;
const RING = 15;
const CACHE_SIZE = 64;
/** Ticks a field may keep ignoring cells that opened after it was built. */
export const OPEN_REFRESH = 100;
/** Fields each owner may build per tick. */
export const REBUILDS_PER_OWNER = 2;

export interface Field {
  key: number;
  block: number;
  open: number;
  drop: number;
  built: number;
  dist: Int32Array;
  lastUsed: number;
}

/**
 * Field keys: a cell index (>= 0) for "go to this cell", and negative ranges for "next to
 * this building", "next to this resource node" and "to a drop-off for this resource".
 */
export const buildingKey = (id: number) => -(id + 1);
export const nodeKey = (node: number) => -(1 << 22) - node;
export const dropKey = (player: number, resource: number) => -(1 << 23) - (player * 4 + resource);

// Bucket stacks, reused by every build (a build runs start to finish in one call). A bucket
// only ever holds one distance value at a time, and a cell enters it at most once per
// value, so `total` entries are enough.
let ringTotal = 0;
let ring: Int32Array[] = [];
const ringLen = new Int32Array(RING);

/**
 * Dijkstra from `goals` over walkable cells. Neighbours are checked inline in direction
 * order E, SE, S, SW, W, NW, N, NE (DIR8 order); a diagonal step needs both orthogonal
 * cells open (no corner cutting).
 */
export function buildField(w: World, goals: number[], key: number): Field {
  const n = w.size;
  const total = n * n;
  const grid = w.grid;
  if (ringTotal !== total) {
    ring = [];
    for (let i = 0; i < RING; i++) ring.push(new Int32Array(total));
    ringTotal = total;
  }
  ringLen.fill(0);
  const dist = new Int32Array(total).fill(INF);
  let pending = 0;
  for (const g of goals) {
    if (dist[g] === 0) continue;
    dist[g] = 0;
    ring[0][ringLen[0]++] = g;
    pending++;
  }
  const push = (c: number, nd: number) => {
    if (nd < dist[c]) {
      dist[c] = nd;
      const bi = nd % RING;
      ring[bi][ringLen[bi]++] = c;
      pending++;
    }
  };
  let d = 0;
  while (pending > 0) {
    const bi = d % RING;
    const bucket = ring[bi];
    while (ringLen[bi] > 0) {
      const c = bucket[--ringLen[bi]];
      pending--;
      if (dist[c] !== d) continue;
      const x = c % n;
      const oE = x < n - 1 && grid[c + 1] === 0;
      const oW = x > 0 && grid[c - 1] === 0;
      const oS = c + n < total && grid[c + n] === 0;
      const oN = c >= n && grid[c - n] === 0;
      if (oE) push(c + 1, d + 10);
      if (oE && oS && grid[c + n + 1] === 0) push(c + n + 1, d + 14);
      if (oS) push(c + n, d + 10);
      if (oS && oW && grid[c + n - 1] === 0) push(c + n - 1, d + 14);
      if (oW) push(c - 1, d + 10);
      if (oW && oN && grid[c - n - 1] === 0) push(c - n - 1, d + 14);
      if (oN) push(c - n, d + 10);
      if (oN && oE && grid[c - n + 1] === 0) push(c - n + 1, d + 14);
    }
    d++;
  }
  return { key, block: w.blockVersion, open: w.openVersion, drop: w.dropVersion, built: w.tick, dist, lastUsed: 0 };
}

/**
 * The step from cell c along the field: the DIR8 index of the neighbour with the lowest
 * dist + step cost, or NO_DIR on a goal or an unreached cell. Ties go to the first in
 * `order`, the unit owner's step order (World.stepOrders, from its symmetry frame): the
 * lowest direction in canonical coordinates, so in mirror-image situations both sides take
 * mirror-image steps (the map, and every field built from mirror-image goals, are images too).
 */
export function fieldStep(w: World, f: Field, c: number, order: readonly number[]): number {
  const dist = f.dist;
  const dc = dist[c];
  if (dc === 0 || dc === INF) return NO_DIR;
  const n = w.size;
  const grid = w.grid;
  const x = c % n;
  const oE = x < n - 1 && grid[c + 1] === 0;
  const oW = x > 0 && grid[c - 1] === 0;
  const oS = c + n < n * n && grid[c + n] === 0;
  const oN = c >= n && grid[c - n] === 0;
  // Cost of each direction through open cells, INF where blocked (corner cutting too).
  const v = STEP_SCRATCH;
  v[0] = oE ? dist[c + 1] + 10 : INF;
  v[1] = oE && oS && grid[c + n + 1] === 0 ? dist[c + n + 1] + 14 : INF;
  v[2] = oS ? dist[c + n] + 10 : INF;
  v[3] = oS && oW && grid[c + n - 1] === 0 ? dist[c + n - 1] + 14 : INF;
  v[4] = oW ? dist[c - 1] + 10 : INF;
  v[5] = oW && oN && grid[c - n - 1] === 0 ? dist[c - n - 1] + 14 : INF;
  v[6] = oN ? dist[c - n] + 10 : INF;
  v[7] = oN && oE && grid[c - n + 1] === 0 ? dist[c - n + 1] + 14 : INF;
  let best = INF;
  let bestK = NO_DIR;
  for (let i = 0; i < 8; i++) {
    const k = order[i];
    if (v[k] < best) {
      best = v[k];
      bestK = k;
    }
  }
  return bestK;
}

const STEP_SCRATCH = new Int32Array(8);

/**
 * The walkable cell nearest (x, y): smallest squared distance; ties go to the cell nearer
 * `prefer` (the commanding player's spawn, so both players resolve mirror-image ties the
 * mirror-image way), then to the lower cell index. -1 if none.
 */
export function nearestWalkable(w: World, x: number, y: number, prefer?: { cellX: number; cellY: number }): number {
  const n = w.size;
  x = Math.min(Math.max(x, 0), n - 1);
  y = Math.min(Math.max(y, 0), n - 1);
  if (w.grid[y * n + x] === 0) return y * n + x;
  for (let r = 1; r < n; r++) {
    let best = -1;
    let bestD = 0;
    let bestP = 0;
    // Scan a square a bit larger than the ring so a closer cell in the next ring is not missed.
    const reach = r + (r >> 1) + 1;
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const cx = x + dx;
        const cy = y + dy;
        if (cx < 0 || cy < 0 || cx >= n || cy >= n || w.grid[cy * n + cx] !== 0) continue;
        const d = dx * dx + dy * dy;
        if (d > r * r * 2) continue;
        const px = prefer === undefined ? 0 : cx - prefer.cellX;
        const py = prefer === undefined ? 0 : cy - prefer.cellY;
        const pd = px * px + py * py;
        const c = cy * n + cx;
        if (best < 0 || d < bestD || (d === bestD && (pd < bestP || (pd === bestP && c < best)))) {
          best = c;
          bestD = d;
          bestP = pd;
        }
      }
    }
    if (best >= 0) return best;
  }
  return -1;
}

/** Walkable cells touching a rectangle (8-neighbourhood), in cell order. */
export function cellsAround(w: World, cellX: number, cellY: number, size: number): number[] {
  const n = w.size;
  const out: number[] = [];
  for (let y = cellY - 1; y <= cellY + size; y++) {
    for (let x = cellX - 1; x <= cellX + size; x++) {
      if (x >= cellX && x < cellX + size && y >= cellY && y < cellY + size) continue;
      if (x < 0 || y < 0 || x >= n || y >= n) continue;
      if (w.grid[y * n + x] === 0) out.push(y * n + x);
    }
  }
  return out;
}

/** Keeps the CACHE_SIZE most recently used fields (keys: see buildingKey and friends). */
export class FieldCache {
  private fields: Field[] = [];
  private budgetTick = -1;
  private built = [0, 0, 0, 0];
  /** Counters for timing reports: fields built, fresh hits, stale fields used past the budget, requests left without a field. */
  builds = 0;
  hits = 0;
  staleUses = 0;
  deferred = 0;

  /**
   * The field for `key`, or null when it has none yet and `owner`'s budget for this tick is
   * spent. `drop`: the field also depends on the set of finished drop-off buildings.
   */
  get(w: World, key: number, goals: () => number[], drop = false, owner = 0): Field | null {
    let f: Field | undefined;
    for (const g of this.fields) {
      if (g.key === key) {
        f = g;
        break;
      }
    }
    const stale =
      f !== undefined &&
      (f.block !== w.blockVersion ||
        (drop && f.drop !== w.dropVersion) ||
        (f.open !== w.openVersion && w.tick - f.built >= OPEN_REFRESH));
    if (f === undefined || stale) {
      if (this.budgetTick !== w.tick) {
        this.budgetTick = w.tick;
        this.built.fill(0);
      }
      if (this.built[owner] >= REBUILDS_PER_OWNER) {
        if (f === undefined) {
          this.deferred++;
          return null;
        }
        this.staleUses++;
        f.lastUsed = w.tick;
        return f;
      }
      this.built[owner]++;
      if (f !== undefined) this.fields.splice(this.fields.indexOf(f), 1);
      if (this.fields.length >= CACHE_SIZE) this.evict();
      f = buildField(w, goals(), key);
      this.builds++;
      this.fields.push(f);
    } else {
      this.hits++;
    }
    f.lastUsed = w.tick;
    return f;
  }

  private evict(): void {
    let v = 0;
    for (let i = 1; i < this.fields.length; i++) {
      const a = this.fields[i];
      const b = this.fields[v];
      if (a.lastUsed < b.lastUsed || (a.lastUsed === b.lastUsed && a.key < b.key)) v = i;
    }
    this.fields.splice(v, 1);
  }
}
