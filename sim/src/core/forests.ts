// D-101 (RICH.forests, ceo 2026-10-24): forests near a main city, so its nearest trees do not end
// up far away. Shared by the fixed map and the random maps; integers only (the 16 directions of
// fixed.ts).

import { DIR16_X, DIR16_Y } from "./fixed.ts";

/** Cells from the main city's centre to a forest's centre. */
export const HOME_FOREST = { min: 14, max: 20, radius: 2, apart: 8 };

/** The cells of a forest centred on (cx, cy): a disc of HOME_FOREST.radius (21 cells). */
export function forestCells(cx: number, cy: number): [number, number][] {
  const r = HOME_FOREST.radius;
  const out: [number, number][] = [];
  for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r + 1) out.push([x, y]);
  return out;
}

/**
 * Up to `count` forest centres around (hx, hy), HOME_FOREST.min to max cells out, every cell of
 * each `free` (and one cell round it too), HOME_FOREST.apart or more from each other. Directions
 * from `first` (0-15) round, then distances from the nearest: the same answer for the same map.
 */
export function homeForests(hx: number, hy: number, count: number, first: number, free: (x: number, y: number) => boolean): [number, number][] {
  const found: [number, number][] = [];
  const r = HOME_FOREST.radius + 1;
  for (let d = HOME_FOREST.min; d <= HOME_FOREST.max && found.length < count; d++) {
    for (let k = 0; k < 16 && found.length < count; k++) {
      const dir = (first + k) & 15;
      const cx = hx + Math.trunc((DIR16_X[dir] * d) / 1024);
      const cy = hy + Math.trunc((DIR16_Y[dir] * d) / 1024);
      if (found.some(([x, y]) => (x - cx) * (x - cx) + (y - cy) * (y - cy) < HOME_FOREST.apart * HOME_FOREST.apart)) continue;
      let ok = true;
      for (let y = cy - r; y <= cy + r && ok; y++) for (let x = cx - r; x <= cx + r && ok; x++) if (!free(x, y)) ok = false;
      if (ok) found.push([cx, cy]);
    }
  }
  return found;
}
