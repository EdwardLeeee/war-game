// The walls' way (WALL_SHIFT, D-119): soldiers on a castle's walls walk along them, over the gates
// while they stand, from wall cell to wall cell. Steps are counted by the way's cells, four a cell
// (E, S, W, N; World.walkNext); ties go to the cell first in a frame's canonical order.

import { BuildingType } from "../protocol.ts";
import { type Frame, IDENTITY, toCanon } from "../frame.ts";
import type { World } from "./world.ts";

let dist = new Int32Array(128);
let queue = new Int32Array(128);

/** Can one walk the way's cell c: a wall cell, or a gate's while the gate stands. */
export function wayOpen(w: World, c: number): boolean {
  if (w.walkGate[c] === 0) return true;
  const id = w.buildingAt[c];
  if (id < 0) return false;
  const s = w.building(id);
  return s >= 0 && w.buildings.col.type[s] === BuildingType.Gate;
}

/**
 * Steps from cell `from` to each cell of town t's way (by way index, -1 none; valid until the next
 * call): through open cells only, `from` and `also` taken as open whatever they are.
 */
function spread(w: World, t: number, from: number, also: number): Int32Array {
  const cells = w.walkCells[t];
  const next = w.walkNext[t];
  const m = cells.length;
  if (dist.length < m) {
    dist = new Int32Array(m * 2);
    queue = new Int32Array(m * 2);
  }
  dist.fill(-1, 0, m);
  const s = w.walkIndex[from];
  if (s < 0) return dist;
  dist[s] = 0;
  queue[0] = s;
  let head = 0;
  let tail = 1;
  while (head < tail) {
    const k = queue[head++];
    for (let d = 0; d < 4; d++) {
      const j = next[k * 4 + d];
      if (j < 0 || dist[j] >= 0) continue;
      const c = cells[j];
      if (c !== also && !wayOpen(w, c)) continue;
      dist[j] = dist[k] + 1;
      queue[tail++] = j;
    }
  }
  return dist;
}

function before(f: Frame, n: number, a: number, b: number): boolean {
  const p = toCanon(f, a % n, Math.trunc(a / n));
  const q = toCanon(f, b % n, Math.trunc(b / n));
  return p.v < q.v || (p.v === q.v && p.u < q.u);
}

/**
 * The frame ties are broken in for `owner` at town t: a player's own; a neutral town's militia take
 * that of the player whose main city is nearer (on the axis, player 0's), as their posts (scenarios.ts).
 */
export function wayFrame(w: World, owner: number, t: number): Frame {
  if (owner === 0 || owner === 1) return w.map.frames[owner] ?? IDENTITY;
  const d = (p: number) => {
    const dx = w.homes[p].cellX - w.townX[t];
    const dy = w.homes[p].cellY - w.townY[t];
    return dx * dx + dy * dy;
  };
  return (d(1) < d(0) ? w.map.frames[1] : w.map.frames[0]) ?? IDENTITY;
}

/**
 * Of town t's wall cells (not its gates') `ok` takes, the one fewest steps from `from` along the
 * way; equally near, the first in frame f. -1 none.
 */
export function wayPick(w: World, t: number, from: number, f: Frame, ok: (c: number) => boolean): number {
  const d = spread(w, t, from, -1);
  const n = w.size;
  let best = -1;
  let bestD = 0;
  for (const c of w.wallCells[t]) {
    const k = d[w.walkIndex[c]];
    if (k < 0 || !ok(c)) continue;
    if (best >= 0 && (k > bestD || (k === bestD && !before(f, n, c, best)))) continue;
    best = c;
    bestD = k;
  }
  return best;
}

/** Steps from `from` to `to` along town t's way, -1 if the way between them is closed. */
export function waySteps(w: World, t: number, from: number, to: number): number {
  const i = w.walkIndex[to];
  return i < 0 ? -1 : spread(w, t, from, -1)[i];
}

/**
 * The way's cell next to `from` one step nearer `to` (`from` taken as open: it may be a gate broken
 * under the walker); equally near, the first in frame f. -1 if the way between them is closed.
 */
export function wayNext(w: World, t: number, from: number, to: number, f: Frame): number {
  const d = spread(w, t, to, from);
  const k = w.walkIndex[from];
  if (k < 0 || d[k] <= 0) return -1;
  const cells = w.walkCells[t];
  const next = w.walkNext[t];
  const n = w.size;
  let best = -1;
  for (let s = 0; s < 4; s++) {
    const j = next[k * 4 + s];
    if (j < 0 || d[j] !== d[k] - 1) continue;
    if (best < 0 || before(f, n, cells[j], best)) best = cells[j];
  }
  return best;
}
