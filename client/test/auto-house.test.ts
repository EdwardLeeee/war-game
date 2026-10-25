// 自動蓋民居 (the user 2026-10-25: 「人口快滿時自動蓋民居」; ceo's spec): a house when the room
// left is one house's or less, none being built, the cap below its ceiling, no enemy at home and
// its wood there, the reserve not kept back from it; the gathering villager nearest the main city
// builds it; the spot 4–10 cells from the main city, away from the map's centre first, a clear
// cell all round it, not in a town, not on a resource node.

import assert from "node:assert/strict";
import { test } from "node:test";
import { type Footprint, HOME_CELLS, HOUSE_FAR, HOUSE_NEAR, type HouseNeed, houseBlock, houseSpot, nearFootprint, pickBuilder, type SpotWorld } from "../src/game/auto-house.ts";
import { PlaceBit } from "../src/sim.ts";

const COST = { food: 0, wood: 30, gold: 0, crystal: 0 };
const NEED: HouseNeed = {
  on: true,
  room: 8,
  houseCap: 8,
  cap: 50,
  ceiling: 200,
  unfinished: false,
  enemyNear: false,
  have: { food: 0, wood: 30, gold: 0, crystal: 0 },
  cost: COST,
};

test("什麼時候蓋：空位不超過一間民居、沒有還沒蓋完的、上限還沒到最高、家裡沒敵兵、木頭夠一間（不管預留）", () => {
  assert.equal(houseBlock(NEED), null, "room exactly a house's: build");
  assert.equal(houseBlock({ ...NEED, room: -3 }), null, "full (and over): build");
  assert.equal(houseBlock({ ...NEED, on: false }), "off");
  assert.equal(houseBlock({ ...NEED, room: 9 }), "room");
  assert.equal(houseBlock({ ...NEED, cap: 200 }), "ceiling");
  assert.equal(houseBlock({ ...NEED, unfinished: true }), "building");
  assert.equal(houseBlock({ ...NEED, enemyNear: true }), "home");
  assert.equal(houseBlock({ ...NEED, have: { ...NEED.have, wood: 29 } }), "wood");
  // In this order: the switch, then whether one is wanted, then what stops it.
  assert.equal(houseBlock({ ...NEED, room: 20, enemyNear: true, have: { ...NEED.have, wood: 0 } }), "room");
  assert.equal(houseBlock({ ...NEED, unfinished: true, enemyNear: true }), "building");
});

test("家裡被攻擊：敵兵在主城占地 12 格內（和全體回城的提醒同一個範圍）", () => {
  const city: Footprint = { x: 20, y: 20, w: 4, h: 4 };
  assert.equal(HOME_CELLS, 12);
  assert.equal(nearFootprint(city, 22, 22, HOME_CELLS), true);
  assert.equal(nearFootprint(city, 24 + 12, 22, HOME_CELLS), true);
  assert.equal(nearFootprint(city, 24 + 12.5, 22, HOME_CELLS), false);
  assert.equal(nearFootprint(city, 20 - 12, 20 - 12, HOME_CELLS), true);
  assert.equal(nearFootprint(city, 20 - 12, 20 - 13, HOME_CELLS), false);
});

test("誰去蓋：正在採集的村民裡離主城最近的一名，一樣近取 id 小的；沒有就等", () => {
  const city: Footprint = { x: 20, y: 20, w: 4, h: 4 };
  assert.equal(pickBuilder([{ id: 5, x: 30, y: 22 }, { id: 3, x: 15, y: 22 }, { id: 9, x: 22, y: 40 }], city), 3);
  assert.equal(pickBuilder([{ id: 7, x: 27, y: 22 }, { id: 4, x: 17, y: 22 }], city), 4);
  assert.equal(pickBuilder([], city), null);
});

const N = 48;
const CITY: Footprint = { x: 30, y: 30, w: 4, h: 4 };
/** The map's centre up and to the left of the main city: away from it is down and to the right. */
const MIDDLE = { x: 10, y: 10 };

function open(): SpotWorld & { cells: Uint8Array; nodes: Set<number> } {
  const cells = new Uint8Array(N * N);
  // The main city's own cells are blocked, as on the placement grid.
  for (let y = CITY.y; y < CITY.y + CITY.h; y++) for (let x = CITY.x; x < CITY.x + CITY.w; x++) cells[y * N + x] = PlaceBit.Blocked;
  const nodes = new Set<number>();
  return { cells, nodes, grid: { size: N, cells }, buildings: [CITY], towns: [], node: (c) => nodes.has(c), skip: new Set() };
}

function check(world: SpotWorld, spot: { x: number; y: number } | null): { x: number; y: number } {
  if (spot === null) return assert.fail("a spot");
  const d = Math.hypot(spot.x + 1 - (CITY.x + 2), spot.y + 1 - (CITY.y + 2));
  assert.ok(d >= HOUSE_NEAR && d <= HOUSE_FAR, `4–10 cells from the main city (${d})`);
  for (let y: number = spot.y - 1; y <= spot.y + 2; y++) {
    for (let x: number = spot.x - 1; x <= spot.x + 2; x++) {
      for (const b of world.buildings) assert.ok(!(x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h), `a clear cell round it (${x},${y})`);
    }
  }
  return spot;
}

const cellsOf = (s: { x: number; y: number }) => [[s.x, s.y], [s.x + 1, s.y], [s.x, s.y + 1], [s.x + 1, s.y + 1]];

test("蓋在哪：主城 4–10 格內、背對地圖中央那一側、近的先；和建築隔 1 格", () => {
  const w = open();
  const s = check(w, houseSpot(w, CITY, 2, MIDDLE));
  // Down and to the right of the main city.
  assert.ok(s.x + 1 > CITY.x + 2 && s.y + 1 > CITY.y + 2, `away from the centre (${s.x},${s.y})`);
  // The map's centre on the other side: the other way.
  const t = check(w, houseSpot(w, CITY, 2, { x: 46, y: 46 }));
  assert.ok(t.x + 1 < CITY.x + 2 && t.y + 1 < CITY.y + 2, `away from the centre (${t.x},${t.y})`);
  // A farm where it went: one clear cell from it too.
  const farm = { x: s.x - 1, y: s.y + 2, w: 3, h: 3 };
  for (let y = farm.y; y < farm.y + 3; y++) for (let x = farm.x; x < farm.x + 3; x++) w.cells[y * N + x] = PlaceBit.Blocked;
  const u = check({ ...w, buildings: [CITY, farm] }, houseSpot({ ...w, buildings: [CITY, farm] }, CITY, 2, MIDDLE));
  assert.notDeepEqual(u, s);
});

test("蓋在哪：不在城鎮城牆內、不壓資源點、不擋城門的路；樹或石頭旁邊排在最後；被拒過的不再試；沒地方就不蓋", () => {
  const w = open();
  const first = check(w, houseSpot(w, CITY, 2, MIDDLE));
  // A town's castle over the whole far side: none in it.
  const town = { x0: CITY.x + 4, y0: CITY.y - 12, x1: N - 1, y1: N - 1 };
  const inTown = check(w, houseSpot({ ...w, towns: [town] }, CITY, 2, MIDDLE));
  for (const [x, y] of cellsOf(inTown)) assert.ok(!(x >= town.x0 && x <= town.x1 && y >= town.y0 && y <= town.y1), `not in the town (${x},${y})`);
  // A town without a castle: its circle.
  const circle = { cx: first.x + 1, cy: first.y + 1, r: 3 };
  const ring = check(w, houseSpot({ ...w, towns: [circle] }, CITY, 2, MIDDLE));
  for (const [x, y] of cellsOf(ring)) assert.ok(Math.hypot(x + 0.5 - circle.cx, y + 0.5 - circle.cy) > circle.r, `not in the town (${x},${y})`);
  // A gate's lane beside the best spot: not there.
  const lane = new Uint8Array(w.cells);
  lane[(first.y - 1) * N + first.x] |= PlaceBit.GateLane;
  assert.notDeepEqual(houseSpot({ ...w, grid: { size: N, cells: lane } }, CITY, 2, MIDDLE), first);
  // A node beside it (the placement grid blocks it too): a spot with nothing beside first.
  const trees = open();
  for (const [x, y] of [[first.x + 2, first.y], [first.x - 1, first.y + 1]]) {
    trees.cells[y * N + x] = PlaceBit.Blocked;
    trees.nodes.add(y * N + x);
  }
  const clear = check(trees, houseSpot(trees, CITY, 2, MIDDLE));
  assert.notDeepEqual(clear, first);
  for (let y = clear.y - 1; y <= clear.y + 2; y++) for (let x = clear.x - 1; x <= clear.x + 2; x++) assert.equal(trees.nodes.has(y * N + x), false);
  // Refused before: somewhere else.
  assert.notDeepEqual(houseSpot({ ...w, skip: new Set([first.y * N + first.x]) }, CITY, 2, MIDDLE), first);
  // Everything round the main city blocked or unexplored: none.
  const shut = open();
  shut.cells.fill(PlaceBit.Unexplored);
  assert.equal(houseSpot(shut, CITY, 2, MIDDLE), null);
});
