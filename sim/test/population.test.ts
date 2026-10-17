// D-083 (the user 2026-10-17): the population ceiling is 200 plus 20 for each small town and 40
// for the big one a player governs, a governed town adds as much to the cap, and a town lost
// lowers both without taking the units away. POPULATION_200 is off until war-game-ai has retuned
// the AIs; off, the ceiling is 120 as before. perf200 and perf360: both sides full at 200 / 360.

import assert from "node:assert/strict";
import { test } from "node:test";
import type { Game } from "../src/core/game.ts";
import { Game as NewGame } from "../src/core/game.ts";
import { BUILDINGS, MAGE_CAP, MAX_POPULATION, POPULATION_200, rules, UNITS } from "../src/core/rules.ts";
import { PERF, PERF_200, PERF_360 } from "../src/core/scenarios.ts";
import { UNIT_KINDS } from "../src/core/world.ts";
import { BuildingType, HeaderField, NEUTRAL, Reject, Resource, TownSize, TownState, UnitFlag, UnitType } from "../src/protocol.ts";
import { buildView } from "../src/view/view.ts";
import { cmd, emptyGame, openArea, put } from "./helpers.ts";

/** A test body run with POPULATION_200 on, then as it was. */
function populationOn(body: () => void): () => void {
  return () => {
    const was = POPULATION_200.on;
    POPULATION_200.on = true;
    try {
      body();
    } finally {
      POPULATION_200.on = was;
    }
  };
}

/** An empty game where player 0 has a main city, 60 houses (310 from buildings) and a barracks. */
function crowded(): { g: Game; barracks: number; small: number; large: number } {
  const g = emptyGame();
  const w = g.w;
  const area = openArea(g, 26);
  const house = BUILDINGS[BuildingType.House];
  for (let k = 0; k < 60; k++) w.addBuilding(0, BuildingType.House, area.x + 2 * (k % 12), area.y + 2 * Math.trunc(k / 12), house.hp, 1000);
  const b = BUILDINGS[BuildingType.Barracks];
  const barracks = w.addBuilding(0, BuildingType.Barracks, area.x, area.y + 14, b.hp, 1000);
  w.res[Resource.Food] = 10000;
  w.res[Resource.Wood] = 10000;
  w.res[Resource.Gold] = 10000;
  const small = Array.from(w.townSize).indexOf(TownSize.Small);
  const large = Array.from(w.townSize).indexOf(TownSize.Large);
  return { g, barracks, small, large };
}

function govern(g: Game, t: number, p: number): void {
  g.w.townOwner[t] = p;
  g.w.townState[t] = TownState.Governed;
}

function lose(g: Game, t: number): void {
  g.w.townOwner[t] = NEUTRAL;
  g.w.townState[t] = TownState.Neutral;
}

const ceilingOnScreen = (g: Game, p: number) => buildView(g, p).header[HeaderField.populationCeiling];

const rejected = (g: Game) => g.events.filter((e) => e.ev.k === "rejected").map((e) => (e.ev as { reason: number }).reason);

test("off: the ceiling is 120 as before, and the rules say so", () => {
  assert.equal(POPULATION_200.on, false, "off until war-game-ai has retuned the AIs (D-083)");
  const { g, small } = crowded();
  assert.equal(g.w.populationCap(0), MAX_POPULATION);
  govern(g, small, 0);
  assert.equal(g.w.populationCap(0), MAX_POPULATION, "towns do not lift it");
  assert.equal(ceilingOnScreen(g, 0), 120);
  const r = rules();
  assert.equal(r.maxPopulation, 120);
  assert.deepEqual(r.population, { base: 120, town: [0, 0] });
  assert.deepEqual(r.towns.map((t) => t.populationCap), [5, 10]);
});

test(
  "on: 200, plus 20 for each small town and 40 for the big one governed; a town lost lowers it again",
  populationOn(() => {
    const { g, small, large } = crowded();
    const w = g.w;
    assert.equal(w.populationCap(0), 200);
    assert.equal(ceilingOnScreen(g, 0), 200);
    govern(g, small, 0);
    assert.equal(w.populationCeiling(0), 220);
    assert.equal(w.populationCap(0), 220);
    govern(g, large, 0);
    assert.equal(w.populationCap(0), 260);
    assert.equal(ceilingOnScreen(g, 0), 260);
    // Player 1 governs nothing: its own ceiling.
    assert.equal(w.populationCeiling(1), 200);
    // A town being repaired (not yet governed) adds nothing.
    w.townState[small] = TownState.Repairing;
    assert.equal(w.populationCap(0), 240);
    lose(g, large);
    govern(g, small, 0);
    assert.equal(w.populationCap(0), 220);
    // Without houses enough, the cap is what is built: main city 10 and 60 houses, and the towns.
    const r = rules();
    assert.equal(r.maxPopulation, 200);
    assert.deepEqual(r.population, { base: 200, town: [20, 40] });
    assert.deepEqual(r.towns.map((t) => t.populationCap), [20, 40]);
  }),
);

test(
  "on: a governed town adds 20 / 40 to a cap that houses do not fill",
  populationOn(() => {
    const g = emptyGame();
    const small = Array.from(g.w.townSize).indexOf(TownSize.Small);
    const large = Array.from(g.w.townSize).indexOf(TownSize.Large);
    assert.equal(g.w.populationCap(0), 10, "the main city alone");
    govern(g, small, 0);
    govern(g, large, 0);
    assert.equal(g.w.populationCap(0), 10 + 20 + 40);
  }),
);

test(
  "on: training past the cap is refused; a town lost keeps the soldiers, and training waits for room",
  populationOn(() => {
    const { g, barracks, small } = crowded();
    const w = g.w;
    govern(g, small, 0);
    const area = openArea(g, 20);
    for (let k = 0; k < 218; k++) put(g, 0, UnitType.Spearman, area.x + (k % 20), area.y + Math.trunc(k / 20));
    assert.equal(w.population(0), 218);
    cmd(g, 0, { c: "train", building: barracks, type: UnitType.Spearman, n: 3 });
    g.step();
    assert.deepEqual(rejected(g), [Reject.PopulationCap], "218 + 3 > 220");
    cmd(g, 0, { c: "train", building: barracks, type: UnitType.Spearman, n: 2 });
    g.step();
    assert.deepEqual(rejected(g), [], "218 + 2 = 220: past the old 120");
    const trainTicks = UNITS[UnitType.Spearman].trainTicks;
    for (let t = 0; t < 2 * trainTicks + 40; t++) g.step();
    assert.equal(w.population(0), 220);
    lose(g, small);
    assert.equal(w.populationCap(0), 200);
    for (let t = 0; t < 100; t++) g.step();
    assert.equal(w.population(0), 220, "the units stay");
    cmd(g, 0, { c: "train", building: barracks, type: UnitType.Spearman, n: 1 });
    g.step();
    assert.deepEqual(rejected(g), [Reject.PopulationCap]);
  }),
);

test("perf200 and perf360: both sides full at 200 / 360, mirror images; perf stays at 114 / 120", () => {
  for (const [scenario, c, cap] of [
    ["perf", PERF, 120],
    ["perf200", PERF_200, 200],
    ["perf360", PERF_360, 360],
  ] as const) {
    const g = new NewGame({ seed: 1, scenario });
    const w = g.w;
    const u = w.units.col;
    const want = c.farmers + c.spearmen + c.ranged + c.mages;
    if (scenario !== "perf") assert.equal(want, cap, scenario);
    for (const p of [0, 1]) {
      assert.equal(w.population(p), want, `${scenario} player ${p}`);
      assert.equal(w.populationCap(p), cap);
      assert.equal(ceilingOnScreen(g, p), cap);
    }
    const kinds = (p: number) => {
      const n = new Array(UNIT_KINDS).fill(0);
      for (let s = 0; s < w.units.count; s++) if (u.owner[s] === p) n[u.type[s]]++;
      return n;
    };
    assert.deepEqual(kinds(0), kinds(1));
    assert.equal(kinds(0)[UnitType.Mage], MAGE_CAP);
    let autocast = 0;
    for (let s = 0; s < w.units.count; s++) if (u.type[s] === UnitType.Mage && (u.flags[s] & UnitFlag.Autocast) !== 0) autocast++;
    assert.equal(autocast, 2 * MAGE_CAP);
    for (let t = 0; t < 400; t++) g.step();
    assert.ok(w.lost[UnitType.Spearman] + w.lost[UnitType.Ranged] + w.lost[UNIT_KINDS + UnitType.Spearman] + w.lost[UNIT_KINDS + UnitType.Ranged] > 0, `${scenario}: the battle started`);
  }
});
