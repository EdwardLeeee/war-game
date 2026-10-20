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
