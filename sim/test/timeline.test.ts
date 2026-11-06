// The post-game timeline (D-124, D-125; core/timeline.ts): samples of both sides every 10 seconds, town changes, main cities
// under attack, every death, cannon totals; outside the hash, and back by itself when a game is run again from its log.

import assert from "node:assert/strict";
import { test } from "node:test";
import { continueGame } from "../src/continue.ts";
import { hex8 } from "../src/core/fixed.ts";
import { BUILDINGS, DODGE, GARRISON, GARRISON_TYPES, OUTPOST, OUTPOST_HIDE, rules, TIMELINE, TOWNS } from "../src/core/rules.ts";
import { HitCause, UNIT_KINDS } from "../src/core/world.ts";
import { BuildingType, CELL_SHIFT, NEUTRAL, NO_OWNER, Resource, TownState, UnitType } from "../src/protocol.ts";
import { Runner } from "../src/runner.ts";
import { cmd, emptyGame, put, run, slotOf, switchedOff } from "./helpers.ts";

const S = 20;
const RES = [Resource.Food, Resource.Wood, Resource.Gold, Resource.Crystal];

/** One computer against another, played to the end once for the tests that read a whole game. */
let played: Runner | null = null;
function wholeGame(): Runner {
  if (played !== null) return played;
  const r = new Runner({ seed: 3, scenario: "standard", ai: [true, true], maxTicks: 60 * 60 * S, difficulty: ["hard", "normal"], autoTrain: [false, false], build: "t" });
  while (!r.over) r.tick();
  played = r;
  return r;
}

test("samples: from tick 0 every 10 s and one at the end, each as the world stood then", () => {
  const g = emptyGame();
  const w = g.w;
  const first = g.timeline.result(w);
  assert.equal(first.every, 200);
  assert.deepEqual(first.samples.map((x) => x.tick), [0]);
  assert.deepEqual(first.samples[0].stock[0], RES.map((r) => w.res[r]));
  put(g, 0, UnitType.Ranged, 5, 5);
  put(g, 1, UnitType.Spearman, 6, 90);
  run(g, TIMELINE.every);
  const stock = RES.map((r) => w.res[r]);
  w.res[Resource.Gold] += 123;
  run(g, 70);
  const t = g.timeline.result(w);
  assert.deepEqual(t.samples.map((x) => x.tick), [0, 200, 270], "the last one is now");
  assert.equal(t.samples[1].units[0][UnitType.Ranged], 1);
  assert.equal(t.samples[1].units[1][UnitType.Spearman], 1);
  assert.deepEqual(t.samples[1].stock[0], stock);
  assert.equal(t.samples[2].stock[0][2], stock[2] + 123);
  // result() leaves the record as it was: the extra last sample is not kept.
  run(g, TIMELINE.every - 70);
  assert.deepEqual(g.timeline.result(w).samples.map((x) => x.tick), [0, 200, 400]);
});

test("near: soldiers by a town and by a main city, both sides, farmers not, and only places with someone", () => {
  const g = emptyGame();
  const w = g.w;
  const t = w.map.towns[0];
  const places = w.map.towns.length;
  const box = w.castles[0].inside;
  const out = t.cellX + box.x1 + TIMELINE.nearTown;
  put(g, 0, UnitType.Spearman, t.cellX, t.cellY);
  put(g, 1, UnitType.Ranged, out, t.cellY);
  put(g, 1, UnitType.Ranged, out + 1, t.cellY);
  put(g, 1, UnitType.Farmer, t.cellX - 1, t.cellY);
  const home = w.map.spawns[0];
  put(g, 1, UnitType.Cavalry, home.cellX - 2 - TIMELINE.nearCity, home.cellY);
  run(g, 1);
  const rows = new Map(g.timeline.result(w).samples.at(-1)!.near.map((r) => [r[0], [r[1], r[2]]]));
  assert.deepEqual(rows.get(0), [1, 1], "8 cells out counts, 9 does not, the farmer does not");
  assert.ok(rows.get(places + 0) !== undefined && rows.get(places + 0)![1] >= 1, "by player 0's main city");
  assert.equal(rows.get(places + 1), undefined, "nobody by player 1's");
});

test("towns: a row for each change of state or holder, none at the start; a plunder pays into earned", () => {
  const g = emptyGame();
  const w = g.w;
  const T = 0;
  const t = w.map.towns[T];
  assert.deepEqual(g.timeline.result(w).towns, []);
  put(g, 0, UnitType.Spearman, t.cellX - 4, t.cellY);
  run(g, 3);
  const before = g.timeline.result(w).samples.at(-1)!.earned[0];
  w.townState[T] = TownState.Plundering;
  w.townOwner[T] = 0;
  w.townTimer[T] = 3;
  run(g, 5);
  w.townTimer[T] = 1;
  run(g, 3);
  const rows = g.timeline.result(w).towns.map((r) => r.slice(1));
  assert.deepEqual(rows, [
    [T, TownState.Plundering, 0],
    [T, TownState.Ruins, NO_OWNER],
    [T, TownState.Neutral, NEUTRAL],
  ]);
  const paid = TOWNS[w.townSize[T]].plunder;
  const after = g.timeline.result(w).samples.at(-1)!.earned[0];
  assert.equal(after[0] - before[0], paid.food);
  assert.equal(after[2] - before[2], paid.gold);
  assert.equal(after[3] - before[3], paid.crystal);
});

test("main city under attack: spells end after 30 s without a hit, the lowest hp kept; fallen, 0", () => {
  const g = emptyGame();
  const w = g.w;
  const b = w.buildings.col;
  const s = w.mainCity(1);
  const id = b.id[s];
  const tx = b.cellX[s];
  const ty = b.cellY[s];
  const spear = put(g, 0, UnitType.Spearman, tx - 1, ty);
  w.units.col.hp[slotOf(g, spear)] = 100000;
  g.fog.update(w);
  cmd(g, 0, { c: "attack", u: [spear], target: id });
  run(g, 5 * S);
  const first = g.timeline.result(w).sides[1].cityHits;
  assert.equal(first.length, 1);
  assert.ok(first[0][0] < first[0][1], "one spell of several blows");
  assert.equal(first[0][2], b.hp[w.building(id)], "lowest so far is now");
  cmd(g, 0, { c: "stop", u: [spear] });
  w.units.col.x[slotOf(g, spear)] = (tx - 30) << CELL_SHIFT;
  w.units.col.anchorX[slotOf(g, spear)] = (tx - 30) << CELL_SHIFT;
  run(g, TIMELINE.calmTicks + 2 * S);
  w.units.col.x[slotOf(g, spear)] = (tx - 1) << CELL_SHIFT;
  w.units.col.anchorX[slotOf(g, spear)] = (tx - 1) << CELL_SHIFT;
  cmd(g, 0, { c: "attack", u: [spear], target: id });
  run(g, 3 * S);
  const second = g.timeline.result(w).sides[1].cityHits;
  assert.equal(second.length, 2, "a second spell");
  assert.deepEqual(g.timeline.result(w).sides[0].cityHits, []);
  b.hp[w.building(id)] = 1;
  run(g, 3 * S);
  assert.equal(g.timeline.result(w).sides[1].cityHits.at(-1)![2], 0, "fallen");
});

test("deaths and the cannon's best shot: by whom, with what, and how many one shot killed of what", switchedOff(DODGE, () => {
  const g = emptyGame();
  const w = g.w;
  const u = w.units.col;
  const ax = 20;
  const ay = 60;
  const mage = put(g, 0, UnitType.Mage, ax, ay);
  const soft = [put(g, 1, UnitType.Spearman, ax + 5, ay), put(g, 1, UnitType.Spearman, ax + 5, ay + 1), put(g, 1, UnitType.Ranged, ax + 5, ay - 1)];
  for (const id of soft) {
    u.hp[slotOf(g, id)] = 1;
    u.stance[slotOf(g, id)] = 1;
  }
  w.res[Resource.Crystal] = 500;
  g.fog.update(w);
  cmd(g, 0, { c: "cast", u: mage, fx: ((ax + 5) << CELL_SHIFT) + 512, fy: (ay << CELL_SHIFT) + 512 });
  run(g, 10 * S);
  const t = g.timeline.result(w);
  const shot = t.deaths.filter((d) => d[6] === HitCause.Cannon);
  assert.equal(shot.length, 3, JSON.stringify(t.deaths));
  for (const d of shot) {
    assert.equal(d[1], 1);
    assert.equal(d[5], 0, "by player 0");
  }
  const c = t.sides[0].cannon;
  assert.equal(c.shots, 1);
  assert.equal(c.kills, 3);
  assert.equal(c.best?.kills, 3);
  assert.equal(c.best?.types[UnitType.Spearman], 2);
  assert.equal(c.best?.types[UnitType.Ranged], 1);
  assert.equal(c.best?.tick, shot[0][0]);
  assert.equal(t.sides[1].cannon.best, null);
}));

test("a whole game: totals agree with the deaths, earned never falls and covers what was gathered, the computers are named", () => {
  const r = wholeGame();
  const w = r.game.w;
  const t = r.timeline();
  assert.equal(t.samples.at(-1)!.tick, w.tick);
  for (let p = 0; p < 2; p++) {
    assert.deepEqual(t.sides[p as 0 | 1].lost, Array.from(w.lost.subarray(p * UNIT_KINDS, (p + 1) * UNIT_KINDS)));
    const mine = t.deaths.filter((d) => d[1] === p);
    assert.equal(mine.length, t.sides[p as 0 | 1].lost.reduce((a, b) => a + b, 0), "every loss is a death row");
    for (let k = 1; k < t.samples.length; k++) {
      t.samples[k].earned[p as 0 | 1].forEach((v, i) => assert.ok(v >= t.samples[k - 1].earned[p as 0 | 1][i], `earned falls at ${t.samples[k].tick}`));
    }
    RES.forEach((res, i) => assert.ok(t.samples.at(-1)!.earned[p as 0 | 1][i] >= w.gathered[p * 4 + res]));
    assert.equal(t.deaths.filter((d) => d[5] === p && d[6] === HitCause.Cannon).length, t.sides[p as 0 | 1].cannon.kills);
    const best = t.sides[p as 0 | 1].cannon.best;
    if (best !== null) assert.equal(best.types.reduce((a, b) => a + b, 0), best.kills);
  }
  assert.ok(t.deaths.some((d) => d[1] === NEUTRAL), "the militia too");
  for (let k = 1; k < t.deaths.length; k++) assert.ok(t.deaths[k][0] >= t.deaths[k - 1][0], "in order");
  assert.equal(t.sides[0].ai?.difficulty, "hard");
  assert.equal(t.sides[1].ai?.difficulty, "normal");
  assert.equal(t.sides[0].ai?.style, r.styles[0]);
  assert.ok(t.towns.length > 0, "towns changed hands");
});

test("run again from its log, the timeline comes back the same; and it is not in the hash", () => {
  const r = new Runner({ seed: 5, scenario: "standard", ai: [true, true], maxTicks: 0, difficulty: ["hard", "normal"], autoTrain: [false, false], build: "t" });
  const stop = 12 * 60 * S;
  while (r.game.tick < stop && !r.over) r.tick();
  const lines = [JSON.stringify(r.header([true, true])), ...r.game.log.map((c) => JSON.stringify(c))];
  const got = continueGame({ log: lines.join("\n") + "\n", hashes: r.hashes.map((h) => ({ tick: h.tick, hash: hex8(h.hash) })), toTick: r.game.tick, build: "t" });
  assert.equal(got.ok, true);
  if (!got.ok) return;
  assert.deepEqual(got.runner.timeline(), r.timeline());
  const h = r.game.hash();
  r.game.w.deathLog.push(1, 2, 3, 4, 5, 6, 7, 8);
  r.game.w.earnedExtra[0] += 5;
  assert.equal(r.game.hash(), h);
});

test("hides (D-125): who hides in what and how, one place; the switches off, null", () => {
  const b = rules().buildings;
  assert.deepEqual(b[BuildingType.MainCity].hides, { types: GARRISON_TYPES, command: "garrison", slots: BUILDINGS[BuildingType.MainCity].holds });
  assert.deepEqual(b[BuildingType.ArrowTower].hides, { types: GARRISON_TYPES, command: "garrison", slots: BUILDINGS[BuildingType.ArrowTower].holds });
  assert.deepEqual(b[BuildingType.Outpost].hides, { types: [UnitType.Spearman], command: "post", slots: OUTPOST_HIDE.slots });
  assert.equal(b[BuildingType.House].hides, null);
  assert.equal(JSON.parse(JSON.stringify(rules())).buildings[BuildingType.ArrowTower].hides.slots, BUILDINGS[BuildingType.ArrowTower].holds, "it survives the way to the screen");
  switchedOff(GARRISON, () => {
    assert.equal(rules().buildings[BuildingType.MainCity].hides, null);
  })();
  switchedOff(OUTPOST_HIDE, () => {
    assert.equal(rules().buildings[BuildingType.Outpost].hides, null);
  })();
  switchedOff(OUTPOST, () => {
    assert.equal(rules().buildings[BuildingType.Outpost].hides, null);
  })();
});
