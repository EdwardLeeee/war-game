// Automatic training (round 6, D-054; core/training.ts): a barracks, range or mage hall with it
// on queues its unit whenever its queue is empty, from what is above the player's reserve, not
// past the population or the mage cap; a person's buildings start with it on, an AI's off.

import assert from "node:assert/strict";
import { test } from "node:test";
import { Game } from "../src/core/game.ts";
import { AUTO_TRAIN, MAGE_CAP, UNITS } from "../src/core/rules.ts";
import { BuildingField, BuildingFlag, BuildingType, BUILDING_STRIDE, HeaderField, Resource, UnitType } from "../src/protocol.ts";
import { Runner } from "../src/runner.ts";
import { buildView } from "../src/view/view.ts";
import { cmd, emptyGame, run } from "./helpers.ts";

const SPEAR = UNITS[UnitType.Spearman];

/** An empty standard game (main cities only) where player p's new buildings start with automatic training as given. */
function scene(auto: [boolean, boolean]): Game {
  const g = emptyGame();
  for (let p = 0; p < 2; p++) g.w.autoTrain[p] = auto[p] ? 1 : 0;
  return g;
}

/** A finished building of player p beside its main city (player 1's mirrors player 0's). */
function trainer(g: Game, p: number, type: BuildingType, k = 0): number {
  const [x, y] = [20 + 4 * k, 72];
  const id = g.w.addBuilding(p, type, p === 0 ? x : y, p === 0 ? y : x, 500, 1000);
  return g.w.building(id);
}

function setRes(g: Game, p: number, food: number, wood: number, gold: number, crystal: number): void {
  g.w.res.set([food, wood, gold, crystal], p * 4);
}

function count(g: Game, p: number, type: UnitType): number {
  const u = g.w.units.col;
  let n = 0;
  for (let s = 0; s < g.w.units.count; s++) if (u.owner[s] === p && u.type[s] === type) n++;
  return n;
}

test("on: a barracks queues the next spearman whenever its queue empties, and both sides mirror", () => {
  const g = scene([true, true]);
  const bs = [trainer(g, 0, BuildingType.Barracks), trainer(g, 1, BuildingType.Barracks)];
  for (let p = 0; p < 2; p++) setRes(g, p, 1000, 1000, 0, 0);
  const b = g.w.buildings.col;
  for (const s of bs) assert.ok((b.flags[s] & BuildingFlag.AutoTrain) !== 0);
  let emptyTicks = 0;
  for (let t = 0; t < 4 * SPEAR.trainTicks + 10; t++) {
    run(g, 1);
    for (const s of bs) if (b.queueLength[s] === 0) emptyTicks++;
  }
  assert.equal(emptyTicks, 0, "never empty while there is money");
  for (let p = 0; p < 2; p++) {
    assert.equal(count(g, p, UnitType.Spearman), 4);
    assert.equal(g.w.res[p * 4 + Resource.Food], 1000 - 5 * SPEAR.cost.food, "four out, the fifth queued");
  }
  const u = g.w.units.col;
  const at = (p: number) =>
    Array.from({ length: g.w.units.count }, (_, s) => s)
      .filter((s) => u.owner[s] === p)
      .map((s) => (p === 0 ? `${u.x[s]},${u.y[s]}` : `${u.y[s]},${u.x[s]}`))
      .sort();
  assert.deepEqual(at(1), at(0));
});

test("only what is above the reserve pays: at reserve + cost - 1 nothing is queued, at reserve + cost one is", () => {
  const g = scene([true, false]);
  const s = trainer(g, 0, BuildingType.Barracks);
  const r = AUTO_TRAIN.reserve;
  setRes(g, 0, r.food + SPEAR.cost.food, r.wood + SPEAR.cost.wood - 1, 0, 0);
  run(g, 20);
  assert.equal(g.w.buildings.col.queueLength[s], 0);
  g.w.res[Resource.Wood] += 1;
  run(g, 1);
  assert.equal(g.w.buildings.col.queueLength[s], 1);
  assert.deepEqual(Array.from(g.w.res.subarray(0, 3)), [r.food, r.wood, 0], "spent down to the reserve, not into it");
  // The reserve is the player's: set to zero, the same money queues at once elsewhere too.
  const s2 = trainer(g, 0, BuildingType.Barracks, 1);
  setRes(g, 0, SPEAR.cost.food, SPEAR.cost.wood, 0, 0);
  cmd(g, 0, { c: "reserve", food: 0, wood: 0, gold: 0, crystal: 0 });
  run(g, 1);
  assert.equal(g.w.buildings.col.queueLength[s2], 1);
  const v = buildView(g, 0);
  assert.deepEqual([HeaderField.reserveFood, HeaderField.reserveWood, HeaderField.reserveGold, HeaderField.reserveCrystal].map((f) => v.header[f]), [0, 0, 0, 0]);
});

test("a full population queues nothing and says so on the building; room again, it queues and the mark goes", () => {
  const g = scene([true, false]);
  const s = trainer(g, 0, BuildingType.Barracks);
  setRes(g, 0, 5000, 5000, 0, 0);
  const cap = g.w.populationCap(0);
  for (let k = 0; k < cap; k++) g.w.addUnit(0, UnitType.Farmer, (16 << 10) + 512, (70 << 10) + 512, UNITS[UnitType.Farmer].hp);
  run(g, 5);
  const b = g.w.buildings.col;
  assert.equal(b.queueLength[s], 0);
  assert.ok((b.flags[s] & BuildingFlag.AutoPopulationFull) !== 0);
  const row = (v: ReturnType<typeof buildView>) => {
    for (let k = 0; k < v.buildings.length; k += BUILDING_STRIDE) if (v.buildings[k + BuildingField.id] === b.id[s]) return v.buildings.subarray(k, k + BUILDING_STRIDE);
    return null;
  };
  const both = BuildingFlag.AutoTrain | BuildingFlag.AutoPopulationFull;
  assert.equal((row(buildView(g, 0))?.[BuildingField.flags] ?? 0) & both, both);
  assert.equal((row(buildView(g, null))?.[BuildingField.flags] ?? 0) & both, both, "a spectator sees it too");
  assert.equal((row(buildView(g, 1))?.[BuildingField.flags] ?? 0) & both, 0, "the enemy does not");
  g.w.units.col.hp[0] = 0;
  run(g, 2);
  assert.equal(b.queueLength[s], 1);
  assert.equal(b.flags[s] & BuildingFlag.AutoPopulationFull, 0);
});

test("paused (auto_train off) queues nothing; on again, it does", () => {
  const g = scene([true, false]);
  const s = trainer(g, 0, BuildingType.Barracks);
  setRes(g, 0, 1000, 1000, 0, 0);
  cmd(g, 0, { c: "auto_train", building: g.w.buildings.col.id[s], on: false });
  run(g, 20);
  const b = g.w.buildings.col;
  assert.equal(b.queueLength[s], 0);
  assert.equal(b.flags[s] & (BuildingFlag.AutoTrain | BuildingFlag.AutoPopulationFull), 0);
  cmd(g, 0, { c: "auto_train", building: b.id[s], on: true });
  run(g, 1);
  assert.equal(b.queueLength[s], 1);
});

test("an AI's buildings start with it off: a game without autoTrain, and only the person's side with it", () => {
  const off = emptyGame();
  const s = trainer(off, 0, BuildingType.Barracks);
  setRes(off, 0, 1000, 1000, 0, 0);
  run(off, 20);
  assert.equal(off.w.buildings.col.flags[s] & BuildingFlag.AutoTrain, 0);
  assert.equal(off.w.buildings.col.queueLength[s], 0);
  // As the worker starts a person against the AI (ai [false, true]).
  const r = new Runner({ seed: 1, scenario: "e2e", ai: [false, false], maxTicks: 0, autoTrain: [true, false] });
  const b = r.game.w.buildings.col;
  for (let k = 0; k < r.game.w.buildings.count; k++) {
    if (!AUTO_TRAIN.buildings.includes(b.type[k])) continue;
    assert.equal((b.flags[k] & BuildingFlag.AutoTrain) !== 0, b.owner[k] === 0, `building ${b.id[k]} of player ${b.owner[k]}`);
  }
  assert.deepEqual(r.header([false, true]).autoTrain, [true, false]);
  assert.equal(new Runner({ seed: 1, scenario: "standard", ai: [true, true] }).header([true, true]).autoTrain, undefined);
});

test("mage hall: the mage cap holds, and 15 crystal stay for the cannon", () => {
  const g = scene([true, false]);
  const s = trainer(g, 0, BuildingType.MageHall);
  const mage = UNITS[UnitType.Mage].cost;
  const r = AUTO_TRAIN.reserve;
  setRes(g, 0, 0, r.wood, r.gold + mage.gold, r.crystal + mage.crystal - 1);
  run(g, 5);
  assert.equal(g.w.buildings.col.queueLength[s], 0, "short of the crystal reserve");
  g.w.res[Resource.Crystal] += 1;
  run(g, 1);
  assert.equal(g.w.buildings.col.queueLength[s], 1);
  // At the cap: no more.
  const g2 = scene([true, false]);
  const s2 = trainer(g2, 0, BuildingType.MageHall);
  for (let k = 0; k < MAGE_CAP; k++) g2.w.addUnit(0, UnitType.Mage, (16 << 10) + 512, (70 << 10) + 512, UNITS[UnitType.Mage].hp);
  setRes(g2, 0, 0, 5000, 5000, 5000);
  run(g2, 5);
  assert.equal(g2.w.buildings.col.queueLength[s2], 0);
});

test("a log with autoTrain replays to the same hashes", () => {
  const r = new Runner({ seed: 2, scenario: "e2e", ai: [false, true], maxTicks: 0, autoTrain: [true, false] });
  while (r.game.tick < 3000) r.tick();
  const head = r.header([false, true]);
  const rp = new Runner({ seed: head.seed, scenario: head.scenario, ai: [false, false], replay: r.game.log, maxTicks: 0, autoTrain: head.autoTrain });
  while (rp.game.tick < 3000) rp.tick();
  assert.ok(r.game.w.trained[UnitType.Spearman] > 0, "player 0 trained on its own");
  assert.deepEqual(rp.hashes, r.hashes);
});
