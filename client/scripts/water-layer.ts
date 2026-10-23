// The water's ripples (art-v6's water layer, drawn by the ground's shader): war-game-ui's
// ground_r8.py water_layer() in TypeScript, for the development set and the test page until ui
// ships theirs. Small waves (value noise, 4 m a tile) seen from the game's camera (30° up, looking
// north): a dark body, the sky in it by the rippled surface's fresnel. RGBA bytes, sRGB, height in A.

import { valueNoise } from "../src/art/ground.ts";

export function waterLayer(size = 512, tileM = 4, seed = 7, deep: readonly number[] = [0.012, 0.03, 0.036]): Uint8Array {
  const h = new Float64Array(size * size);
  for (const [cells, weight] of [[8, 0.55], [16, 0.3], [32, 0.15]] as const) {
    const v = valueNoise(size, cells, seed + cells);
    for (let i = 0; i < h.length; i++) h[i] += (v[i] / 255) * weight;
  }
  const px = tileM / size;
  // numpy's gradient: central inside, one-sided at the edges; waves a few centimetres high.
  const at = (x: number, y: number) => h[y * size + x] * 0.12;
  const grad = (x: number, y: number, dx: number, dy: number) => {
    const xa = Math.max(0, x - dx);
    const ya = Math.max(0, y - dy);
    const xb = Math.min(size - 1, x + dx);
    const yb = Math.min(size - 1, y + dy);
    return (at(xb, yb) - at(xa, ya)) / (px * (dx !== 0 ? xb - xa : yb - ya));
  };
  const v = [0, Math.cos(Math.PI / 6), -Math.sin(Math.PI / 6)];
  const srgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.max(c, 0) ** (1 / 2.4) - 0.055);
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const gx = grad(x, y, 1, 0);
      const gy = grad(x, y, 0, 1);
      // The image's y runs south: north is the row before.
      let nx = -gx;
      let ny = gy;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len;
      ny /= len;
      nz /= len;
      const nv = nx * v[0] + ny * v[1] + nz * v[2];
      const cosv = Math.min(1, Math.max(0, -nv));
      const fres = 0.02 + 0.98 * (1 - cosv) ** 5;
      const rz = v[2] - 2 * nv * nz;
      const up = Math.min(1, Math.max(0, rz));
      const sky = [0.55 * (1 - up) + 0.3 * up, 0.6 * (1 - up) + 0.42 * up, 0.64 * (1 - up) + 0.58 * up];
      const o = (y * size + x) * 4;
      for (let c = 0; c < 3; c++) out[o + c] = Math.round(Math.min(1, Math.max(0, srgb(deep[c] * (1 - fres) + sky[c] * fres * 2.6))) * 255);
      out[o + 3] = Math.round(Math.min(1, h[y * size + x]) * 255);
    }
  }
  return out;
}
