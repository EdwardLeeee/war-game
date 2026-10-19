// 城牆 (D-089): ui's wall pictures laid on exactly the simulation's castle cells, taps on and by
// the walls, and the town's range (inside the walls) for 留守.

import assert from "node:assert/strict";
import { test } from "node:test";
import { castleOf } from "../../sim/src/core/castle.ts";
import { CASTLE_LARGE, CASTLE_LARGE3, CASTLE_SMALL } from "../../sim/src/core/castle-layout.ts";
import { type CastleJson, type CastleLayout, fitLayout } from "../src/art/castle.ts";
import { inTown } from "../src/game/army.ts";
import { MOCK_RULES } from "../src/mock/mock-port.ts";
import {
  CELL,
  HEADER_LENGTH,
  type MapInfo,
  type Snapshot,
  TOWN_STRIDE,
  TownField as T,
  TownSize,
  TownState,
  UNIT_STRIDE,
  UnitField as U,
  UnitType,
} from "../src/sim.ts";
import { TILE_PX } from "../src/tuning.ts";
import { GameView } from "../src/view/view.ts";

/** A layout as ui's: a piece a cell of the walls and gates (a gate's picture holds its piers too). */
function layoutOf(l: { wall: readonly (readonly [number, number])[]; gate: readonly (readonly [number, number])[] }): CastleLayout {
  return { walls: [...l.wall, ...l.gate].map(([x, y]) => ({ piece: "p", anchor: [x + 0.5, y + 0.5], front: y + 1, cells: [[x, y]] })), floor: [] };
}
const json: Pick<CastleJson, "layouts"> = { layouts: { small: layoutOf(CASTLE_SMALL), large: layoutOf(CASTLE_LARGE), large3: layoutOf(CASTLE_LARGE3) } };

test("城牆的圖照模擬的格子放：小鎮對 small；大城對 large，箭樓換了位置就整組跟著移", () => {
  const small = fitLayout(json, castleOf(TownSize.Small), false);
  assert.deepEqual(small && { name: small.name, dx: small.dx, dy: small.dy }, { name: "small", dx: 0, dy: 0 });
  // The fixed map's: its tower one up and left of the centre cell, as the layouts have it.
  const fixed = fitLayout(json, castleOf(TownSize.Large), true);
  assert.deepEqual(fixed && { name: fixed.name, dx: fixed.dx, dy: fixed.dy }, { name: "large", dx: 0, dy: 0 });
  // A random map turned: the tower at the centre cell itself, so the castle one right and one down.
  const map = { tower: { cellX: 50, cellY: 40 }, towns: [{ size: TownSize.Large, cellX: 50, cellY: 40 }] };
  const turned = fitLayout(json, castleOf(TownSize.Large, map), true);
  assert.deepEqual(turned && { name: turned.name, dx: turned.dx, dy: turned.dy }, { name: "large", dx: 1, dy: 1 });
  // Neighbouring spawns: the 3 × 3 tower's castle.
  const three = fitLayout(json, castleOf(TownSize.Large, { ...map, towerSize: 3 }), true);
  assert.equal(three?.name, "large3");
});

test("城牆的圖對不上模擬的格子（少一格牆）：不用圖（畫面改畫方塊）", () => {
  const c = castleOf(TownSize.Small);
  assert.equal(fitLayout(json, { wall: c.wall.slice(1), gate: c.gate }, false), null);
  assert.equal(fitLayout(json, c, true), null, "a small town's castle is no big city's");
});

// A small town at (16, 16) on a 32-cell map: walls on rows and columns 11 and 21, inside 12..20.
const SIZE = 32;
const TOWN = { id: 0, size: TownSize.Small, cellX: 16, cellY: 16, radius: 5 };
const map: MapInfo = { seed: 1, size: SIZE, terrain: new Uint8Array(SIZE * SIZE), spawns: [], towns: [TOWN] };

function view(units: [number, number, number][]): GameView {
  const v = new GameView(0, map, MOCK_RULES);
  const u = new Int32Array(units.length * UNIT_STRIDE);
  units.forEach(([id, x, y], i) => {
    const o = i * UNIT_STRIDE;
    u[o + U.id] = id;
    u[o + U.type] = UnitType.Spearman;
    u[o + U.x] = x * CELL;
    u[o + U.y] = y * CELL;
  });
  const t = new Int32Array(TOWN_STRIDE);
  t[T.id] = 0;
  t[T.size] = TownSize.Small;
  t[T.cellX] = 16;
  t[T.cellY] = 16;
  t[T.state] = TownState.Neutral;
  const snap: Snapshot = {
    type: "snapshot",
    header: new Int32Array(HEADER_LENGTH),
    units: u,
    buildings: new Int32Array(0),
    towns: t,
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

test("點牆內南邊、被南牆的圖擋住的兵：選到兵，不是城鎮（ceo 2026-10-20）", () => {
  const v = view([[7, 16.5, 20.5]]);
  // The south wall's picture stands over the cells behind it: under the finger too.
  v.wallPictureAt = () => TOWN.id;
  const at = v.pick(16.5 * TILE_PX, 20.5 * TILE_PX, 22);
  assert.deepEqual(at && { kind: at.kind, id: at.id }, { kind: "unit", id: 7 });
});

test("點牆、點牆的圖、點牆內的空地：選到城鎮；牆外沒有圖的地方：什麼都沒有", () => {
  const v = view([]);
  // On the west wall's middle cell.
  assert.equal(v.pick(11.5 * TILE_PX, 16.5 * TILE_PX, 22)?.kind, "town");
  // Inside, open ground.
  assert.equal(v.pick(14.5 * TILE_PX, 14.5 * TILE_PX, 22)?.kind, "town");
  // North of the north wall: nothing; unless the wall's picture is there.
  assert.equal(v.pick(16.5 * TILE_PX, 9.5 * TILE_PX, 22), null);
  v.wallPictureAt = () => TOWN.id;
  assert.equal(v.pick(16.5 * TILE_PX, 9.5 * TILE_PX, 22)?.kind, "town");
});

test("留守算城鎮裡的兵：牆以內才算，站在城門上不算（PROTOCOL.md 3.5）", () => {
  const area = { id: 0, cellX: 16, cellY: 16, radius: 5, inside: { x0: 12, y0: 12, x1: 20, y1: 20 } };
  const unit = (cx: number, cy: number) => ({ id: 1, type: UnitType.Spearman, x: (cx + 0.5) * CELL, y: (cy + 0.5) * CELL });
  assert.equal(inTown(unit(20, 16), area), true);
  // The east gate (21, 15..17), within the old radius.
  assert.equal(inTown(unit(21, 16), area), false);
  assert.equal(inTown(unit(21, 16), { ...area, inside: null }), true, "without a castle, the radius");
});

test("放建築：牆上寫「城牆上不能蓋」，城門的通道（城門、門外一格、門內一格）寫「城門要留給人走，不能蓋」，都照模擬的標記和規則", async () => {
  const { castleReason, GATE_LANE_TEXT, WALL_TEXT } = await import("../src/ui/placement.ts");
  const { PlaceBit, BuildingType } = await import("../src/sim.ts");
  const n = 16;
  const cells = new Uint8Array(n * n);
  // A wall at (5, 5), a gate's lane at (8, 5).
  cells[5 * n + 5] = PlaceBit.Blocked | PlaceBit.Wall;
  cells[5 * n + 8] = PlaceBit.Gate | PlaceBit.GateLane;
  const grid = { size: n, cells };
  const house = { type: BuildingType.House, size: 2 };
  assert.equal(castleReason(grid, house, 4, 4), WALL_TEXT);
  assert.equal(castleReason(grid, house, 7, 4), GATE_LANE_TEXT);
  assert.equal(castleReason(grid, house, 10, 10), null, "open ground");
});
