// Round 7 PR D (D-061; core/rules.ts TOWERS, GARRISON): villagers build arrow towers near their
// main city or a town they hold, and the towers shoot by themselves; ranged units and mages hide
// in main cities and arrow towers, fight from inside, cannot be hit there, and come out when told
// or when the building falls.

import assert from "node:assert/strict";
import { test } from "node:test";
import type { Game } from "../src/core/game.ts";
import { ARROW_TOWER, BUILDINGS, CANNON, GARRISON, UNITS } from "../src/core/rules.ts";
import { Action, BuildingField, BuildingFlag, BUILDING_STRIDE, BuildingType, Order, PlaceBit, Reject, Resource, UnitFlag, UnitType } from "../src/protocol.ts";
import { buildView } from "../src/view/view.ts";
import { cmd, emptyGame, put, run, slotOf } from "./helpers.ts";

// Player 0's main city covers (14..17, 76..79); player 1's is its mirror image at (76, 14).
const TX = 20;
const TY = 77;

function rejections(g: Game, p: number): number[] {
  return g.events.filter((e) => e.to === p && e.ev.k === "rejected").map((e) => (e.ev as { reason: number }).reason);
}

/** A finished arrow tower of player p at (x, y), or its mirror image for player 1. */
function tower(g: Game, p: number, x = TX, y = TY): number {
  const info = BUILDINGS[BuildingType.ArrowTower];
  return p === 0 ? g.w.addBuilding(0, BuildingType.ArrowTower, x, y, info.hp, 1000) : g.w.addBuilding(1, BuildingType.ArrowTower, y, x, info.hp, 1000);
}

function buildingRow(g: Game, p: number | null, id: number): Int32Array {
  const v = buildView(g, p);
  for (let k = 0; k < v.buildings.length; k += BUILDING_STRIDE) if (v.buildings[k + BuildingField.id] === id) return v.buildings.subarray(k, k + BUILDING_STRIDE);
  throw new Error("not in view");
}

test("villagers build arrow towers near their main city only; finished, a tower shoots", () => {
  const g = emptyGame();
  g.w.ecoOn[0] = 0;
  const farmer = put(g, 0, UnitType.Farmer, 19, 80);
  g.w.res.set([0, 1000, 1000, 0], 0);
  g.fog.update(g.w);
  const v = buildView(g, 0);
  const n = g.w.size;
  assert.ok((v.placement[TY * n + TX] & PlaceBit.TowerLand) !== 0, "tower land 3 cells from the city");
  assert.equal(v.placement[TY * n + 30] & PlaceBit.TowerLand, 0, "not 13 cells off");
  cmd(g, 0, { c: "build", u: [farmer], type: BuildingType.ArrowTower, x: 30, y: TY });
  cmd(g, 0, { c: "build", u: [farmer], type: BuildingType.ArrowTower, x: TX, y: TY });
  run(g, 1);
  assert.deepEqual(rejections(g, 0).slice(0, 1), [Reject.BadPlacement]);
  run(g, BUILDINGS[BuildingType.ArrowTower].buildTicks + 100);
  const b = g.w.buildings.col;
  let s = -1;
  for (let k = 0; k < g.w.buildings.count; k++) if (b.type[k] === BuildingType.ArrowTower) s = k;
  assert.ok(s >= 0 && b.progress[s] === 1000, "built");
  assert.deepEqual([g.w.res[Resource.Wood], g.w.res[Resource.Gold]], [900, 950]);
  // An enemy spearman 5 cells off the tower: an arrow of 5 every 2 s, and a shot event.
  const foe = put(g, 1, UnitType.Spearman, TX + 7, TY);
  g.w.units.col.stance[slotOf(g, foe)] = 1;
  g.fog.update(g.w);
  let shots = 0;
  for (let k = 0; k < 80; k++) {
    g.step();
    shots += g.events.filter((e) => e.to === 0 && e.ev.k === "shot" && (e.ev as { building: number }).building === b.id[s]).length;
  }
  assert.equal(shots, 2);
  assert.equal(g.w.units.col.hp[slotOf(g, foe)], UNITS[UnitType.Spearman].hp - 2 * ARROW_TOWER.damage);
});

test("ranged units and mages hide in a tower (3) or main city (6); spearmen cannot; full is NoRoom", () => {
  const g = emptyGame();
  const t = tower(g, 0);
  const city = g.w.buildings.col.id[g.w.mainCity(0)];
  const ranged = [0, 1, 2, 3].map((k) => put(g, 0, UnitType.Ranged, TX + 3, TY - 1 + k));
  const spear = put(g, 0, UnitType.Spearman, TX + 4, TY);
  g.fog.update(g.w);
  cmd(g, 0, { c: "garrison", u: [spear], building: t });
  cmd(g, 0, { c: "garrison", u: ranged, building: t });
  cmd(g, 0, { c: "garrison", u: [ranged[3]], building: t });
  run(g, 1);
  assert.deepEqual(rejections(g, 0), [Reject.NotAvailable, Reject.NoRoom]);
  run(g, 60);
  const u = g.w.units.col;
  const b = g.w.buildings.col;
  const ts = g.w.building(t);
  assert.deepEqual(ranged.map((id) => u.action[slotOf(g, id)] === Action.Garrisoned), [true, true, true, false]);
  assert.equal(b.soldiers[ts], 3);
  assert.equal(u.order[slotOf(g, ranged[0])], Order.Garrison);
  assert.equal(u.orderTarget[slotOf(g, ranged[0])], t);
  cmd(g, 0, { c: "garrison", u: [ranged[3]], building: city });
  run(g, 200);
  assert.equal(u.action[slotOf(g, ranged[3])], Action.Garrisoned, "into the main city");
  assert.equal(b.soldiers[g.w.mainCity(0)], 1);
  // The owner sees how many; the enemy, beside it, only that someone is in.
  put(g, 1, UnitType.Spearman, TX + 3, TY + 4);
  g.fog.update(g.w);
  assert.equal(buildingRow(g, 0, t)[BuildingField.soldiers], 3);
  for (const p of [0, 1]) assert.ok((buildingRow(g, p, t)[BuildingField.flags] & BuildingFlag.Occupied) !== 0, `player ${p}`);
  assert.equal(buildingRow(g, 1, t)[BuildingField.soldiers], 0);
});

test("from inside: hidden ranged shoot from the tower's edge and cannot be targeted or hurt; leave, move and the tower falling let them out", () => {
  const g = emptyGame();
  const t = tower(g, 0);
  const ranged = [0, 1].map((k) => put(g, 0, UnitType.Ranged, TX + 2, TY + k));
  g.fog.update(g.w);
  cmd(g, 0, { c: "garrison", u: ranged, building: t });
  run(g, 30);
  const u = g.w.units.col;
  assert.ok(ranged.every((id) => u.action[slotOf(g, id)] === Action.Garrisoned));
  // An enemy spearman standing 5 cells from the tower's edge (8 from where the ranged went in? no matter).
  const foe = put(g, 1, UnitType.Spearman, TX + 6, TY);
  u.stance[slotOf(g, foe)] = 1;
  g.fog.update(g.w);
  cmd(g, 1, { c: "attack", u: [foe], target: ranged[0] });
  run(g, 1);
  assert.deepEqual(rejections(g, 1), [Reject.InvalidTarget], "a hidden soldier is no target");
  run(g, 60);
  assert.ok(u.hp[slotOf(g, foe)] < UNITS[UnitType.Spearman].hp, "the hidden ranged hit it");
  // stop keeps them in; leave lets one out; move takes the other out.
  cmd(g, 0, { c: "stop", u: ranged });
  run(g, 1);
  assert.ok(ranged.every((id) => u.action[slotOf(g, id)] === Action.Garrisoned), "stop: still inside");
  cmd(g, 0, { c: "leave", building: t, u: [ranged[0]] });
  run(g, 1);
  assert.equal(u.action[slotOf(g, ranged[0])], Action.Idle);
  assert.equal(u.order[slotOf(g, ranged[0])], Order.None);
  assert.equal(g.w.buildings.col.soldiers[g.w.building(t)], 1);
  cmd(g, 0, { c: "move", u: [ranged[1]], x: TX + 3, y: TY + 6 });
  run(g, 1);
  assert.equal(u.order[slotOf(g, ranged[1])], Order.Move);
  assert.equal(g.w.buildings.col.soldiers[g.w.building(t)], 0);
  // Back in, then the tower falls: out, alive.
  cmd(g, 0, { c: "garrison", u: ranged, building: t });
  run(g, 120);
  assert.ok(ranged.every((id) => u.action[slotOf(g, id)] === Action.Garrisoned));
  g.w.buildings.col.hp[g.w.building(t)] = 0;
  run(g, 1);
  assert.ok(g.w.building(t) < 0, "the tower is gone");
  assert.ok(ranged.every((id) => slotOf(g, id) >= 0 && u.action[slotOf(g, id)] !== Action.Garrisoned), "out and alive");
});

test("a mage hiding in the main city fires the cannon on autocast from the city's edge and stays inside", () => {
  const g = emptyGame();
  const city = g.w.buildings.col.id[g.w.mainCity(0)];
  const mage = put(g, 0, UnitType.Mage, 19, 78);
  g.w.res[Resource.Crystal] = 100;
  g.fog.update(g.w);
  const u = g.w.units.col;
  // As a trained mage: autocast on.
  u.flags[slotOf(g, mage)] |= UnitFlag.Autocast;
  cmd(g, 0, { c: "garrison", u: [mage], building: city });
  run(g, 20);
  assert.equal(u.action[slotOf(g, mage)], Action.Garrisoned);
  // Three enemy spearmen 7 cells from the city's edge.
  const foes = [0, 1, 2].map((k) => put(g, 1, UnitType.Spearman, 25, 77 + k));
  for (const id of foes) u.stance[slotOf(g, id)] = 1;
  g.fog.update(g.w);
  let fired = false;
  for (let k = 0; k < 80 && !fired; k++) {
    g.step();
    fired = g.w.cannonShots[0] > 0;
  }
  assert.ok(fired, "the cannon fired");
  // From inside it hits for half (ceo 2026-10-07, B: GARRISON) and cools down twice as long.
  const half = Math.trunc((CANNON.damage * GARRISON.cannonPermille) / 1000);
  assert.equal(half, 22);
  assert.deepEqual(foes.map((id) => u.hp[slotOf(g, id)]), foes.map(() => UNITS[UnitType.Spearman].hp - half));
  assert.equal(u.castCooldown[slotOf(g, mage)], CANNON.cooldownTicks * GARRISON.cannonCooldown);
  run(g, 2);
  assert.equal(u.action[slotOf(g, mage)], Action.Garrisoned, "still inside");
  assert.equal(u.order[slotOf(g, mage)], Order.Garrison);
  assert.equal(u.orderTarget[slotOf(g, mage)], city);
});

test("mirror images: two towers with hidden ranged and their attackers play as mirror images, tick by tick", () => {
  const g = emptyGame();
  const towers = [tower(g, 0), tower(g, 1)];
  const pairs: [number, number][] = [];
  const add = (owner: number, type: UnitType, x: number, y: number) => {
    const a = put(g, owner, type, x, y);
    const b = put(g, 1 - owner, type, y, x);
    pairs.push([a, b]);
    return [a, b];
  };
  const hidden = [add(0, UnitType.Ranged, TX + 2, TY), add(0, UnitType.Mage, TX + 2, TY + 1)];
  // Attackers of each tower, of the other player.
  for (let k = 0; k < 4; k++) add(1, UnitType.Spearman, TX + 6, TY - 1 + k);
  g.fog.update(g.w);
  cmd(g, 0, { c: "garrison", u: hidden.map((p) => p[0]), building: towers[0] });
  cmd(g, 1, { c: "garrison", u: hidden.map((p) => p[1]), building: towers[1] });
  g.w.res[Resource.Crystal] = 100;
  g.w.res[4 + Resource.Crystal] = 100;
  run(g, 30);
  const att0 = pairs.slice(2).map((p) => p[0]);
  const att1 = pairs.slice(2).map((p) => p[1]);
  cmd(g, 1, { c: "attack", u: att0, target: towers[0] });
  cmd(g, 0, { c: "attack", u: att1, target: towers[1] });
  const u = g.w.units.col;
  g.step();
  assert.deepEqual([rejections(g, 0), rejections(g, 1)], [[], []], "both attacks given");
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
    }
    const [s0, s1] = towers.map((id) => g.w.building(id));
    assert.equal(s0 < 0, s1 < 0);
    if (s0 >= 0) assert.equal(g.w.buildings.col.hp[s0], g.w.buildings.col.hp[s1], `tick ${g.tick}: tower hp`);
  }
  assert.ok(att0.some((id) => slotOf(g, id) < 0 || u.hp[slotOf(g, id)] < UNITS[UnitType.Spearman].hp), "the defenders hit");
});
