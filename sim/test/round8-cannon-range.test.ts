// Round 8 rule 3 (D-069; core/rules.ts SHORT_CANNON): the crystal cannon reaches 7 cells, not 8:
// a cast farther off is refused, autocast takes nothing farther; rules() says so; mirror-image
// mages on autocast play as mirror images.

import assert from "node:assert/strict";
import { test } from "node:test";
import { CANNON, DODGE, rules, SHORT_CANNON } from "../src/core/rules.ts";
import { CELL, CELL_SHIFT, Reject, Resource, UnitFlag, UnitType } from "../src/protocol.ts";
import { cmd, emptyGame, put, run, slotOf, switchedOff } from "./helpers.ts";

const centre = (c: number) => (c << CELL_SHIFT) + 512;

function withShort<T>(on: boolean, f: () => T): T {
  const was = SHORT_CANNON.on;
  SHORT_CANNON.on = on;
  try {
    return f();
  } finally {
    SHORT_CANNON.on = was;
  }
}

test("the cannon's range is 7 cells (8 with the switch off), in rules() too", () => {
  withShort(true, () => {
    assert.equal(CANNON.range, 7 * CELL);
    assert.equal(rules().cannonRange, 7 * CELL);
  });
  withShort(false, () => {
    assert.equal(CANNON.range, 8 * CELL);
    assert.equal(rules().cannonRange, 8 * CELL);
  });
});

test("a cast 7.5 cells off is refused (OutOfRange); 6.5 cells off it fires", () => {
  for (const on of [true, false]) {
    withShort(on, () => {
      const g = emptyGame();
      const mage = put(g, 0, UnitType.Mage, 31, 37);
      g.w.res[Resource.Crystal] = 100;
      g.fog.update(g.w);
      cmd(g, 0, { c: "cast", u: mage, fx: centre(31), fy: centre(37) + 7 * 1024 + 512 });
      run(g, 1);
      const refused = g.events.filter((e) => e.to === 0 && e.ev.k === "rejected").map((e) => (e.ev as { reason: number }).reason);
      assert.deepEqual(refused, on ? [Reject.OutOfRange] : [], on ? "7.5 cells: out of range" : "switch off: 8 cells reach");
      cmd(g, 0, { c: "stop", u: [mage] });
      run(g, 1);
      cmd(g, 0, { c: "cast", u: mage, fx: centre(31), fy: centre(37) + 6 * 1024 + 512 });
      run(g, CANNON.calibrateTicks + 2);
      assert.ok(g.w.cannonShots[0] >= 1, "6.5 cells: it fires");
    });
  }
});

test("mirror images: mages on autocast fire at a block 7 cells off, not at one 8 cells off, as mirror images", switchedOff(DODGE, () => {
  for (const far of [false, true]) {
    withShort(true, () => {
      const g = emptyGame();
      const pairs: [number, number][] = [];
      const add = (owner: number, type: UnitType, x: number, y: number) => {
        const a = put(g, owner, type, x, y);
        const b = put(g, 1 - owner, type, y, x);
        pairs.push([a, b]);
        return [a, b];
      };
      // A block of 3 x 2 spearmen, its near row 7 or 8 cells south of the mage.
      const row = far ? 45 : 44;
      for (let k = 0; k < 3; k++) for (let r = 0; r < 2; r++) add(0, UnitType.Spearman, 30 + k, row + r);
      const [m1, m0] = add(1, UnitType.Mage, 31, 37);
      for (const m of [m1, m0]) g.w.units.col.flags[slotOf(g, m)] |= UnitFlag.Autocast;
      g.w.res[Resource.Crystal] = 100;
      g.w.res[4 + Resource.Crystal] = 100;
      g.w.ecoOn[0] = 0;
      g.w.ecoOn[1] = 0;
      g.fog.update(g.w);
      const u = g.w.units.col;
      for (let t = 0; t < 60; t++) {
        g.step();
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
      assert.equal(g.w.cannonShots[0], g.w.cannonShots[1]);
      assert.equal(g.w.cannonShots[1] > 0, !far, far ? "8 cells: out of reach" : "7 cells: it fires");
    });
  }
}));
