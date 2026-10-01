import assert from "node:assert/strict";
import { test } from "node:test";
import { damage } from "../src/core/units.ts";
import { Action, BuildingType, CELL_SHIFT, GameOverReason, Order, Reject, Stance, UNIT_STRIDE, UnitField, UnitFlag, UnitType } from "../src/protocol.ts";
import { buildView } from "../src/view/view.ts";
import { BUILDINGS } from "../src/core/rules.ts";
import { cmd, emptyGame, openArea, put, run, slotOf } from "./helpers.ts";

test("multipliers: ranged deal 7 to spearmen (5 x 3/2), 5 to others; at least 1", () => {
  assert.equal(damage(5, UnitType.Ranged, UnitType.Spearman), 7);
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

test("main city arrows hit intruders; destroying a main city ends the game", () => {
  const g = emptyGame();
  const w = g.w;
  const s1 = w.map.spawns[1];
  const intruder = put(g, 0, UnitType.Spearman, s1.cellX - 5, s1.cellY + 3);
  g.fog.update(w);
  run(g, 45);
  assert.ok(slotOf(g, intruder) < 0 || w.units.col.hp[slotOf(g, intruder)] < 60, "arrow hit");
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

test("formation: sets and clears the Loose flag of own units, moves nobody, and shows in the view", () => {
  const g = emptyGame();
  const w = g.w;
  const a = openArea(g, 12);
  const mine = [0, 1, 2].map((k) => put(g, 0, UnitType.Spearman, a.x + 2 + k, a.y + 2));
  const farmer = put(g, 0, UnitType.Farmer, a.x + 2, a.y + 4);
  const theirs = put(g, 1, UnitType.Spearman, a.x + 10, a.y + 10);
  g.fog.update(w);
  const u = w.units.col;
  const loose = (id: number) => (u.flags[slotOf(g, id)] & UnitFlag.Loose) !== 0;
  const before = mine.map((id) => [u.x[slotOf(g, id)], u.y[slotOf(g, id)]]);
  const rejected = () => g.events.filter((e) => e.ev.k === "rejected").map((e) => (e.ev as { reason: number }).reason);

  cmd(g, 0, { c: "formation", u: [...mine, farmer, theirs], loose: true });
  g.step();
  assert.deepEqual(rejected(), []);
  assert.deepEqual([...mine, farmer].map(loose), [true, true, true, true], "own units, any type");
  assert.equal(loose(theirs), false, "not the other player's");
  run(g, 40);
  assert.deepEqual(mine.map((id) => [u.x[slotOf(g, id)], u.y[slotOf(g, id)]]), before, "the command alone moves nobody");
  assert.equal(u.order[slotOf(g, mine[0])], Order.None);
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
  cmd(g, 0, { c: "formation", u: [theirs], loose: true });
  g.step();
  assert.deepEqual(rejected(), [Reject.NotOwner]);
  cmd(g, 0, { c: "formation", u: mine, loose: 1 as never });
  g.step();
  assert.deepEqual(rejected(), [Reject.InvalidTarget]);
  assert.deepEqual(mine.map(loose), [false, true, true], "a rejected command changes nothing");
});
