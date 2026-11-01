// A unit going for a target with no order to attack it, the straight way blocked (CHASE_ROUND; the user 2026-10-31: 「後面過去
// 的兵只會看不會打」): it walks round, at most CHASE_ROUND.walk cells; further, or no way there, it lets go.

import assert from "node:assert/strict";
import { test } from "node:test";
import { BUILDINGS, CHASE_ROUND } from "../src/core/rules.ts";
import { BuildingType, CELL_SHIFT, Order, Stance, TownState, UnitType } from "../src/protocol.ts";
import { cmd, emptyGame, openArea, put, run, slotOf, switchedOff } from "./helpers.ts";

type G = ReturnType<typeof emptyGame>;
const T = 0;

/** A barracks of player 0 in the open, its soldier north of it, an enemy south of it standing still. */
function aroundBarracks(): { g: G; a: number; foe: number } {
  const g = emptyGame();
  const at = openArea(g, 12);
  const x = at.x + 4;
  const y = at.y + 4;
  g.w.addBuilding(0, BuildingType.Barracks, x, y, BUILDINGS[BuildingType.Barracks].hp, 1000);
  const a = put(g, 0, UnitType.Spearman, x + 1, y - 1);
  const foe = put(g, 1, UnitType.Spearman, x + 1, y + 3);
  g.w.units.col.stance[slotOf(g, foe)] = Stance.Hold;
  g.fog.update(g.w);
  return { g, a, foe };
}

test("a building between them: it walks round and fights, it does not stand against the wall", () => {
  const { g, foe } = aroundBarracks();
  const u = g.w.units.col;
  const hp = u.hp[slotOf(g, foe)];
  run(g, 30 * 20);
  assert.ok(g.w.unit(foe) < 0 || u.hp[slotOf(g, foe)] < hp, "it got at it");
});

test("CHASE_ROUND off: as before, it presses against the building", switchedOff(CHASE_ROUND, () => {
  const { g, a, foe } = aroundBarracks();
  const u = g.w.units.col;
  const hp = u.hp[slotOf(g, foe)];
  run(g, 30 * 20);
  assert.equal(g.w.unit(a) >= 0 && u.hp[slotOf(g, foe)], hp, "it never got there");
}));

test("no way there (a closed gate between): it lets go and goes on with its move", () => {
  const g = emptyGame();
  g.w.townState[T] = TownState.Governed;
  g.w.townOwner[T] = 1;
  g.w.townTimer[T] = 1 << 20;
  g.w.refreshGates(T);
  const t = g.w.map.towns[T];
  const y1 = g.w.castles[T].inside.y1;
  const a = put(g, 0, UnitType.Cavalry, t.cellX + y1 + 2, t.cellY + y1 + 2);
  const site = g.w.addBuilding(1, BuildingType.ArrowTower, t.cellX + 4, t.cellY + 4, 100, 100);
  g.fog.update(g.w);
  cmd(g, 0, { c: "move", u: [a], x: t.cellX + y1 + 2, y: t.cellY + y1 + 22 });
  const u = g.w.units.col;
  run(g, 15 * 20);
  assert.ok(g.w.building(site) >= 0);
  assert.ok(u.y[slotOf(g, a)] >> CELL_SHIFT > t.cellY + y1 + 8, "it went on");
  assert.equal(u.order[slotOf(g, a)] === Order.Move || u.order[slotOf(g, a)] === Order.None, true);
});
