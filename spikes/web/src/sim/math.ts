// Integer helpers shared by the simulation. Nothing here uses Math.sin/cos/atan2/pow or
// floating-point results that could differ between engines (AGENTS.md, determinism).
// Bitwise operators truncate to 32 bits, so they are only used on values known to fit.

import { DIR16_TAN } from "./constants.ts";

/** Integer division rounded toward zero, as GDScript int division does. Exact while |a| < 2^52. */
export function idiv(a: number, b: number): number {
  return Math.trunc(a / b);
}

/** Largest r with r * r <= n, for small non-negative n. */
export function isqrt(n: number): number {
  let r = 0;
  while ((r + 1) * (r + 1) <= n) r++;
  return r;
}

/** Direction of (dx, dy) as one of 16 sectors, k * 22.5 degrees, y pointing down. */
export function dir16(dx: number, dy: number): number {
  if (dx === 0 && dy === 0) return 0;
  const ax = dx < 0 ? -dx : dx;
  const ay = dy < 0 ? -dy : dy;
  const s = ay * 1024;
  let q = 4;
  if (s < ax * DIR16_TAN[0]) q = 0;
  else if (s < ax * DIR16_TAN[1]) q = 1;
  else if (s < ax * DIR16_TAN[2]) q = 2;
  else if (s < ax * DIR16_TAN[3]) q = 3;
  if (dx >= 0) return dy >= 0 ? q : (16 - q) % 16;
  return dy >= 0 ? 8 - q : 8 + q;
}

/** xorshift32 with a fixed seed: shifts and XOR only, identical in GDScript. */
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
  below(n: number): number {
    return this.next() % n;
  }
}

export const FNV_OFFSET = 2166136261;
const FNV_PRIME = 16777619;

/** FNV-1a (32 bit) over the four little-endian bytes of a non-negative int32. */
export function fnvWord(h: number, v: number): number {
  for (let s = 0; s < 32; s += 8) {
    h = (h ^ ((v >>> s) & 255)) >>> 0;
    h = Math.imul(h, FNV_PRIME) >>> 0;
  }
  return h;
}

export function hex8(h: number): string {
  return (h >>> 0).toString(16).padStart(8, "0");
}
