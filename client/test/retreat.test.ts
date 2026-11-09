// 退回駐守的城（D-138 A; the user 2026-11-10: 「軍團按退守應該要會退到上一座它駐守的城市」）: where a group falls back,
// and the town each group last left soldiers in, kept with the save.

import assert from "node:assert/strict";
import { test } from "node:test";
import { ArmyBook, type TownArea } from "../src/game/army.ts";
import { retreatTown } from "../src/game/retreat.ts";
import { CELL, UnitType } from "../src/sim.ts";

const own = [
  { id: 3, cellX: 20, cellY: 20 },
  { id: 5, cellX: 60, cellY: 60 },
  { id: 7, cellX: 60, cellY: 20 },
];

test("退到哪：上一次駐守的城還是我方的就回那裡，再遠也一樣", () => {
  assert.equal(retreatTown(5, own, { x: 21, y: 21 }), 5);
});

test("退到哪：上一次的城丟了（不在我方的城裡），或沒駐守過，就去離軍團最近的我方城；一樣近取編號小的", () => {
  assert.equal(retreatTown(9, own, { x: 58, y: 22 }), 7, "town 9 not ours any more");
  assert.equal(retreatTown(null, own, { x: 22, y: 19 }), 3, "never held one");
  assert.equal(retreatTown(null, [own[2], own[0]], { x: 40.5, y: 20.5 }), 3, "as near: the lower id");
  assert.equal(retreatTown(null, own, null), 3, "nobody to measure from: the lowest id");
});

test("退到哪：一座我方的城都沒有就回主城（null）", () => {
  assert.equal(retreatTown(5, [], { x: 10, y: 10 }), null);
  assert.equal(retreatTown(null, [], null), null);
});

const spear = (id: number, cx: number, cy: number) => ({ id, type: UnitType.Spearman, x: cx * CELL + CELL / 2, y: cy * CELL + CELL / 2 });

test("每個軍團記上一次駐守的城：留守（station）和進駐（stationAll）都算，只記有兵留下的軍團；存檔帶著，舊存檔沒有就是沒有", () => {
  const book = new ArmyBook();
  book.saveGroup(0, [1, 2, 3].map((id) => ({ id, type: UnitType.Spearman })));
  book.saveGroup(1, [4, 5].map((id) => ({ id, type: UnitType.Spearman })));
  assert.deepEqual(book.lastTown, [null, null, null, null]);
  const town: TownArea = { id: 6, cellX: 30, cellY: 30, radius: 4 };
  book.station([spear(1, 30, 30), spear(2, 31, 30), spear(4, 50, 50)], town, 1);
  assert.deepEqual(book.lastTown, [6, null, null, null], "group 1's soldier stayed; group 2's was not in the town");
  book.stationAll(8, [4]);
  assert.deepEqual(book.lastTown, [6, 8, null, null]);
  book.stationAll(9, [2]);
  assert.deepEqual(book.lastTown, [9, 8, null, null], "the last one");
  const saved = book.save();
  const back = new ArmyBook();
  back.restore(saved);
  assert.deepEqual(back.lastTown, [9, 8, null, null]);
  const old = { ...saved };
  delete old.lastTown;
  const fromOld = new ArmyBook();
  fromOld.restore(old);
  assert.deepEqual(fromOld.lastTown, [null, null, null, null]);
});
