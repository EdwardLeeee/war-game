// 圓邊霧 (the user 2026-11-02 chose R9-07's round fog): the fog's edge drawn as a soft curve and not
// cell by cell. Only the picture: the simulation's sight is unchanged. Pure, for the unit tests.

/** Texels a cell for the round fog. */
export const FOG_ROUND_SCALE = 4;

/**
 * The round fog's alpha (FOG_ROUND_SCALE texels a cell) from one per cell: each cell's value over
 * its texels, then a box blur of about a cell, twice each way (near a Gaussian), so the edge of
 * sight is a soft curve and not stairs. `out` is RGBA, only alpha written; `tmp` the same size.
 */
export function roundFog(cells: Uint8Array, size: number, out: Uint8ClampedArray, tmp: Float32Array): void {
  const k = FOG_ROUND_SCALE;
  const n = size * k;
  const a = new Float32Array(tmp.buffer, 0, n * n);
  for (let y = 0; y < n; y++) {
    const row = ((y / k) | 0) * size;
    for (let x = 0; x < n; x++) a[y * n + x] = cells[row + ((x / k) | 0)];
  }
  const r = Math.round(k * 0.75);
  const line = new Float32Array(n);
  for (let pass = 0; pass < 2; pass++) {
    // Rows, then columns: a running sum over 2r + 1 texels, the edges clamped.
    for (let y = 0; y < n; y++) blurLine(a, y * n, 1, n, r, line);
    for (let x = 0; x < n; x++) blurLine(a, x, n, n, r, line);
  }
  for (let i = 0; i < n * n; i++) out[i * 4 + 3] = a[i];
}

function blurLine(a: Float32Array, start: number, step: number, n: number, r: number, line: Float32Array): void {
  const w = 2 * r + 1;
  let sum = 0;
  for (let i = -r; i <= r; i++) sum += a[start + Math.min(n - 1, Math.max(0, i)) * step];
  for (let i = 0; i < n; i++) {
    line[i] = sum / w;
    sum += a[start + Math.min(n - 1, i + r + 1) * step] - a[start + Math.max(0, i - r) * step];
  }
  for (let i = 0; i < n; i++) a[start + i * step] = line[i];
}

/** Cells a side of the round fog's tiles: a change redraws only its tiles (roundFogChanged). */
export const FOG_TILE = 8;

/** Texels the blur reaches (its two passes): what a changed texel changes, and what a texel is read from. */
const reach = (): number => 2 * Math.round(FOG_ROUND_SCALE * 0.75);

export interface FogRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

let windowBuf = new Float32Array(0);
let lineBuf = new Float32Array(0);

/**
 * The round fog again where `cells` changed from `prev` (both one value a cell, as roundFog takes them; `out` holds
 * roundFog's picture of `prev`): only the tiles of FOG_TILE cells with a change, with the blur's reach round them, so
 * the fog is redrawn in a few hundredths of the whole (the fog of a big battle changes 12 to 16 of 9216 cells a
 * time; the whole took 9 ms on the test machine, 6 times a second: 2026-11-24, the user's 「200兵時畫面會卡卡的」).
 *
 * The same alpha as roundFog over the whole, to the bit: each output texel is read from texels within the reach, so a
 * window of the reach beyond the output gives it whole (nearer the window's edge, where the edge is clamped, it
 * differs: those are not written), and every running sum is of float32 values far within a double's precision,
 * exact, so a window's sums are the whole line's. Returns the texel rectangles written; none when nothing changed.
 */
export function roundFogChanged(cells: Uint8Array, prev: Uint8Array, size: number, out: Uint8ClampedArray): FogRect[] {
  const k = FOG_ROUND_SCALE;
  const n = size * k;
  const tiles = Math.ceil(size / FOG_TILE);
  const dirty = new Uint8Array(tiles * tiles);
  let any = false;
  for (let i = 0; i < size * size; i++) {
    if (cells[i] === prev[i]) continue;
    dirty[Math.floor(Math.floor(i / size) / FOG_TILE) * tiles + Math.floor((i % size) / FOG_TILE)] = 1;
    any = true;
  }
  if (!any) return [];
  const R = reach();
  const r = R / 2;
  const rects: FogRect[] = [];
  for (let ty = 0; ty < tiles; ty++) {
    for (let tx = 0; tx < tiles; tx++) {
      if (dirty[ty * tiles + tx] === 0) continue;
      // What may change: the tile's texels and the reach round them. What that is read from: the reach again.
      const ox0 = Math.max(0, tx * FOG_TILE * k - R);
      const oy0 = Math.max(0, ty * FOG_TILE * k - R);
      const ox1 = Math.min(n, Math.min(size, (tx + 1) * FOG_TILE) * k + R);
      const oy1 = Math.min(n, Math.min(size, (ty + 1) * FOG_TILE) * k + R);
      const wx0 = Math.max(0, ox0 - R);
      const wy0 = Math.max(0, oy0 - R);
      const wx1 = Math.min(n, ox1 + R);
      const wy1 = Math.min(n, oy1 + R);
      const ww = wx1 - wx0;
      const wh = wy1 - wy0;
      if (windowBuf.length < ww * wh) windowBuf = new Float32Array(ww * wh);
      if (lineBuf.length < Math.max(ww, wh)) lineBuf = new Float32Array(Math.max(ww, wh));
      const a = new Float32Array(windowBuf.buffer, 0, ww * wh);
      for (let y = 0; y < wh; y++) {
        const row = (((wy0 + y) / k) | 0) * size;
        for (let x = 0; x < ww; x++) a[y * ww + x] = cells[row + (((wx0 + x) / k) | 0)];
      }
      const line = new Float32Array(lineBuf.buffer, 0, Math.max(ww, wh));
      for (let pass = 0; pass < 2; pass++) {
        for (let y = 0; y < wh; y++) blurLine(a, y * ww, 1, ww, r, line);
        for (let x = 0; x < ww; x++) blurLine(a, x, ww, wh, r, line);
      }
      for (let y = oy0; y < oy1; y++) {
        for (let x = ox0; x < ox1; x++) out[(y * n + x) * 4 + 3] = a[(y - wy0) * ww + (x - wx0)];
      }
      rects.push({ x: ox0, y: oy0, w: ox1 - ox0, h: oy1 - oy0 });
    }
  }
  return rects;
}
