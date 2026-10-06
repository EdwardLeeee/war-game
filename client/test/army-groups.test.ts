import assert from "node:assert/strict";
import { test } from "node:test";
import { ArmyBook, type ArmyUnit, mostlyLoose, RECRUIT_RECHECK_TICKS, redirects, type TownArea } from "../src/game/army.ts";
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
    assert.equal(book.enlist(id, SPEAR, w.typeOf), 0);
  }
  assert.equal(count(book, 0), "10/10");
  // Full again: the next one stays at the rally point.
  w.add(24, SPEAR, 10, 10);
  assert.equal(book.enlist(24, SPEAR, w.typeOf), null);
  assert.equal(count(book, 0), "10/10");
});

test("編隊自動補兵：補給缺這種兵最多的編隊，一樣多挑編號小的；關掉的編隊和不缺的編隊不補；村民不補", () => {
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
    return book.enlist(id, type, w.typeOf);
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
  assert.equal(book.enlist(30, SPEAR, w.typeOf), null);
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
  assert.equal(book.enlist(9, SPEAR, w.typeOf), 0);
  assert.equal(count(book, 0), "5/5");
});

test("編隊自動補兵：新兵訓練出來就出發，不等湊滿，走到編隊現在的中心（不算還沒會合的新兵）（D-054）", () => {
  const w = new World();
  const book = new ArmyBook();
  book.saveGroup(0, w.many(1, 6, SPEAR, 50, 50));
  w.kill(4, 5, 6);
  book.prune(w.alive, () => true); // 1, 2, 3 at cells 50, 51, 52: centre cell 51
  const train = (id: number, tick: number): MarchOrderList => {
    w.add(id, SPEAR, 10, 10);
    assert.equal(book.enlist(id, SPEAR, w.typeOf), 0);
    return book.muster(tick, w.where);
  };
  assert.deepEqual(train(21, 0), [{ ids: [21], cellX: 51, cellY: 50 }]);
  // The next one goes at once too, with the one still on its way.
  assert.deepEqual(train(22, 60), [{ ids: [21, 22], cellX: 51, cellY: 50 }]);
  // Already sent: nothing more while the group stays put.
  assert.deepEqual(book.muster(61, w.where), []);
  assert.deepEqual(book.muster(60 + RECRUIT_RECHECK_TICKS, w.where), []);
});
type MarchOrderList = ReturnType<ArmyBook["muster"]>;

test("編隊自動補兵：編隊移動超過 3 格就重下前進指令；走到 6 格內就不再管；新兵一直是編隊的成員", () => {
  const w = new World();
  const book = new ArmyBook();
  book.saveGroup(0, w.many(1, 4, SPEAR, 50, 50));
  w.kill(2, 3, 4);
  book.prune(w.alive, () => true); // one veteran left, at cell (50, 50)
  for (const id of [21, 22, 23]) {
    w.add(id, SPEAR, 10, 50);
    book.enlist(id, SPEAR, w.typeOf);
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
  book.enlist(21, SPEAR, w.typeOf);
  assert.deepEqual(book.muster(0, w.where), []);
  assert.deepEqual(book.groups[0].recruits, []);
  assert.deepEqual(book.muster(RECRUIT_RECHECK_TICKS, w.where), []);
});

test("編隊自動補兵：玩家親手下過指令的新兵不再替他下指令，但還在編隊裡；陣亡的新兵不管", () => {
  const w = new World();
  const book = new ArmyBook();
  book.saveGroup(0, w.many(1, 5, SPEAR, 50, 50));
  w.kill(3, 4, 5);
  book.prune(w.alive, () => true);
  for (const id of [21, 22, 23]) {
    w.add(id, SPEAR, 10, 10);
    book.enlist(id, SPEAR, w.typeOf);
  }
  book.playerOrdered([22, 99]);
  w.kill(23);
  // The one ordered by hand and the dead one are not led; 22 stands far away by the player's
  // order and does not pull the meeting point toward it.
  assert.deepEqual(book.muster(10, w.where), [{ ids: [21], cellX: 51, cellY: 50 }]);
  book.prune(w.alive, () => true);
  assert.deepEqual(book.groups[0].ids, [1, 2, 21, 22]);
  // Once it walks up to the group it is an ordinary member, and counts for where the group is.
  w.units.set(22, { type: SPEAR, cx: 52, cy: 50 });
  book.muster(10 + RECRUIT_RECHECK_TICKS, w.where);
  assert.deepEqual(book.groups[0].recruits.map((r) => r.id), [21]);
});

test("編隊自動補兵：玩家對走在路上的新兵改姿態、隊形或自動施放，編隊移動後還是會被帶過去；前進才算親手指揮", () => {
  const w = new World();
  const book = new ArmyBook();
  book.saveGroup(0, w.many(1, 4, SPEAR, 50, 50));
  w.kill(2, 3, 4);
  book.prune(w.alive, () => true); // one veteran left, at cell (50, 50)
  for (const id of [21, 22, 23]) {
    w.add(id, SPEAR, 10, 50);
    book.enlist(id, SPEAR, w.typeOf);
  }
  assert.deepEqual(book.muster(0, w.where), [{ ids: [21, 22, 23], cellX: 50, cellY: 50 }]);
  // On their way, the player selects the whole group and changes its stance, formation and autocast.
  book.playerCommand({ c: "stance", u: [1, 21, 22, 23], stance: 1 });
  book.playerCommand({ c: "formation", u: [1, 21, 22, 23], loose: true });
  book.playerCommand({ c: "autocast", u: [1, 21, 22, 23], on: false });
  // The group moves on: all three are sent after it again.
  w.move([1], 10, 0);
  assert.deepEqual(book.muster(RECRUIT_RECHECK_TICKS, w.where), [{ ids: [21, 22, 23], cellX: 60, cellY: 50 }]);
  // A march order of his own to one of them: that one is his now.
  book.playerCommand({ c: "move", u: [22], x: 5, y: 5 });
  w.move([1], 10, 0);
  assert.deepEqual(book.muster(2 * RECRUIT_RECHECK_TICKS, w.where), [{ ids: [21, 23], cellX: 70, cellY: 50 }]);
  // Which orders count.
  for (const c of ["move", "attack", "retreat", "stop", "cast", "gather", "build", "repair"]) {
    const cmd = { c, u: [21], x: 0, y: 0, target: 0, node: 0, building: 0, type: 1, fx: 0, fy: 0 } as Parameters<typeof redirects>[0];
    assert.equal(redirects(cmd), true, c);
  }
  for (const cmd of [{ c: "stance", u: [21], stance: 0 }, { c: "formation", u: [21], loose: true }, { c: "autocast", u: [21], on: true }] as Parameters<typeof redirects>[0][]) {
    assert.equal(redirects(cmd), false, cmd.c);
  }
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
    assert.equal(book.enlist(id, SPEAR, w.typeOf), 0);
  }
  assert.deepEqual(book.muster(0, w.where), []);
  assert.deepEqual(book.groups[0].recruits, []);
  assert.equal(count(book, 0), "3/3");
  // A later recruit joins them where they stand.
  w.kill(21);
  book.prune(w.alive, () => true);
  w.add(24, SPEAR, 40, 10);
  book.enlist(24, SPEAR, w.typeOf);
  assert.deepEqual(book.muster(500, w.where), [{ ids: [24], cellX: 10, cellY: 10 }]);
});

test("隊形：編隊裡超過一半是散開，補進來的新兵也散開；剛好一半或沒有人時不算（D-027）", () => {
  const loose = new Set([1, 2, 3]);
  const isLoose = (id: number): boolean => loose.has(id);
  assert.equal(mostlyLoose([1, 2, 3, 4, 5], isLoose), true, "3 of 5");
  assert.equal(mostlyLoose([1, 2, 4, 5], isLoose), false, "2 of 4: half is not more than half");
  assert.equal(mostlyLoose([1, 2, 3], isLoose), true, "all of them");
  assert.equal(mostlyLoose([4, 5], isLoose), false, "none of them");
  assert.equal(mostlyLoose([], isLoose), false, "nobody left in the group");
});

// --- 軍團 (D-050): the player sets how many of each type a group wants -------------------

/** A gathering point (the rally point) at a cell, fixed point. */
const at = (cx: number, cy: number) => ({ x: cx * CELL + CELL / 2, y: cy * CELL + CELL / 2 });

test("軍團：設定目標後，沒編隊、沒留守的兵被拉進缺人的編隊（缺最多的優先，一樣多給編號小的）；留守、其他編隊的兵和村民不動", () => {
  const w = new World();
  const book = new ArmyBook();
  const town: TownArea = { id: 0, cellX: 80, cellY: 80, radius: 4 };
  book.saveGroup(1, w.many(1, 2, SPEAR, 10, 10)); // group 2: 2 spearmen, wants 2
  w.many(11, 5, SPEAR, 30, 30); // 11–15 in no group
  w.many(21, 2, RANGED, 40, 40); // 21–22 in no group
  w.add(31, SPEAR, 80, 80); // stationed below
  w.add(41, FARMER, 30, 31);
  assert.deepEqual(book.station(w.army(), town, 1), [31]);
  // Group 1 wants 2 spearmen and a ranged; group 3 wants 2 spearmen; group 2 now 3.
  book.setWant(0, SPEAR, 2, w.typeOf);
  book.setWant(0, RANGED, 1, w.typeOf);
  book.setWant(2, SPEAR, 2, w.typeOf);
  book.setWant(1, SPEAR, 3, w.typeOf);
  const drafted = book.draft(w.army());
  // Spearmen in id order, each to the group most short (the lower number on a tie):
  // 11 → 1 (short 2, 2, 1 for groups 1, 3, 2), 12 → 3, 13 → 1, 14 → 2, 15 → 3; ranged 21 → 1.
  assert.deepEqual(book.groups[0].ids, [11, 13, 21]);
  assert.deepEqual(book.groups[1].ids, [1, 2, 14]);
  assert.deepEqual(book.groups[2].ids, [12, 15]);
  assert.deepEqual(book.groups[3].ids, []);
  assert.deepEqual(drafted, [
    { group: 0, ids: [11, 13, 21] },
    { group: 2, ids: [12, 15] },
    { group: 1, ids: [14] },
  ]);
  // 22 is not wanted anywhere, 31 stays stationed, the farmer is not taken.
  const all = book.groups.flatMap((g) => g.ids);
  for (const id of [22, 31, 41]) assert.ok(!all.includes(id), `${id} not taken`);
  assert.deepEqual(book.garrisonOf(0), [31]);
  // Nothing more to do: a second draft takes nobody.
  assert.deepEqual(book.draft(w.army()), []);
});

test("軍團：優先順序和自動補兵一樣：缺最多的先補，一樣多補編號小的；關掉自動補兵的編隊不拉", () => {
  const w = new World();
  const book = new ArmyBook();
  book.setWant(0, SPEAR, 1, w.typeOf);
  book.setWant(1, SPEAR, 3, w.typeOf);
  book.setWant(2, SPEAR, 3, w.typeOf);
  book.groups[3].refill = false;
  book.setWant(3, SPEAR, 9, w.typeOf);
  w.many(1, 4, SPEAR, 20, 20);
  book.draft(w.army());
  // 1 → group 2 (short 3, the lower of 2 and 3), 2 → group 3 (3 against 2), 3 → group 2 (2 and 2: the lower), 4 → group 3 (2 against 1).
  assert.deepEqual(book.groups[1].ids, [1, 3]);
  assert.deepEqual(book.groups[2].ids, [2, 4]);
  assert.deepEqual(book.groups[0].ids, []);
  assert.deepEqual(book.groups[3].ids, [], "自動補兵 off: nobody pulled");
});

test("軍團：拉進來的兵不等湊滿 3 名，下一次就出發走到編隊所在的地方；已經在旁邊的直接算會合", () => {
  const w = new World();
  const book = new ArmyBook();
  book.saveGroup(0, w.many(1, 3, SPEAR, 50, 50));
  book.setWant(0, SPEAR, 5, w.typeOf);
  w.add(11, SPEAR, 10, 10);
  w.add(12, SPEAR, 52, 51); // already by the group
  book.draft(w.army());
  assert.deepEqual(book.groups[0].ids, [1, 2, 3, 11, 12]);
  assert.deepEqual(book.muster(200, w.where), [{ ids: [11], cellX: 51, cellY: 50 }]);
  assert.deepEqual(
    book.groups[0].recruits.map((r) => r.id),
    [11],
  );
  // On the way it is sent again only when the group moves on.
  assert.deepEqual(book.muster(200 + RECRUIT_RECHECK_TICKS, w.where), []);
});

test("軍團：編隊現在沒人時，拉進來的兵先在集結點集合；到了之後，再來的兵走去他們那裡", () => {
  const w = new World();
  const book = new ArmyBook();
  book.setWant(0, RANGED, 3, w.typeOf);
  w.add(1, RANGED, 10, 10);
  w.add(2, RANGED, 70, 10);
  book.draft(w.army());
  assert.deepEqual(book.muster(0, w.where, at(40, 60)), [{ ids: [1, 2], cellX: 40, cellY: 60 }]);
  // Without a gathering point they are the group where they stand, as before.
  const other = new ArmyBook();
  other.setWant(0, RANGED, 3, w.typeOf);
  other.draft(w.army());
  assert.deepEqual(other.muster(0, w.where), []);
  // They arrive; the next one goes to them.
  w.move([1], 30, 50);
  w.move([2], -30, 50);
  assert.deepEqual(book.muster(RECRUIT_RECHECK_TICKS, w.where, at(40, 60)), []);
  assert.deepEqual(book.groups[0].recruits, []);
  w.add(3, RANGED, 40, 20);
  book.draft(w.army());
  assert.deepEqual(book.muster(100, w.where, at(5, 5)), [{ ids: [3], cellX: 40, cellY: 60 }]);
});

test("軍團設定：目標調低時，後加入的兵先離開編隊；目標是三種兵的總和；清空後編隊沒有兵、什麼都不要", () => {
  const w = new World();
  const book = new ArmyBook();
  book.saveGroup(0, [...w.many(1, 3, SPEAR, 10, 10), ...w.many(11, 2, RANGED, 12, 10), w.add(21, FARMER, 9, 9)]);
  assert.equal(count(book, 0), "6/6");
  w.add(4, SPEAR, 30, 30);
  book.setWant(0, SPEAR, 4, w.typeOf);
  book.draft(w.army());
  assert.deepEqual(book.groups[0].ids, [1, 2, 3, 11, 12, 21, 4]);
  assert.equal(count(book, 0), "7/7", "4 spearmen + 2 ranged + the farmer saved with them");
  // Down to 2 spearmen: the last two to join leave (4, then 3).
  assert.deepEqual(book.setWant(0, SPEAR, 2, w.typeOf), [3, 4]);
  assert.deepEqual(book.groups[0].ids, [1, 2, 11, 12, 21]);
  assert.deepEqual(book.groups[0].recruits, []);
  assert.equal(count(book, 0), "5/5");
  assert.deepEqual(book.groups[0].want, { [SPEAR]: 2, [RANGED]: 2 });
  // Free again, and no group short of spearmen: they stay free.
  assert.deepEqual(book.draft(w.army()), []);
  assert.deepEqual(book.setWant(0, MAGE, 1, w.typeOf), []);
  assert.equal(count(book, 0), "5/6");
  assert.deepEqual(book.clearGroup(0), [1, 2, 11, 12, 21]);
  assert.equal(count(book, 0), "0/0");
  assert.deepEqual(book.groups[0].want, {});
  // Nothing wanted: nobody is pulled back.
  assert.deepEqual(book.draft(w.army()), []);
});

test("軍團設定：「照目前選的兵」就是原本的存編隊（選的兵放進來、各種兵的目標設成選的人數）", () => {
  const w = new World();
  const a = new ArmyBook();
  const b = new ArmyBook();
  const units = [...w.many(1, 2, SPEAR, 10, 10), w.add(5, MAGE, 11, 11)];
  a.saveGroup(2, units);
  b.saveGroup(2, units);
  assert.deepEqual(a.groups[2], b.groups[2]);
  assert.deepEqual(a.groups[2].want, { [SPEAR]: 2, [MAGE]: 1 });
  assert.equal(count(a, 2), "3/3");
});

test("軍團：只拉站著沒有指令、不是堅守的兵；正在執行玩家指令的等它停下來才拉（不推翻玩家的指令）", () => {
  const w = new World();
  const book = new ArmyBook();
  book.setWant(0, SPEAR, 3, w.typeOf);
  w.many(1, 3, SPEAR, 20, 20);
  const busy = new Set([1, 3]);
  assert.deepEqual(book.draft(w.army(), (id) => !busy.has(id)), [{ group: 0, ids: [2] }]);
  busy.delete(3);
  assert.deepEqual(book.draft(w.army(), (id) => !busy.has(id)), [{ group: 0, ids: [3] }]);
  assert.deepEqual(book.groups[0].ids, [2, 3]);
});

test("新兵補不進任何編隊時，加入現有兵最多的編隊，那種兵的目標加 1；一樣多給編號小的、自動補兵關掉的不算；沒有編隊有兵時留在集結點（D-054）", () => {
  const w = new World();
  const book = new ArmyBook();
  // No group has anyone: it stays at the rally point.
  w.add(100, SPEAR, 10, 10);
  assert.equal(book.joinLargest(100, SPEAR, w.typeOf), null);
  book.saveGroup(0, w.many(1, 3, SPEAR, 40, 40));
  book.saveGroup(1, [...w.many(11, 3, RANGED, 50, 40), w.add(14, MAGE, 50, 41)]);
  book.saveGroup(2, w.many(21, 4, SPEAR, 60, 40));
  book.groups[2].refill = false;
  // Group 2 has the most (4) among those on: a spearman joins it and it wants one more.
  w.add(101, SPEAR, 10, 10);
  assert.equal(book.enlist(101, SPEAR, w.typeOf), null, "nobody is short of spearmen");
  assert.equal(book.joinLargest(101, SPEAR, w.typeOf), 1);
  assert.deepEqual(book.groups[1].want, { [RANGED]: 3, [MAGE]: 1, [SPEAR]: 1 });
  assert.equal(count(book, 1), "5/5");
  assert.deepEqual(book.groups[1].recruits.map((r) => r.id), [101]);
  // It sets off at once, to the group.
  assert.deepEqual(book.muster(0, w.where), [{ ids: [101], cellX: 51, cellY: 40 }]);
  // The dead do not count: two of group 2 fall, group 1 (3) and group 2 (3) tie, the lower number.
  w.kill(11, 12);
  book.prune(w.alive, () => true);
  w.add(102, RANGED, 10, 10);
  assert.equal(book.enlist(102, RANGED, w.typeOf), 1, "group 2 is short of ranged now: filled first");
  w.add(103, MAGE, 10, 10);
  assert.equal(book.joinLargest(103, MAGE, w.typeOf), 1, "group 2 has 4 again, group 1 has 3");
  assert.equal(book.joinLargest(104, FARMER, w.typeOf), null, "farmers never");
});
