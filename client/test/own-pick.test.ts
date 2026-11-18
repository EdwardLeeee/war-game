// A tap on one of ours passing through one of our buildings picks the building (D-154: ours walk through our own
// buildings, never stop in them; ceo 2026-11-18): not on a farm, where farmers stand to work; not an enemy's unit;
// not one of ours only beside the building.

import assert from "node:assert/strict";
import { test } from "node:test";
import { MOCK_RULES } from "../src/mock/mock-port.ts";
import { BUILDING_STRIDE, BuildingField as B, BuildingType, CELL, HEADER_LENGTH, type MapInfo, type Snapshot, UNIT_STRIDE, UnitField as U, UnitType } from "../src/sim.ts";
import { TILE_PX } from "../src/tuning.ts";
import { GameView } from "../src/view/view.ts";

const SIZE = 32;
const map: MapInfo = { seed: 1, size: SIZE, terrain: new Uint8Array(SIZE * SIZE), spawns: [], towns: [] };

/** Units [id, owner, type, x, y] (cells) and buildings [id, owner, type, cellX, cellY]; player 0 is us. */
function view(units: [number, number, number, number, number][], buildings: [number, number, number, number, number][]): GameView {
  const v = new GameView(0, map, MOCK_RULES);
  const u = new Int32Array(units.length * UNIT_STRIDE);
  units.forEach(([id, owner, type, x, y], i) => {
    const o = i * UNIT_STRIDE;
    u[o + U.id] = id;
    u[o + U.owner] = owner;
    u[o + U.type] = type;
    u[o + U.x] = Math.round(x * CELL);
    u[o + U.y] = Math.round(y * CELL);
  });
  const b = new Int32Array(buildings.length * BUILDING_STRIDE);
  buildings.forEach(([id, owner, type, x, y], i) => {
    const o = i * BUILDING_STRIDE;
    b[o + B.id] = id;
    b[o + B.owner] = owner;
    b[o + B.type] = type;
    b[o + B.cellX] = x;
    b[o + B.cellY] = y;
    b[o + B.hp] = 100;
    b[o + B.progress] = 1000;
  });
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

const at = (x: number, y: number) => [x * TILE_PX, y * TILE_PX] as const;
const BARRACKS: [number, number, number, number, number] = [50, 0, BuildingType.Barracks, 10, 10];

test("我們的村民、兵走過我們的兵營（在占地裡）：點那裡選到兵營", () => {
  for (const type of [UnitType.Farmer, UnitType.Spearman]) {
    const v = view([[1, 0, type, 11.5, 11.5]], [BARRACKS]);
    const p = v.pick(...at(11.5, 11.5), 22);
    assert.deepEqual(p, { kind: "building", id: 50, owner: 0, type: BuildingType.Barracks }, `type ${type}`);
  }
});

test("站在兵營旁邊（不在占地裡）、敵人的兵在我們兵營的占地裡：照舊選到那個兵", () => {
  const size = MOCK_RULES.buildings[BuildingType.Barracks]?.size ?? 3;
  const beside = view([[1, 0, UnitType.Spearman, 10 + size + 0.5, 11.5]], [BARRACKS]);
  assert.equal(beside.pick(...at(10 + size + 0.5, 11.5), 22)?.kind, "unit");
  const enemy = view([[2, 1, UnitType.Spearman, 11.5, 11.5]], [BARRACKS]);
  assert.deepEqual(enemy.pick(...at(11.5, 11.5), 22), { kind: "unit", id: 2, owner: 1, type: UnitType.Spearman });
});

test("種田的村民站在農田上：點他照舊選到村民；在別人的建築裡也照舊選到兵", () => {
  const farm = view([[1, 0, UnitType.Farmer, 11.5, 11.5]], [[51, 0, BuildingType.Farm, 10, 10]]);
  assert.equal(farm.pick(...at(11.5, 11.5), 22)?.kind, "unit");
  const theirs = view([[1, 0, UnitType.Spearman, 11.5, 11.5]], [[52, 1, BuildingType.Barracks, 10, 10]]);
  assert.equal(theirs.pick(...at(11.5, 11.5), 22)?.kind, "unit");
});
