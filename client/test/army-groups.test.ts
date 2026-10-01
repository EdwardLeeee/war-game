import assert from "node:assert/strict";
import { test } from "node:test";
import { ArmyBook, type ArmyUnit, RECRUIT_RECHECK_TICKS, RECRUIT_WAIT_TICKS, type TownArea } from "../src/game/army.ts";
import { CELL, UnitType } from "../src/sim.ts";

const FARMER = UnitType.Farmer;
const SPEAR = UnitType.Spearman;
const RANGED = UnitType.Ranged;
const MAGE = UnitType.Mage;

/** A little world: living units with a type and a cell. */
class World {
  readonly units = new Map<number, { type: number; cx: number; cy: number }>();
  add(id: number, type: number, cx: number, cy: number): { id: number; type: number } {
    this.units.set(id, { type, cx, cy });
    return { id, type };
  }
  many(first: number, n: number, type: number, cx: number, cy: number): { id: number; type: number }[] {
    return Array.from({ length: n }, (_, i) => this.add(first + i, type, cx + i, cy));
  }
  kill(...ids: number[]): void {
    for (const id of ids) this.units.delete(id);
  }
  move(ids: number[], dx: number, dy: number): void {
    for (const id of ids) {
      const u = this.units.get(id);
      if (u !== undefined) this.units.set(id, { ...u, cx: u.cx + dx, cy: u.cy + dy });
    }
  }
  readonly typeOf = (id: number): number | null => this.units.get(id)?.type ?? null;
  readonly alive = (id: number): boolean => this.units.has(id);
  readonly where = (id: number): { x: number; y: number } | null => {
    const u = this.units.get(id);
    return u === undefined ? null : { x: u.cx * CELL + CELL / 2, y: u.cy * CELL + CELL / 2 };
  };
  army(): ArmyUnit[] {
    return [...this.units].map(([id, u]) => ({ id, type: u.type, x: u.cx * CELL + CELL / 2, y: u.cy * CELL + CELL / 2 }));
  }
}

/** 現有／原本, as on the group button. */
const count = (book: ArmyBook, i: number): string => `${book.groups[i].ids.length}/${book.groups[i].saved}`;

test("編隊自動補兵：存 10 名槍兵、陣亡 3 名後，接下來訓練出的 3 名槍兵補進這個編隊，回到 10/10（驗收條件）", () => {
  const w = new World();
  const book = new ArmyBook();
  book.saveGroup(0, w.many(1, 10, SPEAR, 40, 40));
  assert.equal(count(book, 0), "10/10");
  assert.deepEqual(book.groups[0].want, { [SPEAR]: 10 });
  w.kill(8, 9, 10);
  book.prune(w.alive, () => true);
  assert.equal(count(book, 0), "7/10");
  for (const id of [21, 22, 23]) {
    w.add(id, SPEAR, 10, 10);
    assert.equal(book.enlist(id, SPEAR, 100, w.typeOf), 0);
  }
  assert.equal(count(book, 0), "10/10");
  // Full again: the next one stays at the rally point.
  w.add(24, SPEAR, 10, 10);
  assert.equal(book.enlist(24, SPEAR, 100, w.typeOf), null);
  assert.equal(count(book, 0), "10/10");
});

test("編隊自動補兵：補給缺這種兵最多的編隊，一樣多挑編號小的；關掉的編隊和不缺的編隊不補；農民不補", () => {
  const w = new World();
  const book = new ArmyBook();
  book.saveGroup(0, [...w.many(1, 4, SPEAR, 40, 40), ...w.many(11, 2, RANGED, 40, 41)]);
  book.saveGroup(1, w.many(21, 6, SPEAR, 50, 40));
  book.saveGroup(2, w.many(31, 6, SPEAR, 60, 40));
  // Group 1 is short of 1 spearman, groups 2 and 3 of 3 each, group 1 also of a ranged.
  w.kill(1, 12, 21, 22, 23, 31, 32, 33);
  book.prune(w.alive, () => true);
  const train = (id: number, type: number): number | null => {
    w.add(id, type, 10, 10);
    return book.enlist(id, type, 0, w.typeOf);
  };
  assert.equal(train(101, SPEAR), 1, "3 short in groups 2 and 3: the lower number");
  assert.equal(train(102, SPEAR), 2, "now group 3 is shortest (3 against 2)");
  assert.equal(train(103, RANGED), 0, "only group 1 has ranged");
  assert.equal(train(104, MAGE), null, "no group has mages");
  assert.equal(train(105, FARMER), null, "farmers are never enlisted");
  book.groups[1].refill = false;
  assert.equal(train(106, SPEAR), 2, "group 2 is off: 2 short there, but group 3 (2 short) gets it");
  book.groups[2].refill = false;
  assert.equal(train(107, SPEAR), 0, "group 1 is short of 1");
  assert.equal(train(108, SPEAR), null, "the rest are off or full");
});

test("編隊：一名兵只屬於一個編隊，存進另一個編隊時從舊的移出，舊編隊的「原本」跟著減少", () => {
  const w = new World();
  const book = new ArmyBook();
  const all = [...w.many(1, 6, SPEAR, 40, 40), ...w.many(11, 4, RANGED, 40, 41), w.add(20, FARMER, 40, 42)];
  book.saveGroup(0, all);
  assert.equal(count(book, 0), "11/11");
  assert.deepEqual(book.groups[0].want, { [SPEAR]: 6, [RANGED]: 4 }, "farmers are members but not refilled");
  // Half of them become group 2.
  book.saveGroup(1, all.filter((u) => [4, 5, 6, 13, 14, 20].includes(u.id)));
  assert.deepEqual(book.groups[0].ids, [1, 2, 3, 11, 12]);
  assert.equal(count(book, 0), "5/5");
  assert.deepEqual(book.groups[0].want, { [SPEAR]: 3, [RANGED]: 2 });
  assert.equal(count(book, 1), "6/6");
  assert.deepEqual(book.groups[1].want, { [SPEAR]: 3, [RANGED]: 2 });
  // Regrouping left nobody short.
  w.add(30, SPEAR, 10, 10);
  assert.equal(book.enlist(30, SPEAR, 0, w.typeOf), null);
  // Saving a group again counts it afresh.
  w.kill(1);
  book.prune(w.alive, () => true);
  assert.equal(count(book, 0), "4/5");
  book.saveGroup(0, [2, 3, 11, 12].map((id) => ({ id, type: w.typeOf(id) ?? -1 })));
  assert.equal(count(book, 0), "4/4");
});

test("編隊：移去留守的兵不改「原本」，所以會補回來", () => {
  const w = new World();
  const book = new ArmyBook();
  const town: TownArea = { id: 0, cellX: 30, cellY: 30, radius: 4 };
  book.saveGroup(0, w.many(1, 5, SPEAR, 29, 30));
  assert.deepEqual(book.station(w.army(), town, 1), [2], "the one on the centre");
  assert.equal(count(book, 0), "4/5");
  w.add(9, SPEAR, 10, 10);
  assert.equal(book.enlist(9, SPEAR, 0, w.typeOf), 0);
  assert.equal(count(book, 0), "5/5");
});

test("編隊自動補兵：新兵湊滿 3 名才一起出發，走到編隊現在的中心（不算還沒會合的新兵）", () => {
  const w = new World();
  const book = new ArmyBook();
  book.saveGroup(0, w.many(1, 6, SPEAR, 50, 50)); // cells 50–55: the centre is 52.5 → cell 53 after + half a cell
  w.kill(4, 5, 6);
  book.prune(w.alive, () => true); // 1, 2, 3 at cells 50, 51, 52: centre cell 51
  const train = (id: number, tick: number): MarchOrderList => {
    w.add(id, SPEAR, 10, 10);
    assert.equal(book.enlist(id, SPEAR, tick, w.typeOf), 0);
    return book.muster(tick, w.where);
  };
  assert.deepEqual(train(21, 0), []);
  assert.deepEqual(train(22, 60), []);
  assert.deepEqual(train(23, 120), [{ ids: [21, 22, 23], cellX: 51, cellY: 50 }]);
  // Already sent: nothing more while the group stays put.
  assert.deepEqual(book.muster(121, w.where), []);
  assert.deepEqual(book.muster(120 + RECRUIT_RECHECK_TICKS, w.where), []);
});
type MarchOrderList = ReturnType<ArmyBook["muster"]>;

test("編隊自動補兵：湊不到 3 名時，第一名等了 20 秒（400 tick）就出發", () => {
  const w = new World();
  const book = new ArmyBook();
  book.saveGroup(0, w.many(1, 4, SPEAR, 50, 50));
  w.kill(3, 4);
  book.prune(w.alive, () => true);
  w.add(21, SPEAR, 10, 10);
  book.enlist(21, SPEAR, 1000, w.typeOf);
  w.add(22, SPEAR, 10, 11);
  book.enlist(22, SPEAR, 1300, w.typeOf);
  assert.deepEqual(book.muster(1000 + RECRUIT_WAIT_TICKS - 1, w.where), []);
  // The two veterans stand on cells 50 and 51: the centre is the line between them, cell 51.
  assert.deepEqual(book.muster(1000 + RECRUIT_WAIT_TICKS, w.where), [{ ids: [21, 22], cellX: 51, cellY: 50 }], "the second leaves with the first");
});

test("編隊自動補兵：編隊移動超過 3 格就重下前進指令；走到 6 格內就不再管；新兵一直是編隊的成員", () => {
  const w = new World();
  const book = new ArmyBook();
  book.saveGroup(0, w.many(1, 4, SPEAR, 50, 50));
  w.kill(2, 3, 4);
  book.prune(w.alive, () => true); // one veteran left, at cell (50, 50)
  for (const id of [21, 22, 23]) {
    w.add(id, SPEAR, 10, 50);
    book.enlist(id, SPEAR, 0, w.typeOf);
  }
  assert.deepEqual(book.muster(0, w.where), [{ ids: [21, 22, 23], cellX: 50, cellY: 50 }]);
  // The group walks 2 cells: not far enough to send them again.
  w.move([1], 2, 0);
  assert.deepEqual(book.muster(RECRUIT_RECHECK_TICKS, w.where), []);
  // 10 cells further: sent again, to where the group is now.
  w.move([1], 10, 0);
  assert.deepEqual(book.muster(2 * RECRUIT_RECHECK_TICKS - 1, w.where), [], "checked every 2 s, not every tick");
  assert.deepEqual(book.muster(2 * RECRUIT_RECHECK_TICKS, w.where), [{ ids: [21, 22, 23], cellX: 62, cellY: 50 }]);
  // Two of them arrive (within 6 cells); the third is still on its way.
  w.units.set(21, { type: SPEAR, cx: 57, cy: 50 });
  w.units.set(22, { type: SPEAR, cx: 60, cy: 52 });
  w.units.set(23, { type: SPEAR, cx: 40, cy: 50 });
  assert.deepEqual(book.muster(3 * RECRUIT_RECHECK_TICKS, w.where), []);
  assert.deepEqual(book.groups[0].recruits.map((r) => r.id), [23]);
  // The group moves again: only the one still marching is sent, and the two that joined now count for the centre.
  w.move([1, 21, 22], 12, 0);
  const again = book.muster(4 * RECRUIT_RECHECK_TICKS, w.where);
  assert.deepEqual(again.map((o) => o.ids), [[23]]);
  assert.deepEqual(book.groups[0].ids, [1, 21, 22, 23]);
});

test("編隊自動補兵：新兵訓練出來就在編隊旁邊（6 格內）時，直接算會合，不下指令", () => {
  const w = new World();
  const book = new ArmyBook();
  book.saveGroup(0, w.many(1, 3, SPEAR, 12, 10));
  w.kill(3);
  book.prune(w.alive, () => true);
  w.add(21, SPEAR, 10, 10);
  book.enlist(21, SPEAR, 0, w.typeOf);
  assert.deepEqual(book.muster(0, w.where), []);
  assert.deepEqual(book.groups[0].recruits, []);
  assert.deepEqual(book.muster(RECRUIT_WAIT_TICKS, w.where), []);
});

test("編隊自動補兵：玩家親手下過指令的新兵不再替他下指令，但還在編隊裡；陣亡的新兵不管", () => {
  const w = new World();
  const book = new ArmyBook();
  book.saveGroup(0, w.many(1, 5, SPEAR, 50, 50));
  w.kill(3, 4, 5);
  book.prune(w.alive, () => true);
  for (const id of [21, 22, 23]) {
    w.add(id, SPEAR, 10, 10);
    book.enlist(id, SPEAR, 0, w.typeOf);
  }
  book.playerOrdered([22, 99]);
  w.kill(23);
  // Three were waiting: the one ordered by hand and the dead one are out, so 21 waits for the 20 s.
  assert.deepEqual(book.muster(10, w.where), []);
  // 22 stands far away by the player's order: it does not pull the meeting point toward it.
  assert.deepEqual(book.muster(RECRUIT_WAIT_TICKS, w.where), [{ ids: [21], cellX: 51, cellY: 50 }]);
  book.prune(w.alive, () => true);
  assert.deepEqual(book.groups[0].ids, [1, 2, 21, 22]);
  // Once it walks up to the group it is an ordinary member, and counts for where the group is.
  w.units.set(22, { type: SPEAR, cx: 52, cy: 50 });
  book.muster(RECRUIT_WAIT_TICKS + RECRUIT_RECHECK_TICKS, w.where);
  assert.deepEqual(book.groups[0].recruits.map((r) => r.id), [21]);
});

test("編隊自動補兵：編隊全滅時新兵不出發，留在原地當編隊的新成員", () => {
  const w = new World();
  const book = new ArmyBook();
  book.saveGroup(0, w.many(1, 3, SPEAR, 50, 50));
  w.kill(1, 2, 3);
  book.prune(w.alive, () => true);
  assert.equal(count(book, 0), "0/3");
  for (const id of [21, 22, 23]) {
    w.add(id, SPEAR, 10, 10);
    assert.equal(book.enlist(id, SPEAR, 0, w.typeOf), 0);
  }
  assert.deepEqual(book.muster(0, w.where), []);
  assert.deepEqual(book.groups[0].recruits, []);
  assert.equal(count(book, 0), "3/3");
  // A later recruit joins them where they stand.
  w.kill(21);
  book.prune(w.alive, () => true);
  w.add(24, SPEAR, 40, 10);
  book.enlist(24, SPEAR, 500, w.typeOf);
  assert.deepEqual(book.muster(500 + RECRUIT_WAIT_TICKS, w.where), [{ ids: [24], cellX: 10, cellY: 10 }]);
});
