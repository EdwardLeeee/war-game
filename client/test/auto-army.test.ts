// 自動訓練照軍團缺的補 (D-098; the user 2026-10-21): what the groups are missing, which type the
// buildings train next, what stops them, and the main city's villagers up to their target.

import assert from "node:assert/strict";
import { test } from "node:test";
import { AutoArmyBook, armyNeed, affordsAbove, type GroupNeed, missingText, pickTrains, VILLAGER_TARGET, villagersMissing } from "../src/game/auto-army.ts";
import { headerAutoTrain } from "../src/game/game.ts";
import { UnitType } from "../src/sim.ts";

const S = UnitType.Spearman;
const R = UnitType.Ranged;
const M = UnitType.Mage;
const c = (food: number, wood: number, gold: number, crystal = 0) => ({ food, wood, gold, crystal });
const COST: Record<number, ReturnType<typeof c>> = { [S]: c(40, 20, 0), [R]: c(0, 40, 30), [M]: c(0, 0, 90, 50) };
const cost = (t: number) => COST[t];
const RICH = { have: c(1000, 1000, 1000, 1000), reserve: c(0, 150, 100, 15), room: 50, mageRoom: 6 };

test("缺額：開著自動補兵的軍團，每個兵種「想要 −（現有＋走去會合中）」加總，再減掉佇列裡的；沒設軍團、都關了自動補兵、都滿，各自說得出來", () => {
  assert.deepEqual(armyNeed([], {}), { reason: "none", missing: {}, want: {} });
  assert.equal(armyNeed([{ refill: true, want: {}, have: { [S]: 3 } }], {}).reason, "none", "a group with nothing wanted is not set");
  assert.equal(armyNeed([{ refill: false, want: { [S]: 4 }, have: {} }], {}).reason, "off");
  const two: GroupNeed[] = [
    { refill: true, want: { [S]: 10, [R]: 5 }, have: { [S]: 7, [R]: 3 } },
    { refill: true, want: { [S]: 4 }, have: { [S]: 6 } },
    // Off: not counted.
    { refill: false, want: { [M]: 3 }, have: {} },
  ];
  // Group 2 has two too many spearmen: they do not make up for group 1's three.
  assert.deepEqual(armyNeed(two, {}), { reason: "short", missing: { [S]: 3, [R]: 2 }, want: { [S]: 14, [R]: 5 } });
  assert.deepEqual(armyNeed(two, { [S]: 1, [R]: 5 }).missing, { [S]: 2, [R]: 0 });
  assert.equal(armyNeed(two, { [S]: 3, [R]: 2 }).reason, "full");
  assert.equal(missingText({ [R]: 2, [S]: 3, [M]: 0 }), "槍 3、遠 2");
});

test("挑兵種：缺的比例最大的先（遠程缺 2/5 比槍兵 3/10 多），一棟一名；補滿就停；沒有空的建築的兵種跳過", () => {
  const need = armyNeed([{ refill: true, want: { [S]: 10, [R]: 5 }, have: { [S]: 7, [R]: 3 } }], {});
  const sites = [
    { id: 1, trains: S, free: true },
    { id: 2, trains: S, free: true },
    { id: 3, trains: R, free: true },
  ];
  // Ranged 2/5 first; then spearmen 3/10 (ranged's 1/5 is less) at both barracks.
  assert.deepEqual(pickTrains(need, sites, cost, RICH).trains, [
    { building: 3, type: R },
    { building: 1, type: S },
    { building: 2, type: S },
  ]);
  // The range busy: spearmen only.
  assert.deepEqual(pickTrains(need, [sites[0], { ...sites[2], free: false }], cost, RICH).trains, [{ building: 1, type: S }]);
  // Full, or no group: nothing.
  assert.deepEqual(pickTrains(armyNeed([{ refill: true, want: { [S]: 2 }, have: { [S]: 2 } }], {}), sites, cost, RICH).trains, []);
  assert.deepEqual(pickTrains(armyNeed([], {}), sites, cost, RICH).trains, []);
});

test("只用預留以上的錢（只看那個兵種要花的資源）；人口滿了、法師到上限就不排，說得出為什麼", () => {
  assert.equal(affordsAbove(COST[S], c(40, 170, 0), c(0, 150, 100)), true, "a reserve of gold does not stop a spearman");
  assert.equal(affordsAbove(COST[S], c(40, 169, 500), c(0, 150, 100)), false);
  const need = armyNeed([{ refill: true, want: { [S]: 5, [R]: 5, [M]: 2 }, have: {} }], {});
  const sites = [
    { id: 1, trains: S, free: true },
    { id: 3, trains: R, free: true },
    { id: 5, trains: M, free: true },
  ];
  // Gold 120 over a reserve of 100: no ranged (30 above? 20 only) and no mage; spearmen go.
  const poor = pickTrains(need, sites, cost, { ...RICH, have: c(500, 500, 120, 100) });
  assert.deepEqual(poor.trains, [{ building: 1, type: S }]);
  assert.equal(poor.blocked.get(R), "money");
  assert.equal(poor.blocked.get(M), "money");
  // The money spent on one is not there for the next: all three equally short, the spearman first
  // (the lower type), its 木 20 leaves 35 above the reserve, short of a ranged unit's 40.
  const spent = pickTrains(need, sites, cost, { ...RICH, have: c(500, 205, 1000, 0), mageRoom: 0 });
  assert.deepEqual(spent.trains, [{ building: 1, type: S }]);
  assert.equal(spent.blocked.get(R), "money");
  const full = pickTrains(need, sites, cost, { ...RICH, room: 0 });
  assert.deepEqual(full.trains, []);
  assert.equal(full.blocked.get(S), "population");
  const capped = pickTrains(need, sites, cost, { ...RICH, mageRoom: 0 });
  assert.equal(capped.blocked.get(M), "mages");
  assert.deepEqual(capped.trains.map((t) => t.type).sort(), [S, R].sort());
});

test("村民：活著的（躲著的也算）加上排著的，少於目標才補；目標預設 40，−／+ 一次 5，0 到 200；暫停和目標存進存檔", () => {
  assert.equal(VILLAGER_TARGET, 40);
  assert.equal(villagersMissing(40, 36, 1), 3);
  assert.equal(villagersMissing(40, 41, 0), 0);
  const book = new AutoArmyBook();
  assert.equal(book.stepTarget(1), 45);
  assert.equal(book.stepTarget(-10), 0);
  book.villagerTarget = 198;
  assert.equal(book.stepTarget(1), 200);
  assert.equal(book.togglePaused(7), true);
  assert.equal(book.togglePaused(7), false);
  book.togglePaused(9);
  book.villagersPaused = true;
  book.autoHouse = false;
  const back = new AutoArmyBook();
  back.restore(JSON.parse(JSON.stringify(book.save())));
  assert.deepEqual(back.save(), { paused: [9], villagerTarget: 200, villagersPaused: true, autoHouse: false });
  back.restore(undefined);
  assert.deepEqual(back.save(), { paused: [], villagerTarget: 40, villagersPaused: false, autoHouse: true });
  // A save from before 自動蓋民居: on.
  back.restore({ paused: [], villagerTarget: 40, villagersPaused: false });
  assert.equal(back.autoHouse, true);
});

test("D-098 改用 init.autoTrain：紀錄第一行的 autoTrain 讀得出來；舊的存檔（玩家的開著）才逐棟送 auto_train off", () => {
  assert.deepEqual(headerAutoTrain('{"protocol":1,"seed":1,"scenario":"standard","ai":[false,true],"autoTrain":[false,false]}\n{"c":"move"}\n'), [false, false]);
  assert.deepEqual(headerAutoTrain('{"protocol":1,"seed":1,"scenario":"standard","ai":[false,true],"autoTrain":[true,false]}\n'), [true, false]);
  assert.equal(headerAutoTrain('{"protocol":1,"seed":1,"scenario":"standard","ai":[true,true]}\n'), null);
  assert.equal(headerAutoTrain("not json"), null);
});
