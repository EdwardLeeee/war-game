// 圓邊霧 redrawn only where the fog changed (round-fog.ts roundFogChanged; the user 2026-11-24 「200兵時畫面會卡卡的」:
// the whole fog was blurred again 6 times a second): to the bit the picture a whole redraw gives (ceo 2026-11-24),
// whatever changed: one cell, a few here and there, the map's edges and corners, much of the map, nothing.

import assert from "node:assert/strict";
import { test } from "node:test";
import { FOG_ROUND_SCALE, FOG_TILE, roundFog, roundFogChanged } from "../src/render/round-fog.ts";

const SIZE = 96;
const N = SIZE * FOG_ROUND_SCALE;
/** The fog's three alphas (world.ts FOG_ALPHA: in sight, explored, never seen), and a seeded random. */
const VALUES = [0, 115, 235];
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const whole = (cells: Uint8Array): Uint8ClampedArray => {
  const out = new Uint8ClampedArray(N * N * 4);
  roundFog(cells, SIZE, out, new Float32Array(N * N));
  return out;
};
/** The picture of `before`, then only the changes to `after`: the bytes, and the rectangles written. */
const changed = (before: Uint8Array, after: Uint8Array) => {
  const out = whole(before);
  const rects = roundFogChanged(after, before, SIZE, out);
  return { out, rects };
};
function sameBytes(a: Uint8ClampedArray, b: Uint8ClampedArray, what: string): void {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) assert.fail(`${what}: byte ${i} (texel ${Math.floor(i / 4) % N}, ${Math.floor(i / 4 / N)}) ${a[i]} ≠ ${b[i]}`);
}

/** A map like a game's: never seen far off, explored round the middle, in sight round a few spots. */
function mapLike(r: () => number): Uint8Array {
  const c = new Uint8Array(SIZE * SIZE).fill(VALUES[2]);
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) if ((x - 48) ** 2 + (y - 48) ** 2 < 40 * 40) c[y * SIZE + x] = VALUES[1];
  for (let s = 0; s < 12; s++) {
    const cx = Math.floor(r() * SIZE);
    const cy = Math.floor(r() * SIZE);
    const rad = 2 + Math.floor(r() * 7);
    for (let y = Math.max(0, cy - rad); y < Math.min(SIZE, cy + rad); y++) for (let x = Math.max(0, cx - rad); x < Math.min(SIZE, cx + rad); x++) if ((x - cx) ** 2 + (y - cy) ** 2 < rad * rad) c[y * SIZE + x] = VALUES[0];
  }
  return c;
}

test("圓邊霧只重畫變了的地方：一格、零星幾格（像大戰時一次 12–16 格）、地圖四邊和四角、一大片，每個像素都和整張重畫一樣", () => {
  const r = rng(7);
  for (let round = 0; round < 40; round++) {
    const before = mapLike(r);
    const after = before.slice();
    const kind = round % 4;
    if (kind === 0) {
      const i = Math.floor(r() * SIZE * SIZE);
      after[i] = VALUES[(VALUES.indexOf(before[i]) + 1) % 3];
    }
    if (kind === 1) for (let i = 0; i < 16; i++) after[Math.floor(r() * SIZE * SIZE)] = VALUES[Math.floor(r() * 3)];
    if (kind === 2) {
      // The edges and the corners (where the blur's edge is the map's).
      for (const [x, y] of [[0, 0], [SIZE - 1, 0], [0, SIZE - 1], [SIZE - 1, SIZE - 1], [0, 37], [SIZE - 1, 51], [44, 0], [62, SIZE - 1], [1, 1], [SIZE - 2, SIZE - 2]]) after[y * SIZE + x] = VALUES[(VALUES.indexOf(before[y * SIZE + x]) + 1) % 3];
    }
    if (kind === 3) for (let y = 10; y < 70; y++) for (let x = 20; x < 90; x++) if (r() < 0.3) after[y * SIZE + x] = VALUES[Math.floor(r() * 3)];
    const { out, rects } = changed(before, after);
    sameBytes(out, whole(after), `round ${round} (${["one cell", "16 here and there", "edges and corners", "much"][kind]})`);
    if (after.some((v, i) => v !== before[i])) assert.ok(rects.length > 0, `round ${round}: something written`);
  }
});

test("圓邊霧：一格變了只寫那一塊（不到整張的十分之一）；沒變就什麼都不寫；第一次整張畫照舊用 roundFog", () => {
  const before = mapLike(rng(3));
  const after = before.slice();
  after[40 * SIZE + 40] = after[40 * SIZE + 40] === 0 ? 235 : 0;
  const { rects } = changed(before, after);
  const area = rects.reduce((s, q) => s + q.w * q.h, 0);
  assert.equal(rects.length, 1);
  assert.ok(area < (N * N) / 10, `${area} texels of ${N * N}`);
  // The tile's texels and the blur's reach round them, inside the map.
  const R = 2 * Math.round(FOG_ROUND_SCALE * 0.75);
  assert.deepEqual(rects[0], { x: 5 * FOG_TILE * FOG_ROUND_SCALE - R, y: 5 * FOG_TILE * FOG_ROUND_SCALE - R, w: FOG_TILE * FOG_ROUND_SCALE + 2 * R, h: FOG_TILE * FOG_ROUND_SCALE + 2 * R });
  const { rects: none } = changed(before, before.slice());
  assert.deepEqual(none, []);
  // The first picture (from the fog never seen, all one value) to a game's, by changes only: the same as whole.
  const start = new Uint8Array(SIZE * SIZE).fill(235);
  const { out } = changed(start, before);
  sameBytes(out, whole(before), "from nothing seen");
});
