// D-022 (user, 2026-09-30: 「我選玩一個單位 然後要改去選建築 這樣要怎模按？怎模取消選取當前單位」):
// with farmers selected, tapping an own building sends them to work only where there is work
// (not finished, damaged, a farm); any other building is selected instead.

import assert from "node:assert/strict";
import { test } from "node:test";
import { tapIntents } from "../src/input/intent.ts";
import { MOCK_RULES } from "../src/mock/mock-port.ts";
import {
  BUILDING_STRIDE,
  BuildingField as B,
  BuildingFlag,
  BuildingType,
  CELL,
  HEADER_LENGTH,
  type MapInfo,
  type Snapshot,
  UNIT_STRIDE,
  UnitField as U,
  UnitType,
} from "../src/sim.ts";
import { TILE_PX } from "../src/tuning.ts";
import { GameView } from "../src/view/view.ts";

const SIZE = 32;
const map: MapInfo = { seed: 1, size: SIZE, terrain: new Uint8Array(SIZE * SIZE), spawns: [], towns: [] };

/** [id, type, cellX, cellY, hp, progress, flags?] per building, all owned by player 0. */
function view(buildings: [number, BuildingType, number, number, number, number, number?][]): GameView {
  const v = new GameView(0, map, MOCK_RULES);
  const b = new Int32Array(buildings.length * BUILDING_STRIDE);
  buildings.forEach(([id, type, cx, cy, hp, progress, flags], i) => {
    const o = i * BUILDING_STRIDE;
    b[o + B.id] = id;
    b[o + B.owner] = 0;
    b[o + B.type] = type;
    b[o + B.cellX] = cx;
    b[o + B.cellY] = cy;
    b[o + B.hp] = hp;
    b[o + B.progress] = progress;
    b[o + B.flags] = flags ?? 0;
  });
  // One farmer, far from the buildings.
  const u = new Int32Array(UNIT_STRIDE);
  u[U.id] = 1;
  u[U.type] = UnitType.Farmer;
  u[U.x] = 30 * CELL;
  u[U.y] = 30 * CELL;
  const snap: Snapshot = {
    type: "snapshot",
    header: new Int32Array(HEADER_LENGTH),
    units: u,
    buildings: b,
    towns: new Int32Array(0),
    warnings: new Int32Array(0),
    nodes: new Int32Array(0),
    fog: null,
    placement: null,
    idleFarmers: new Int32Array(0),
    events: [],
  };
  v.push(snap, 0);
  return v;
}

const full = (t: BuildingType) => MOCK_RULES.buildings[t].hp;
const farmers = { units: [1], building: null };
const tapCell = (v: GameView, cx: number, cy: number) => tapIntents(v, farmers, "normal", (cx + 0.5) * TILE_PX, (cy + 0.5) * TILE_PX, 1, 22, 12);

test("還沒蓋好的建築 → 派村民去蓋（repair）", () => {
  const v = view([[10, BuildingType.House, 2, 2, 50, 400]]);
  assert.equal(v.buildingNeedsFarmers(10), true);
  assert.deepEqual(tapCell(v, 2, 2), [{ kind: "command", cmd: { c: "repair", u: [1], building: 10 } }]);
});

test("受損的建築 → 派村民去修（repair）", () => {
  const v = view([[10, BuildingType.Barracks, 2, 2, full(BuildingType.Barracks) - 1, 1000]]);
  assert.deepEqual(tapCell(v, 3, 3), [{ kind: "command", cmd: { c: "repair", u: [1], building: 10 } }]);
});

test("農田 → 派村民去耕（有沒有人耕由模擬判定）", () => {
  const v = view([[10, BuildingType.Farm, 2, 2, full(BuildingType.Farm), 1000]]);
  assert.deepEqual(tapCell(v, 2, 2), [{ kind: "command", cmd: { c: "repair", u: [1], building: 10 } }]);
});

test("完好的主城、民居、兵營 → 改選那棟建築", () => {
  for (const type of [BuildingType.MainCity, BuildingType.House, BuildingType.Barracks]) {
    const v = view([[10, type, 2, 2, full(type), 1000]]);
    assert.equal(v.buildingNeedsFarmers(10), false, String(type));
    assert.deepEqual(tapCell(v, 2, 2), [{ kind: "selectBuilding", id: 10 }], String(type));
  }
});

test("主城剛被攻擊（RepairLocked）：照樣派村民去修（模擬會讓他們等），畫面另外說明", () => {
  const v = view([[10, BuildingType.MainCity, 2, 2, full(BuildingType.MainCity) - 100, 1000, BuildingFlag.RepairLocked]]);
  assert.equal(v.buildingRepairLocked(10), true);
  assert.deepEqual(tapCell(v, 3, 3), [{ kind: "command", cmd: { c: "repair", u: [1], building: 10 } }]);
  assert.equal(view([[10, BuildingType.MainCity, 2, 2, full(BuildingType.MainCity) - 100, 1000]]).buildingRepairLocked(10), false);
});
