// Round 8 rule 4 (D-069; core/rules.ts HOME_GUARD): a soldier within 8 cells of its own main city,
// or within the radius of a town its owner governs, takes a fifth less damage; farmers, soldiers
// elsewhere and towns not governed yet do not count; mirror images stay mirror images.

import assert from "node:assert/strict";
import { test } from "node:test";
import { AVENGE, CANNON, DODGE, HOME_GUARD } from "../src/core/rules.ts";
import { atHome } from "../src/core/units.ts";
import { CELL_SHIFT, Resource, TownState, UnitType } from "../src/protocol.ts";
import { cmd, emptyGame, put, run, slotOf, switchedOff } from "./helpers.ts";

const centre = (c: number) => (c << CELL_SHIFT) + 512;
type G = ReturnType<typeof emptyGame>;
const REDUCED = CANNON.damage - Math.trunc((CANNON.damage * HOME_GUARD.permille) / 1000);

/** Player 1's mage 6 cells north of player 0's `type` at (x, y) fires at it; the hp it lost. */
function shot(type: UnitType, x: number, y: number, setup?: (g: G) => void): number {
  const g = emptyGame();
  const unit = put(g, 0, type, x, y);
  const mage = put(g, 1, UnitType.Mage, x, y - 6);
  g.w.res[4 + Resource.Crystal] = 100;
  g.w.ecoOn[0] = 0;
  setup?.(g);
  g.fog.update(g.w);
  cmd(g, 1, { c: "cast", u: mage, fx: centre(x), fy: centre(y) });
  run(g, CANNON.calibrateTicks + 1);
  assert.equal(g.w.cannonHits[1], 1);
  const s = slotOf(g, unit);
  return s < 0 ? Number.POSITIVE_INFINITY : g.w.units.col.hp[s] === undefined ? 0 : (type === UnitType.Farmer ? 25 : 100) - g.w.units.col.hp[s];
}

function withHome<T>(on: boolean, f: () => T): T {
  const was = HOME_GUARD.on;
  HOME_GUARD.on = on;
  try {
    return f();
  } finally {
    HOME_GUARD.on = was;
  }
}

test("a spearman 5 cells from its main city takes a fifth less from a cannon shot; with the switch off, all of it", switchedOff([DODGE, AVENGE], () => {
  // Player 0's main city covers cells 14-17 x 76-79.
  assert.equal(withHome(true, () => shot(UnitType.Spearman, 22, 78)), REDUCED);
  assert.equal(withHome(false, () => shot(UnitType.Spearman, 22, 78)), CANNON.damage);
}));

test("away from home, or a farmer at home: all of it", switchedOff([DODGE, AVENGE], () => {
  withHome(true, () => {
    assert.equal(shot(UnitType.Spearman, 27, 70), CANNON.damage, "10 cells from the city's footprint");
    assert.equal(shot(UnitType.Farmer, 22, 78), Number.POSITIVE_INFINITY, "a farmer is killed as before");
  });
}));

test("in a town its owner governs: a fifth less; while the town is being repaired, all of it", switchedOff([DODGE, AVENGE], () => {
  withHome(true, () => {
    const town = (state: number) => (g: G) => {
      const t = g.w.map.towns.findIndex((x) => x.cellX === 29 && x.cellY === 29);
      g.w.townOwner[t] = 0;
      g.w.townState[t] = state;
    };
    assert.equal(shot(UnitType.Spearman, 31, 31, town(TownState.Governed)), REDUCED);
    assert.equal(shot(UnitType.Spearman, 31, 31, town(TownState.Repairing)), CANNON.damage);
    assert.equal(shot(UnitType.Spearman, 36, 29, town(TownState.Governed)), CANNON.damage, "outside the town's radius");
  });
}));

test("atHome follows the main city: 8 cells from its footprint, not 9", () => {
  const g = emptyGame();
  const near = put(g, 0, UnitType.Spearman, 25, 78);
  const far = put(g, 0, UnitType.Spearman, 26, 78);
  assert.equal(atHome(g.w, slotOf(g, near)), true);
  assert.equal(atHome(g.w, slotOf(g, far)), false);
  assert.equal(atHome(g.w, slotOf(g, put(g, 1, UnitType.Spearman, 22, 78))), false, "not the other player's home");
});

test("mirror images: each side's soldiers shelled at home lose the same, tick by tick", switchedOff([DODGE, AVENGE], () => {
  withHome(true, () => {
    const g = emptyGame();
    const pairs: [number, number][] = [];
    const add = (owner: number, type: UnitType, x: number, y: number) => {
      const a = put(g, owner, type, x, y);
      const b = put(g, 1 - owner, type, y, x);
      pairs.push([a, b]);
      return [a, b];
    };
    for (let k = 0; k < 3; k++) add(0, UnitType.Spearman, 21 + k, 78);
    const [m1, m0] = add(1, UnitType.Mage, 22, 72);
    g.w.res[Resource.Crystal] = 100;
    g.w.res[4 + Resource.Crystal] = 100;
    g.w.ecoOn[0] = 0;
    g.w.ecoOn[1] = 0;
    g.fog.update(g.w);
    cmd(g, 1, { c: "cast", u: m1, fx: centre(22), fy: centre(78) });
    cmd(g, 0, { c: "cast", u: m0, fx: centre(78), fy: centre(22) });
    const u = g.w.units.col;
    let landed = -1;
    for (let t = 0; t < 60; t++) {
      g.step();
      // The middle spearman as the shot lands (afterwards they fight the mage).
      if (landed < 0 && g.w.cannonShots[1] === 1) landed = u.hp[slotOf(g, pairs[1][0])];
      for (const [a, b] of pairs) {
        const sa = slotOf(g, a);
        const sb = slotOf(g, b);
        assert.equal(sa < 0, sb < 0);
        if (sa < 0) continue;
        assert.equal(u.hp[sa], u.hp[sb], `tick ${g.tick}: hp`);
        assert.equal(u.x[sb], u.y[sa], `tick ${g.tick}`);
        assert.equal(u.y[sb], u.x[sa], `tick ${g.tick}`);
      }
    }
    assert.equal(landed, 100 - REDUCED, "the middle spearman lost a fifth less");
  });
}));
