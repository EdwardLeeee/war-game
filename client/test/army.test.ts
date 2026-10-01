import assert from "node:assert/strict";
import { test } from "node:test";
import { ArmyBook, type ArmyUnit, inTown, isSoldier, type TownArea } from "../src/game/army.ts";
import { CELL, UnitType } from "../src/sim.ts";

const FARMER = UnitType.Farmer;
const SPEAR = UnitType.Spearman;
const RANGED = UnitType.Ranged;
const MAGE = UnitType.Mage;

/** A small town at cell (30, 30) with the simulation's radius of 4 cells. */
const TOWN: TownArea = { id: 0, cellX: 30, cellY: 30, radius: 4 };
const OTHER: TownArea = { id: 1, cellX: 60, cellY: 60, radius: 6 };

/** A unit standing at the centre of a cell. */
const unit = (id: number, type: number, cx: number, cy: number): ArmyUnit => ({ id, type, x: cx * CELL + CELL / 2, y: cy * CELL + CELL / 2 });

test("留守：城鎮範圍是模擬用的那個圓（中心在格子正中間，半徑 4 格）", () => {
  assert.equal(inTown(unit(1, SPEAR, 34, 30), TOWN), true, "4 cells east: on the circle");
  assert.equal(inTown(unit(2, SPEAR, 35, 30), TOWN), false, "5 cells east");
  assert.equal(inTown(unit(3, SPEAR, 33, 33), TOWN), false, "3 and 3: 4.24 cells away, outside the circle");
  assert.equal(inTown(unit(4, SPEAR, 32, 33), TOWN), true, "2 and 3: 3.6 cells away");
});

test("留守：只挑城鎮範圍內的士兵，離中心近的先、一樣近挑編號小的、法師排最後", () => {
  const book = new ArmyBook();
  const units = [
    unit(10, MAGE, 30, 30), // on the centre, but a mage: last
    unit(11, SPEAR, 32, 30), // 2 cells
    unit(12, RANGED, 30, 31), // 1 cell
    unit(13, SPEAR, 31, 30), // 1 cell, higher id than 12
    unit(14, FARMER, 30, 30), // farmers do not count
    unit(15, SPEAR, 40, 30), // outside
  ];
  assert.deepEqual(book.candidates(units, TOWN), [12, 13, 11, 10]);
  assert.deepEqual(book.station(units, TOWN, 2), [12, 13]);
  assert.deepEqual(book.garrisonOf(TOWN.id), [12, 13]);
  // The next ones in the same order; asking for more than there are takes what is there.
  assert.deepEqual(book.candidates(units, TOWN), [11, 10]);
  assert.deepEqual(book.station(units, TOWN, 5), [11, 10]);
  assert.deepEqual(book.station(units, TOWN, 1), [], "nobody left to station");
  assert.deepEqual(book.station(units, TOWN, 0), []);
});

test("留守：全軍不選留守的兵，也不選農民", () => {
  const book = new ArmyBook();
  const units = [unit(1, SPEAR, 30, 30), unit(2, SPEAR, 31, 30), unit(3, RANGED, 50, 50), unit(4, FARMER, 31, 31), unit(5, MAGE, 52, 50)];
  assert.deepEqual(book.army(units), [1, 2, 3, 5]);
  book.station(units, TOWN, 1);
  assert.deepEqual(book.army(units), [2, 3, 5]);
  assert.equal(isSoldier(FARMER), false);
});

test("留守：被挑中的兵從原本的編隊移出", () => {
  const book = new ArmyBook();
  const units = [unit(1, SPEAR, 30, 30), unit(2, SPEAR, 31, 30), unit(3, SPEAR, 32, 30)];
  book.groups[0].ids = [1, 2, 3];
  book.groups[2].ids = [1, 3];
  book.station(units, TOWN, 1);
  assert.deepEqual(book.groups[0].ids, [2, 3]);
  assert.deepEqual(book.groups[2].ids, [3]);
});

test("留守：已經在別座城鎮留守的兵不會再被挑", () => {
  const book = new ArmyBook();
  // Unit 1 stands where the two areas would overlap if OTHER were moved; station it in TOWN first.
  const near: TownArea = { id: 1, cellX: 33, cellY: 30, radius: 4 };
  const units = [unit(1, SPEAR, 31, 30), unit(2, SPEAR, 33, 30)];
  assert.deepEqual(book.station(units, TOWN, 1), [1]);
  assert.deepEqual(book.candidates(units, near), [2]);
  assert.deepEqual(book.candidates(units, OTHER), []);
});

test("留守：減一名時放掉挑選順序最後面的那一名（法師先、再來離中心最遠的、一樣遠放編號大的）", () => {
  const book = new ArmyBook();
  const units = [unit(1, SPEAR, 30, 30), unit(2, SPEAR, 32, 30), unit(3, SPEAR, 30, 32), unit(4, MAGE, 30, 31)];
  book.station(units, TOWN, 4);
  assert.equal(book.releaseOne(units, TOWN), 4, "the mage");
  assert.equal(book.releaseOne(units, TOWN), 3, "2 cells away, higher id");
  assert.equal(book.releaseOne(units, TOWN), 2);
  assert.equal(book.releaseOne(units, TOWN), 1);
  assert.equal(book.releaseOne(units, TOWN), null);
  assert.deepEqual(book.army(units), [1, 2, 3, 4]);
});

test("留守：玩家親手下前進、攻擊或撤退的兵不再留守", () => {
  const book = new ArmyBook();
  const units = [unit(1, SPEAR, 30, 30), unit(2, SPEAR, 31, 30), unit(3, SPEAR, 32, 30)];
  book.station(units, TOWN, 2);
  assert.deepEqual(book.release([2, 3]), [2], "3 was not stationed");
  assert.deepEqual(book.garrisonOf(TOWN.id), [1]);
  assert.deepEqual(book.army(units), [2, 3]);
});

test("留守：搶或治理被模擬拒絕（例如資源不夠）時，跟著留守的兵放回來；成功了就不再追蹤", () => {
  const book = new ArmyBook();
  const units = [unit(1, SPEAR, 30, 30), unit(2, SPEAR, 31, 30), unit(3, SPEAR, 60, 60)];
  book.awaitChoice(TOWN.id, 7, book.station(units, TOWN, 2));
  assert.deepEqual(book.refused(6), [], "another command");
  assert.deepEqual(book.refused(7), [1, 2]);
  assert.deepEqual(book.garrisonOf(TOWN.id), []);
  assert.deepEqual(book.refused(7), [], "only once");
  // A choice that went through: the town no longer waits, so a later rejection with that number changes nothing.
  book.awaitChoice(OTHER.id, 9, book.station(units, OTHER, 1));
  book.settle(() => false);
  assert.deepEqual(book.refused(9), []);
  assert.deepEqual(book.garrisonOf(OTHER.id), [3]);
});

test("留守：陣亡的兵從名單移除；城鎮不再是我方的，名單清空並回報還活著的兵", () => {
  const book = new ArmyBook();
  const units = [unit(1, SPEAR, 30, 30), unit(2, SPEAR, 31, 30), unit(3, SPEAR, 60, 60), unit(4, SPEAR, 61, 60)];
  book.groups[1].ids = [2, 9];
  book.station(units, TOWN, 2);
  book.station(units, OTHER, 2);
  // Unit 1 dies; both towns still held.
  assert.deepEqual(book.prune((id) => id !== 1 && id !== 9, () => true), []);
  assert.deepEqual(book.garrisonOf(TOWN.id), [2]);
  assert.deepEqual(book.groups[1].ids, [], "2 left the group when stationed, 9 died");
  // OTHER revolts: its garrison ends and the two survivors are handed back.
  assert.deepEqual(book.prune(() => true, (town) => town === TOWN.id), [3, 4]);
  assert.deepEqual(book.garrisonOf(OTHER.id), []);
  assert.deepEqual(book.garrisonOf(TOWN.id), [2]);
  assert.deepEqual(book.army(units), [1, 3, 4]);
});
