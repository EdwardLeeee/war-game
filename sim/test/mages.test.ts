// Mages (PR-4): crystal bolt, crystal cannon (calibration, warning, crystal, cooldown,
// range, no friendly fire), autocast, shield (absorb, ranged x3, regeneration), bounty.

import assert from "node:assert/strict";
import test from "node:test";
import type { Game } from "../src/core/game.ts";
import { CANNON, DODGE, MAGE_BOUNTY, SHIELD_REGEN, UNITS } from "../src/core/rules.ts";
import {
  Action,
  BuildingType,
  CELL,
  Order,
  Reject,
  Resource,
  UnitFlag,
  UnitType,
  WARNING_STRIDE,
  WarningField,
} from "../src/protocol.ts";
import { buildView } from "../src/view/view.ts";
import { cmd, emptyGame, openArea, put, run, slotOf, switchedOff } from "./helpers.ts";

function step(g: Game, p = 0): number[] {
  g.step();
  return g.events.filter((e) => e.to === p && e.ev.k === "rejected").map((e) => (e.ev as { reason: number }).reason);
}

const centre = (c: number) => c * CELL + 512;

function arena() {
  const g = emptyGame();
  g.w.ecoOn[0] = 0;
  g.w.ecoOn[1] = 0;
  const a = openArea(g, 20);
  g.w.res[Resource.Crystal] = 20;
  return { g, a };
}

test("cast: calibrates 1.5 s with a warning both sides see, then hits enemies in the radius only", switchedOff(DODGE, () => {
  const { g, a } = arena();
  const mage = put(g, 0, UnitType.Mage, a.x + 2, a.y + 10);
  const friend = put(g, 0, UnitType.Spearman, a.x + 9, a.y + 11);
  const foes = [put(g, 1, UnitType.Spearman, a.x + 9, a.y + 10), put(g, 1, UnitType.Spearman, a.x + 10, a.y + 10)];
  const far = put(g, 1, UnitType.Spearman, a.x + 13, a.y + 10);
  // Only the cannon may deal damage here: everyone else holds and never gets to swing.
  for (const f of [...foes, far, friend]) {
    g.w.units.col.stance[slotOf(g, f)] = 1;
    g.w.units.col.cooldown[slotOf(g, f)] = 100000;
  }
  g.w.units.col.stance[slotOf(g, mage)] = 1;
  g.w.units.col.cooldown[slotOf(g, mage)] = 100000;
  g.fog.update(g.w);
  const fx = centre(a.x + 9) + 512;
  const fy = centre(a.y + 10);
  cmd(g, 0, { c: "cast", u: mage, fx, fy });
  assert.deepEqual(step(g), []);
  const u = g.w.units.col;
  assert.equal(u.order[slotOf(g, mage)], Order.Cast);
  assert.equal(u.action[slotOf(g, mage)], Action.Calibrate);
  for (const p of [0, 1]) {
    const v = buildView(g, p);
    assert.equal(v.warnings.length, WARNING_STRIDE, `player ${p} sees the warning`);
    assert.equal(v.warnings[WarningField.id], mage);
    assert.equal(v.warnings[WarningField.x], fx);
    assert.equal(v.warnings[WarningField.radius], CANNON.radius);
  }
  const x0 = u.x[slotOf(g, mage)];
  run(g, CANNON.calibrateTicks - 2);
  assert.equal(u.x[slotOf(g, mage)], x0, "stands still while calibrating");
  assert.equal(g.w.res[Resource.Crystal], 20, "crystal is spent when it fires");
  run(g, 2);
  for (const f of foes) assert.equal(u.hp[slotOf(g, f)], UNITS[UnitType.Spearman].hp - CANNON.damage, "hit");
  assert.equal(u.hp[slotOf(g, far)], UNITS[UnitType.Spearman].hp, "outside the radius");
  assert.equal(u.hp[slotOf(g, friend)], UNITS[UnitType.Spearman].hp, "never own units");
  assert.equal(g.w.res[Resource.Crystal], 20 - CANNON.crystal);
  assert.equal(u.castCooldown[slotOf(g, mage)], CANNON.cooldownTicks - 1);
  assert.equal(u.order[slotOf(g, mage)], Order.None);
  assert.equal(buildView(g, 0).warnings.length, 0);
  cmd(g, 0, { c: "cast", u: mage, fx, fy });
  assert.deepEqual(step(g), [Reject.Cooldown]);
}));

test("a spearman at full health stands two crystal cannon shots (round 3, D-026); the third kills it", () => {
  const { g, a } = arena();
  const mages = [0, 1, 2].map((k) => put(g, 0, UnitType.Mage, a.x + 2, a.y + 9 + k));
  const foe = put(g, 1, UnitType.Spearman, a.x + 9, a.y + 10);
  const u = g.w.units.col;
  for (const s of [...mages, foe]) {
    u.stance[slotOf(g, s)] = 1;
    u.cooldown[slotOf(g, s)] = 100000;
  }
  g.fog.update(g.w);
  const fx = centre(a.x + 9);
  const fy = centre(a.y + 10);
  for (const m of mages.slice(0, 2)) cmd(g, 0, { c: "cast", u: m, fx, fy });
  run(g, CANNON.calibrateTicks + 1);
  assert.equal(u.hp[slotOf(g, foe)], UNITS[UnitType.Spearman].hp - 2 * CANNON.damage, "two shots: still standing");
  cmd(g, 0, { c: "cast", u: mages[2], fx, fy });
  run(g, CANNON.calibrateTicks + 1);
  assert.equal(slotOf(g, foe), -1, "the third shot kills it");
});

test("cast rejects: not a mage, out of range, no crystal; another order cancels without spending", () => {
  const { g, a } = arena();
  const mage = put(g, 0, UnitType.Mage, a.x + 2, a.y + 10);
  const spear = put(g, 0, UnitType.Spearman, a.x + 2, a.y + 12);
  cmd(g, 0, { c: "cast", u: spear, fx: centre(a.x + 5), fy: centre(a.y + 10) });
  assert.deepEqual(step(g), [Reject.NotAvailable]);
  cmd(g, 0, { c: "cast", u: mage, fx: centre(a.x + 11), fy: centre(a.y + 10) });
  assert.deepEqual(step(g), [Reject.OutOfRange], "9 cells away");
  cmd(g, 0, { c: "cast", u: mage, fx: centre(a.x + 5), fy: centre(a.y + 10) });
  assert.deepEqual(step(g), []);
  run(g, 10);
  cmd(g, 0, { c: "stop", u: [mage] });
  assert.deepEqual(step(g), []);
  run(g, 40);
  assert.equal(g.w.res[Resource.Crystal], 20, "cancelled: nothing spent");
  assert.equal(g.w.units.col.castProgress[slotOf(g, mage)], 0);
  g.w.res[Resource.Crystal] = 4;
  cmd(g, 0, { c: "cast", u: mage, fx: centre(a.x + 5), fy: centre(a.y + 10) });
  assert.deepEqual(step(g), [Reject.NoCrystal]);
});

test("autocast fires at a cluster of 3 enemies, not at 2", () => {
  for (const count of [2, 3]) {
    const { g, a } = arena();
    const mage = put(g, 0, UnitType.Mage, a.x + 2, a.y + 10);
    g.w.units.col.stance[slotOf(g, mage)] = 1;
    for (let k = 0; k < count; k++) {
      const f = put(g, 1, UnitType.Farmer, a.x + 9, a.y + 9 + k);
      g.w.units.col.stance[slotOf(g, f)] = 1;
    }
    cmd(g, 0, { c: "autocast", u: [mage], on: true });
    assert.deepEqual(step(g), []);
    assert.ok((g.w.units.col.flags[slotOf(g, mage)] & UnitFlag.Autocast) !== 0);
    g.fog.update(g.w);
    let cast = false;
    for (let t = 0; t < 20 && !cast; t++) {
      g.step();
      cast = g.w.units.col.order[slotOf(g, mage)] === Order.Cast;
    }
    assert.equal(cast, count >= CANNON.autocastMinTargets, `${count} enemies`);
  }
});

test("shield: takes hits first (ranged x3, early balance), hp only after it breaks; regenerates out of combat", () => {
  const { g, a } = arena();
  const mage = put(g, 0, UnitType.Mage, a.x + 2, a.y + 10);
  const shooter = put(g, 1, UnitType.Ranged, a.x + 6, a.y + 10);
  const u = g.w.units.col;
  u.stance[slotOf(g, mage)] = 1;
  u.flags[slotOf(g, mage)] &= ~UnitFlag.Autocast;
  g.fog.update(g.w);
  assert.equal(u.shield[slotOf(g, mage)], UNITS[UnitType.Mage].shield);
  cmd(g, 1, { c: "attack", u: [shooter], target: mage });
  // Mage bolts back (range 5): keep the mage from killing the shooter first by stopping it.
  u.hp[slotOf(g, shooter)] = 10000;
  for (let t = 0; t < 30 && u.shield[slotOf(g, mage)] === UNITS[UnitType.Mage].shield; t++) g.step();
  assert.equal(u.shield[slotOf(g, mage)], UNITS[UnitType.Mage].shield - 15, "5 x 3 = 15 on the shield");
  assert.equal(u.hp[slotOf(g, mage)], UNITS[UnitType.Mage].hp);
  for (let t = 0; t < 2000 && u.shield[slotOf(g, mage)] > 0; t++) g.step();
  assert.equal(u.hp[slotOf(g, mage)], UNITS[UnitType.Mage].hp, "the breaking hit is absorbed whole");
  for (let t = 0; t < 100 && u.hp[slotOf(g, mage)] === UNITS[UnitType.Mage].hp; t++) g.step();
  assert.equal(u.hp[slotOf(g, mage)], UNITS[UnitType.Mage].hp - 5, "then 5 on the body");
  // Out of combat: take the shooter away; 5 s later the shield comes back at 6 per second.
  u.hp[slotOf(g, shooter)] = 0;
  run(g, 1);
  const s0 = u.shield[slotOf(g, mage)];
  run(g, SHIELD_REGEN.afterTicks);
  run(g, 40);
  assert.ok(u.shield[slotOf(g, mage)] - s0 >= 11 && u.shield[slotOf(g, mage)] - s0 <= 13, `regen ${u.shield[slotOf(g, mage)] - s0}`);
});

test("a mage's death pays the killer 15 crystal (nothing when the militia kill it)", () => {
  for (const killerOwner of [1, 2]) {
    const { g, a } = arena();
    const mage = put(g, 0, UnitType.Mage, a.x + 2, a.y + 10);
    const killer = put(g, killerOwner, UnitType.Spearman, a.x + 3, a.y + 10);
    g.w.units.col.shield[slotOf(g, mage)] = 0;
    g.w.units.col.hp[slotOf(g, mage)] = 1;
    g.fog.update(g.w);
    const crystal1 = g.w.res[4 + Resource.Crystal];
    let ev: { killer: number; crystal: number } | null = null;
    for (let t = 0; t < 100 && ev === null; t++) {
      g.step();
      for (const e of g.events) if (e.ev.k === "mage_killed" && e.to === 0) ev = e.ev;
    }
    assert.ok(ev !== null);
    assert.equal(ev!.killer, killerOwner);
    assert.equal(ev!.crystal, killerOwner === 1 ? MAGE_BOUNTY : 0);
    assert.equal(g.w.res[4 + Resource.Crystal] - crystal1, killerOwner === 1 ? MAGE_BOUNTY : 0);
    assert.equal(g.w.lost[UnitType.Mage], 1);
    void killer;
  }
});

test("a trained mage starts with a full shield; the mage cap counts the queue", () => {
  const g = emptyGame();
  g.w.ecoOn[0] = 0;
  const m = g.w.mainCity(0);
  const b = g.w.buildings.col;
  const hall = g.w.addBuilding(0, BuildingType.MageHall, b.cellX[m] + 8, b.cellY[m], 500, 1000);
  g.w.res.set([1000, 1000, 2000, 1000], 0);
  for (let k = 0; k < 4; k++) put(g, 0, UnitType.Mage, 40, 60 + k);
  cmd(g, 0, { c: "train", building: hall, type: UnitType.Mage, n: 3 });
  assert.deepEqual(step(g), [Reject.MageCap], "4 + 3 > 6");
  cmd(g, 0, { c: "train", building: hall, type: UnitType.Mage, n: 2 });
  assert.deepEqual(step(g), []);
  let id = -1;
  for (let t = 0; t < UNITS[UnitType.Mage].trainTicks + 5 && id < 0; t++) {
    g.step();
    for (const e of g.events) if (e.ev.k === "unit_trained") id = e.ev.id;
  }
  assert.equal(g.w.units.col.shield[slotOf(g, id)], UNITS[UnitType.Mage].shield);
});

test("a trained mage has autocast on from the start and fires at a cluster; switched off, it does not", () => {
  for (const off of [false, true]) {
    const g = emptyGame();
    const w = g.w;
    w.ecoOn[0] = 0;
    const m = w.mainCity(0);
    const b = w.buildings.col;
    const hall = w.addBuilding(0, BuildingType.MageHall, b.cellX[m] + 8, b.cellY[m], 500, 1000);
    w.res.set([1000, 1000, 2000, 1000], 0);
    cmd(g, 0, { c: "train", building: hall, type: UnitType.Mage, n: 1 });
    assert.deepEqual(step(g), []);
    let id = -1;
    for (let t = 0; t < UNITS[UnitType.Mage].trainTicks + 5 && id < 0; t++) {
      g.step();
      for (const e of g.events) if (e.ev.k === "unit_trained") id = e.ev.id;
    }
    assert.ok(id >= 0, "the mage is trained");
    const u = w.units.col;
    assert.ok((u.flags[slotOf(g, id)] & UnitFlag.Autocast) !== 0, "autocast is on at birth");
    if (off) {
      cmd(g, 0, { c: "autocast", u: [id], on: false });
      assert.deepEqual(step(g), []);
      assert.equal(u.flags[slotOf(g, id)] & UnitFlag.Autocast, 0);
    }
    // Three enemy farmers (they do not fight back) 6 cells from the mage, close together.
    const mx = u.x[slotOf(g, id)] >> 10;
    const my = u.y[slotOf(g, id)] >> 10;
    u.stance[slotOf(g, id)] = 1;
    for (let k = 0; k < 3; k++) {
      const f = put(g, 1, UnitType.Farmer, mx + 6, my - 1 + k);
      u.stance[slotOf(g, f)] = 1;
    }
    g.fog.update(w);
    let cast = false;
    for (let t = 0; t < 20 && !cast; t++) {
      g.step();
      cast = u.order[slotOf(g, id)] === Order.Cast;
    }
    assert.equal(cast, !off, off ? "switched off: it does not cast on its own" : "it casts on its own");
  }
});
