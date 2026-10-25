// 城內 B (R8-36 B, the user 2026-10-23; art-v6 castle 2): what lives in a town is left out in ruins
// and under a building; the towns' ground for the shader (lanes, trampled earth, every building's
// cells inside the walls and a decor piece's left out for one trampled); its weight map as
// war-game-ui's ground_r8.py town_weights makes it; castle 2 read, castle 1 still.

import assert from "node:assert/strict";
import { test } from "node:test";
import { type CastleFit, type CastleLayout, decorFrame, decorHidden, fitLayout, parseCastle, townGround } from "../src/art/castle.ts";
import { buildingEntry, type BuildingsJson } from "../src/art/structures.ts";
import { GROUND_CELL_M, type GroundJson, TownWeights, townGroundOn } from "../src/art/ground.ts";
import { D100_LARGE, D100_SMALL } from "../../sim/src/core/castle-layout-d100.ts";

const TOWN: NonNullable<GroundJson["rules"]["town"]> = { soft_m: 0.6, blur_m: 0.35, edge_m: 0.45, layers: { E: { lane: "yard", trampled: "yard" }, W: { lane: "yard", trampled: "yard" } } };
const RULES: GroundJson["rules"] = {
  bank_cells: 1,
  gravel_cells: 1,
  edge_m: 1.2,
  height_k: 0.9,
  dirt: { node_cells: 1, noise_threshold: 0.8, noise_soft: 0.3 },
  weights: { texels_per_cell: 4, soft_m: 1.6, blur_m: 1.0 },
  town: TOWN,
};

/** ui's town_weights for one channel written plainly: the whole map, every cell, as ground_r8.py's numpy. */
function reference(s: Float32Array, n: number, k: number): Float64Array {
  const side = n * k;
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < n && y < n && s[y * n + x] > 0;
  const smooth = (e0: number, e1: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  };
  const f = new Float64Array(side * side);
  for (let ty = 0; ty < side; ty++) {
    for (let tx = 0; tx < side; tx++) {
      const X = ((tx + 0.5) / k) * GROUND_CELL_M;
      const Y = ((ty + 0.5) / k) * GROUND_CELL_M;
      const isIn = inside(Math.floor(tx / k), Math.floor(ty / k));
      let d = 1e3;
      for (let y = -1; y <= n; y++) {
        for (let x = -1; x <= n; x++) {
          const seedIn = inside(x, y);
          if (seedIn === isIn) continue;
          const edge = inside(x - 1, y) !== seedIn || inside(x + 1, y) !== seedIn || inside(x, y - 1) !== seedIn || inside(x, y + 1) !== seedIn;
          if (!edge) continue;
          const dx = Math.max(Math.abs(X - (x + 0.5) * GROUND_CELL_M) - GROUND_CELL_M / 2, 0);
          const dy = Math.max(Math.abs(Y - (y + 0.5) * GROUND_CELL_M) - GROUND_CELL_M / 2, 0);
          d = Math.min(d, Math.hypot(dx, dy));
        }
      }
      f[ty * side + tx] = smooth(-TOWN.soft_m / 2, TOWN.soft_m / 2, isIn ? d : -d);
    }
  }
  const blur = (a: Float64Array, sigma: number) => {
    const r = Math.floor(3 * sigma) + 1;
    const kern: number[] = [];
    for (let i = -r; i <= r; i++) kern.push(Math.exp(-(i * i) / (2 * sigma * sigma)));
    const sum = kern.reduce((x, y) => x + y, 0);
    const c = (v: number) => Math.min(side - 1, Math.max(0, v));
    const rows = new Float64Array(side * side);
    for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) for (let i = -r; i <= r; i++) rows[y * side + x] += (a[c(y + i) * side + x] * kern[i + r]) / sum;
    const out = new Float64Array(side * side);
    for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) for (let i = -r; i <= r; i++) out[y * side + x] += (rows[y * side + c(x + i)] * kern[i + r]) / sum;
    return out;
  };
  const strength = new Float64Array(side * side);
  for (let ty = 0; ty < side; ty++) for (let tx = 0; tx < side; tx++) strength[ty * side + tx] = s[Math.floor(ty / k) * n + Math.floor(tx / k)];
  const wf = blur(f, (TOWN.blur_m * k) / GROUND_CELL_M);
  const ws = blur(strength, 0.25 * k);
  return wf.map((v, i) => Math.min(1, Math.max(0, v * ws[i])));
}

test("城裡的地（R8-36 B）：土路、踩平的土各一個通道，和 ui 的 town_weights 算法一樣；只算城鎮的範圍，沒變就不重算", () => {
  const n = 16;
  const k = 4;
  // A lane fading out past a gate (1, 0.6, 0.35, 0.15), and a patch of trampled earth; one by the map's edge.
  const lane = new Float32Array(n * n);
  [1, 1, 1, 0.6, 0.35, 0.15].forEach((w, i) => (lane[(3 + i) * n + 7] = w));
  const trampled = new Float32Array(n * n);
  for (let y = 4; y <= 6; y++) for (let x = 9; x <= 11; x++) trampled[y * n + x] = 0.9;
  trampled[0 * n + 15] = 1;
  const t = new TownWeights(n, RULES);
  assert.equal(t.side, n * k);
  assert.equal(t.set(lane, trampled, [{ x0: 4, y0: 0, x1: 15, y1: 9 }]), true);
  for (const [ch, s] of [[0, lane], [1, trampled]] as const) {
    const ref = reference(s, n, k);
    let worst = 0;
    for (let i = 0; i < ref.length; i++) worst = Math.max(worst, Math.abs(t.data[i * 4 + ch] - Math.round(ref[i] * 255)));
    assert.ok(worst <= 1, `channel ${ch}: the same as ui's (worst ${worst})`);
  }
  // The middle of the lane strong, its tip weak, the grass beside none.
  const at = (ch: number, cx: number, cy: number) => t.data[((cy * k + 2) * t.side + cx * k + 2) * 4 + ch];
  assert.ok(at(0, 7, 4) > 200 && at(0, 7, 8) < at(0, 7, 6) && at(0, 3, 4) === 0);
  assert.equal(t.set(lane, trampled, [{ x0: 4, y0: 0, x1: 15, y1: 9 }]), false, "nothing changed");
});

test("城裡的地要 ground.json 有 rules.town、weights 和它說的層", () => {
  const layers = ["grass", "grass_dry", "dirt", "gravel", "bank", "yard"].map((id) => ({ id: id as "yard", file: `${id}.png`, tile_m: 8, mean: [0.1, 0.1, 0.1] as [number, number, number] }));
  assert.equal(townGroundOn({ layers, rules: RULES }), true);
  assert.equal(townGroundOn({ layers: layers.filter((l) => l.id !== "yard"), rules: RULES }), false);
  const { town: _, ...noTown } = RULES;
  assert.equal(townGroundOn({ layers, rules: noTown }), false);
});

/** A castle 2 layout as ui's (atlas-buildings.md section 13), cut down: two walls, a lane, trampled earth, two huts. */
const LAYOUT: CastleLayout = {
  walls: [],
  ground: [
    { cell: [0, -8], kind: "lane", w: 0.35 },
    { cell: [0, -7], kind: "lane", w: 1 },
    { cell: [2, 2], kind: "trampled", w: 0.9 },
  ],
  decor: [
    { piece: "hut_a", at: [-2.9, -5], front: -4.45, cells: [[-4, -6], [-4, -5], [-3, -6], [-3, -5]] },
    { piece: "well", at: [3.9, 4], front: 4.35, cells: [[3, 3], [3, 4], [4, 3], [4, 4]] },
  ],
};

test("擺設：廢墟不畫（核准的計畫）；建築（蓋好或施工中）碰到它的任何一格就不畫", () => {
  const hut = LAYOUT.decor?.[0] as NonNullable<CastleLayout["decor"]>[number];
  // The town's centre cell (20, 20): the hut on (16–17, 14–15).
  assert.equal(decorHidden(hut, 20, 20, [], false), false);
  assert.equal(decorHidden(hut, 20, 20, [], true), true, "ruins");
  assert.equal(decorHidden(hut, 20, 20, [{ x: 17, y: 15, w: 2, h: 2 }], false), true, "a house on one of its cells");
  assert.equal(decorHidden(hut, 20, 20, [{ x: 18, y: 15, w: 2, h: 2 }], false), false, "beside it");
});

test("城裡的地：layout 的土路和踩平的土，城牆範圍內的建築占地和被它蓋掉的擺設都算踩平的土（強度 1）", () => {
  const n = 40;
  const fit: CastleFit = { name: "small", layout: LAYOUT, dx: 0, dy: 0 };
  const box = { x0: 13, y0: 13, x1: 27, y1: 27 };
  // A house on the hut (16–17, 14–15), and one outside the walls.
  const g = townGround(n, [{ cx: 20, cy: 20, fit, box }], [{ x: 17, y: 15, w: 2, h: 2 }, { x: 2, y: 2, w: 2, h: 2 }]);
  assert.ok(Math.abs(g.lane[12 * n + 20] - 0.35) < 1e-6);
  assert.equal(g.lane[13 * n + 20], 1);
  assert.ok(Math.abs(g.trampled[22 * n + 22] - 0.9) < 1e-6);
  for (const [x, y] of [[16, 14], [17, 15], [18, 16]]) assert.equal(g.trampled[y * n + x], 1, `${x},${y}: under the house or the hut it covers`);
  assert.equal(g.trampled[2 * n + 2], 0, "a building outside the walls: no town's ground");
  assert.equal(g.trampled[23 * n + 23], 0, "the well, nothing on it: its own ground as the layout says");
});

test("城牆說明檔：war-game castle 2 讀得進來（沒有 tiles、floor），castle 1 照舊；D-100 的城堡對得上 small、large", () => {
  const base = { culture: "E", px_per_m: 60, pages: { color: [], team: [], shadow: [] }, pieces: {}, frames: {}, team: {}, shadows: {} };
  const two = parseCastle({ ...base, format: "war-game castle 2", decor: { hut_a: "decor_hut_a_E" }, layouts: { small: LAYOUT } });
  assert.equal(two.decor?.hut_a, "decor_hut_a_E");
  assert.equal(two.tiles, undefined);
  assert.equal(parseCastle({ ...base, format: "war-game castle 1", tiles: {}, layouts: {} }).format, "war-game castle 1");
  assert.throws(() => parseCastle({ ...base, format: "war-game castle 3", layouts: {} }));
  // A layout laid on D-100's own cells fits them (its pieces cover exactly the walls and gates).
  for (const [name, castle, large] of [["small", D100_SMALL, false], ["large", D100_LARGE, true]] as const) {
    const cells = [...castle.wall, ...castle.gate].filter((c, i, all) => all.findIndex((d) => d[0] === c[0] && d[1] === c[1]) === i);
    const layout: CastleLayout = { walls: cells.map(([x, y]) => ({ piece: "p", anchor: [x + 0.5, y + 0.5], front: y + 1, cells: [[x, y]] })) };
    const fit = fitLayout({ layouts: { [name]: layout } }, castle, large);
    assert.equal(fit?.name, name);
    assert.deepEqual([fit?.dx, fit?.dy], [0, 0]);
  }
});

test("廢墟的擺設（art-v6.3，R8-39）：有燒毀版就畫燒毀版，沒有就不畫；平常照舊；舊的說明檔沒有 decor_ruin 就照舊不畫", () => {
  const c = { decor: { hut_a: "decor_hut_a_E", well: "decor_well_E" }, decor_ruin: { hut_a: "decor_hut_a_E_ruin" } };
  assert.equal(decorFrame(c, "hut_a", false), "decor_hut_a_E");
  assert.equal(decorFrame(c, "hut_a", true), "decor_hut_a_E_ruin");
  assert.equal(decorFrame(c, "well", true), null, "no burnt well: left out");
  assert.equal(decorFrame({ decor: c.decor }, "hut_a", true), null, "art-v6.2 and before");
  // Left out in ruins only without a burnt picture (castle-draw passes ruins && none); a building on it always.
  const hut = LAYOUT.decor?.[0] as NonNullable<CastleLayout["decor"]>[number];
  assert.equal(decorHidden(hut, 20, 20, [], decorFrame(c, "hut_a", true) === null), false);
  assert.equal(decorHidden(hut, 20, 20, [{ x: 17, y: 15, w: 2, h: 2 }], false), true);
});

test("D-100 的城（KEEP 開，art-v6.1 起改名 small_d100、large_d100）也對得上；舊城的 small、large 照舊先試", () => {
  for (const [name, castle, large] of [["small_d100", D100_SMALL, false], ["large_d100", D100_LARGE, true]] as const) {
    const cells = [...castle.wall, ...castle.gate].filter((c, i, all) => all.findIndex((d) => d[0] === c[0] && d[1] === c[1]) === i);
    const layout: CastleLayout = { walls: cells.map(([x, y]) => ({ piece: "p", anchor: [x + 0.5, y + 0.5], front: y + 1, cells: [[x, y]] })) };
    // A D-089 small (one cell off) beside it does not fit: the D-100 one is taken.
    const off: CastleLayout = { walls: [{ piece: "p", anchor: [0.5, 0.5], front: 1, cells: [[0, 0]] }] };
    const fit = fitLayout({ layouts: { [large ? "large" : "small"]: off, [name]: layout } }, castle, large);
    assert.equal(fit?.name, name);
  }
});

test("同一個 type 有兩種圖（art-v6.1：type 9 是 TownTower 也是 Keep）：給名字就拿那一個，沒給照舊拿第一個", () => {
  const b = {
    buildings: {
      TownTower: { type: 9, footprint: [2, 2], states: { done: "town_tower_E_done" }, sizes: { "3": { footprint: [3, 3], states: { done: "town_tower3_E_done" } } } },
      Keep: { type: 9, footprint: [3, 3], states: { done: "keep_E_done" } },
    },
  } as unknown as BuildingsJson;
  assert.equal(buildingEntry(b, 9, 2)?.states.done, "town_tower_E_done");
  assert.equal(buildingEntry(b, 9, 3)?.states.done, "town_tower3_E_done", "KEEP off on a random map: the 3 x 3 tower");
  assert.equal(buildingEntry(b, 9, 3, "Keep")?.states.done, "keep_E_done");
  assert.equal(buildingEntry(b, 9, 3, "Barracks")?.states.done, "town_tower3_E_done", "a name of another type: as before");
});
