import assert from "node:assert/strict";
import { test } from "node:test";
import { damage } from "../src/core/units.ts";
import { Action, BuildingType, CELL_SHIFT, GameOverReason, Order, Reject, Stance, UNIT_STRIDE, UnitField, UnitFlag, UnitType } from "../src/protocol.ts";
import { buildView } from "../src/view/view.ts";
import { BUILDINGS, JOIN_FIGHT, UNITS } from "../src/core/rules.ts";
import { fight } from "../src/balance-lib.ts";
import type { Game } from "../src/core/game.ts";
import { cmd, emptyGame, openArea, put, run, slotOf } from "./helpers.ts";

test("multipliers: ranged deal 12 to spearmen (5 x 5/2, round 3), 5 to others; at least 1", () => {
  assert.equal(damage(5, UnitType.Ranged, UnitType.Spearman), 12);
  assert.equal(damage(5, UnitType.Ranged, UnitType.Ranged), 5);
  assert.equal(damage(6, UnitType.Spearman, UnitType.Ranged), 6);
  assert.equal(damage(0, UnitType.Farmer, UnitType.Farmer), 1);
});

test("a group moves at its slowest speed and forms up: melee in front, then ranged, then mages", () => {
  const g = emptyGame();
  const a = openArea(g, 24);
  const ids: number[] = [];
  for (let k = 0; k < 4; k++) ids.push(put(g, 0, UnitType.Mage, a.x + 2 + k, a.y + 2));
  for (let k = 0; k < 4; k++) ids.push(put(g, 0, UnitType.Ranged, a.x + 2 + k, a.y + 3));
  for (let k = 0; k < 4; k++) ids.push(put(g, 0, UnitType.Spearman, a.x + 2 + k, a.y + 4));
  cmd(g, 0, { c: "move", u: ids, x: a.x + 3, y: a.y + 20 });
  run(g, 1);
  const u = g.w.units.col;
  for (const id of ids) assert.equal(u.speedCap[slotOf(g, id)], 46, "group speed = mage speed");
  run(g, 600);
  for (const id of ids) assert.equal(u.order[slotOf(g, id)], Order.None, `unit ${id} arrived`);
  const meanY = (t: number) => {
    const ys = ids.filter((id) => u.type[slotOf(g, id)] === t).map((id) => u.y[slotOf(g, id)]);
    return ys.reduce((p, v) => p + v, 0) / ys.length;
  };
  // Moving toward +y: the front is the largest y.
  assert.ok(meanY(UnitType.Spearman) > meanY(UnitType.Ranged), "spearmen ahead of ranged");
  assert.ok(meanY(UnitType.Ranged) > meanY(UnitType.Mage), "ranged ahead of mages");
});

test("retreat ignores enemies; attack-move fights them", () => {
  for (const kind of ["retreat", "move"] as const) {
    const g = emptyGame();
    const a = openArea(g, 24);
    const mine = put(g, 0, UnitType.Spearman, a.x + 2, a.y + 10);
    const enemy = put(g, 1, UnitType.Farmer, a.x + 8, a.y + 10);
    g.w.units.col.stance[slotOf(g, enemy)] = Stance.Hold;
    g.w.ecoOn[1] = 0; // keep the target farmer standing still
    g.fog.update(g.w);
    cmd(g, 0, { c: kind, u: [mine], x: a.x + 20, y: a.y + 10 });
    run(g, 300);
    const enemyHurt = slotOf(g, enemy) < 0 || g.w.units.col.hp[slotOf(g, enemy)] < 25;
    assert.equal(enemyHurt, kind === "move", kind);
  }
});

test("hold stance stays put; aggressive idle units chase but give up past the leash", () => {
  const g = emptyGame();
  const a = openArea(g, 24);
  const holder = put(g, 0, UnitType.Spearman, a.x + 4, a.y + 4);
  const chaser = put(g, 0, UnitType.Spearman, a.x + 4, a.y + 14);
  cmd(g, 0, { c: "stance", u: [holder], stance: Stance.Hold });
  const bait1 = put(g, 1, UnitType.Ranged, a.x + 8, a.y + 4);
  const bait2 = put(g, 1, UnitType.Ranged, a.x + 8, a.y + 14);
  const u = g.w.units.col;
  for (const b of [bait1, bait2]) u.stance[slotOf(g, b)] = Stance.Hold;
  g.fog.update(g.w);
  const x0 = u.x[slotOf(g, holder)];
  run(g, 60);
  assert.equal(u.x[slotOf(g, holder)], x0, "holder did not move");
  assert.ok(u.x[slotOf(g, chaser)] > (a.x + 4) << CELL_SHIFT, "chaser moved toward the bait");
  // Move the bait far away (and its post, or it would walk back): the chaser returns.
  u.x[slotOf(g, bait2)] = (a.x + 22) << CELL_SHIFT;
  u.anchorX[slotOf(g, bait2)] = (a.x + 22) << CELL_SHIFT;
  run(g, 200);
  const dx = u.x[slotOf(g, chaser)] - (((a.x + 4) << CELL_SHIFT) + 512);
  assert.ok(Math.abs(dx) < 2 << CELL_SHIFT, `chaser back near its post (dx ${dx})`);
});

test("joining a fight: an idle soldier takes on the enemy a friend within 6 cells is fighting; hold, farmers and units with orders do not", () => {
  const g = emptyGame();
  const w = g.w;
  const a = openArea(g, 24);
  w.ecoOn[0] = 0;
  const u = w.units.col;
  // The enemy stands (hold) and never hits back.
  const enemy = put(g, 1, UnitType.Spearman, a.x + 12, a.y + 16);
  u.stance[slotOf(g, enemy)] = Stance.Hold;
  u.cooldown[slotOf(g, enemy)] = 100000;
  const friend = put(g, 0, UnitType.Spearman, a.x + 12, a.y + 12); // 4 cells: it fights
  const joiner = put(g, 0, UnitType.Spearman, a.x + 12, a.y + 9); // 7 cells: too far to see it as its own
  const holder = put(g, 0, UnitType.Spearman, a.x + 10, a.y + 9);
  u.stance[slotOf(g, holder)] = Stance.Hold;
  const farmer = put(g, 0, UnitType.Farmer, a.x + 14, a.y + 9);
  const mover = put(g, 0, UnitType.Spearman, a.x + 11, a.y + 8);
  g.fog.update(w);
  cmd(g, 0, { c: "move", u: [mover], x: a.x + 11, y: a.y + 1 });
  const at = (id: number) => [u.x[slotOf(g, id)], u.y[slotOf(g, id)]];
  const holderAt = at(holder);
  const farmerAt = at(farmer);
  const joinerY = u.y[slotOf(g, joiner)];
  run(g, 40);
  assert.equal(u.target[slotOf(g, friend)], enemy, "the friend fights it");
  assert.equal(u.target[slotOf(g, joiner)], enemy, "the idle soldier joins in");
  assert.ok(u.y[slotOf(g, joiner)] > joinerY + 1024, "and goes for it");
  assert.deepEqual(at(holder), holderAt, "hold: stays");
  assert.deepEqual(at(farmer), farmerAt, "farmer: stays");
  assert.equal(u.target[slotOf(g, mover)], -1, "a unit with an order keeps to it");
});

test("joining a fight does not chain: in a line of soldiers 4 cells apart, only those within 8 cells of the enemy leave their place", () => {
  const g = emptyGame();
  const a = openArea(g, 24);
  const u = g.w.units.col;
  const enemy = put(g, 1, UnitType.Spearman, a.x + 12, a.y + 2);
  u.stance[slotOf(g, enemy)] = Stance.Hold;
  u.cooldown[slotOf(g, enemy)] = 100000;
  const line = [6, 10, 14, 18].map((dy) => put(g, 0, UnitType.Spearman, a.x + 12, a.y + dy));
  g.fog.update(g.w);
  const start = line.map((id) => [u.x[slotOf(g, id)], u.y[slotOf(g, id)]]);
  let moved1 = false;
  for (let t = 0; t < 150; t++) {
    g.step();
    if (u.y[slotOf(g, line[1])] < start[1][1] - 512) moved1 = true;
    for (const k of [2, 3]) assert.deepEqual([u.x[slotOf(g, line[k])], u.y[slotOf(g, line[k])]], start[k], `tick ${g.tick}: soldier ${k} (12 or more cells away) stays`);
  }
  assert.ok(moved1, "the one 8 cells away joins");
});

test("joining a fight: ranged walking up to standing spearmen meet all of them (equal cost, 8 cells): the spearmen win; without it the ranged win", () => {
  const spear = { spear: 14, ranged: 0, mage: 0 };
  const ranged = { spear: 0, ranged: 12, mage: 0 };
  assert.equal(fight([spear, ranged], 1, 8).winner, 0, "with joining");
  const range = JOIN_FIGHT.range;
  JOIN_FIGHT.range = 0;
  try {
    assert.equal(fight([spear, ranged], 1, 8).winner, 1, "without it, the standing spearmen come one by one");
  } finally {
    JOIN_FIGHT.range = range;
  }
});

test("main city arrows hit intruders; destroying a main city ends the game", () => {
  const g = emptyGame();
  const w = g.w;
  const s1 = w.map.spawns[1];
  const intruder = put(g, 0, UnitType.Spearman, s1.cellX - 5, s1.cellY + 3);
  g.fog.update(w);
  run(g, 45);
  assert.ok(slotOf(g, intruder) < 0 || w.units.col.hp[slotOf(g, intruder)] < UNITS[UnitType.Spearman].hp, "arrow hit");
  const main1 = w.mainCity(1);
  w.buildings.col.hp[main1] = 1;
  const attacker = put(g, 0, UnitType.Spearman, s1.cellX + 3, s1.cellY);
  g.fog.update(w);
  cmd(g, 0, { c: "attack", u: [attacker], target: w.buildings.col.id[main1] });
  run(g, 100);
  assert.equal(w.winner, 0);
  assert.equal(w.endReason, GameOverReason.MainCityDestroyed);
});

/**
 * An enemy lumber camp (2 x 2) in an open area, walled in by 8 enemy houses (`gap`: the
 * houses on the right are moved one cell out, leaving a one-cell passage down to the camp),
 * and 4 spearmen of player 0 outside, told to attack the camp.
 */
function walledCamp(gap: boolean) {
  const g = emptyGame();
  const w = g.w;
  const a = openArea(g, 16);
  const x0 = a.x + 6;
  const y0 = a.y + 6;
  const camp = w.addBuilding(1, BuildingType.LumberCamp, x0, y0, BUILDINGS[BuildingType.LumberCamp].hp, 1000);
  const d = gap ? 1 : 0;
  const spots = [[-2, -2], [0, -2], [2 + d, -2], [-2, 0], [2 + d, 0], [-2, 2], [0, 2], [2, 2]];
  const houses = spots.map(([dx, dy]) => w.addBuilding(1, BuildingType.House, x0 + dx, y0 + dy, BUILDINGS[BuildingType.House].hp, 1000));
  const ids: number[] = [];
  // Close enough to see the camp (sight 6), outside the wall.
  for (let k = 0; k < 4; k++) ids.push(put(g, 0, UnitType.Spearman, x0 + 6, y0 - 3 + 2 * k));
  g.fog.update(w);
  cmd(g, 0, { c: "attack", u: ids, target: camp });
  g.step();
  assert.ok(!g.events.some((e) => e.ev.k === "rejected"), "the attack order is accepted");
  const hp = (id: number) => {
    const s = w.building(id);
    return s < 0 ? 0 : w.buildings.col.hp[s];
  };
  return { g, camp, houses, hp };
}

test("walled in: attackers break through the enemy house nearest the target, then hit the target", () => {
  const { g, camp, houses, hp } = walledCamp(false);
  let first = -1;
  for (let t = 0; t < 3000 && hp(camp) === BUILDINGS[BuildingType.LumberCamp].hp; t++) {
    g.step();
    if (first < 0) first = houses.findIndex((h) => hp(h) < BUILDINGS[BuildingType.House].hp);
  }
  assert.ok(first >= 0, "a house was attacked");
  // The houses at the sides (1, 3, 4, 6) touch the camp's sides and are nearer it than the
  // corners; of those the lowest id goes first.
  assert.equal(first, 1, `broke in through house ${first}`);
  assert.ok(hp(camp) < BUILDINGS[BuildingType.LumberCamp].hp, "then hit the camp");
});

test("a narrow way in (one cell) is used: no house is attacked", () => {
  const { g, camp, houses, hp } = walledCamp(true);
  for (let t = 0; t < 3000 && hp(camp) > 0; t++) g.step();
  assert.equal(hp(camp), 0, "the camp was destroyed");
  // Checked when the camp falls: afterwards idle soldiers pick nearby enemy buildings anyway.
  assert.deepEqual(houses.map(hp), houses.map(() => BUILDINGS[BuildingType.House].hp), "every house untouched");
});

test("a move to a walled-in point: soldiers break through enemy walls; with only own walls, they and farmers wait at the nearest cell instead of pushing", () => {
  // Soldiers told to move into the enemy's walled area break in like an attack.
  const enemy = walledCamp(false);
  const u0 = enemy.g.w.units.col;
  const soldiers: number[] = [];
  for (let s = 0; s < enemy.g.w.units.count; s++) if (u0.owner[s] === 0) soldiers.push(u0.id[s]);
  const c = enemy.g.w.building(enemy.camp);
  cmd(enemy.g, 0, { c: "move", u: soldiers, x: enemy.g.w.buildings.col.cellX[c] + 2, y: enemy.g.w.buildings.col.cellY[c] - 1 });
  run(enemy.g, 600);
  assert.ok(enemy.houses.some((h) => enemy.hp(h) < BUILDINGS[BuildingType.House].hp), "a house is attacked");

  // Own houses around an empty spot: nothing to break; a soldier and a farmer go as near as they can.
  const g = emptyGame();
  const w = g.w;
  const a = openArea(g, 16);
  const x0 = a.x + 6;
  const y0 = a.y + 6;
  for (const [dx, dy] of [[-2, -2], [0, -2], [2, -2], [-2, 0], [2, 0], [-2, 2], [0, 2], [2, 2]]) {
    w.addBuilding(0, BuildingType.House, x0 + dx, y0 + dy, BUILDINGS[BuildingType.House].hp, 1000);
  }
  const soldier = put(g, 0, UnitType.Spearman, x0 + 8, y0);
  const farmer = put(g, 0, UnitType.Farmer, x0 + 8, y0 + 1);
  g.fog.update(w);
  cmd(g, 0, { c: "move", u: [soldier], x: x0, y: y0 });
  cmd(g, 0, { c: "move", u: [farmer], x: x0 + 1, y: y0 + 1 });
  run(g, 600);
  const u = w.units.col;
  for (const id of [soldier, farmer]) {
    const s = slotOf(g, id);
    const cx = u.x[s] >> CELL_SHIFT;
    const cy = u.y[s] >> CELL_SHIFT;
    // The ring's outer edge is 4 cells from the spot: the unit waits right outside it,
    // standing, instead of pushing against the wall for ever.
    assert.ok(Math.max(Math.abs(cx - x0), Math.abs(cy - y0)) <= 4, `unit ${id} at ${cx - x0},${cy - y0}`);
    assert.equal(u.action[s], Action.Idle, `unit ${id} waits`);
  }
  for (let s = 0; s < w.buildings.count; s++) assert.equal(w.buildings.col.hp[s], BUILDINGS[w.buildings.col.type[s]].hp, "own buildings untouched");
});

/** Runs (at least the tick that applies the commands just given) until none of the units has an order, at most `cap` ticks; true when they all got there. */
function settle(g: Game, ids: number[], cap = 600): boolean {
  const u = g.w.units.col;
  for (let t = 0; t < cap; t++) {
    g.step();
    if (ids.every((id) => u.order[slotOf(g, id)] === Order.None)) return true;
  }
  return false;
}

/** Middle of the units, in cells. */
function middle(g: Game, ids: number[]): { x: number; y: number } {
  const u = g.w.units.col;
  let x = 0;
  let y = 0;
  for (const id of ids) {
    x += u.x[slotOf(g, id)];
    y += u.y[slotOf(g, id)];
  }
  return { x: x / ids.length / 1024, y: y / ids.length / 1024 };
}

/** Distance from each unit to its nearest neighbour among them, in cells: the smallest and the mean. */
function spacing(g: Game, ids: number[]): { min: number; mean: number } {
  const u = g.w.units.col;
  const d: number[] = ids.map((a) => {
    let best = Infinity;
    for (const b of ids) {
      if (a === b) continue;
      const dx = u.x[slotOf(g, a)] - u.x[slotOf(g, b)];
      const dy = u.y[slotOf(g, a)] - u.y[slotOf(g, b)];
      best = Math.min(best, Math.hypot(dx, dy) / 1024);
    }
    return best;
  });
  return { min: Math.min(...d), mean: d.reduce((p, v) => p + v, 0) / d.length };
}

const far = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

/** Standing about two cells apart (a loose formation), not one. */
function loose2(g: Game, ids: number[]): boolean {
  const d = spacing(g, ids);
  return d.mean >= 1.5 && d.min >= 1.2;
}

const shown = (g: Game, ids: number[]) => `nearest neighbour ${spacing(g, ids).min.toFixed(2)}, on average ${spacing(g, ids).mean.toFixed(2)} cells`;

test("formation: sets and clears the Loose flag of own units and shows in the view; standing soldiers spread out where they are, others keep their orders", () => {
  const g = emptyGame();
  const w = g.w;
  const a = openArea(g, 16);
  const mine = [0, 1, 2].map((k) => put(g, 0, UnitType.Spearman, a.x + 2 + k, a.y + 2));
  const farmer = put(g, 0, UnitType.Farmer, a.x + 2, a.y + 4);
  // A spearman far from the others attacks an enemy farmer standing still.
  const busy = put(g, 0, UnitType.Spearman, a.x + 12, a.y + 8);
  const theirs = put(g, 1, UnitType.Farmer, a.x + 12, a.y + 12);
  const u = w.units.col;
  u.stance[slotOf(g, theirs)] = Stance.Hold;
  // No automatic work: farmers stay where they are.
  w.ecoOn[0] = 0;
  w.ecoOn[1] = 0;
  g.fog.update(w);
  cmd(g, 0, { c: "attack", u: [busy], target: theirs });
  g.step();
  const loose = (id: number) => (u.flags[slotOf(g, id)] & UnitFlag.Loose) !== 0;
  const farmerAt = [u.x[slotOf(g, farmer)], u.y[slotOf(g, farmer)]];
  const before = middle(g, mine);
  const rejected = () => g.events.filter((e) => e.ev.k === "rejected").map((e) => (e.ev as { reason: number }).reason);

  cmd(g, 0, { c: "formation", u: [...mine, farmer, busy, theirs], loose: true });
  g.step();
  assert.deepEqual(rejected(), []);
  assert.deepEqual([...mine, farmer, busy].map(loose), [true, true, true, true, true], "own units, any type");
  assert.equal(loose(theirs), false, "not the other player's");
  assert.equal(u.order[slotOf(g, busy)], Order.Attack, "a unit attacking something keeps at it");
  assert.equal(u.order[slotOf(g, mine[0])], Order.Move, "the standing spearmen form up again");
  assert.ok(settle(g, mine), "and get there");
  assert.ok(loose2(g, mine), `two cells apart now (${shown(g, mine)})`);
  assert.ok(far(middle(g, mine), before) <= 1, "where they stood");
  assert.deepEqual([u.x[slotOf(g, farmer)], u.y[slotOf(g, farmer)]], farmerAt, "the farmer only takes the flag");
  // The flag is in the snapshot's flags field.
  const view = buildView(g, 0);
  let seen = 0;
  for (let o = 0; o < view.units.length; o += UNIT_STRIDE) {
    if (view.units[o + UnitField.id] === mine[0]) seen = view.units[o + UnitField.flags] & UnitFlag.Loose;
  }
  assert.equal(seen, UnitFlag.Loose);

  cmd(g, 0, { c: "formation", u: [mine[0]], loose: false });
  g.step();
  assert.deepEqual(mine.map(loose), [false, true, true], "cleared for the one named");
  assert.equal(u.order[slotOf(g, mine[0])], Order.None, "a soldier on its own only takes the flag");
  cmd(g, 0, { c: "formation", u: [theirs], loose: true });
  g.step();
  assert.deepEqual(rejected(), [Reject.NotOwner]);
  cmd(g, 0, { c: "formation", u: mine, loose: 1 as never });
  g.step();
  assert.deepEqual(rejected(), [Reject.InvalidTarget]);
  assert.deepEqual(mine.map(loose), [false, true, true], "a rejected command changes nothing");
});

test("formation: two squads far apart told together spread out each where it stands, and close up again", () => {
  const g = emptyGame();
  const a = openArea(g, 24);
  const squad = (x: number, y: number) => {
    const ids: number[] = [];
    for (let k = 0; k < 9; k++) ids.push(put(g, 0, UnitType.Spearman, x + (k % 3), y + Math.trunc(k / 3)));
    return ids;
  };
  const one = squad(a.x + 3, a.y + 3);
  const two = squad(a.x + 18, a.y + 18);
  g.fog.update(g.w);
  const at = [middle(g, one), middle(g, two)];
  cmd(g, 0, { c: "formation", u: [...one, ...two], loose: true });
  assert.ok(settle(g, [...one, ...two]), "everyone got there");
  [one, two].forEach((ids, k) => {
    assert.ok(far(middle(g, ids), at[k]) <= 1, `squad ${k}: its middle moved ${far(middle(g, ids), at[k]).toFixed(2)} cells`);
    assert.ok(loose2(g, ids), `squad ${k}: ${shown(g, ids)}`);
  });
  assert.ok(far(middle(g, one), middle(g, two)) > 19, "not drawn together");

  cmd(g, 0, { c: "formation", u: [...one, ...two], loose: false });
  assert.ok(settle(g, [...one, ...two]));
  [one, two].forEach((ids, k) => {
    assert.ok(far(middle(g, ids), at[k]) <= 1, `squad ${k} closed up where it stood`);
    assert.ok(spacing(g, ids).mean <= 1.25, `squad ${k}: one cell apart again (${shown(g, ids)})`);
  });
});

test("formation: spreading out in place, units take the slots nearest where they stand (a block of 16 is done in 3 s)", () => {
  const g = emptyGame();
  const a = openArea(g, 24);
  const ids: number[] = [];
  for (let k = 0; k < 16; k++) ids.push(put(g, 0, UnitType.Spearman, a.x + 8 + (k % 4), a.y + 8 + Math.trunc(k / 4)));
  g.fog.update(g.w);
  const u = g.w.units.col;
  const start = ids.map((id) => [u.x[slotOf(g, id)], u.y[slotOf(g, id)]]);
  cmd(g, 0, { c: "formation", u: ids, loose: true });
  assert.ok(settle(g, ids, 60), "spread out within 60 ticks");
  const walked = ids.map((id, k) => Math.hypot(u.x[slotOf(g, id)] - start[k][0], u.y[slotOf(g, id)] - start[k][1]) / 1024);
  assert.ok(Math.max(...walked) <= 2.5, `the longest walk ${Math.max(...walked).toFixed(2)} cells`);
  assert.ok(loose2(g, ids), shown(g, ids));
});

test("formation: a squad that marched in keeps its front when it spreads out (spearmen ahead of ranged)", () => {
  const g = emptyGame();
  const a = openArea(g, 24);
  const ids: number[] = [];
  for (let k = 0; k < 4; k++) ids.push(put(g, 0, UnitType.Ranged, a.x + 8 + k, a.y + 2));
  for (let k = 0; k < 4; k++) ids.push(put(g, 0, UnitType.Spearman, a.x + 8 + k, a.y + 3));
  g.fog.update(g.w);
  cmd(g, 0, { c: "move", u: ids, x: a.x + 10, y: a.y + 14 });
  assert.ok(settle(g, ids));
  const at = middle(g, ids);
  cmd(g, 0, { c: "formation", u: ids, loose: true });
  assert.ok(settle(g, ids));
  const u = g.w.units.col;
  const meanY = (t: number) => {
    const ys = ids.filter((id) => u.type[slotOf(g, id)] === t).map((id) => u.y[slotOf(g, id)] / 1024);
    return ys.reduce((p, v) => p + v, 0) / ys.length;
  };
  // They came toward +y: the front is the larger y.
  assert.ok(meanY(UnitType.Spearman) > meanY(UnitType.Ranged) + 1, "spearmen still in front");
  assert.ok(loose2(g, ids), shown(g, ids));
  assert.ok(far(middle(g, ids), at) <= 1);
});

test("formation: a group forms up two cells apart only when more than half of it is loose", () => {
  const g = emptyGame();
  const a = openArea(g, 24);
  const ids = [0, 1, 2, 3].map((k) => put(g, 0, UnitType.Spearman, a.x + 4 + k, a.y + 4));
  g.fog.update(g.w);
  cmd(g, 0, { c: "formation", u: ids.slice(0, 2), loose: true });
  cmd(g, 0, { c: "move", u: ids, x: a.x + 12, y: a.y + 16 });
  assert.ok(settle(g, ids));
  assert.ok(spacing(g, ids).mean <= 1.25, `two of four: one cell (${shown(g, ids)})`);
  cmd(g, 0, { c: "formation", u: [ids[2]], loose: true });
  cmd(g, 0, { c: "move", u: ids, x: a.x + 12, y: a.y + 4 });
  assert.ok(settle(g, ids));
  assert.ok(loose2(g, ids), `three of four: two cells (${shown(g, ids)})`);
});

test("formation: a group on its way keeps its goal and takes the new spacing; members already there join in", () => {
  const g = emptyGame();
  const a = openArea(g, 24);
  const ids: number[] = [];
  for (let k = 0; k < 9; k++) ids.push(put(g, 0, UnitType.Spearman, a.x + 2 + (k % 3), a.y + 2 + Math.trunc(k / 3)));
  g.fog.update(g.w);
  cmd(g, 0, { c: "move", u: ids, x: a.x + 14, y: a.y + 14 });
  g.step();
  const u = g.w.units.col;
  const goal = u.orderTarget[slotOf(g, ids[0])];
  // Until the first of them is there, the rest still on their way.
  let t = 0;
  while (ids.every((id) => u.order[slotOf(g, id)] === Order.Move) && t++ < 600) g.step();
  const there = ids.filter((id) => u.order[slotOf(g, id)] === Order.None).length;
  assert.ok(there > 0 && there < ids.length, `some there (${there}), some not`);
  cmd(g, 0, { c: "formation", u: ids, loose: true });
  g.step();
  assert.deepEqual(new Set(ids.map((id) => u.orderTarget[slotOf(g, id)])), new Set([goal]), "the same goal for all");
  assert.equal(new Set(ids.map((id) => u.group[slotOf(g, id)])).size, 1, "one formation");
  assert.ok(settle(g, ids));
  assert.ok(loose2(g, ids), `two cells apart (${shown(g, ids)})`);
});

test("big groups reach their slots, close and loose (slots off to the side of the way in)", () => {
  for (const [n, loose] of [[36, false], [25, true]] as const) {
    const g = emptyGame();
    const a = openArea(g, 30);
    const ids: number[] = [];
    for (let k = 0; k < n; k++) ids.push(put(g, 0, UnitType.Spearman, a.x + 1 + Math.trunc(k / 7), a.y + 1 + (k % 7)));
    g.fog.update(g.w);
    if (loose) cmd(g, 0, { c: "formation", u: ids, loose: true });
    cmd(g, 0, { c: "move", u: ids, x: a.x + 22, y: a.y + 22 });
    const u = g.w.units.col;
    assert.ok(settle(g, ids, 1500), `${n} ${loose ? "loose" : "close"}: ${ids.filter((id) => u.order[slotOf(g, id)] !== Order.None).length} still on their way`);
    assert.ok(loose ? loose2(g, ids) : spacing(g, ids).mean <= 1.25, `${n}: ${shown(g, ids)}`);
  }
});
