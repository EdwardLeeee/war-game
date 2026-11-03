// 哨所 3 × 3 (D-119, D-121): those hiding in it drawn on its walk, looking out; those poking turn to the enemy.

import assert from "node:assert/strict";
import { test } from "node:test";
import { buildingEntry, type BuildingsJson } from "../src/art/structures.ts";
import { outpostHide } from "../src/game/features.ts";
import { crewSpots, facingTo, pokers } from "../src/render/outpost-crew.ts";
import { BuildingType, type Rules } from "../src/sim.ts";

const STAND: [number, number, number][] = [
  [-2, 2, 3],
  [0, 2, 3],
  [2, 2, 3],
  [2, 0, 3],
  [-2, 0, 3],
  [-2, -2, 3],
  [0, -2, 3],
  [2, -2, 3],
  [0, 0, 3],
];

test("朝向：和模擬一樣 16 方向，0 東、4 南、8 西、12 北", () => {
  assert.equal(facingTo(0, 0, 1, 0), 0);
  assert.equal(facingTo(0, 0, 0, 1), 4);
  assert.equal(facingTo(0, 0, -1, 0), 8);
  assert.equal(facingTo(0, 0, 0, -1), 12);
  assert.equal(facingTo(0, 0, 1, 1), 2);
  assert.equal(facingTo(0, 0, 0, 0), 4, "同一點：朝南（朝鏡頭）");
});

test("牆頂的兵：照人數用前 n 個站位，從錨點換成世界座標，臉朝外", () => {
  const spots = crewSpots(STAND, 3, 100, 200, 16);
  assert.deepEqual(spots, [
    { x: 68, y: 232, upM: 3, facing: 6 },
    { x: 100, y: 232, upM: 3, facing: 4 },
    { x: 132, y: 232, upM: 3, facing: 2 },
  ]);
  assert.equal(crewSpots(STAND, 0, 0, 0, 16).length, 0);
  assert.equal(crewSpots(STAND, 12, 0, 0, 16).length, 9, "最多照站位的數量");
  assert.equal(crewSpots(STAND, 9, 0, 0, 16)[8].facing, 4, "中間那個朝南");
});

test("戳：挑離目標最近的 n 名；一樣近取前面的", () => {
  const spots = crewSpots(STAND, 9, 0, 0, 16);
  // An enemy by the east wall: the three on it.
  assert.deepEqual(pokers(spots, 60, 0, 3), [2, 3, 7]);
  assert.deepEqual(pokers(spots, 60, 0, 1), [3]);
  assert.deepEqual(pokers(spots, 60, 0, 0), []);
  assert.deepEqual(pokers(spots.slice(0, 2), 60, 0, 5), [0, 1], "人比 n 少：全部");
});

test("圖集：哨所的站位和前層照這一局的大小讀；別的大小的圖沒有就不畫", () => {
  const b = {
    buildings: {
      outpost: { type: BuildingType.Outpost, footprint: [3, 3], states: { done: "o3" }, stand_m: STAND, fronts: { done: "o3_front" }, sizes: { "2": { footprint: [2, 2], states: { done: "o2" } } } },
    },
  } as unknown as BuildingsJson;
  assert.equal(buildingEntry(b, BuildingType.Outpost, 3)?.stand_m?.length, 9);
  assert.equal(buildingEntry(b, BuildingType.Outpost, 3)?.fronts?.done, "o3_front", "前層（擋在步道上的人前面的女牆）");
  assert.equal(buildingEntry(b, BuildingType.Outpost, 2)?.stand_m, undefined);
  assert.equal(buildingEntry(b, BuildingType.Outpost, 2)?.fronts, undefined);
});

test("開關：features.outpostHide 開著才畫牆頂、面板才寫躲了幾名", () => {
  assert.equal(outpostHide(null), false);
  assert.equal(outpostHide({ features: { plunderOnce: true, towers: true, garrison: true, cavalry: true, outpost: true } } as Pick<Rules, "features">), false);
  assert.equal(outpostHide({ features: { plunderOnce: true, towers: true, garrison: true, cavalry: true, outpost: true, outpostHide: true } } as unknown as Pick<Rules, "features">), true);
});
