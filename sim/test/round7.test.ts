// Round 7 (D-061): the protocol (PR P). With their switches off, arrow towers, stables and
// hiding soldiers are refused; Rules tells the screen and the AI what is on; and a building
// with someone inside shows only that to the players who see it.

import assert from "node:assert/strict";
import { test } from "node:test";
import { CAVALRY, GARRISON, OUTPOST, PLUNDER_RECOVERY, rules, TOWERS, TOWN_ONCE } from "../src/core/rules.ts";
import { BuildingField, BuildingFlag, BUILDING_STRIDE, BuildingType, Reject, TOWN_STRIDE, TownField, UnitType } from "../src/protocol.ts";
import { buildView } from "../src/view/view.ts";
import { cmd, emptyGame, put, slotOf } from "./helpers.ts";

function rejected(g: ReturnType<typeof emptyGame>, p: number): number[] {
  return g.events.filter((e) => e.to === p && e.ev.k === "rejected").map((e) => (e.ev as { reason: number }).reason);
}

/** Runs `body` with every round 7 switch off. */
function allOff(body: () => void): () => void {
  return () => {
    const switches = [TOWN_ONCE, PLUNDER_RECOVERY, TOWERS, GARRISON, CAVALRY];
    const saved = switches.map((x) => x.on);
    for (const x of switches) x.on = false;
    try {
      body();
    } finally {
      switches.forEach((x, k) => (x.on = saved[k]));
    }
  };
}

test("round 7 switches off: towers, stables, garrison and leave are refused, and Rules says so", allOff(() => {
  const r = rules();
  assert.deepEqual(r.features, { plunderOnce: false, towers: false, garrison: false, cavalry: false, outpost: OUTPOST.on });
  assert.equal(r.plunderRecovery.startPermille, 1000, "no recovery rule");
  assert.equal(r.buildings[BuildingType.MainCity].holds, 6);
  assert.equal(r.buildings[BuildingType.ArrowTower].holds, 3);
  assert.deepEqual(r.garrisonTypes, [UnitType.Ranged, UnitType.Mage]);
  assert.equal(r.arrows.mainCity.extraMax, 10);
  assert.equal(r.towns.length, 2);

  const g = emptyGame();
  const city = g.w.buildings.col.id[g.w.mainCity(0)];
  const ranged = put(g, 0, UnitType.Ranged, 20, 72);
  g.fog.update(g.w);
  cmd(g, 0, { c: "build", u: [], type: BuildingType.ArrowTower, x: 20, y: 74 });
  cmd(g, 0, { c: "build", u: [], type: BuildingType.Stable, x: 20, y: 74 });
  cmd(g, 0, { c: "garrison", u: [ranged], building: city });
  cmd(g, 0, { c: "leave", building: city });
  g.step();
  assert.deepEqual(rejected(g, 0), [Reject.NotAvailable, Reject.NotAvailable, Reject.NotAvailable, Reject.NotAvailable]);
  assert.ok(slotOf(g, ranged) >= 0);
}));

test("Rules.features follows the switches", () => {
  const f = rules().features;
  assert.deepEqual(f, { plunderOnce: TOWN_ONCE.on, towers: TOWERS.on, garrison: GARRISON.on, cavalry: CAVALRY.on, outpost: OUTPOST.on });
});

test("someone hiding: everyone who sees the building gets Occupied, only the owner how many", () => {
  const g = emptyGame();
  const b = g.w.buildings.col;
  const city1 = g.w.mainCity(1);
  b.garrisoned[city1] = 3;
  // A spearman of player 0 beside player 1's main city sees it.
  put(g, 0, UnitType.Spearman, b.cellX[city1] - 2, b.cellY[city1] + 1);
  g.fog.update(g.w);
  const row = (p: number | null) => {
    const v = buildView(g, p);
    for (let k = 0; k < v.buildings.length; k += BUILDING_STRIDE) {
      if (v.buildings[k + BuildingField.id] === b.id[city1]) return v.buildings.subarray(k, k + BUILDING_STRIDE);
    }
    throw new Error("not in view");
  };
  for (const p of [0, 1, null]) assert.equal(row(p)[BuildingField.flags] & BuildingFlag.Occupied, BuildingFlag.Occupied, `player ${p}`);
  assert.equal(row(1)[BuildingField.garrisoned], 3, "the owner knows how many");
  assert.equal(row(0)[BuildingField.garrisoned], 0, "the enemy does not");
  assert.equal(row(0)[BuildingField.soldiers], 0);
  b.garrisoned[city1] = 0;
  assert.equal(row(0)[BuildingField.flags] & BuildingFlag.Occupied, 0, "nobody inside");
});

test("town rows are TOWN_STRIDE long and pay in full while the town rules are off", () => {
  const g = emptyGame();
  const v = buildView(g, null);
  assert.equal(TOWN_STRIDE, 14, "11 from round 7, 14 with the town's place and size (D-074)");
  assert.equal(v.towns.length, g.w.townSize.length * TOWN_STRIDE);
  for (let k = 0; k < v.towns.length; k += TOWN_STRIDE) assert.equal(v.towns[k + TownField.incomePermille], 1000);
});
