// 天然障礙物 (R6-51) on the screen: why the preview is red on a ford or a bridge, in the
// simulation's own order (PROTOCOL.md section 7: a gate's lane first, then a crossing).

import assert from "node:assert/strict";
import { test } from "node:test";
import { BuildingType, PlaceBit } from "../src/sim.ts";
import { CROSSING_TEXT, GATE_LANE_TEXT, placeReason } from "../src/ui/placement.ts";

test("放建築：占地碰到淺灘或橋寫「橋和淺灘要留給人走，不能蓋」；同時碰到城門的通道，照模擬先寫城門", () => {
  const n = 16;
  const cells = new Uint8Array(n * n);
  // A bridge's cell at (6, 6).
  cells[6 * n + 6] = PlaceBit.Crossing;
  const grid = { size: n, cells };
  const house = { type: BuildingType.House, size: 2 };
  assert.equal(CROSSING_TEXT, "橋和淺灘要留給人走，不能蓋");
  assert.equal(placeReason(grid, house, 5, 5), CROSSING_TEXT);
  assert.equal(placeReason(grid, house, 6, 6), CROSSING_TEXT);
  assert.equal(placeReason(grid, house, 8, 8), null, "open ground");
  cells[7 * n + 7] = PlaceBit.Gate | PlaceBit.GateLane;
  assert.equal(placeReason(grid, house, 6, 6), GATE_LANE_TEXT);
});

test("地形的圖（art-v5）照 ui 的規則擺：水的圖塊在格子的角、照四周濕不濕編號；橋面和欄杆；懸崖的岩柱只在轉彎和兩端", async () => {
  const { terrainPieces, variant } = await import("../src/art/terrain.ts");
  // 6 × 6: a north-south bridge at (2, 1) between water at (1, 1) and (3, 1); a cliff line (1–3, 3); water in the corner cell (5, 5).
  const g = new Array(36).fill(0);
  g[1 * 6 + 1] = 3;
  g[1 * 6 + 2] = 5;
  g[1 * 6 + 3] = 3;
  for (const x of [1, 2, 3]) g[3 * 6 + x] = 7;
  g[5 * 6 + 5] = 3;
  const pieces = terrainPieces((x, y) => g[y * 6 + x], 6, 6);
  const water = (x: number, y: number) => pieces.find((p) => p.x === x && p.y === y && p.ground === "water")?.frame;
  const at = (prefix: string) => pieces.filter((p) => p.frame.startsWith(prefix)).map((p) => [p.x, p.y, p.front]);
  // Corner (2, 1): south-west water (4), south-east the bridge (8, a bridge stands in the river).
  assert.equal(water(2, 1), "terrain_water_m12");
  assert.equal(water(1, 1), "terrain_water_m8");
  // Off the map: the nearest cell's. The corner (6, 6) sees (5, 5) on all four sides.
  assert.equal(water(6, 6), "terrain_water_m15");
  assert.deepEqual(at("terrain_bridge_deck_ns"), [[2.5, 1.5, 2]]);
  // Rails on both long sides: west (2, 1.5) and east (3, 1.5), front y + 1.
  assert.deepEqual(at("terrain_bridge_rail_y"), [[2, 1.5, 2], [3, 1.5, 2]]);
  // The cliff: a post at each end, none in the straight middle; arms east between, front y + 0.99.
  assert.deepEqual(at("terrain_cliff_post"), [[1.5, 3.5, 4], [3.5, 3.5, 4]]);
  assert.deepEqual(pieces.filter((p) => p.frame.startsWith("terrain_cliff_post")).map((p) => p.frame), [`terrain_cliff_post_v${variant(1, 3, 2)}`, `terrain_cliff_post_v${variant(3, 3, 2)}`]);
  assert.deepEqual(at("terrain_cliff_arm_E"), [[2, 3.5, 3.99], [3, 3.5, 3.99]]);
  assert.equal(variant(3, 5, 7), (3 * 31 + 5 * 17 + ((3 ^ 5) & 7)) % 7);
});

test("固定地圖的地形圖塊：和 ui 的參考程式（terrain_rules.py）算出的一樣，共 804 個", async () => {
  const { terrainPieces } = await import("../src/art/terrain.ts");
  const { generateMap } = await import("../../sim/src/core/map.ts");
  const m = generateMap();
  const pieces = terrainPieces((x, y) => m.terrain[y * m.size + x], m.size, m.size);
  const kind = (f: string) => f.replace(/_(v\d+|m\d+)$/, "");
  const counts: Record<string, number> = {};
  for (const p of pieces) counts[kind(p.frame)] = (counts[kind(p.frame)] ?? 0) + 1;
  // python3 design/b1/common/terrain_rules.py pieces() on the same grid, 2026-10-20 (art-v5).
  assert.equal(pieces.length, 804);
  assert.deepEqual(counts, {
    terrain_water: 582,
    terrain_rock: 136,
    terrain_ford: 18,
    terrain_bridge_deck_ns: 9,
    terrain_bridge_deck_ew: 9,
    terrain_bridge_rail_x: 6,
    terrain_bridge_rail_y: 6,
    terrain_cliff_post: 14,
    terrain_cliff_arm_E: 9,
    terrain_cliff_arm_S: 9,
    terrain_cliff_arm_SE: 6,
  });
});
