// Flow fields: one Dijkstra from each destination cell over the whole map (integer costs:
// 10 straight, 14 diagonal, no corner cutting), then every cell points at its best
// neighbour. Units heading to the same cell share one field.
//
// Shortest distances are unique whatever order the queue pops cells in, and directions
// are chosen from those distances with a fixed tie-break (lowest direction index), so
// the field does not depend on queue order.

import { DIR8_COST, DIR8_DX, DIR8_DY, NO_DIR } from "./constants.ts";
import type { GameMap } from "./map.ts";

const INF = 0x3fffffff;
const RING = 15; // largest edge cost + 1
const CACHE_SIZE = 16;

export interface FlowField {
  dest: number;
  dist: Int32Array;
  dir: Uint8Array;
  lastUsed: number;
}

function passable(map: GameMap, x: number, y: number, k: number): boolean {
  const n = map.size;
  const nx = x + DIR8_DX[k];
  const ny = y + DIR8_DY[k];
  if (nx < 0 || ny < 0 || nx >= n || ny >= n) return false;
  if (map.blocked[ny * n + nx] === 1) return false;
  if ((k & 1) === 1) {
    if (map.blocked[y * n + nx] === 1 || map.blocked[ny * n + x] === 1) return false;
  }
  return true;
}

export function buildFlowField(map: GameMap, dest: number): FlowField {
  const n = map.size;
  const total = n * n;
  const dist = new Int32Array(total).fill(INF);
  const dir = new Uint8Array(total).fill(NO_DIR);
  const buckets: number[][] = [];
  for (let i = 0; i < RING; i++) buckets.push([]);

  dist[dest] = 0;
  buckets[0].push(dest);
  let pending = 1;
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
        if (!passable(map, x, y, k)) continue;
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
    if (c === dest || dist[c] === INF) continue;
    const x = c % n;
    const y = (c - x) / n;
    let best = INF;
    let bestK = NO_DIR;
    for (let k = 0; k < 8; k++) {
      if (!passable(map, x, y, k)) continue;
      const v = dist[(y + DIR8_DY[k]) * n + x + DIR8_DX[k]] + DIR8_COST[k];
      if (v < best) {
        best = v;
        bestK = k;
      }
    }
    dir[c] = bestK;
  }
  return { dest, dist, dir, lastUsed: 0 };
}

/** Keeps the 16 most recently used fields; evicts the least recently used, lowest cell on ties. */
export class FlowFieldCache {
  private fields = new Map<number, FlowField>();
  private map: GameMap;
  builds = 0;
  constructor(map: GameMap) {
    this.map = map;
  }

  get(dest: number, tick: number): FlowField {
    let f = this.fields.get(dest);
    if (f === undefined) {
      if (this.fields.size >= CACHE_SIZE) this.evict();
      f = buildFlowField(this.map, dest);
      this.builds++;
      this.fields.set(dest, f);
    }
    f.lastUsed = tick;
    return f;
  }

  private evict(): void {
    let victim: FlowField | null = null;
    for (const f of this.fields.values()) {
      if (
        victim === null ||
        f.lastUsed < victim.lastUsed ||
        (f.lastUsed === victim.lastUsed && f.dest < victim.dest)
      ) {
        victim = f;
      }
    }
    if (victim !== null) this.fields.delete(victim.dest);
  }
}
