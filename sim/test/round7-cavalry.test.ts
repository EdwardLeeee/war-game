// Round 7 PR K (D-061; core/rules.ts CAVALRY): stables train cavalry (GDD appendix A), their
// automatic training as the barracks', spearmen x3 against cavalry, cavalry x2 against mages and
// shields, ranged x9/5 against cavalry; mirror-image cavalry fights play as mirror images.

import assert from "node:assert/strict";
import { test } from "node:test";
import { BUILDINGS, UNITS } from "../src/core/rules.ts";
import { damage } from "../src/core/units.ts";
import { BuildingFlag, BuildingType, Reject, Resource, UnitType } from "../src/protocol.ts";
import { SHIELD } from "../src/core/rules.ts";
import { cmd, emptyGame, put, run, slotOf } from "./helpers.ts";

const CAV = UNITS[UnitType.Cavalry];

test("cavalry: GDD appendix A, trained at a stable in 28 s for 70 food and 70 gold", () => {
  assert.deepEqual([CAV.hp, CAV.attack, CAV.trainTicks, CAV.cost.food, CAV.cost.gold], [130, 11, 28 * 20, 70, 70]);
  const g = emptyGame();
  g.w.ecoOn[0] = 0;
  const farmer = put(g, 0, UnitType.Farmer, 20, 80);
  g.w.res.set([1000, 1000, 1000, 0], 0);
  g.fog.update(g.w);
  cmd(g, 0, { c: "build", u: [farmer], type: BuildingType.Stable, x: 21, y: 72 });
  run(g, BUILDINGS[BuildingType.Stable].buildTicks + 200);
  const b = g.w.buildings.col;
  let s = -1;
  for (let k = 0; k < g.w.buildings.count; k++) if (b.type[k] === BuildingType.Stable && b.progress[k] === 1000) s = k;
  assert.ok(s >= 0, "the stable stands");
  cmd(g, 0, { c: "train", building: b.id[s], type: UnitType.Spearman, n: 1 });
  cmd(g, 0, { c: "train", building: b.id[s], type: UnitType.Cavalry, n: 1 });
  run(g, 1);
  const rejected = g.events.filter((e) => e.to === 0 && e.ev.k === "rejected").map((e) => (e.ev as { reason: number }).reason);
  assert.deepEqual(rejected, [Reject.NotAvailable], "a stable trains cavalry only");
  assert.deepEqual([g.w.res[Resource.Food], g.w.res[Resource.Gold]], [930, 1000 - BUILDINGS[BuildingType.Stable].cost.gold - 70]);
  run(g, CAV.trainTicks + 1);
  assert.equal(g.w.trained[UnitType.Cavalry], 1);
});

test("a person's stable trains on its own, as the barracks; a stable may need a barracks first (requires)", () => {
  const g = emptyGame();
  g.w.autoTrain[0] = 1;
  const id = g.w.addBuilding(0, BuildingType.Stable, 21, 72, BUILDINGS[BuildingType.Stable].hp, 1000);
  assert.ok((g.w.buildings.col.flags[g.w.building(id)] & BuildingFlag.AutoTrain) !== 0);
  // requires: refused without a finished barracks, accepted with one.
  const info = BUILDINGS[BuildingType.Stable];
  const saved = info.requires;
  info.requires = [BuildingType.Barracks];
  try {
    const h = emptyGame();
    h.w.ecoOn[0] = 0;
    const farmer = put(h, 0, UnitType.Farmer, 20, 80);
    h.w.res.set([1000, 1000, 1000, 0], 0);
    h.fog.update(h.w);
    cmd(h, 0, { c: "build", u: [farmer], type: BuildingType.Stable, x: 21, y: 72 });
    run(h, 1);
    assert.deepEqual(h.events.filter((e) => e.ev.k === "rejected").map((e) => (e.ev as { reason: number }).reason), [Reject.NotAvailable]);
    h.w.addBuilding(0, BuildingType.Barracks, 25, 80, BUILDINGS[BuildingType.Barracks].hp, 1000);
    cmd(h, 0, { c: "build", u: [farmer], type: BuildingType.Stable, x: 21, y: 72 });
    run(h, 1);
    assert.deepEqual(h.events.filter((e) => e.ev.k === "rejected"), []);
  } finally {
    info.requires = saved;
  }
});

test("multipliers: spearmen x3 on cavalry, cavalry x2 on mages and shields, ranged x9/5 on cavalry", () => {
  assert.equal(damage(UNITS[UnitType.Spearman].attack, UnitType.Spearman, UnitType.Cavalry), 18);
  assert.equal(damage(CAV.attack, UnitType.Cavalry, UnitType.Mage), 22);
  assert.equal(damage(CAV.attack, UnitType.Cavalry, SHIELD), 22);
  assert.equal(damage(CAV.attack, UnitType.Cavalry, UnitType.Ranged), 11);
  assert.equal(damage(UNITS[UnitType.Ranged].attack, UnitType.Ranged, UnitType.Cavalry), 9);
});

test("mirror images: cavalry charging ranged and spearmen play as mirror images, tick by tick", () => {
  const g = emptyGame();
  const pairs: [number, number][] = [];
  const add = (owner: number, type: UnitType, x: number, y: number) => {
    const a = put(g, owner, type, x, y);
    const b = put(g, 1 - owner, type, y, x);
    pairs.push([a, b]);
    return [a, b];
  };
  // Player 0's cavalry near its main city; the other player's ranged and spearmen 8 cells off.
  const cav = [0, 1, 2, 3].map((k) => add(0, UnitType.Cavalry, 22 + k, 80));
  for (let k = 0; k < 4; k++) add(1, UnitType.Ranged, 22 + k, 72);
  for (let k = 0; k < 2; k++) add(1, UnitType.Spearman, 23 + k, 71);
  g.fog.update(g.w);
  cmd(g, 0, { c: "move", u: cav.map((p) => p[0]), x: 23, y: 71 });
  cmd(g, 1, { c: "move", u: cav.map((p) => p[1]), x: 71, y: 23 });
  const u = g.w.units.col;
  let fought = false;
  for (let t = 0; t < 400; t++) {
    g.step();
    for (const [a, b] of pairs) {
      const sa = slotOf(g, a);
      const sb = slotOf(g, b);
      assert.equal(sa < 0, sb < 0, `tick ${g.tick}: both alive or both gone`);
      if (sa < 0) continue;
      assert.equal(u.hp[sa], u.hp[sb], `tick ${g.tick}: hp`);
      assert.equal(u.x[sb], u.y[sa], `tick ${g.tick}`);
      assert.equal(u.y[sb], u.x[sa], `tick ${g.tick}`);
      if (u.hp[sa] < UNITS[u.type[sa]].hp) fought = true;
    }
  }
  assert.ok(fought, "they fought");
});
