// 寫實地面 (D-093; the R8 brief, item 6): war-game-ui's ground (ground/ground.json, art-v6 on; agreed
// with ui 2026-10-21) and which ground each cell gets. The ground is blended on the GPU
// (render/ground-draw.ts): grass everywhere, the river bank by water, gravel by rock and cliffs,
// dirt by the resource points and in patches. Here, from the cells' Terrain values and the
// resource points only, a weight a cell for each, one texel a cell; the GPU smooths and frays the
// edges between. Pure, for the unit tests.

export const GROUND_FORMAT = "war-game ground 1";

export const GROUND_LAYERS = ["grass", "grass_dry", "dirt", "gravel", "bank"] as const;
export type GroundLayerId = (typeof GROUND_LAYERS)[number];

/** A tileable texture: its colour lit from above (RGB, sRGB), its height in A (the higher shows through), `tile_m` metres a tile. */
export interface GroundTexture {
  id: GroundLayerId;
  file: string;
  /** The same at 2 倍 as ASTC 4×4 (KTX), where the GPU has it. */
  astc?: string;
  tile_m: number;
  /** Mean colour, linear RGB. */
  mean: [number, number, number];
  /**
   * A photo not yet lit (the development set: R7's CC0 textures as they come): recoloured to `tint`
   * (linear albedo) by its own light and dark, `contrast` of it kept, its height from its brightness.
   */
  tint?: [number, number, number];
  contrast?: number;
}

export interface GroundJson {
  format: string;
  layers: GroundTexture[];
  /** Tileable grey value noise (the edges), and the large light and dark that break the repetition; made here when absent. */
  noise?: { file: string; tile_m: number };
  macro?: { file: string; tile_m: number };
  rules: {
    /** Cells round water (3–6) that are river bank; round rock and cliffs (1, 7) gravel. */
    bank_cells: number;
    gravel_cells: number;
    /** How wide an edge between two grounds is (m), and how much the heights move it. */
    edge_m: number;
    height_k: number;
    /** Dirt round the resource points, and in patches where the noise is over the threshold (0–1). */
    dirt: { node_cells: number; noise_threshold: number };
  };
  /** The whole ground multiplied last: ui sets them against the units' contrast (R8: 找得到兵). */
  grade: { brightness: number; saturation: number };
}

export function parseGround(v: unknown): GroundJson {
  const g = v as GroundJson;
  if (typeof g !== "object" || g === null || g.format !== GROUND_FORMAT) throw new Error(`not a ${GROUND_FORMAT} description`);
  if (!Array.isArray(g.layers) || typeof g.rules !== "object") throw new Error("incomplete ground description");
  for (const id of GROUND_LAYERS) if (!g.layers.some((l) => l.id === id && l.tile_m > 0)) throw new Error(`ground: no ${id}`);
  return { ...g, grade: { brightness: g.grade?.brightness ?? 1, saturation: g.grade?.saturation ?? 1 } };
}

const wet = (t: number) => t >= 3 && t <= 6;
const stony = (t: number) => t === 1 || t === 7;

/**
 * A cell's weights, 4 bytes a cell (RGBA, row by row): R the river bank, G gravel, B dirt (A
 * unused), 255 within the rules' distances (cells, x or y: Chebyshev), else 0. `nodes`: the cells
 * of the resource points (not the trees).
 */
export function groundWeights(ground: Uint8Array, n: number, nodes: readonly number[], rules: GroundJson["rules"]): Uint8Array {
  const out = new Uint8Array(n * n * 4);
  const near = (channel: number, seeds: (i: number) => boolean, reach: number) => {
    if (reach < 0) return;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (!seeds(y * n + x)) continue;
        for (let yy = Math.max(0, y - reach); yy <= Math.min(n - 1, y + reach); yy++) {
          for (let xx = Math.max(0, x - reach); xx <= Math.min(n - 1, x + reach); xx++) out[(yy * n + xx) * 4 + channel] = 255;
        }
      }
    }
  };
  near(0, (i) => wet(ground[i]), rules.bank_cells);
  near(1, (i) => stony(ground[i]), rules.gravel_cells);
  const nodeAt = new Uint8Array(n * n);
  for (const c of nodes) if (c >= 0 && c < n * n) nodeAt[c] = 1;
  near(2, (i) => nodeAt[i] === 1, rules.dirt.node_cells);
  return out;
}

/**
 * Tileable value noise (`size` square, a lattice of `cells` a side, smoothstep between), one byte
 * a pixel; the same on every device (a fixed integer hash, no Math.random).
 */
export function valueNoise(size: number, cells: number, seed: number): Uint8Array {
  const lattice = new Float64Array(cells * cells);
  let s = seed >>> 0 || 1;
  for (let i = 0; i < lattice.length; i++) {
    // xorshift32
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    lattice[i] = s / 4294967296;
  }
  const out = new Uint8Array(size * size);
  const step = size / cells;
  const at = (x: number, y: number) => lattice[(((y % cells) + cells) % cells) * cells + (((x % cells) + cells) % cells)];
  const ease = (t: number) => t * t * (3 - 2 * t);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fx = x / step;
      const fy = y / step;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const tx = ease(fx - x0);
      const ty = ease(fy - y0);
      const a = at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx;
      const b = at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx;
      out[y * size + x] = Math.round((a * (1 - ty) + b * ty) * 255);
    }
  }
  return out;
}
