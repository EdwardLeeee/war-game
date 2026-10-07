// Map symmetry frames. Each player has a frame that carries its side of a symmetric map onto
// the canonical side (player 0's). The prototype's 1 v 1 map is mirrored across x <-> y, so
// player 1's frame is that mirror; a 4-player map would give each player a rotation.
//
// Every tie-break that depends on direction or position (a flow-field step, which axis to
// slide along first, where the AI puts a building) is made in canonical coordinates, so
// every player resolves the image of a situation the image way, and neither side gets the
// better end of the ties. Integer maths only; shared by the simulation and the AI.

/** canon = M · (x, y) + t for cells, with M = [m0 m1; m2 m3] a signed permutation matrix. */
export interface Frame {
  m: readonly [number, number, number, number];
  t: readonly [number, number];
}

export const IDENTITY: Frame = { m: [1, 0, 0, 1], t: [0, 0] };
/** Across the main diagonal: (x, y) -> (y, x). */
export const MIRROR_XY: Frame = { m: [0, 1, 1, 0], t: [0, 0] };
/** Quarter turns about the centre of a size x size map (for 4-player maps). */
export function rotation(quarters: number, size: number): Frame {
  const q = ((quarters % 4) + 4) % 4;
  const s = size - 1;
  if (q === 1) return { m: [0, -1, 1, 0], t: [s, 0] };
  if (q === 2) return { m: [-1, 0, 0, -1], t: [s, s] };
  if (q === 3) return { m: [0, 1, -1, 0], t: [0, s] };
  return IDENTITY;
}

/** Across the vertical midline of a size x size map: (x, y) -> (size - 1 - x, y). */
export function mirrorX(size: number): Frame {
  return { m: [-1, 0, 0, 1], t: [size - 1, 0] };
}

/** The frame that undoes f. */
export function invert(f: Frame): Frame {
  const [a, b, c, d] = f.m;
  // Inverse of M is its transpose; inverse translation is -M^T t.
  return { m: [a, c, b, d], t: [-(a * f.t[0] + c * f.t[1]) | 0, -(b * f.t[0] + d * f.t[1]) | 0] };
}

/** f, then g: toCanon(then(f, g), p) = toCanon(g, toCanon(f, p)). */
export function then(f: Frame, g: Frame): Frame {
  const [a, b, c, d] = f.m;
  const [e, k, l, h] = g.m;
  return {
    m: [(e * a + k * c) | 0, (e * b + k * d) | 0, (l * a + h * c) | 0, (l * b + h * d) | 0],
    t: [(e * f.t[0] + k * f.t[1] + g.t[0]) | 0, (l * f.t[0] + h * f.t[1] + g.t[1]) | 0],
  };
}

export function toCanon(f: Frame, x: number, y: number): { u: number; v: number } {
  const [a, b, c, d] = f.m;
  return { u: a * x + b * y + f.t[0], v: c * x + d * y + f.t[1] };
}

/** The inverse of toCanon (M is orthogonal, so its inverse is its transpose). */
export function fromCanon(f: Frame, u: number, v: number): { x: number; y: number } {
  const [a, b, c, d] = f.m;
  const du = u - f.t[0];
  const dv = v - f.t[1];
  return { x: a * du + c * dv, y: b * du + d * dv };
}

/** Top-left cell of the real footprint whose canonical image is the size x size square at (u, v). */
export function rectFromCanon(f: Frame, u: number, v: number, size: number): { x: number; y: number } {
  const p = fromCanon(f, u, v);
  const q = fromCanon(f, u + size - 1, v + size - 1);
  return { x: Math.min(p.x, q.x), y: Math.min(p.y, q.y) };
}

/**
 * The cell a player treats as the centre of a size x size footprint with top-left (x, y): the
 * canonical footprint's top-left + size / 2, back in real cells. For an odd size that is the
 * true centre. For an even size (a main city, a 2 x 2 building) the true centre is a cell
 * corner, and this picks the same one of its four cells on both sides of a mirrored map
 * (a random map can be mirrored left to right, D-074). With the identity or the x <-> y mirror
 * it is (x + size / 2, y + size / 2).
 */
export function footprintCentre(f: Frame, x: number, y: number, size: number): { x: number; y: number } {
  const p = toCanon(f, x, y);
  const q = toCanon(f, x + size - 1, y + size - 1);
  const h = size >> 1;
  return fromCanon(f, Math.min(p.u, q.u) + h, Math.min(p.v, q.v) + h);
}

/** footprintCentre of a main city (4 x 4) given its centre cell as in GameMap.spawns. */
export function spawnCentre(f: Frame, spawn: { cellX: number; cellY: number }): { x: number; y: number } {
  return footprintCentre(f, spawn.cellX - 2, spawn.cellY - 2, 4);
}

/** DIR8 steps: E, SE, S, SW, W, NW, N, NE (y points down). */
const DX = [1, 1, 0, -1, -1, -1, 0, 1];
const DY = [0, 1, 1, 1, 0, -1, -1, -1];

/**
 * The real DIR8 indices in canonical order: element i is the real direction whose canonical
 * image is direction i. Trying directions in this order and keeping the first strict best
 * breaks ties by the lowest canonical direction.
 */
export function stepOrder(f: Frame): number[] {
  const [a, b, c, d] = f.m;
  const order: number[] = [];
  for (let i = 0; i < 8; i++) {
    // Real vector = M^T · canonical vector.
    const rx = a * DX[i] + c * DY[i];
    const ry = b * DX[i] + d * DY[i];
    for (let k = 0; k < 8; k++) if (DX[k] === rx && DY[k] === ry) order.push(k);
  }
  return order;
}

/** True for a mirror frame (it swaps left and right): determinant -1. */
export function isReflection(f: Frame): boolean {
  return f.m[0] * f.m[3] - f.m[1] * f.m[2] < 0;
}

/** True when the real x axis is the canonical y axis (such a player tries y first on a tie). */
export function xIsCanonY(f: Frame): boolean {
  return f.m[0] === 0;
}
