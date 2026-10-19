// "attacked" says who hit (D-087, for R6's 全體回城 that pops up only for enemy players): `by` is
// the attacker's owner, NEUTRAL for militia and the big city's tower, the enemy player for its
// soldiers, its main city's arrows and a cannon fired from out of sight. At most one per 8 x 8
// block per 60 ticks per attacker's owner, so militia hitting there do not hide the enemy.

import assert from "node:assert/strict";
import test from "node:test";
import type { Game } from "../src/core/game.ts";
import { DODGE, SHORT_CANNON } from "../src/core/rules.ts";
import { BuildingType, CELL, CELL_SHIFT, NEUTRAL, Resource, type SimEvent, UnitType } from "../src/protocol.ts";
import { cmd, emptyGame, openArea, put, slotOf, switchedOff } from "./helpers.ts";

type Attacked = Extract<SimEvent, { k: "attacked" }>;

/** Player p's "attacked" events over the next `ticks` ticks, with the tick each came. */
function attacked(g: Game, p: number, ticks: number): (Attacked & { tick: number })[] {
  const out: (Attacked & { tick: number })[] = [];
  for (let t = 0; t < ticks && !g.w.over; t++) {
    g.step();
    for (const e of g.events) if (e.to === p && e.ev.k === "attacked") out.push({ ...e.ev, tick: g.w.tick });
  }
  return out;
}

/** A unit that takes hits for a long time and never hits back. */
function dummy(g: Game, owner: number, type: UnitType, x: number, y: number): number {
  const id = put(g, owner, type, x, y);
  const u = g.w.units.col;
  u.hp[slotOf(g, id)] = 100000;
  u.stance[slotOf(g, id)] = 1;
  u.cooldown[slotOf(g, id)] = 100000;
  return id;
}

function arena(): { g: Game; a: { x: number; y: number } } {
  const g = emptyGame();
  g.w.ecoOn[0] = 0;
  g.w.ecoOn[1] = 0;
  return { g, a: openArea(g, 20) };
}

test("an enemy player's soldier: by is that player", () => {
  const { g, a } = arena();
  const farmer = dummy(g, 0, UnitType.Farmer, a.x + 5, a.y + 5);
  const foe = put(g, 1, UnitType.Spearman, a.x + 6, a.y + 5);
  g.fog.update(g.w);
  cmd(g, 1, { c: "attack", u: [foe], target: farmer });
  const got = attacked(g, 0, 40);
  assert.ok(got.length > 0);
  assert.deepEqual([got[0].target, got[0].by], [farmer, 1]);
  assert.deepEqual(attacked(g, 1, 40), [], "the attacker is not told");
});

test("militia and the big city's tower: by is NEUTRAL", () => {
  const { g, a } = arena();
  const target = dummy(g, 0, UnitType.Spearman, a.x + 5, a.y + 5);
  put(g, NEUTRAL, UnitType.Militia, a.x + 6, a.y + 5);
  g.fog.update(g.w);
  const fromMilitia = attacked(g, 0, 60);
  assert.ok(fromMilitia.length > 0, "the militia hit it");
  assert.ok(fromMilitia.every((e) => e.target === target && e.by === NEUTRAL));
  // The big city's tower (NEUTRAL) shoots a unit beside it.
  const tower = g.w.buildings.col;
  let ts = -1;
  for (let s = 0; s < g.w.buildings.count; s++) if (tower.type[s] === BuildingType.TownTower) ts = s;
  assert.ok(ts >= 0);
  const near = dummy(g, 0, UnitType.Spearman, tower.cellX[ts] - 2, tower.cellY[ts]);
  const fromTower = attacked(g, 0, 60).filter((e) => e.target === near);
  assert.ok(fromTower.length > 0, "the tower shot it");
  assert.ok(fromTower.every((e) => e.by === NEUTRAL));
});

test("the enemy main city's arrows: by is the enemy player", () => {
  const g = emptyGame();
  g.w.ecoOn[0] = 0;
  g.w.ecoOn[1] = 0;
  const home = g.w.map.spawns[1];
  const scout = dummy(g, 0, UnitType.Spearman, home.cellX - 5, home.cellY + 4);
  g.fog.update(g.w);
  const got = attacked(g, 0, 60).filter((e) => e.target === scout);
  assert.ok(got.length > 0, "the main city shot it");
  assert.ok(got.every((e) => e.by === 1));
});

test(
  "a cannon fired from out of sight: by is the enemy player",
  switchedOff([DODGE, SHORT_CANNON], () => {
    const { g, a } = arena();
    g.w.res[4 + Resource.Crystal] = 50;
    const mage = dummy(g, 1, UnitType.Mage, a.x + 2, a.y + 10);
    const farmer = dummy(g, 0, UnitType.Farmer, a.x + 9, a.y + 10);
    g.fog.update(g.w);
    const u = g.w.units.col;
    const ms = slotOf(g, mage);
    assert.notEqual(g.fog.visible[0][(u.y[ms] >> CELL_SHIFT) * g.w.size + (u.x[ms] >> CELL_SHIFT)], 1, "player 0 does not see the mage");
    u.cooldown[ms] = 0;
    cmd(g, 1, { c: "cast", u: mage, fx: (a.x + 9) * CELL + 512, fy: (a.y + 10) * CELL + 512 });
    const got = attacked(g, 0, 40);
    assert.equal(u.hp[slotOf(g, farmer)] < 100000, true, "the cannon hit");
    assert.deepEqual(got.map((e) => [e.target, e.by]), [[farmer, 1]]);
  }),
);

test("militia and an enemy at the same place: an event for each, each at most once a 60 ticks", () => {
  const { g, a } = arena();
  const target = dummy(g, 0, UnitType.Spearman, a.x + 5, a.y + 5);
  put(g, NEUTRAL, UnitType.Militia, a.x + 6, a.y + 5);
  const foe = put(g, 1, UnitType.Spearman, a.x + 4, a.y + 5);
  g.fog.update(g.w);
  cmd(g, 1, { c: "attack", u: [foe], target });
  const got = attacked(g, 0, 130);
  const by = (o: number) => got.filter((e) => e.by === o).map((e) => e.tick);
  assert.ok(by(1).length >= 2 && by(NEUTRAL).length >= 2, `both, again after 60 ticks: ${JSON.stringify(got.map((e) => [e.tick, e.by]))}`);
  for (const o of [1, NEUTRAL]) {
    const ticks = by(o);
    for (let k = 1; k < ticks.length; k++) assert.ok(ticks[k] - ticks[k - 1] >= 60, `by ${o}: ${ticks.join(",")}`);
  }
  // In one 60-tick window from the first, one of each, the enemy's not hidden by the militia's.
  const first = got[0].tick;
  const window = got.filter((e) => e.tick < first + 60).map((e) => e.by).sort();
  assert.deepEqual(window, [1, NEUTRAL]);
});
