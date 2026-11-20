// A unit's depth among the standing buildings drawn this frame (structure-art.ts unitDepth, section 6 of
// docs/sprite-atlas.md): in front of one whose footprint lies wholly at smaller x or smaller y than it, behind one
// wholly at larger; inside one's footprint (ours walk through our own, D-154), behind it until it is out (ceo
// 2026-11-20: by its place on the screen it came out in front of the main city's hall while still in it, walking on
// its porch's roof); else by its place on the screen. A field lies on the ground and is not among them; a foundation
// (the first stage of building one) is flat too, and no one inside it is drawn behind it. No PixiJS here: the unit
// tests take it on its own.

/** A building drawn standing up: its footprint (cells) and its depth on the plane. */
export interface DrawnFootprint {
  /** A foundation, flat on the ground: no one inside it is behind it. */
  flat?: boolean;
  cellX: number;
  cellY: number;
  size: number;
  z: number;
}

/** (ux, uy) in cells is inside `d`'s footprint (not on its edge), behind it: not a flat foundation's. */
export function inside(d: DrawnFootprint, ux: number, uy: number): boolean {
  return d.flat !== true && ux > d.cellX && ux < d.cellX + d.size && uy > d.cellY && uy < d.cellY + d.size;
}

/**
 * The depth of a unit at (ux, uy) in cells whose place on the screen gives `py`, among the buildings drawn:
 * `owner[y * n + x]` is the drawn building on that cell (1-based; 0 none), those within 4 cells looked at. Square on
 * (D-088, `square`): its own y is its front edge already; only inside a footprint to correct.
 */
export function buildingDepth(drawn: readonly DrawnFootprint[], owner: Int32Array, n: number, ux: number, uy: number, py: number, square: boolean): number {
  if (drawn.length === 0) return py;
  const cx = Math.floor(ux);
  const cy = Math.floor(uy);
  let depth = py;
  // Inside one: behind it whatever else is near (a house beside the main city, wholly behind the unit by its
  // footprint, sits lower on the screen than the city's middle: in front of the house would put it in front of the city).
  let within = Number.POSITIVE_INFINITY;
  let last = 0;
  for (let y = Math.max(0, cy - 4); y <= Math.min(n - 1, cy + 4); y++) {
    for (let x = Math.max(0, cx - 4); x <= Math.min(n - 1, cx + 4); x++) {
      const k = owner[y * n + x];
      if (k === 0 || k === last) continue;
      last = k;
      const d = drawn[k - 1];
      if (inside(d, ux, uy)) within = Math.min(within, d.z - 0.01);
      else if (square || (d.flat === true && ux > d.cellX && ux < d.cellX + d.size && uy > d.cellY && uy < d.cellY + d.size)) continue;
      else if (ux >= d.cellX + d.size || uy >= d.cellY + d.size) depth = Math.max(depth, d.z + 0.01);
      else depth = Math.min(depth, d.z - 0.01);
    }
  }
  return within < Number.POSITIVE_INFINITY ? Math.min(within, py) : depth;
}

/** The unit at (ux, uy) in cells is inside a standing building's footprint (drawn behind it). */
export function inAFootprint(drawn: readonly DrawnFootprint[], owner: Int32Array, n: number, ux: number, uy: number): boolean {
  const cx = Math.floor(ux);
  const cy = Math.floor(uy);
  if (cx < 0 || cy < 0 || cx >= n || cy >= n) return false;
  const k = owner[cy * n + cx];
  return k !== 0 && inside(drawn[k - 1], ux, uy);
}
