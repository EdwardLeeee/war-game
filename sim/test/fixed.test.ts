import assert from "node:assert/strict";
import { test } from "node:test";
import { dir16, fnvBytes, fnvWord, FNV_OFFSET, idiv, isqrt, Rng } from "../src/core/fixed.ts";

test("xorshift32 matches the reference sequence (same as the engine spike)", () => {
  const r = new Rng(1);
  assert.deepEqual([r.next(), r.next(), r.next()], [270369, 67634689, 2647435461]);
});

test("idiv truncates toward zero; isqrt is exact for large values", () => {
  assert.equal(idiv(-7, 2), -3);
  assert.equal(idiv(7, 2), 3);
  for (const v of [0, 1, 2, 3, 4, 15, 16, 17, 99, 100, 2 ** 40, 2 ** 40 - 1, 2 ** 50 + 12345]) {
    const r = isqrt(v);
    assert.ok(r * r <= v && (r + 1) * (r + 1) > v, `isqrt(${v}) = ${r}`);
  }
});

test("dir16 sectors", () => {
  assert.deepEqual([[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]].map(([x, y]) => dir16(x, y)), [0, 2, 4, 6, 8, 10, 12, 14]);
});

test("FNV-1a word and byte forms equal the BigInt reference", () => {
  let ref = 2166136261n;
  const words = [0, 1, -1, 255, 1 << 20, 0x7fffffff];
  let h = FNV_OFFSET;
  const bytes: number[] = [];
  for (const w of words) {
    h = fnvWord(h, w);
    for (let s = 0; s < 32; s += 8) {
      const b = (w >>> s) & 255;
      bytes.push(b);
      ref = ((ref ^ BigInt(b)) * 16777619n) & 0xffffffffn;
    }
  }
  assert.equal(h, Number(ref));
  assert.equal(fnvBytes(FNV_OFFSET, Uint8Array.from(bytes)), Number(ref));
});
