// Integer helpers. Nothing here uses Math.sin/cos/atan2/exp/log/pow or keeps floating-point
// state (AGENTS.md, determinism). Division truncates toward zero; Math.sqrt is exactly
// rounded by IEEE 754 and only used to seed an integer square root. Bitwise operators
// truncate to 32 bits, so they are only used on values known to fit.

/** Integer division rounded toward zero. Exact while |a| < 2^52. */
export function idiv(a: number, b: number): number {
  return Math.trunc(a / b);
}

/** Largest r with r * r <= n, for 0 <= n < 2^52. */
export function isqrt(n: number): number {
  if (n <= 0) return 0;
  let r = Math.floor(Math.sqrt(n));
  while (r * r > n) r--;
  while ((r + 1) * (r + 1) <= n) r++;
  return r;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// 16 directions, k * 22.5 degrees, y down: rounded cos/sin * 1024.
export const DIR16_X = [1024, 946, 724, 392, 0, -392, -724, -946, -1024, -946, -724, -392, 0, 392, 724, 946];
export const DIR16_Y = [0, 392, 724, 946, 1024, 946, 724, 392, 0, -392, -724, -946, -1024, -946, -724, -392];
// tan(11.25), tan(33.75) degrees * 1024
const DIR16_TAN = [204, 684];

/** Sector of (a, b) with a >= b >= 0, i.e. an angle in [0, 45] degrees: 0, 1 or 2. */
function halfQuadrant(a: number, b: number): number {
  const s = b * 1024;
  if (s < a * DIR16_TAN[0]) return 0;
  if (s < a * DIR16_TAN[1]) return 1;
  return 2;
}

/**
 * Direction of (dx, dy) as one of 16 sectors. (0, 0) gives 0. Mirror-exact: the steeper
 * half of each quadrant is worked out with the axes swapped, so dir16(dy, dx) is always the
 * mirror image (x <-> y) of dir16(dx, dy) (frame.ts relies on it).
 */
export function dir16(dx: number, dy: number): number {
  if (dx === 0 && dy === 0) return 0;
  const ax = dx < 0 ? -dx : dx;
  const ay = dy < 0 ? -dy : dy;
  const q = ay <= ax ? halfQuadrant(ax, ay) : 4 - halfQuadrant(ay, ax);
  if (dx >= 0) return dy >= 0 ? q : (16 - q) % 16;
  return dy >= 0 ? 8 - q : 8 + q;
}

// 8 grid steps, clockwise from +x. Cost 10 straight, 14 diagonal.
export const DIR8_DX = [1, 1, 0, -1, -1, -1, 0, 1];
export const DIR8_DY = [0, 1, 1, 1, 0, -1, -1, -1];
export const DIR8_COST = [10, 14, 10, 14, 10, 14, 10, 14];
export const NO_DIR = 255;

/** xorshift32: shifts and XOR only. One instance per purpose (map, each AI). */
export class Rng {
  state: number;
  constructor(seed: number) {
    this.state = seed >>> 0 || 1;
  }
  next(): number {
    let x = this.state | 0;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x >>> 0;
    return this.state;
  }
  /** 0 <= result < n. */
  below(n: number): number {
    return this.next() % n;
  }
}

export const FNV_OFFSET = 2166136261;
const FNV_PRIME = 16777619;

/** FNV-1a (32 bit) over the four little-endian bytes of an int32 (negative values allowed). */
export function fnvWord(h: number, v: number): number {
  for (let s = 0; s < 32; s += 8) {
    h = (h ^ ((v >>> s) & 255)) >>> 0;
    h = Math.imul(h, FNV_PRIME) >>> 0;
  }
  return h;
}

/** FNV-1a over the first n entries of an Int32Array, as little-endian words. */
export function fnvInt32(h: number, a: Int32Array, n: number = a.length): number {
  for (let i = 0; i < n; i++) h = fnvWord(h, a[i]);
  return h;
}

/** FNV-1a over the bytes of a Uint8Array. */
export function fnvBytes(h: number, a: Uint8Array): number {
  for (let i = 0; i < a.length; i++) {
    h = (h ^ a[i]) >>> 0;
    h = Math.imul(h, FNV_PRIME) >>> 0;
  }
  return h;
}

export function hex8(h: number): string {
  return (h >>> 0).toString(16).padStart(8, "0");
}
