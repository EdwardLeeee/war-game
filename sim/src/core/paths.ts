// Flow fields on the live grid (the engine spike's method, extended): Dijkstra from a set of
// goal cells with integer costs (10 straight, 14 diagonal, no corner cutting), using a
// 15-bucket ring (Dial). Every cell then points at the neighbour with the lowest
// dist + step cost, ties to the lowest direction index. Distances are unique, so the field
// does not depend on queue order. Fields are cached per goal key and rebuilt when the grid
// version changes (a building placed or destroyed, a tree chopped out).

import { DIR8_COST, DIR8_DX, DIR8_DY, NO_DIR } from "./fixed.ts";
import type { World } from "./world.ts";

const INF = 0x3fffffff;
const RING = 15;
const CACHE_SIZE = 32;

export interface Field {
  key: number;
  version: number;
  dist: Int32Array;
  dir: Uint8Array;
  lastUsed: number;
}

function passable(w: World, x: number, y: number, k: number): boolean {
  const n = w.size;
  const nx = x + DIR8_DX[k];
  const ny = y + DIR8_DY[k];
  if (nx < 0 || ny < 0 || nx >= n || ny >= n) return false;
  const g = w.grid;
  if (g[ny * n + nx] !== 0) return false;
  if ((k & 1) === 1 && (g[y * n + nx] !== 0 || g[ny * n + x] !== 0)) return false;
  return true;
}

export function buildField(w: World, goals: number[], key: number): Field {
  const n = w.size;
  const total = n * n;
  const dist = new Int32Array(total).fill(INF);
  const dir = new Uint8Array(total).fill(NO_DIR);
  const buckets: number[][] = [];
  for (let i = 0; i < RING; i++) buckets.push([]);
  let pending = 0;
  for (const g of goals) {
    if (dist[g] === 0) continue;
    dist[g] = 0;
    buckets[0].push(g);
    pending++;
  }
  let d = 0;
  while (pending > 0) {
    const bucket = buckets[d % RING];
    while (bucket.length > 0) {
      const c = bucket.pop() as number;
      pending--;
      if (dist[c] !== d) continue;
      const x = c % n;
      const y = (c - x) / n;
      for (let k = 0; k < 8; k++) {
        if (!passable(w, x, y, k)) continue;
        const nc = (y + DIR8_DY[k]) * n + x + DIR8_DX[k];
        const nd = d + DIR8_COST[k];
        if (nd < dist[nc]) {
          dist[nc] = nd;
          buckets[nd % RING].push(nc);
          pending++;
        }
      }
    }
    d++;
  }
  for (let c = 0; c < total; c++) {
    if (dist[c] === 0 || dist[c] === INF) continue;
    const x = c % n;
    const y = (c - x) / n;
    let best = INF;
    let bestK = NO_DIR;
    for (let k = 0; k < 8; k++) {
      if (!passable(w, x, y, k)) continue;
      const v = dist[(y + DIR8_DY[k]) * n + x + DIR8_DX[k]] + DIR8_COST[k];
      if (v < best) {
        best = v;
        bestK = k;
      }
    }
    dir[c] = bestK;
  }
  return { key, version: w.gridVersion, dist, dir, lastUsed: 0 };
}

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

/**
 * Keeps the CACHE_SIZE most recently used fields. Keys: a cell index (>= 0) for "go to this
 * cell", or -(buildingId + 1) for "go next to this building".
 */
export class FieldCache {
  private fields: Field[] = [];
  builds = 0;

  get(w: World, key: number, goals: () => number[]): Field {
    let f: Field | undefined;
    for (const g of this.fields) {
      if (g.key === key) {
        f = g;
        break;
      }
    }
    if (f === undefined || f.version !== w.gridVersion) {
      if (f !== undefined) this.fields.splice(this.fields.indexOf(f), 1);
      if (this.fields.length >= CACHE_SIZE) this.evict();
      f = buildField(w, goals(), key);
      this.builds++;
      this.fields.push(f);
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
