// 寫實地面 (D-093; the R8 brief, item 6): war-game-ui's ground (ground/ground.json, art-v6 on; agreed
// with ui 2026-10-21) and which ground each cell gets. The ground is blended on the GPU
// (render/ground-draw.ts): grass everywhere, the river bank by water, gravel by rock and cliffs,
// dirt by the resource points and in patches. Here, from the cells' Terrain values and the
// resource points only, a weight for each: one texel a cell, the GPU smoothing and fraying the
// edges between; or (rules.weights, R8-28, the user 2026-10-22: 「河岸一格一格的方塊」) several
// texels a cell, soft with the distance from the seed cells and blurred, so that a diagonal river's
// bank follows the water, not the cells (war-game-ui's ground_r8.py weights(), the same numbers).
// Pure, for the unit tests.

export const GROUND_FORMAT = "war-game ground 1";

export const GROUND_LAYERS = ["grass", "grass_dry", "dirt", "gravel", "bank"] as const;
export type GroundLayerId = (typeof GROUND_LAYERS)[number];

/** A tileable texture: its colour lit from above (RGB, sRGB), its height in A (the higher shows through), `tile_m` metres a tile. */
export interface GroundTexture {
  /**
   * One of GROUND_LAYERS, or (art-v6) `water`: the water's ripples, lit, drawn by the shader
   * (rules.water); `yard`: packed earth, the towns' lanes and trampled ground (rules.town).
   */
  id: GroundLayerId | "water" | "yard";
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
    /**
     * Dirt round the resource points, and in patches where the noise is over the threshold (0–1);
     * `noise_soft` (R8-28): the patches' edge that wide in the noise, about the threshold (absent:
     * 0.06 from it up, a hard edge).
     */
    dirt: { node_cells: number; noise_threshold: number; noise_soft?: number };
    /**
     * The weights soft (R8-28): `texels_per_cell` texels a cell; a channel 0.5 at its reach (cells)
     * past the nearest seed cell's square, from 1 to 0 over `soft_m` metres; then a Gaussian blur of
     * `blur_m` metres (edges clamped). Absent: one texel a cell, on or off (Chebyshev).
     */
    weights?: { texels_per_cell: number; soft_m: number; blur_m: number };
    /**
     * The water drawn by the ground's shader (art-v6, ceo 2026-10-23; ui's ground_r8.py): the weight
     * map's A is the signed distance to the water's edge (in the water +, on land −, metres) clamped
     * to `range_m` and blurred `blur_m` (absent: weights.blur_m); the shader darkens a wet band
     * `wet_m` wide on land (to `wet_dark`), lays the water inside (`edge_m` soft, its edge moved by the
     * noise `noise_m`), the bed showing through the shallows (`bed`, `bed_shallow`, `shallow` linear
     * RGB, `depth_m`), the water layer's ripples drifting at `flow` (two, m/s). Only with the weights
     * and a `water` layer; absent, the terrain's water tiles as before.
     */
    water?: {
      range_m: number;
      blur_m?: number;
      edge_m: number;
      wet_m: number;
      wet_dark: number;
      depth_m: number;
      shallow: [number, number, number];
      deep?: [number, number, number];
      bed: number;
      bed_shallow: number;
      noise_m: number;
      flow: [[number, number], [number, number]];
    };
    /**
     * The towns' ground (art-v6, R8-36 B; ui's ground_r8.py town_weights): the castles' lanes and
     * trampled earth (castle 2 layouts' `ground`), each a channel of a second weight map: the signed
     * distance to its cells (inside +, outside −, metres), smoothstep(−soft_m/2, soft_m/2), blurred
     * blur_m, times the cells' strengths blurred a quarter cell; laid over the ground like the others,
     * its edge `edge_m` soft, from the layer `layers[culture]` names (both `yard` in art-v6).
     */
    town?: { soft_m: number; blur_m: number; edge_m: number; layers: Record<"E" | "W", { lane: string; trampled: string }> };
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

/** The water drawn by the shader (rules.water, with the weights and a `water` layer); else the terrain's tiles. */
export const groundWater = (g: Pick<GroundJson, "layers" | "rules">): boolean => g.rules.water !== undefined && g.rules.weights !== undefined && g.layers.some((l) => l.id === "water");
const stony = (t: number) => t === 1 || t === 7;

/** The towns' ground drawn by the shader (rules.town, with the weights and its layers). */
export const townGroundOn = (g: Pick<GroundJson, "layers" | "rules">): boolean =>
  g.rules.town !== undefined && g.rules.weights !== undefined && Object.values(g.rules.town.layers).every((l) => g.layers.some((x) => x.id === l.lane) && g.layers.some((x) => x.id === l.trampled));

/** Metres a cell (the ground's tiles and noise are in metres). */
export const GROUND_CELL_M = 2;

/** Texels a side of the weight map: the cells times rules.weights.texels_per_cell (1 without). */
export const weightsSide = (n: number, rules: GroundJson["rules"]): number => n * Math.max(1, Math.floor(rules.weights?.texels_per_cell ?? 1));

const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/**
 * The weight map kept for a game (render/ground-draw.ts uploads `data`): `set` the cells' grounds
 * and resource points as they are now, and only the texels near the seeds that changed are made
 * again (a mine running out, a random map's rocks found), the same as making it all again.
 */
export class GroundWeights {
  readonly side: number;
  /** RGBA, row by row, `side` texels a side: R bank, G gravel, B dirt; A the water's signed distance (rules.water). */
  readonly data: Uint8Array;
  private readonly n: number;
  private readonly rules: GroundJson["rules"];
  /** The seeds as last set, a byte a cell: bit 0 wet, 1 stony, 2 a resource point. */
  private seeds: Uint8Array | null = null;

  /** The water in A (rules.water, ground.json with a water layer). */
  private readonly water: boolean;

  constructor(n: number, rules: GroundJson["rules"], water = false) {
    this.n = n;
    this.rules = rules;
    this.water = water && rules.water !== undefined && rules.weights !== undefined;
    this.side = weightsSide(n, rules);
    this.data = new Uint8Array(this.side * this.side * 4);
  }

  /** The grounds and resource points now; false when no seed changed (nothing to upload). */
  set(ground: Uint8Array, nodes: readonly number[]): boolean {
    const n = this.n;
    const seeds = new Uint8Array(n * n);
    for (let i = 0; i < n * n; i++) seeds[i] = (wet(ground[i]) ? 1 : 0) | (stony(ground[i]) ? 2 : 0);
    for (const c of nodes) if (c >= 0 && c < n * n) seeds[c] |= 4;
    const before = this.seeds;
    this.seeds = seeds;
    if (this.rules.weights === undefined) {
      if (before !== null && before.every((v, i) => v === seeds[i])) return false;
      this.data.set(groundWeights(ground, n, nodes, this.rules));
      return true;
    }
    // The cells whose seeds changed (all, the first time).
    let x0 = n;
    let y0 = n;
    let x1 = -1;
    let y1 = -1;
    for (let i = 0; i < n * n; i++) {
      if (before !== null && before[i] === seeds[i]) continue;
      const x = i % n;
      const y = Math.floor(i / n);
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    if (x1 < 0) return false;
    // What a seed reaches: its falloff, then the blur.
    const w = this.rules.weights;
    const k = this.side / n;
    const reach = Math.max(this.rules.bank_cells, this.rules.gravel_cells, this.rules.dirt.node_cells);
    const sigma = (w.blur_m * k) / GROUND_CELL_M;
    const blurR = sigma > 0 ? Math.floor(3 * sigma) + 1 : 0;
    let pad = Math.ceil((reach * GROUND_CELL_M + w.soft_m / 2) / GROUND_CELL_M) + Math.ceil(blurR / k) + 1;
    if (this.water) pad = Math.max(pad, this.waterPad());
    const r = [Math.max(0, x0 - pad) * k, Math.max(0, y0 - pad) * k, Math.min(n, x1 + 1 + pad) * k, Math.min(n, y1 + 1 + pad) * k] as const;
    this.region(...r);
    if (this.water) this.waterRegion(...r);
    return true;
  }

  /** Cells round a changed one whose water distance may change: its reach, a cell beyond (the edge cells), the blur. */
  private waterPad(): number {
    const wa = this.rules.water as NonNullable<GroundJson["rules"]["water"]>;
    const blurM = wa.blur_m ?? (this.rules.weights as NonNullable<GroundJson["rules"]["weights"]>).blur_m;
    return Math.ceil((wa.range_m + 3 * blurM) / GROUND_CELL_M) + 2;
  }

  /**
   * A, the water's signed distance, for the texels [tx0, tx1) × [ty0, ty1) (rules.water): in a wet
   * cell the distance to the nearest dry one, in a dry cell minus the distance to the nearest wet one
   * (0 on the edge either side), clamped to range_m, blurred blur_m; cells off the map are the nearest
   * cell's, so a river running off the edge grows no bank there (ui's ground_r8.py water_distance).
   */
  private waterRegion(tx0: number, ty0: number, tx1: number, ty1: number): void {
    const wa = this.rules.water as NonNullable<GroundJson["rules"]["water"]>;
    const seeds = this.seeds as Uint8Array;
    const n = this.n;
    const side = this.side;
    const k = side / n;
    const texelM = GROUND_CELL_M / k;
    const blurM = wa.blur_m ?? (this.rules.weights as NonNullable<GroundJson["rules"]["weights"]>).blur_m;
    const sigma = (blurM * k) / GROUND_CELL_M;
    const blurR = sigma > 0 ? Math.floor(3 * sigma) + 1 : 0;
    const kernel: number[] = [];
    let sum = 0;
    for (let i = -blurR; i <= blurR; i++) {
      const v = blurR === 0 ? 1 : Math.exp(-(i * i) / (2 * sigma * sigma));
      kernel.push(v);
      sum += v;
    }
    for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;
    const clampC = (v: number) => Math.min(n - 1, Math.max(0, v));
    const wetAt = (x: number, y: number) => (seeds[clampC(y) * n + clampC(x)] & 1) !== 0;
    // The distances over the region and the blur round it, past the map's edge too (the ground there the nearest cell's).
    const ex0 = tx0 - blurR;
    const ey0 = ty0 - blurR;
    const ew = tx1 - tx0 + 2 * blurR;
    const eh = ty1 - ty0 + 2 * blurR;
    const far = wa.range_m + 2 * GROUND_CELL_M;
    const dl = new Float64Array(ew * eh).fill(1e9);
    const dw = new Float64Array(ew * eh).fill(1e9);
    const reachT = Math.ceil(far / texelM) + 1;
    const cx0 = Math.floor(ex0 / k) - Math.ceil(far / GROUND_CELL_M) - 1;
    const cy0 = Math.floor(ey0 / k) - Math.ceil(far / GROUND_CELL_M) - 1;
    const cx1 = Math.floor((ex0 + ew - 1) / k) + Math.ceil(far / GROUND_CELL_M) + 1;
    const cy1 = Math.floor((ey0 + eh - 1) / k) + Math.ceil(far / GROUND_CELL_M) + 1;
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const isWet = wetAt(cx, cy);
        // Only the cells along the edge: a wet one beside a dry one, a dry one beside a wet one.
        const edge = wetAt(cx - 1, cy) !== isWet || wetAt(cx + 1, cy) !== isWet || wetAt(cx, cy - 1) !== isWet || wetAt(cx, cy + 1) !== isWet;
        if (!edge) continue;
        const d = isWet ? dw : dl;
        const sx = (cx + 0.5) * GROUND_CELL_M;
        const sy = (cy + 0.5) * GROUND_CELL_M;
        for (let ty = Math.max(ey0, cy * k - reachT); ty < Math.min(ey0 + eh, (cy + 1) * k + reachT); ty++) {
          const dy = Math.max(Math.abs((ty + 0.5) * texelM - sy) - GROUND_CELL_M / 2, 0);
          for (let tx = Math.max(ex0, cx * k - reachT); tx < Math.min(ex0 + ew, (cx + 1) * k + reachT); tx++) {
            const dx = Math.max(Math.abs((tx + 0.5) * texelM - sx) - GROUND_CELL_M / 2, 0);
            const dist = Math.hypot(dx, dy);
            const at = (ty - ey0) * ew + (tx - ex0);
            if (dist < d[at]) d[at] = dist;
          }
        }
      }
    }
    const sd = new Float64Array(ew * eh);
    for (let ty = ey0; ty < ey0 + eh; ty++) {
      for (let tx = ex0; tx < ex0 + ew; tx++) {
        const at = (ty - ey0) * ew + (tx - ex0);
        const inWet = wetAt(Math.floor(tx / k), Math.floor(ty / k));
        const v = inWet ? Math.min(dl[at], far) : -Math.min(dw[at], far);
        sd[at] = Math.min(wa.range_m, Math.max(-wa.range_m, v));
      }
    }
    // The blur, rows (y) then columns (x) as ground_r8.py's, on the extended texels.
    const rows = new Float64Array(ew * (ty1 - ty0));
    for (let ty = ty0; ty < ty1; ty++) {
      for (let tx = ex0; tx < ex0 + ew; tx++) {
        let v = 0;
        for (let i = -blurR; i <= blurR; i++) v += sd[(ty + i - ey0) * ew + (tx - ex0)] * kernel[i + blurR];
        rows[(ty - ty0) * ew + (tx - ex0)] = v;
      }
    }
    for (let ty = ty0; ty < ty1; ty++) {
      for (let tx = tx0; tx < tx1; tx++) {
        let v = 0;
        for (let i = -blurR; i <= blurR; i++) v += rows[(ty - ty0) * ew + (tx + i - ex0)] * kernel[i + blurR];
        this.data[(ty * side + tx) * 4 + 3] = Math.round(Math.min(1, Math.max(0, 0.5 + v / wa.range_m / 2)) * 255);
      }
    }
  }

  /** The texels [tx0, tx1) × [ty0, ty1) made again from the seeds (rules.weights on). */
  private region(tx0: number, ty0: number, tx1: number, ty1: number): void {
    const w = this.rules.weights as NonNullable<GroundJson["rules"]["weights"]>;
    const seeds = this.seeds as Uint8Array;
    const n = this.n;
    const side = this.side;
    const k = side / n;
    const sigma = (w.blur_m * k) / GROUND_CELL_M;
    const blurR = sigma > 0 ? Math.floor(3 * sigma) + 1 : 0;
    const kernel: number[] = [];
    let sum = 0;
    for (let i = -blurR; i <= blurR; i++) {
      const v = blurR === 0 ? 1 : Math.exp(-(i * i) / (2 * sigma * sigma));
      kernel.push(v);
      sum += v;
    }
    for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;
    // The falloff over the region and the blur's reach round it (within the map).
    const ex0 = Math.max(0, tx0 - blurR);
    const ey0 = Math.max(0, ty0 - blurR);
    const ex1 = Math.min(side, tx1 + blurR);
    const ey1 = Math.min(side, ty1 + blurR);
    const ew = ex1 - ex0;
    const eh = ey1 - ey0;
    const texelM = GROUND_CELL_M / k;
    const channels: [number, number][] = [
      [1, this.rules.bank_cells],
      [2, this.rules.gravel_cells],
      [4, this.rules.dirt.node_cells],
    ];
    channels.forEach(([bit, reachCells], ch) => {
      const r = reachCells * GROUND_CELL_M;
      const far = r + w.soft_m / 2;
      const d = new Float64Array(ew * eh).fill(1e9);
      const padCells = Math.ceil(far / GROUND_CELL_M) + 1;
      const cx0 = Math.max(0, Math.floor(ex0 / k) - padCells);
      const cy0 = Math.max(0, Math.floor(ey0 / k) - padCells);
      const cx1 = Math.min(n - 1, Math.floor((ex1 - 1) / k) + padCells);
      const cy1 = Math.min(n - 1, Math.floor((ey1 - 1) / k) + padCells);
      for (let cy = cy0; cy <= cy1; cy++) {
        for (let cx = cx0; cx <= cx1; cx++) {
          if ((seeds[cy * n + cx] & bit) === 0) continue;
          // The seed's square in metres, and the texels it may reach.
          const sx0 = cx * GROUND_CELL_M;
          const sy0 = cy * GROUND_CELL_M;
          const reachT = Math.ceil(far / texelM) + 1;
          for (let ty = Math.max(ey0, cy * k - reachT); ty < Math.min(ey1, (cy + 1) * k + reachT); ty++) {
            const my = (ty + 0.5) * texelM;
            const dy = Math.max(Math.abs(my - (sy0 + GROUND_CELL_M / 2)) - GROUND_CELL_M / 2, 0);
            for (let tx = Math.max(ex0, cx * k - reachT); tx < Math.min(ex1, (cx + 1) * k + reachT); tx++) {
              const mx = (tx + 0.5) * texelM;
              const dx = Math.max(Math.abs(mx - (sx0 + GROUND_CELL_M / 2)) - GROUND_CELL_M / 2, 0);
              const dist = Math.hypot(dx, dy);
              const at = (ty - ey0) * ew + (tx - ex0);
              if (dist < d[at]) d[at] = dist;
            }
          }
        }
      }
      const f = new Float64Array(ew * eh);
      for (let i = 0; i < f.length; i++) f[i] = smooth(far, r - w.soft_m / 2, d[i]);
      // The blur, rows (y) then columns (x) as ground_r8.py's, the map's edges clamped.
      const rows = new Float64Array(ew * (ty1 - ty0));
      for (let ty = ty0; ty < ty1; ty++) {
        for (let tx = ex0; tx < ex1; tx++) {
          let v = 0;
          for (let i = -blurR; i <= blurR; i++) {
            const yy = Math.min(side - 1, Math.max(0, ty + i));
            v += f[(yy - ey0) * ew + (tx - ex0)] * kernel[i + blurR];
          }
          rows[(ty - ty0) * ew + (tx - ex0)] = v;
        }
      }
      for (let ty = ty0; ty < ty1; ty++) {
        for (let tx = tx0; tx < tx1; tx++) {
          let v = 0;
          for (let i = -blurR; i <= blurR; i++) {
            const xx = Math.min(side - 1, Math.max(0, tx + i));
            v += rows[(ty - ty0) * ew + (xx - ex0)] * kernel[i + blurR];
          }
          this.data[(ty * side + tx) * 4 + ch] = Math.round(Math.min(1, Math.max(0, v)) * 255);
        }
      }
    });
  }
}

/** A box of cells, inclusive. */
export interface CellBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Cells round a town's box made again with it: the edge's softness and blurs reach no farther. */
const TOWN_PAD = 2;

/**
 * The towns' weight map (rules.town; render/ground-draw.ts uploads `data`): R the lanes, G the
 * trampled earth, `texels_per_cell` texels a cell as the ground's. `set` the cells' strengths and the
 * towns' boxes; only the boxes are made (the ground elsewhere is no town's), and only when a cell changed.
 */
export class TownWeights {
  readonly side: number;
  readonly data: Uint8Array;
  private readonly n: number;
  private readonly rules: GroundJson["rules"];
  private last: Float32Array[] | null = null;

  constructor(n: number, rules: GroundJson["rules"]) {
    this.n = n;
    this.rules = rules;
    this.side = weightsSide(n, rules);
    this.data = new Uint8Array(this.side * this.side * 4);
  }

  /** The lanes' and the trampled earth's strengths now, a cell each (0–1), in these towns' boxes; false when nothing changed. */
  set(lane: Float32Array, trampled: Float32Array, boxes: readonly CellBox[]): boolean {
    const before = this.last;
    if (before !== null && before[0].every((v, i) => v === lane[i]) && before[1].every((v, i) => v === trampled[i])) return false;
    this.last = [lane.slice(), trampled.slice()];
    this.data.fill(0);
    for (const b of boxes) [lane, trampled].forEach((s, ch) => this.box(s, ch, b));
    return true;
  }

  /** Channel `ch` over a town's box (and TOWN_PAD round it): ui's town_weights there. */
  private box(s: Float32Array, ch: number, b: CellBox): void {
    const tr = this.rules.town as NonNullable<GroundJson["rules"]["town"]>;
    const n = this.n;
    const side = this.side;
    const k = side / n;
    const texelM = GROUND_CELL_M / k;
    const cx0 = Math.max(0, b.x0 - TOWN_PAD);
    const cy0 = Math.max(0, b.y0 - TOWN_PAD);
    const cx1 = Math.min(n - 1, b.x1 + TOWN_PAD);
    const cy1 = Math.min(n - 1, b.y1 + TOWN_PAD);
    const tx0 = cx0 * k;
    const ty0 = cy0 * k;
    const w = (cx1 + 1) * k - tx0;
    const h = (cy1 + 1) * k - ty0;
    // Off the map is outside (ui pads the cells with none).
    const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < n && y < n && s[y * n + x] > 0;
    const inBox = (x: number, y: number) => x >= cx0 && x <= cx1 && y >= cy0 && y <= cy1;
    // The signed distance: from the region's edge cells (inside ones beside an outside one, outside ones beside an inside one).
    const f = new Float64Array(w * h);
    for (let ty = 0; ty < h; ty++) {
      for (let tx = 0; tx < w; tx++) {
        const X = (tx0 + tx + 0.5) * texelM;
        const Y = (ty0 + ty + 0.5) * texelM;
        const cx = Math.floor((tx0 + tx) / k);
        const cy = Math.floor((ty0 + ty) / k);
        const isIn = inside(cx, cy);
        let d = 1e3;
        for (let y = cy - TOWN_PAD; y <= cy + TOWN_PAD; y++) {
          for (let x = cx - TOWN_PAD; x <= cx + TOWN_PAD; x++) {
            const seedIn = inside(x, y);
            if (seedIn === isIn) continue;
            // An edge cell of the other side: one of its four neighbours is on this side.
            if (inside(x - 1, y) === seedIn && inside(x + 1, y) === seedIn && inside(x, y - 1) === seedIn && inside(x, y + 1) === seedIn) continue;
            const dx = Math.max(Math.abs(X - (x + 0.5) * GROUND_CELL_M) - GROUND_CELL_M / 2, 0);
            const dy = Math.max(Math.abs(Y - (y + 0.5) * GROUND_CELL_M) - GROUND_CELL_M / 2, 0);
            d = Math.min(d, Math.hypot(dx, dy));
          }
        }
        f[ty * w + tx] = smooth(-tr.soft_m / 2, tr.soft_m / 2, isIn ? d : -d);
      }
    }
    const strength = new Float64Array(w * h);
    for (let ty = 0; ty < h; ty++) for (let tx = 0; tx < w; tx++) strength[ty * w + tx] = s[Math.floor((ty0 + ty) / k) * n + Math.floor((tx0 + tx) / k)];
    // Blurred as ui's (rows then columns, the map's edges clamped; past the box the town's channel is 0), and multiplied.
    const blurred = (a: Float64Array, sigma: number): Float64Array => {
      if (sigma <= 0) return a;
      const r = Math.floor(3 * sigma) + 1;
      const kern: number[] = [];
      for (let i = -r; i <= r; i++) kern.push(Math.exp(-(i * i) / (2 * sigma * sigma)));
      const sum = kern.reduce((x, y) => x + y, 0);
      const at = (tx: number, ty: number) => {
        const gx = Math.min(side - 1, Math.max(0, tx0 + tx));
        const gy = Math.min(side - 1, Math.max(0, ty0 + ty));
        return inBox(Math.floor(gx / k), Math.floor(gy / k)) ? a[(gy - ty0) * w + (gx - tx0)] : 0;
      };
      const rows = new Float64Array(w * h);
      for (let ty = 0; ty < h; ty++) for (let tx = 0; tx < w; tx++) {
        let v = 0;
        for (let i = -r; i <= r; i++) v += at(tx, ty + i) * kern[i + r];
        rows[ty * w + tx] = v / sum;
      }
      const out = new Float64Array(w * h);
      const atRow = (tx: number, ty: number) => {
        const gx = Math.min(side - 1, Math.max(0, tx0 + tx));
        return inBox(Math.floor(gx / k), cy0) ? rows[ty * w + (gx - tx0)] : 0;
      };
      for (let ty = 0; ty < h; ty++) for (let tx = 0; tx < w; tx++) {
        let v = 0;
        for (let i = -r; i <= r; i++) v += atRow(tx + i, ty) * kern[i + r];
        out[ty * w + tx] = v / sum;
      }
      return out;
    };
    const wf = blurred(f, (tr.blur_m * k) / GROUND_CELL_M);
    const ws = blurred(strength, 0.25 * k);
    for (let ty = 0; ty < h; ty++) {
      for (let tx = 0; tx < w; tx++) {
        const o = ((ty0 + ty) * side + tx0 + tx) * 4 + ch;
        this.data[o] = Math.max(this.data[o], Math.round(Math.min(1, Math.max(0, wf[ty * w + tx] * ws[ty * w + tx])) * 255));
      }
    }
  }
}

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
