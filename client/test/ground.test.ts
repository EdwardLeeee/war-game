// 寫實地面的權重圖 (R8-28, the user approved 2026-10-22): several texels a cell, soft with the
// distance from the water, rock and resource points, blurred, as war-game-ui's ground_r8.py
// weights(); made again only near the seeds that change, the same as all of it again.

import assert from "node:assert/strict";
import { test } from "node:test";
import { GROUND_CELL_M, type GroundJson, GroundWeights, groundWeights } from "../src/art/ground.ts";

const RULES: GroundJson["rules"] = {
  bank_cells: 1,
  gravel_cells: 1,
  edge_m: 1.2,
  height_k: 0.9,
  dirt: { node_cells: 1, noise_threshold: 0.8, noise_soft: 0.3 },
  weights: { texels_per_cell: 4, soft_m: 1.6, blur_m: 1.0 },
};

/** A stretch like R8-28's: a diagonal river (3), rocks (1), a cliff (7), two resource points. */
function sample(n = 14): { ground: Uint8Array; nodes: number[] } {
  const ground = new Uint8Array(n * n);
  for (let x = 0; x < n; x++) {
    const y = Math.floor(2 + x * 0.7);
    for (const yy of [y, y + 1]) if (yy < n) ground[yy * n + x] = 3;
  }
  ground[2 * n + 10] = ground[2 * n + 11] = 1;
  ground[11 * n + 2] = 7;
  return { ground, nodes: [9 * n + 3, 4 * n + 12] };
}

/** ground_r8.py weights() written plainly: every texel against every seed, then the blur over the whole map. */
function reference(ground: Uint8Array, nodes: number[], n: number, rules: GroundJson["rules"]): Uint8Array {
  const w = rules.weights as NonNullable<GroundJson["rules"]["weights"]>;
  const k = w.texels_per_cell;
  const side = n * k;
  const out = new Uint8Array(side * side * 4);
  const smooth = (e0: number, e1: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  };
  const sigma = (w.blur_m * k) / GROUND_CELL_M;
  const R = Math.floor(3 * sigma) + 1;
  const kern: number[] = [];
  for (let i = -R; i <= R; i++) kern.push(Math.exp(-(i * i) / (2 * sigma * sigma)));
  const sum = kern.reduce((a, b) => a + b, 0);
  const isNode = new Set(nodes);
  const chans: [(i: number) => boolean, number][] = [
    [(i) => ground[i] >= 3 && ground[i] <= 6, rules.bank_cells],
    [(i) => ground[i] === 1 || ground[i] === 7, rules.gravel_cells],
    [(i) => isNode.has(i), rules.dirt.node_cells],
  ];
  chans.forEach(([seed, reach], ch) => {
    const f = new Float64Array(side * side);
    const r = reach * GROUND_CELL_M;
    for (let ty = 0; ty < side; ty++) {
      for (let tx = 0; tx < side; tx++) {
        const X = ((tx + 0.5) / k) * GROUND_CELL_M;
        const Y = ((ty + 0.5) / k) * GROUND_CELL_M;
        let d = 1e9;
        for (let i = 0; i < n * n; i++) {
          if (!seed(i)) continue;
          const dx = Math.max(Math.abs(X - ((i % n) + 0.5) * GROUND_CELL_M) - GROUND_CELL_M / 2, 0);
          const dy = Math.max(Math.abs(Y - (Math.floor(i / n) + 0.5) * GROUND_CELL_M) - GROUND_CELL_M / 2, 0);
          d = Math.min(d, Math.hypot(dx, dy));
        }
        f[ty * side + tx] = smooth(r + w.soft_m / 2, r - w.soft_m / 2, d);
      }
    }
    const a = new Float64Array(side * side);
    for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) for (let i = -R; i <= R; i++) a[y * side + x] += (f[Math.min(side - 1, Math.max(0, y + i)) * side + x] * kern[i + R]) / sum;
    for (let y = 0; y < side; y++) {
      for (let x = 0; x < side; x++) {
        let v = 0;
        for (let i = -R; i <= R; i++) v += (a[y * side + Math.min(side - 1, Math.max(0, x + i))] * kern[i + R]) / sum;
        out[(y * side + x) * 4 + ch] = Math.round(Math.min(1, Math.max(0, v)) * 255);
      }
    }
  });
  return out;
}

const maxDiff = (a: Uint8Array, b: Uint8Array) => a.reduce((m, v, i) => Math.max(m, Math.abs(v - b[i])), 0);

test("權重圖（R8-28）：每格 4 個點，照離水、岩石、資源點的距離變淡再糊開，和 ui 的 ground_r8.py 算法一樣", () => {
  const n = 14;
  const { ground, nodes } = sample(n);
  const w = new GroundWeights(n, RULES);
  assert.equal(w.side, 56);
  assert.equal(w.set(ground, nodes), true);
  assert.ok(maxDiff(w.data, reference(ground, nodes, n, RULES)) <= 1, "the same as the plain formula");
  // A diagonal river's bank: right by the water full, its reach (1 cell = 2 m) about half, far from it none.
  const side = w.side;
  const bank = (tx: number, ty: number) => w.data[(ty * side + tx) * 4];
  // Column x = 6: water in rows 6 and 7 (its south edge at 16 m).
  const col = 6 * 4 + 2;
  assert.ok(bank(col, 28) > 240, "in the water (14.3 m)");
  assert.ok(bank(col, 36) > 100 && bank(col, 36) < 160, "its reach (2 m) past the edge, 18.3 m: about half");
  assert.ok(bank(col, 44) < 5, "past the reach, the soft and the blur (22.3 m): none");
  for (let ty = 28; ty < 44; ty++) assert.ok(bank(col, ty + 1) <= bank(col, ty), "fading away from the water");
});

test("權重圖：只重算種子變了的附近，結果和整張重算一樣；種子沒變就不重算", () => {
  const n = 14;
  const { ground, nodes } = sample(n);
  const w = new GroundWeights(n, RULES);
  w.set(ground, nodes);
  assert.equal(w.set(ground, nodes), false, "nothing changed: nothing to upload");
  // A mine runs out, rocks are found (a random map explored).
  const ground2 = ground.slice();
  ground2[8 * n + 9] = 1;
  const nodes2 = [nodes[1]];
  assert.equal(w.set(ground2, nodes2), true);
  const fresh = new GroundWeights(n, RULES);
  fresh.set(ground2, nodes2);
  assert.deepEqual(w.data, fresh.data);
});

test("權重圖：沒有 rules.weights 時照舊一格一個點、有或沒有（Chebyshev）", () => {
  const n = 14;
  const { ground, nodes } = sample(n);
  const { weights: _, ...plain } = RULES;
  const w = new GroundWeights(n, plain);
  assert.equal(w.side, n);
  w.set(ground, nodes);
  assert.deepEqual(w.data, groundWeights(ground, n, nodes, plain));
});

const WATER: NonNullable<GroundJson["rules"]["water"]> = {
  range_m: 4.5,
  blur_m: 1.5,
  edge_m: 0.35,
  wet_m: 0.9,
  wet_dark: 0.62,
  depth_m: 2.5,
  shallow: [0.045, 0.058, 0.045],
  bed: 0.55,
  bed_shallow: 0.45,
  noise_m: 0.08,
  flow: [
    [0.05, 0.02],
    [-0.03, 0.04],
  ],
};

/** The water's A written plainly: the map padded with its edge cells, every texel against every cell, the blur over all, cropped. */
function waterReference(ground: Uint8Array, n: number, rules: GroundJson["rules"]): Uint8Array {
  const w = rules.weights as NonNullable<GroundJson["rules"]["weights"]>;
  const wa = rules.water as NonNullable<GroundJson["rules"]["water"]>;
  const k = w.texels_per_cell;
  const pad = Math.ceil((wa.range_m + 3 * (wa.blur_m ?? w.blur_m)) / GROUND_CELL_M) + 1;
  const N = n + 2 * pad;
  const wetP = (x: number, y: number) => {
    const t = ground[Math.min(n - 1, Math.max(0, y - pad)) * n + Math.min(n - 1, Math.max(0, x - pad))];
    return t >= 3 && t <= 6;
  };
  const S = N * k;
  const sd = new Float64Array(S * S);
  for (let ty = 0; ty < S; ty++) {
    for (let tx = 0; tx < S; tx++) {
      const X = ((tx + 0.5) / k) * GROUND_CELL_M;
      const Y = ((ty + 0.5) / k) * GROUND_CELL_M;
      const inWet = wetP(Math.floor(tx / k), Math.floor(ty / k));
      let d = 1e9;
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          if (wetP(x, y) === inWet) continue;
          const dx = Math.max(Math.abs(X - (x + 0.5) * GROUND_CELL_M) - GROUND_CELL_M / 2, 0);
          const dy = Math.max(Math.abs(Y - (y + 0.5) * GROUND_CELL_M) - GROUND_CELL_M / 2, 0);
          d = Math.min(d, Math.hypot(dx, dy));
        }
      }
      sd[ty * S + tx] = Math.min(wa.range_m, Math.max(-wa.range_m, inWet ? d : -d));
    }
  }
  const sigma = ((wa.blur_m ?? w.blur_m) * k) / GROUND_CELL_M;
  const R = Math.floor(3 * sigma) + 1;
  const kern: number[] = [];
  for (let i = -R; i <= R; i++) kern.push(Math.exp(-(i * i) / (2 * sigma * sigma)));
  const sum = kern.reduce((a, b) => a + b, 0);
  const a = new Float64Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) for (let i = -R; i <= R; i++) a[y * S + x] += (sd[Math.min(S - 1, Math.max(0, y + i)) * S + x] * kern[i + R]) / sum;
  const side = n * k;
  const out = new Uint8Array(side * side);
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const yy = y + pad * k;
      const xx = x + pad * k;
      let v = 0;
      for (let i = -R; i <= R; i++) v += (a[yy * S + Math.min(S - 1, Math.max(0, xx + i))] * kern[i + R]) / sum;
      out[y * side + x] = Math.round(Math.min(1, Math.max(0, 0.5 + v / wa.range_m / 2)) * 255);
    }
  }
  return out;
}

test("水的有號距離（A，art-v6）：水裡是到最近陸地的距離、岸上是負的到最近水的距離，夾在 range 內再糊開；和照公式直接算的一樣", () => {
  const n = 12;
  const rules = { ...RULES, water: WATER };
  // A diagonal river running off the map's west and east edges, and a pond.
  const ground = new Uint8Array(n * n);
  for (let x = 0; x < n; x++) {
    const y = Math.floor(2 + x * 0.6);
    for (const yy of [y, y + 1]) if (yy < n) ground[yy * n + x] = 3;
  }
  for (const [x, y] of [[9, 9], [10, 9], [9, 10], [10, 10]]) ground[y * n + x] = 3;
  const w = new GroundWeights(n, rules, true);
  w.set(ground, []);
  const a = new Uint8Array(w.side * w.side);
  for (let i = 0; i < a.length; i++) a[i] = w.data[i * 4 + 3];
  const ref = waterReference(ground, n, rules);
  const diff = a.reduce((m, v, i) => Math.max(m, Math.abs(v - ref[i])), 0);
  assert.ok(diff <= 1, `the same as the plain formula (max diff ${diff})`);
  // In the river's middle above half, on land far from it below, half on its edge.
  assert.ok(a[(2 * 4 + 4) * w.side + 0 * 4 + 2] > 128, "in the water");
  assert.ok(a[(8 * 4) * w.side + 0 * 4 + 2] < 60, "far on land");
  // The river runs off the west edge: no bank grows along the edge (the ground off the map is the edge cell's).
  assert.ok(a[(2 * 4 + 2) * w.side + 0] > 128, "at the map's edge, still water");
});

test("水的有號距離：只重算水變了的附近，和整張重算一樣；沒有 water 層時 A 一直是 0", () => {
  const n = 12;
  const rules = { ...RULES, water: WATER };
  const ground = new Uint8Array(n * n);
  for (let x = 0; x < n; x++) ground[5 * n + x] = 3;
  const w = new GroundWeights(n, rules, true);
  w.set(ground, []);
  const g2 = ground.slice();
  g2[9 * n + 3] = 3;
  w.set(g2, []);
  const fresh = new GroundWeights(n, rules, true);
  fresh.set(g2, []);
  assert.deepEqual(w.data, fresh.data);
  const off = new GroundWeights(n, rules, false);
  off.set(g2, []);
  assert.ok(off.data.every((v, i) => i % 4 !== 3 || v === 0));
});
