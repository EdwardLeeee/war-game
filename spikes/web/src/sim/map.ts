// The 176 x 176 map: about 20 % obstacles in blobs, generated from a fixed seed.
// Spawn squares and the centre stay open; pockets the centre cannot reach are filled in.

import { CENTER, MAP_SIZE, OBSTACLE_PERCENT, SPAWN_BATTLE, SPAWN_CORNER } from "./constants.ts";
import { Rng } from "./math.ts";

export interface GameMap {
  size: number;
  blocked: Uint8Array;
}

export function generateMap(seed: number): GameMap {
  const n = MAP_SIZE;
  const rng = new Rng(seed);
  const blocked = new Uint8Array(n * n);
  const reserved = new Uint8Array(n * n);

  for (const [cx, cy] of [...SPAWN_BATTLE, ...SPAWN_CORNER]) {
    for (let y = cy - 7; y <= cy + 6; y++) {
      for (let x = cx - 7; x <= cx + 6; x++) {
        if (x >= 0 && y >= 0 && x < n && y < n) reserved[y * n + x] = 1;
      }
    }
  }
  for (let dy = -6; dy <= 6; dy++) {
    for (let dx = -6; dx <= 6; dx++) {
      if (dx * dx + dy * dy <= 36) reserved[(CENTER + dy) * n + CENTER + dx] = 1;
    }
  }

  const target = Math.trunc((n * n * OBSTACLE_PERCENT) / 100);
  let count = 0;
  while (count < target) {
    const cx = rng.below(n);
    const cy = rng.below(n);
    const r = 1 + rng.below(4);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= n || y >= n) continue;
        const i = y * n + x;
        if (reserved[i] === 1 || blocked[i] === 1) continue;
        blocked[i] = 1;
        count++;
      }
    }
  }

  // Units move in 8 directions without cutting corners, which reaches exactly the
  // 4-connected cells; fill every open cell the centre cannot reach.
  const seen = new Uint8Array(n * n);
  const queue = new Int32Array(n * n);
  let head = 0;
  let tail = 0;
  const start = CENTER * n + CENTER;
  seen[start] = 1;
  queue[tail++] = start;
  while (head < tail) {
    const c = queue[head++];
    const x = c % n;
    const y = (c - x) / n;
    if (x + 1 < n) tail = visit(c + 1, blocked, seen, queue, tail);
    if (x > 0) tail = visit(c - 1, blocked, seen, queue, tail);
    if (y + 1 < n) tail = visit(c + n, blocked, seen, queue, tail);
    if (y > 0) tail = visit(c - n, blocked, seen, queue, tail);
  }
  for (let i = 0; i < n * n; i++) {
    if (blocked[i] === 0 && seen[i] === 0) blocked[i] = 1;
  }
  return { size: n, blocked };
}

function visit(i: number, blocked: Uint8Array, seen: Uint8Array, queue: Int32Array, tail: number): number {
  if (blocked[i] === 1 || seen[i] === 1) return tail;
  seen[i] = 1;
  queue[tail] = i;
  return tail + 1;
}

/** The open cell nearest to (x, y), searching square rings in a fixed order. */
export function nearestOpen(map: GameMap, x: number, y: number): number {
  const n = map.size;
  x = Math.min(Math.max(x, 0), n - 1);
  y = Math.min(Math.max(y, 0), n - 1);
  if (map.blocked[y * n + x] === 0) return y * n + x;
  for (let r = 1; r < n; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx !== -r && dx !== r && dy !== -r && dy !== r) continue;
        const cx = x + dx;
        const cy = y + dy;
        if (cx < 0 || cy < 0 || cx >= n || cy >= n) continue;
        if (map.blocked[cy * n + cx] === 0) return cy * n + cx;
      }
    }
  }
  return -1;
}

export function countBlocked(map: GameMap): number {
  let c = 0;
  for (let i = 0; i < map.blocked.length; i++) c += map.blocked[i];
  return c;
}
