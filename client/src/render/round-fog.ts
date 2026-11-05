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
