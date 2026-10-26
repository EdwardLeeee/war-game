// 出城歸隊 (the user 2026-10-26: 「我把軍隊放進去之後應該要可以釋放回兵團」, choosing 自動留最少人數;
// ceo's spec): those stationed in a town are still their group's, and come out again to walk back
// to it, the town keeping the least it needs; who stays: those on its wall, then ranged, spearmen,
// cavalry, siege, mages, nearest the centre.

import assert from "node:assert/strict";
import { test } from "node:test";
import { ArmyBook, type ArmyUnit, type TownArea } from "../src/game/army.ts";
import { CELL, UnitType } from "../src/sim.ts";

const SPEAR = UnitType.Spearman;
const RANGED = UnitType.Ranged;
const MAGE = UnitType.Mage;
const CAVALRY = UnitType.Cavalry;

const TOWN: TownArea = { id: 0, cellX: 30, cellY: 30, radius: 4 };
const OTHER: TownArea = { id: 1, cellX: 60, cellY: 60, radius: 4 };

const unit = (id: number, type: number, cx: number, cy: number, wall = false): ArmyUnit => ({ id, type, x: cx * CELL + CELL / 2, y: cy * CELL + CELL / 2, wall });
const where = (units: ArmyUnit[]) => (id: number) => {
  const u = units.find((v) => v.id === id);
  return u === undefined ? null : { x: u.x, y: u.y };
};
const typeOf = (units: ArmyUnit[]) => (id: number) => units.find((v) => v.id === id)?.type ?? null;

test("出城歸隊：自動留最少人數，城裡別的留守先算；留下的是牆上的、遠程、槍兵、騎兵，法師最後，再看離中心近", () => {
  const book = new ArmyBook();
  const units = [
    unit(1, MAGE, 30, 30), // on the centre, but a mage
    unit(2, SPEAR, 31, 30),
    unit(3, RANGED, 32, 30),
    unit(4, CAVALRY, 30, 31),
    unit(5, RANGED, 33, 30, true), // on the wall
    unit(9, SPEAR, 30, 29), // in no group
    unit(20, SPEAR, 50, 50), // group 1 out in the field
  ];
  book.groups[0].ids = [1, 2, 3, 4, 5, 20];
  book.stationAll(TOWN.id, [1, 2, 3, 4, 5, 9]);
  const mine = (id: number) => book.groups[0].ids.includes(id);
  // A large town (3): 9 in no group counts first, two of group 1 stay: the one on the wall, then the ranged.
  const r = book.unstation(units, TOWN, mine, 3);
  assert.deepEqual(r.kept, [5, 3]);
  assert.deepEqual(r.out, [2, 4, 1], "spearman, cavalry, the mage last to stay");
  assert.deepEqual(book.garrisonOf(TOWN.id), [3, 5, 9]);
  // Still group 1's; they walk back to it (recruits).
  assert.deepEqual(book.groups[0].ids, [1, 2, 3, 4, 5, 20]);
  assert.deepEqual(
    book.groups[0].recruits.map((x) => x.id),
    [2, 4, 1],
  );
  assert.deepEqual(book.marching(0), [1, 2, 4, 20]);
  // Nobody more than the least: nothing comes out.
  assert.deepEqual(book.unstation(units, TOWN, mine, 3), { out: [], kept: [5, 3] });
  // 全部帶走: everyone.
  assert.deepEqual(book.unstation(units, TOWN, mine, 0), { out: [5, 3], kept: [] });
  assert.deepEqual(book.garrisonOf(TOWN.id), [9]);
});

test("出城歸隊：走去編隊沒駐守的兵中心；整個編隊都駐守時，出來的兵就是編隊，在原地待命", () => {
  const book = new ArmyBook();
  const units = [unit(1, SPEAR, 30, 30), unit(2, SPEAR, 31, 30), unit(3, SPEAR, 70, 70), unit(4, SPEAR, 72, 70), unit(5, SPEAR, 60, 60)];
  book.groups[0].ids = [1, 2, 3, 4, 5];
  book.stationAll(TOWN.id, [1, 2]);
  book.stationAll(OTHER.id, [5]);
  book.unstation(units, TOWN, () => true, 0);
  // To 3 and 4 (cells 70–72): 5 in the other town does not count.
  assert.deepEqual(book.muster(100, where(units)), [{ ids: [1, 2], cellX: 71, cellY: 70 }]);

  const all = new ArmyBook();
  all.groups[1].ids = [1, 2];
  all.stationAll(TOWN.id, [1, 2]);
  assert.deepEqual(all.marching(1), []);
  all.unstation(units, TOWN, () => true, 0);
  assert.deepEqual(all.muster(100, where(units)), [], "nobody to walk to");
  assert.deepEqual(all.groups[1].recruits, []);
  assert.deepEqual(all.marching(1), [1, 2]);
});

test("解除留守：沒編隊的留守回到全軍，不當新兵；歸隊只動那個編隊的", () => {
  const book = new ArmyBook();
  const units = [unit(1, SPEAR, 30, 30), unit(2, SPEAR, 31, 30), unit(3, SPEAR, 32, 30)];
  book.groups[2].ids = [3];
  book.stationAll(TOWN.id, [1, 2, 3]);
  assert.deepEqual(book.army(units), []);
  assert.deepEqual(book.garrisonByGroup(TOWN.id), [
    { group: 2, ids: [3] },
    { group: null, ids: [1, 2] },
  ]);
  const r = book.unstation(units, TOWN, (id) => book.groupOf(id) === null, 1);
  // Group 3's soldier is the one the town keeps.
  assert.deepEqual(r, { out: [1, 2], kept: [] });
  assert.deepEqual(book.army(units), [1, 2]);
  assert.deepEqual(book.groups[2].recruits, []);
  assert.deepEqual(book.garrisonByGroup(TOWN.id), [{ group: 2, ids: [3] }]);
});

test("駐守中：編隊的留守一城一城列出；城的留守分編隊；哪些城有這些兵", () => {
  const book = new ArmyBook();
  book.groups[0].ids = [1, 2, 3];
  book.groups[1].ids = [4];
  book.stationAll(OTHER.id, [3]);
  book.stationAll(TOWN.id, [1, 4, 7]);
  assert.deepEqual(book.stationedOf(0), [
    { town: TOWN.id, ids: [1] },
    { town: OTHER.id, ids: [3] },
  ]);
  assert.deepEqual(book.stationedOf(2), []);
  assert.deepEqual(book.townsOf([3, 9]), [OTHER.id]);
  assert.deepEqual(book.townsOf([1, 3]), [TOWN.id, OTHER.id]);
  assert.deepEqual(book.perGroup([1, 3, 4, 7]), [2, 1, 0, 0]);
});

test("留守 −、搶治理被拒、下城牆：有編隊的走回編隊", () => {
  const units = [unit(1, SPEAR, 30, 30), unit(2, MAGE, 31, 30), unit(3, RANGED, 30, 31, true)];
  const book = new ArmyBook();
  book.groups[0].ids = [1, 2, 3];
  book.station(units, TOWN, 3);
  assert.equal(book.releaseOne(units, TOWN), 2, "the mage first");
  assert.deepEqual(
    book.groups[0].recruits.map((r) => r.id),
    [2],
  );
  book.awaitChoice(TOWN.id, 4, [1]);
  assert.deepEqual(book.refused(4), [1]);
  assert.deepEqual(
    book.groups[0].recruits.map((r) => r.id),
    [2, 1],
  );
  // 下城牆: 3 comes down and back; one in no group is not touched.
  assert.deepEqual(book.backToGroups([3, 8]), [3]);
  assert.equal(book.isGarrisoned(3), false);
  assert.deepEqual(
    book.groups[0].recruits.map((r) => r.id),
    [2, 1, 3],
  );
});

test("留守的兵：玩家重存編隊時還留在編隊；軍團設定減人先放沒駐守的；兵最多的編隊不算駐守的", () => {
  const units = [unit(1, SPEAR, 30, 30), unit(2, SPEAR, 31, 30), unit(3, SPEAR, 50, 50), unit(4, SPEAR, 51, 50), unit(5, RANGED, 52, 50)];
  const book = new ArmyBook();
  book.saveGroup(0, [1, 2, 3].map((id) => ({ id, type: SPEAR })));
  book.stationAll(TOWN.id, [1, 2]);
  // His long press with the group's button selection (3) and one more (4).
  book.saveGroup(0, [3, 4].map((id) => ({ id, type: SPEAR })), typeOf(units));
  assert.deepEqual(book.groups[0].ids, [3, 4, 1, 2]);
  assert.deepEqual(book.groups[0].want, { [SPEAR]: 4 });
  assert.equal(book.groups[0].saved, 4);
  // 3 spearmen wanted: one of those out in the field leaves (4, the last), not one in the town.
  assert.deepEqual(book.setWant(0, SPEAR, 3, typeOf(units)), [4]);
  // The main army for a new soldier: group 2 has two marching, group 1 one.
  book.saveGroup(1, [
    { id: 4, type: SPEAR },
    { id: 5, type: RANGED },
  ]);
  assert.equal(book.joinLargest(6, SPEAR, (id) => (id === 6 ? SPEAR : typeOf(units)(id))), 1);
});
