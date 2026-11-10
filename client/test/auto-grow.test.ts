// 自動擴編 (D-141, off by default): once every group with 自動補兵 is full and the resources are GROW_MARGIN over the
// reserve of each a soldier costs after paying it, a group with it on wants one more, in the mix it was set to.
import assert from "node:assert/strict";
import { test } from "node:test";
import { type ArmyNeed, GROW_MARGIN, type GrowGroup, pickGrowth, type Site } from "../src/game/auto-army.ts";
import { ArmyBook } from "../src/game/army.ts";
import { UnitType } from "../src/sim.ts";

const S = UnitType.Spearman;
const R = UnitType.Ranged;
const M = UnitType.Mage;
const c = (food: number, wood: number, gold: number, crystal = 0) => ({ food, wood, gold, crystal });
const COST: Record<number, ReturnType<typeof c>> = { [S]: c(40, 20, 0), [R]: c(0, 40, 30), [M]: c(0, 0, 140) };
const cost = (t: number) => COST[t];
const FULL: ArmyNeed = { reason: "full", missing: {}, want: {} };
const SITES: Site[] = [
  { id: 1, trains: S, free: true },
  { id: 2, trains: R, free: true },
  { id: 3, trains: M, free: true },
];
const budget = (have = c(2000, 2000, 2000), room = 20, mageRoom = 6) => ({ have, reserve: c(0, 0, 0), room, mageRoom });
const g = (want: Record<number, number>, o: Partial<GrowGroup> = {}): GrowGroup => ({ grow: true, refill: true, want, base: want, ...o });

test("全滿、資源比預留多 300 以上才擴；有缺的先補；開關關著、自動補兵關著都不擴", () => {
  assert.equal(GROW_MARGIN, 300);
  assert.deepEqual(pickGrowth(FULL, [g({ [S]: 4 })], SITES, cost, budget()), { group: 0, type: S });
  // Something missing: filled first.
  assert.deepEqual(pickGrowth({ reason: "short", missing: { [S]: 1 }, want: { [S]: 4 } }, [g({ [S]: 4 })], SITES, cost, budget()), { block: null });
  assert.deepEqual(pickGrowth(FULL, [g({ [S]: 4 }, { grow: false })], SITES, cost, budget()), { block: null });
  assert.deepEqual(pickGrowth(FULL, [g({ [S]: 4 }, { refill: false })], SITES, cost, budget()), { block: null });
  // A spearman (40 food, 20 wood): 320 wood is the least (300 left after it); 319 is not enough.
  assert.deepEqual(pickGrowth(FULL, [g({ [S]: 4 })], SITES, cost, budget(c(340, 320, 0))), { group: 0, type: S });
  assert.deepEqual(pickGrowth(FULL, [g({ [S]: 4 })], SITES, cost, budget(c(340, 319, 0))), { block: "money" });
  // Over the reserve: a reserve of 100 wood wants 420.
  assert.deepEqual(pickGrowth(FULL, [g({ [S]: 4 })], SITES, cost, { ...budget(c(340, 419, 0)), reserve: c(0, 100, 0) }), { block: "money" });
  // Gold not spent by a spearman: none needed.
  assert.deepEqual(pickGrowth(FULL, [g({ [S]: 4 })], SITES, cost, budget(c(340, 320, 0))), { group: 0, type: S });
});

test("人口沒空位不擴；法師到上限換別的兵種；沒有空的訓練場就等", () => {
  assert.deepEqual(pickGrowth(FULL, [g({ [S]: 4 })], SITES, cost, budget(c(2000, 2000, 2000), 0)), { block: "population" });
  assert.deepEqual(pickGrowth(FULL, [g({ [M]: 2, [R]: 2 })], SITES, cost, budget(c(2000, 2000, 2000), 20, 0)), { group: 0, type: R });
  assert.deepEqual(pickGrowth(FULL, [g({ [M]: 2 })], SITES, cost, budget(c(2000, 2000, 2000), 20, 0)), { block: null });
  const busy = SITES.map((s) => ({ ...s, free: false }));
  assert.deepEqual(pickGrowth(FULL, [g({ [S]: 4 })], busy, cost, budget()), { block: null });
});

test("照設定的比例長：落後最多的兵種先（同樣時兵種小的先）；好幾個軍團開著時人數少的先", () => {
  // Set to 槍 10、遠 5 (2:1): grows 槍 11, then 遠 6, then 槍 12…
  let want: Record<number, number> = { [S]: 10, [R]: 5 };
  const base = { ...want };
  const seen: number[] = [];
  for (let i = 0; i < 4; i++) {
    const r = pickGrowth(FULL, [g(want, { base })], SITES, cost, budget());
    assert.ok("type" in r);
    seen.push(r.type);
    want = { ...want, [r.type]: want[r.type] + 1 };
  }
  assert.deepEqual(seen, [S, R, S, S]);
  assert.deepEqual(want, { [S]: 13, [R]: 6 });
  // Two groups on: the one wanting fewer first; the same, the lower number.
  assert.deepEqual(pickGrowth(FULL, [g({ [S]: 12 }), g({ [R]: 6 })], SITES, cost, budget()), { group: 1, type: R });
  assert.deepEqual(pickGrowth(FULL, [g({ [S]: 6 }), g({ [R]: 6 })], SITES, cost, budget()), { group: 0, type: S });
  // A group set to nobody does not grow.
  assert.deepEqual(pickGrowth(FULL, [g({})], SITES, cost, budget()), { block: null });
});

test("軍團：擴編照開關那一刻的設定長；玩家改設定（−／＋、改成剛才選的、清空）後照新的；存檔記開關和比例，舊存檔是關", () => {
  const book = new ArmyBook();
  const typeOf = () => null;
  assert.equal(book.groups[0].grow, false, "off by default");
  book.setWant(0, S, 10, typeOf);
  book.setWant(0, R, 5, typeOf);
  book.groups[0].grow = true;
  book.grow(0, S, typeOf);
  assert.deepEqual(book.groups[0].want, { [S]: 11, [R]: 5 });
  assert.deepEqual(book.groups[0].growBase, { [S]: 10, [R]: 5 }, "the mix as set");
  book.grow(0, R, typeOf);
  assert.deepEqual(book.groups[0].growBase, { [S]: 10, [R]: 5 });
  // The player sets it again: the mix from now on is the new setting.
  book.setWant(0, R, 11, typeOf);
  assert.equal(book.groups[0].growBase, null);
  book.grow(0, S, typeOf);
  assert.deepEqual(book.groups[0].growBase, { [S]: 11, [R]: 11 });

  const saved = JSON.parse(JSON.stringify(book.save()));
  const back = new ArmyBook();
  back.restore(saved);
  assert.equal(back.groups[0].grow, true);
  assert.deepEqual(back.groups[0].growBase, { [S]: 11, [R]: 11 });
  assert.equal(back.groups[1].grow, false);
  // A save from before 自動擴編: off, no mix.
  for (const k of saved.groups) {
    delete k.grow;
    delete k.growBase;
  }
  const old = new ArmyBook();
  old.restore(saved);
  assert.equal(old.groups[0].grow, false);
  assert.equal(old.groups[0].growBase, null);
  assert.deepEqual(old.groups[0].want, { [S]: 12, [R]: 11 }, "the numbers it grew to kept");
  old.clearGroup(0);
  assert.equal(old.groups[0].growBase, null);
});
