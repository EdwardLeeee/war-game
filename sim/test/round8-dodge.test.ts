// Round 8 rule 1 (D-069; core/rules.ts DODGE): soldiers with no order step out of an enemy
// cannon's warning they see, if they can get out before the shot lands, do not walk into one,
// and go back to their place afterwards; units on the move, and farmers (unless
// DODGE.farmers), do not; mirror-image dodges play as mirror images.

import assert from "node:assert/strict";
import { test } from "node:test";
import { AVENGE, CANNON, DODGE, UNITS } from "../src/core/rules.ts";
import { CELL_SHIFT, Resource, Stance, UnitType } from "../src/protocol.ts";
import { cmd, emptyGame, put, run, slotOf, switchedOff } from "./helpers.ts";

const centre = (c: number) => (c << CELL_SHIFT) + 512;
const SPEAR = UNITS[UnitType.Spearman].hp;

/**
 * Player 1's mage 6 cells north of (x, y) fires half a cell east of (x, y), where player 0's
 * `type` stands. (The very point a shot aims at is too far from the edge to leave in time: the
 * radius plus DODGE.margin is more than a soldier walks while the cannon calibrates.)
 */
function shotAt(type: UnitType, setup?: (g: ReturnType<typeof emptyGame>, unit: number) => void, x = 31, y = 44) {
  const g = emptyGame();
  const unit = put(g, 0, type, x, y);
  const mage = put(g, 1, UnitType.Mage, x, y - 6);
  g.w.res[4 + Resource.Crystal] = 100;
  g.w.ecoOn[0] = 0;
  g.fog.update(g.w);
  setup?.(g, unit);
  cmd(g, 1, { c: "cast", u: mage, fx: centre(x) + 512, fy: centre(y) });
  return { g, unit, mage };
}

function withDodge<T>(on: boolean, farmers: boolean, f: () => T): T {
  const was = { ...DODGE };
  DODGE.on = on;
  DODGE.farmers = farmers;
  try {
    return f();
  } finally {
    Object.assign(DODGE, was);
  }
}

const hp = (g: ReturnType<typeof emptyGame>, id: number) => (slotOf(g, id) < 0 ? 0 : g.w.units.col.hp[slotOf(g, id)]);

// Rule 2 (AVENGE) off: a hit spearman would go for the mage.
test("an idle spearman steps out of the warning, is not hit, and goes back to its place", switchedOff(AVENGE, () => {
  for (const on of [true, false]) {
    withDodge(on, false, () => {
      const { g, unit } = shotAt(UnitType.Spearman);
      // Just as the shot lands (the mage, 6 cells off, then comes to fight).
      run(g, CANNON.calibrateTicks + 1);
      assert.equal(g.w.cannonShots[1], 1, "the shot was fired");
      assert.equal(hp(g, unit), on ? SPEAR : SPEAR - CANNON.damage, on ? "out of the blast" : "switch off: hit");
      if (!on) return;
      run(g, 200);
      const s = slotOf(g, unit);
      const u = g.w.units.col;
      assert.ok(Math.abs(u.x[s] - centre(31)) + Math.abs(u.y[s] - centre(44)) < 600, "back at its place");
    });
  }
}));

test("hold stance steps out too; a unit on the move does not", () => {
  withDodge(true, false, () => {
    const held = shotAt(UnitType.Spearman, (g, unit) => cmd(g, 0, { c: "stance", u: [unit], stance: Stance.Hold }));
    run(held.g, CANNON.calibrateTicks + 5);
    assert.equal(hp(held.g, held.unit), SPEAR);
    // Half a cell west of the blast's centre, walking east through it: inside when it lands.
    const moving = shotAt(UnitType.Spearman, (g, unit) => cmd(g, 0, { c: "move", u: [unit], x: 40, y: 44 }));
    run(moving.g, CANNON.calibrateTicks + 5);
    assert.ok(hp(moving.g, moving.unit) < SPEAR, "a unit with an order keeps to it");
  });
});

test("too late to get out: it stays and is hit", () => {
  withDodge(true, false, () => {
    const { g, unit, mage } = shotAt(UnitType.Spearman);
    run(g, 1);
    // Three moves left: far short of the way out.
    g.w.units.col.castProgress[slotOf(g, mage)] = CANNON.calibrateTicks - 3;
    run(g, 10);
    assert.equal(hp(g, unit), SPEAR - CANNON.damage);
  });
});

test("a unit walking back to its place waits outside a warning until the shot has landed", () => {
  for (const on of [true, false]) {
    withDodge(on, false, () => {
      const { g, unit } = shotAt(UnitType.Spearman, (g, unit) => {
        // It stands 2.25 cells east of the blast's centre, its place half a cell west of it.
        const s = slotOf(g, unit);
        const u = g.w.units.col;
        u.x[s] = centre(31) + 512 + 2 * 1024 + 256;
        u.anchorX[s] = centre(31);
        u.anchorY[s] = centre(44);
      });
      const u = g.w.units.col;
      let nearest = Number.MAX_SAFE_INTEGER;
      for (let t = 0; t < CANNON.calibrateTicks + 2; t++) {
        g.step();
        const s = slotOf(g, unit);
        if (s >= 0) nearest = Math.min(nearest, Math.abs(u.x[s] - (centre(31) + 512)));
      }
      if (on) {
        assert.ok(nearest > CANNON.radius, `it stayed out of the blast (${nearest})`);
        assert.equal(hp(g, unit), SPEAR);
        run(g, 150);
        assert.ok(Math.abs(u.x[slotOf(g, unit)] - centre(31)) < 600, "then went back");
      } else {
        assert.equal(hp(g, unit), SPEAR - CANNON.damage, "switch off: it walked into the blast");
      }
    });
  }
});

test("farmers do not step out unless DODGE.farmers", () => {
  for (const farmers of [false, true]) {
    withDodge(true, farmers, () => {
      const { g, unit } = shotAt(UnitType.Farmer);
      run(g, CANNON.calibrateTicks + 5);
      assert.equal(slotOf(g, unit) >= 0, farmers, farmers ? "it got out" : "it stayed and the shot killed it");
    });
  }
});

test("mirror images: two sides stepping out of each other's shots play as mirror images, tick by tick", () => {
  withDodge(true, false, () => {
    const g = emptyGame();
    const pairs: [number, number][] = [];
    const add = (owner: number, type: UnitType, x: number, y: number) => {
      const a = put(g, owner, type, x, y);
      const b = put(g, 1 - owner, type, y, x);
      pairs.push([a, b]);
      return [a, b];
    };
    for (let k = 0; k < 4; k++) add(0, UnitType.Spearman, 30 + k, 44);
    add(0, UnitType.Ranged, 31, 45);
    const [m1, m0] = add(1, UnitType.Mage, 31, 38);
    g.w.res[Resource.Crystal] = 100;
    g.w.res[4 + Resource.Crystal] = 100;
    g.w.ecoOn[0] = 0;
    g.w.ecoOn[1] = 0;
    g.fog.update(g.w);
    cmd(g, 1, { c: "cast", u: m1, fx: centre(31) + 512, fy: centre(44) });
    cmd(g, 0, { c: "cast", u: m0, fx: centre(44), fy: centre(31) + 512 });
    const u = g.w.units.col;
    let moved = false;
    for (let t = 0; t < 200; t++) {
      g.step();
      for (const [a, b] of pairs) {
        const sa = slotOf(g, a);
        const sb = slotOf(g, b);
        assert.equal(sa < 0, sb < 0, `tick ${g.tick}: both alive or both gone`);
        if (sa < 0) continue;
        assert.equal(u.hp[sa], u.hp[sb], `tick ${g.tick}: hp`);
        assert.equal(u.x[sb], u.y[sa], `tick ${g.tick}`);
        assert.equal(u.y[sb], u.x[sa], `tick ${g.tick}`);
        if (u.x[sa] !== centre(30) && u.y[sa] !== centre(44)) moved = true;
      }
    }
    assert.ok(moved, "they stepped out");
    assert.equal(g.w.cannonShots[0] + g.w.cannonShots[1], 2);
    assert.equal(g.w.cannonHits[0] + g.w.cannonHits[1], 0, "nobody was in the blasts when they landed");
  });
});
