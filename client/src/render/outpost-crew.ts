// 哨所的守軍 (D-119, D-121; the user 2026-11-04: 「我覺得駐守的話站在城上面吧」, chosen: drawn on the
// walls, the rules those of hiding): the spearmen hiding in a 3 × 3 outpost drawn standing on its
// walls' walk at the picture's stand_m, as many as are inside (their count is sent to all who see
// it), looking out; those that poke (event `poke`) turn to the enemy and thrust once. Pure, for the
// unit tests; render/structure-art.ts places them and render/unit-art-draw.ts draws them.

/** Where one of them stands: world px, metres up, and the simulation's facing (16 directions, 0 east, 4 south). */
export interface CrewSpot {
  x: number;
  y: number;
  upM: number;
  facing: number;
}

/** The simulation's facing (16 directions, 0 east, clockwise as y grows south) from one point towards another. */
export function facingTo(fromX: number, fromY: number, toX: number, toY: number): number {
  const dx = toX - fromX;
  const dy = toY - fromY;
  if (dx === 0 && dy === 0) return 4;
  return (((Math.round(Math.atan2(dy, dx) / (Math.PI / 8)) % 16) + 16) % 16);
}

/**
 * The first `n` of the picture's stand points (metres from the anchor at world px (cx, cy), x east,
 * y south, z up; `pxPerM` world px a metre), each looking out from the middle (one at the middle: south).
 */
export function crewSpots(stand: readonly (readonly [number, number, number])[], n: number, cx: number, cy: number, pxPerM: number): CrewSpot[] {
  return stand.slice(0, Math.max(0, n)).map(([mx, my, mz]) => ({ x: cx + mx * pxPerM, y: cy + my * pxPerM, upM: mz, facing: facingTo(0, 0, mx, my) }));
}

/** Which of them poke at a target at world px (tx, ty): the `n` nearest it (equally near, the first). */
export function pokers(spots: readonly CrewSpot[], tx: number, ty: number, n: number): number[] {
  return spots
    .map((s, i) => ({ i, d: (s.x - tx) ** 2 + (s.y - ty) ** 2 }))
    .sort((a, b) => a.d - b.d || a.i - b.i)
    .slice(0, Math.max(0, n))
    .map((p) => p.i)
    .sort((a, b) => a - b);
}
