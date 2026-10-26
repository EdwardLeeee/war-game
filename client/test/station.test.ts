// 駐軍 (the user 2026-10-25: 「我是指說軍團選項，可以駐軍在都市裡面」; ceo's spec): the soldiers selected
// go into a town we hold and stay as its 留守: out of their groups and of any other garrison; a
// town not ours or no town says why; farmers do not go; the ranged and mages go up on the walls
// once in, as many as there are places.

import assert from "node:assert/strict";
import { test } from "node:test";
import { ArmyBook } from "../src/game/army.ts";
import { STATION_NOBODY, STATION_WRONG_TARGET, stationTap, upOnArrival } from "../src/game/station.ts";

const soldier = (id: number) => id >= 10;

test("駐軍點城鎮：自己持有的城，選的兵（村民不算）去留守；別人的城、沒點到城、只選了村民說原因", () => {
  assert.deepEqual(stationTap([1, 10, 11], { id: 3, held: true }, soldier), { town: 3, ids: [10, 11] });
  assert.deepEqual(stationTap([10], { id: 3, held: false }, soldier), { error: "不是你攻下的城鎮" });
  assert.deepEqual(stationTap([10], null, soldier), { error: STATION_WRONG_TARGET });
  assert.deepEqual(stationTap([1, 2], { id: 3, held: true }, soldier), { error: STATION_NOBODY });
});

test("到了城裡：遠程兵和法師上城牆，最多城牆的空位數；其他兵留在城裡", () => {
  const arrived = [
    { id: 10, climbs: false },
    { id: 11, climbs: true },
    { id: 12, climbs: true },
    { id: 13, climbs: true },
  ];
  assert.deepEqual(upOnArrival(arrived, 10), [11, 12, 13]);
  assert.deepEqual(upOnArrival(arrived, 2), [11, 12]);
  assert.deepEqual(upOnArrival(arrived, 0), []);
});

test("駐軍的記帳：記成那座城的留守，離開編隊和別的城的留守；和攻下時設的留守是同一份", () => {
  const army = new ArmyBook();
  army.groups[0].ids = [10, 11, 12];
  army.groups[1].ids = [13];
  army.stationAll(5, [13]);
  // Moved from town 5 to town 7, with two of group 1.
  const left = army.stationAll(7, [10, 11, 13]);
  assert.deepEqual(left, [2, 0, 0, 0]);
  assert.deepEqual(army.garrisonOf(5), []);
  assert.deepEqual(army.garrisonOf(7), [10, 11, 13]);
  assert.deepEqual(army.groups[0].ids, [12]);
  assert.equal(army.isGarrisoned(11), true);
  // The player's own 移動 ends it, as for any 留守 (GDD §5).
  assert.deepEqual(army.release([11, 12]), [11]);
  assert.deepEqual(army.garrisonOf(7), [10, 13]);
});
