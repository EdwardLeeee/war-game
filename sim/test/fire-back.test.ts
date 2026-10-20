// Shooting back on the way (D-095; core/rules.ts FIRE_BACK): a soldier on a move that an enemy
// unit hits from beyond AGGRO_RANGE goes for it, its squad with it; a retreat does not; arrows of
// buildings, soldiers hiding in one, and shooters the player does not see do not count; it gives
// up FIRE_BACK.leash from where it turned and goes on with its move.

import assert from "node:assert/strict";
import { test } from "node:test";
import { AGGRO_RANGE, BUILDINGS, CANNON, FIRE_BACK, RETARGET_EVERY, REVEAL_CAST } from "../src/core/rules.ts";
import { BuildingType, CELL_SHIFT, Order, Resource, Stance, UnitFlag, UnitType } from "../src/protocol.ts";
import { cmd, emptyGame, openArea, put, run, slotOf, switchedOff } from "./helpers.ts";

type G = ReturnType<typeof emptyGame>;

/**
 * Player 0's 15 (3 mages, 4 ranged, 8 spearmen, mages in the north row) walk ("move" or
 * "retreat") 24 cells east past what `foe` puts `off` cells north of the mages' row, then (or
 * after 40 s) it stops. Returns the hits ours took on the way, how many of those came from units
 * standing beyond AGGRO_RANGE, the unit ticks ours had one of `shooters` as their target, and the
 * hp each side lost.
 */
function passBy(order: "move" | "retreat", off: number, foe: (g: G, x: number, y: number) => number[], ours: UnitType[] = []) {
  const g = emptyGame();
  const a = openArea(g, 30);
  g.w.ecoOn[0] = 0;
  g.w.ecoOn[1] = 0;
  g.w.res[4 + Resource.Crystal] = 200;
  const y0 = a.y + 15;
  const group: number[] = [];
  if (ours.length > 0) {
    ours.forEach((t, k) => group.push(put(g, 0, t, a.x + 2 + (k % 4), y0 + Math.trunc(k / 4))));
  } else {
    for (let k = 0; k < 3; k++) group.push(put(g, 0, UnitType.Mage, a.x + 2 + k, y0));
    for (let k = 0; k < 4; k++) group.push(put(g, 0, UnitType.Ranged, a.x + 2 + k, y0 + 1));
    for (let k = 0; k < 8; k++) group.push(put(g, 0, UnitType.Spearman, a.x + 2 + (k % 4), y0 + 2 + Math.trunc(k / 4)));
  }
  const shooters = foe(g, a.x + 13, y0 - off);
  g.fog.update(g.w);
  cmd(g, 0, { c: order, u: group, x: a.x + 26, y: y0 + 1 });
  const u = g.w.units.col;
  const hp = (ids: number[]) => ids.reduce((n, id) => n + (slotOf(g, id) >= 0 ? u.hp[slotOf(g, id)] + u.shield[slotOf(g, id)] : 0), 0);
  const ours0 = hp(group);
  const foes = shooters.filter((id) => slotOf(g, id) >= 0 && g.w.unit(id) >= 0);
  const foes0 = hp(foes);
  let hits = 0;
  let targeting = 0;
  const last = new Map(group.map((id) => [id, u.hp[slotOf(g, id)] + u.shield[slotOf(g, id)]]));
  for (let t = 0; t < 40 * 20; t++) {
    g.step();
    for (const id of group) {
      const s = slotOf(g, id);
      if (s < 0) continue;
      const now = u.hp[s] + u.shield[s];
      if (now < last.get(id)! && u.order[s] !== Order.None) hits++;
      last.set(id, now);
      if (shooters.includes(u.target[s])) targeting++;
    }
    if (group.every((id) => slotOf(g, id) < 0 || u.order[slotOf(g, id)] === Order.None)) break;
  }
  return { g, group, hits, targeting, ourHpLost: ours0 - hp(group), foeHpLost: foes0 - hp(foes) };
}

/** Two mages of player 1 on hold, casting by themselves, two cells apart. */
const mages = (g: G, x: number, y: number) => {
  const ids = [put(g, 1, UnitType.Mage, x, y), put(g, 1, UnitType.Mage, x + 2, y)];
  for (const id of ids) g.w.units.col.flags[slotOf(g, id)] |= UnitFlag.Autocast;
  cmd(g, 1, { c: "stance", u: ids, stance: Stance.Hold });
  return ids;
};

test("on a move, soldiers that mages hit from 6-7 cells go for them; switched off, the move walks past them", () => {
  const on = passBy("move", 6, mages);
  assert.ok(on.targeting > 0, "ours went for the mages");
  assert.equal(on.foeHpLost, 180, "both mages beaten (30 hp and 60 shield each)");
  switchedOff(FIRE_BACK, () => {
    const off = passBy("move", 6, mages);
    assert.ok(off.hits > 0, "they were hit on the way");
    assert.equal(off.targeting, 0, "nobody turned");
    assert.equal(off.foeHpLost, 0);
  })();
});

test("a retreat past the same mages fights no one", () => {
  const r = passBy("retreat", 6, mages);
  assert.ok(r.hits > 0, "they were hit on the way");
  assert.equal(r.targeting, 0);
  assert.equal(r.foeHpLost, 0);
});

test("an arrow tower's arrows, and a mage hiding in it, do not draw a move off its way", () => {
  // Player 1's tower 7 cells north of the mages' row (6.5 cells from its edge: out of AGGRO_RANGE
  // of ours all the way), with a mage inside casting by itself.
  let tower = -1;
  let inside = -1;
  const r = passBy("move", 7, (g, x, y) => {
    const t = BUILDINGS[BuildingType.ArrowTower];
    tower = g.w.addBuilding(1, BuildingType.ArrowTower, x, y - 1, t.hp, 1000);
    inside = put(g, 1, UnitType.Mage, x - 1, y);
    g.w.units.col.flags[slotOf(g, inside)] |= UnitFlag.Autocast;
    cmd(g, 1, { c: "garrison", u: [inside], building: tower });
    return [tower, inside];
  });
  assert.ok(r.hits > 0, "they were hit on the way");
  assert.ok(r.g.w.cannonShots[1] > 0, "the mage inside fired");
  assert.equal(r.targeting, 0, "nobody went for the tower or the mage in it");
  assert.ok(r.group.every((id) => slotOf(r.g, id) < 0 || r.g.w.units.col.fireBack[slotOf(r.g, id)] === -1));
});

/**
 * Player 0's soldier (`type`) walks north (a move) past player 1's mage 7 cells east of its way,
 * which fires where it is about to be: out of AGGRO_RANGE, and out of a spearman's sight (6).
 * With `eye` player 0 sees where the mage stands and goes all the time (an outpost of its own,
 * sight 10). Returns once the shot has landed.
 */
function shotOnTheWay(eye: boolean, type: UnitType = UnitType.Spearman) {
  const g = emptyGame();
  const a = openArea(g, 30);
  g.w.ecoOn[0] = 0;
  g.w.ecoOn[1] = 0;
  g.w.res[4 + Resource.Crystal] = 100;
  const unit = put(g, 0, type, a.x + 10, a.y + 28);
  const mage = put(g, 1, UnitType.Mage, a.x + 17, a.y + 17);
  if (eye) {
    const o = BUILDINGS[BuildingType.Outpost];
    g.w.addBuilding(0, BuildingType.Outpost, a.x + 22, a.y + 20, o.hp, 1000);
  }
  g.fog.update(g.w);
  cmd(g, 1, { c: "stance", u: [mage], stance: Stance.Hold });
  cmd(g, 0, { c: "move", u: [unit], x: a.x + 10, y: a.y + 2 });
  const u = g.w.units.col;
  // It walks a cell and a half while the mage calibrates: the shot lands as it passes 7 cells
  // west of the mage, the nearest it comes.
  while (u.y[slotOf(g, unit)] > (a.y + 19) << CELL_SHIFT) run(g, 1);
  cmd(g, 1, { c: "cast", u: mage, fx: u.x[slotOf(g, unit)] + 64, fy: u.y[slotOf(g, unit)] - 1536 });
  const hp = () => u.hp[slotOf(g, unit)] + u.shield[slotOf(g, unit)];
  const before = hp();
  let went = false;
  for (let t = 0; t < CANNON.calibrateTicks + RETARGET_EVERY + 2; t++) {
    run(g, 1);
    if (u.target[slotOf(g, unit)] === mage) went = true;
  }
  assert.ok(hp() < before, "the shot hit it");
  return { g, a, unit, mage, went };
}

test("a shooter the player does not see does not count; a mage that fires shows itself (REVEAL_CAST) and does", () => {
  switchedOff(REVEAL_CAST, () => {
    const unseen = shotOnTheWay(false);
    const u = unseen.g.w.units.col;
    assert.equal(unseen.went, false, "it did not go for what it does not see");
    assert.equal(u.fireBack[slotOf(unseen.g, unseen.unit)], -1);
    assert.equal(u.order[slotOf(unseen.g, unseen.unit)], Order.Move);
  })();
  const seen = shotOnTheWay(false);
  assert.equal(seen.went, true, "the mage showed itself when it fired");
});

test("it gives up once the shooter is more than FIRE_BACK.leash from where it turned, and goes on with its move", () => {
  // A mage of player 0 (as slow as the one that shot it, which walks off at once: it never gets
  // within AGGRO_RANGE of it).
  const { g, a, unit, mage, went } = shotOnTheWay(true, UnitType.Mage);
  const u = g.w.units.col;
  assert.ok(went && u.fireBack[slotOf(g, unit)] === mage, "hit, it went for the mage");
  const at = [u.anchorX[slotOf(g, unit)], u.anchorY[slotOf(g, unit)]];
  cmd(g, 1, { c: "retreat", u: [mage], x: a.x + 29, y: a.y + 10 });
  let gaveUp = false;
  for (let t = 0; t < 400 && !gaveUp; t++) {
    run(g, 1);
    gaveUp = u.fireBack[slotOf(g, unit)] === -1;
  }
  assert.ok(gaveUp, "it gave up");
  const s = slotOf(g, unit);
  const ms = slotOf(g, mage);
  assert.ok(Math.hypot(u.x[ms] - at[0], u.y[ms] - at[1]) > FIRE_BACK.leash, "the mage more than the leash off where it turned");
  assert.ok(Math.hypot(u.x[ms] - u.x[s], u.y[ms] - u.y[s]) > AGGRO_RANGE, "and never came within AGGRO_RANGE");
  assert.notEqual(u.target[s], mage);
  assert.equal(u.order[s], Order.Move, "still on its move");
  run(g, 60 * 20);
  assert.equal(u.order[slotOf(g, unit)], Order.None, "and it got there");
  assert.ok(Math.abs((u.y[slotOf(g, unit)] >> CELL_SHIFT) - (a.y + 2)) <= 1, "at the goal");
});

test("a shooter that comes within AGGRO_RANGE is just an enemy on the way", () => {
  // A spearman (faster than the mage): it closes in, and the mage is then its target as any enemy within reach.
  const { g, unit, mage, went } = shotOnTheWay(true);
  const u = g.w.units.col;
  assert.ok(went);
  run(g, 3 * 20);
  const s = slotOf(g, unit);
  assert.equal(u.fireBack[s], -1, "handed over");
  assert.equal(u.target[s], mage, "it fights the mage");
});
