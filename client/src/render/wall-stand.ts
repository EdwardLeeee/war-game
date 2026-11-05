// Where those on a castle's walls stand (D-096) and walk (D-119, WALL_SHIFT): per map cell of the
// walls drawn from pictures, the piece's depth, the walk's height and the point from the cell's
// middle. Pure, for the unit tests; render/castle-draw.ts fills it from the castle's pictures.

/** One cell of the walls: its piece's depth, its walk's height (metres), where they stand from the cell's middle (world px). */
export interface WallStand {
  z: number;
  walkM: number;
  dx: number;
  dy: number;
}

/** The cells next to map cell c (E, W, S, N), on the map. */
function around(c: number, n: number): number[] {
  const x = c % n;
  const out: number[] = [];
  if (x < n - 1) out.push(c + 1);
  if (x > 0) out.push(c - 1);
  if (c + n < n * n) out.push(c + n);
  if (c - n >= 0) out.push(c - n);
  return out;
}

/**
 * A gate's opening (D-119: they walk over it while it stands, never stop on it): each of `cells`
 * without a point of its own gets its neighbours' (the piers', then the openings' filled before it):
 * their mean point, at `walkM` (the gate's walk) or else their mean height, at the gate's depth z.
 */
export function fillOpening(stand: Map<number, WallStand>, cells: readonly number[], n: number, z: number, walkM: number | undefined): void {
  let left = cells.filter((c) => !stand.has(c));
  while (left.length > 0) {
    const later: number[] = [];
    const found: [number, WallStand][] = [];
    for (const c of left) {
      const near = around(c, n)
        .map((k) => stand.get(k))
        .filter((s): s is WallStand => s !== undefined);
      if (near.length === 0) {
        later.push(c);
        continue;
      }
      const mean = (f: (s: WallStand) => number) => near.reduce((a, s) => a + f(s), 0) / near.length;
      found.push([c, { z, walkM: walkM ?? mean((s) => s.walkM), dx: mean((s) => s.dx), dy: mean((s) => s.dy) }]);
    }
    if (found.length === 0) return;
    for (const [c, s] of found) stand.set(c, s);
    left = later;
  }
}

/**
 * Where someone at world px (px, py) on the walls is drawn: its cell's point, and walking towards the
 * next cell (D-119) part way to that one's (half way at the edge between them, so it never jumps);
 * its cell's depth. Null off the walls drawn from pictures.
 */
export function wallStandAt(stand: ReadonlyMap<number, WallStand>, n: number, tilePx: number, px: number, py: number): WallStand | null {
  const cx = Math.floor(px / tilePx);
  const cy = Math.floor(py / tilePx);
  if (cx < 0 || cy < 0 || cx >= n || cy >= n) return null;
  const c = cy * n + cx;
  const at = stand.get(c);
  if (at === undefined) return null;
  const fx = px / tilePx - cx - 0.5;
  const fy = py / tilePx - cy - 0.5;
  const across = Math.abs(fx) >= Math.abs(fy);
  const t = across ? Math.abs(fx) : Math.abs(fy);
  const k = across ? (fx < 0 ? (cx > 0 ? c - 1 : -1) : cx < n - 1 ? c + 1 : -1) : fy < 0 ? (cy > 0 ? c - n : -1) : cy < n - 1 ? c + n : -1;
  const next = k < 0 ? undefined : stand.get(k);
  if (next === undefined || t === 0) return at;
  return { z: at.z, walkM: at.walkM + (next.walkM - at.walkM) * t, dx: at.dx + (next.dx - at.dx) * t, dy: at.dy + (next.dy - at.dy) * t };
}
