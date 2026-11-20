// No crystal (D-135; the user 2026-11-08: 「魔晶感覺很雞肋都用不到 好像可以拿掉」): food, wood and gold only. A mage costs
// gold, the cannon nothing; no main city, mage kill, town or vein gives crystal; the maps have no vein. Resource.Crystal
// stays in the tables, always 0 (features.noCrystal). The rules with crystal (the switch NO_CRYSTAL off) went in D-135's
// first layer, and with them the tests of the maps and rules with crystal.

import assert from "node:assert/strict";
import { test } from "node:test";
import { generateMap } from "../src/core/map.ts";
import { generateRandomMap } from "../src/core/random-map.ts";
import { AUTO_TRAIN, CANNON, GOVERN_INCOME, governPerMinute, rules, TOWNS } from "../src/core/rules.ts";
import { twinRiversMap } from "../src/core/twin-rivers.ts";
import { BuildingType, CELL, NodeKind, Reject, Resource, TownSize, UnitType } from "../src/protocol.ts";
import { Runner } from "../src/runner.ts";
import { cmd, emptyGame, openArea, put, run, slotOf } from "./helpers.ts";

const S = 20;
const SIZES = [TownSize.Small, TownSize.Large];
const crystalOf = (g: ReturnType<typeof emptyGame>, p: number) => g.w.res[p * 4 + Resource.Crystal];

test("the rules: a mage costs 140 gold only, the hall 200 gold, the cannon and the reserve no crystal, towns pay none; features say so", () => {
  const r = rules();
  assert.equal(r.features.noCrystal, true);
  assert.deepEqual(r.units[UnitType.Mage].cost, { food: 0, wood: 0, gold: 140, crystal: 0 });
  assert.deepEqual(r.buildings[BuildingType.MageHall].cost, { food: 0, wood: 150, gold: 200, crystal: 0 });
  assert.equal(CANNON.crystal, 0);
  assert.equal(AUTO_TRAIN.reserve.crystal, 0);
  for (const size of SIZES) {
    for (const c of [TOWNS[size].plunder, TOWNS[size].perMinute, governPerMinute(size), GOVERN_INCOME.boost[size], r.towns[size].plunder, r.towns[size].perMinute]) assert.equal(c.crystal, 0);
  }
  for (const u of r.units) assert.equal(u.cost.crystal, 0, `unit ${u.type}`);
  for (const b of r.buildings) if (b !== undefined && b !== null) assert.equal(b.cost.crystal, 0, `building ${b.type}`);
});

test("the maps: no crystal vein, fixed, random or twin-rivers", () => {
  const veins = (m: { nodes: { kind: number }[] }) => m.nodes.filter((x) => x.kind === NodeKind.CrystalVein).length;
  assert.equal(veins(generateMap()), 0);
  assert.equal(veins(twinRiversMap(2)), 0);
  for (let seed = 1; seed <= 8; seed++) assert.equal(veins(generateRandomMap(seed, 129)), 0, `seed ${seed}`);
});

test("the cannon fires with no crystal (no NoCrystal), and a mage's killer gets none", () => {
  const g = emptyGame();
  g.w.ecoOn[0] = 0;
  g.w.ecoOn[1] = 0;
  const a = openArea(g, 20);
  const mage = put(g, 0, UnitType.Mage, a.x + 2, a.y + 10);
  const foe = put(g, 1, UnitType.Spearman, a.x + 8, a.y + 10);
  g.w.units.col.stance[slotOf(g, foe)] = 1;
  g.w.units.col.cooldown[slotOf(g, foe)] = 100000;
  g.fog.update(g.w);
  assert.equal(crystalOf(g, 0), 0);
  const hp = g.w.units.col.hp[slotOf(g, foe)];
  cmd(g, 0, { c: "cast", u: mage, fx: (a.x + 8) * CELL + 512, fy: (a.y + 10) * CELL + 512 });
  let rejected: number[] = [];
  for (let t = 0; t < 3 * S; t++) {
    g.step();
    rejected = rejected.concat(g.events.filter((e) => e.to === 0 && e.ev.k === "rejected").map((e) => (e.ev as { reason: number }).reason));
  }
  assert.ok(!rejected.includes(Reject.NoCrystal), `rejected ${rejected}`);
  assert.equal(g.w.cannonShots[0], 1, "fired");
  assert.ok(g.w.units.col.hp[slotOf(g, foe)] < hp, "and hit");
  assert.equal(crystalOf(g, 0), 0);
  // Its death pays player 1 nothing.
  const s = slotOf(g, mage);
  g.w.units.col.shield[s] = 0;
  g.w.units.col.hp[s] = 1;
  g.w.units.col.cooldown[slotOf(g, foe)] = 0;
  g.w.units.col.stance[slotOf(g, foe)] = 0;
  let killed: { crystal: number } | null = null;
  for (let t = 0; t < 200 && killed === null; t++) {
    g.step();
    for (const e of g.events) if (e.ev.k === "mage_killed" && e.to === 1) killed = e.ev;
  }
  assert.ok(killed !== null, "killed");
  assert.equal(killed!.crystal, 0);
  assert.equal(crystalOf(g, 1), 0);
});

test("a whole game: crystal stays 0 for both sides all the way, main cities and towns giving none; a mage costs its gold", () => {
  const r = new Runner({ seed: 3, scenario: "standard", ai: [true, true], maxTicks: 25 * 60 * S, difficulty: ["hard", "normal"], autoTrain: [false, false], build: "t" });
  while (!r.over) {
    r.tick();
    if (r.game.tick % (16 * S) === 1) for (let p = 0; p < 2; p++) assert.equal(r.game.w.res[p * 4 + Resource.Crystal], 0, `tick ${r.game.tick}`);
  }
  const t = r.timeline();
  for (const s of t.samples) for (let p = 0; p < 2; p++) assert.deepEqual([s.earned[p][Resource.Crystal], s.stock[p][Resource.Crystal]], [0, 0]);
  // A mage trained at a hall: its gold, nothing else.
  const g = emptyGame();
  g.w.ecoOn[0] = 0;
  const m = g.w.mainCity(0);
  const b = g.w.buildings.col;
  const hall = g.w.addBuilding(0, BuildingType.MageHall, b.cellX[m] + 8, b.cellY[m], 500, 1000);
  g.w.res.set([0, 0, 140, 0], 0);
  cmd(g, 0, { c: "train", building: hall, type: UnitType.Mage, n: 1 });
  run(g, 1);
  assert.deepEqual(Array.from(g.w.res.subarray(0, 4)), [0, 0, 0, 0]);
  assert.equal(b.queueLength[g.w.building(hall)], 1);
});
