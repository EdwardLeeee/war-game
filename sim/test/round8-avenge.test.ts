// Round 8 rule 2 (D-069; core/rules.ts AVENGE): a soldier with no order that a cannon shot hits,
// on hold stance or in a squad too, goes for the mage while it sees it within AVENGE.reach of its
// place, then goes back; units with an order keep to it; mirror-image shots play as mirror images.

import assert from "node:assert/strict";
import { test } from "node:test";
import { AVENGE, CANNON, DODGE } from "../src/core/rules.ts";
import { CELL_SHIFT, Order, Resource, Stance, UnitType } from "../src/protocol.ts";
import { cmd, emptyGame, put, run, slotOf, switchedOff } from "./helpers.ts";

const centre = (c: number) => (c << CELL_SHIFT) + 512;
type G = ReturnType<typeof emptyGame>;

/** Player 1's mage 7 cells north of (31, 44) fires there, at player 0's spearman (placed at (31, y)); `setup` gives the spearman its stance or orders first. */
function shelled(setup: (g: G, unit: number) => void, y = 44) {
  const g = emptyGame();
  const unit = put(g, 0, UnitType.Spearman, 31, y);
  const mage = put(g, 1, UnitType.Mage, 31, 37);
  g.w.res[4 + Resource.Crystal] = 100;
  g.w.ecoOn[0] = 0;
  g.fog.update(g.w);
  setup(g, unit);
  run(g, 1);
  cmd(g, 1, { c: "cast", u: mage, fx: centre(31), fy: centre(44) });
  run(g, CANNON.calibrateTicks + 2);
  assert.equal(g.w.cannonHits[1], 1, "the shot hit it");
  return { g, unit, mage };
}

const pos = (g: G, id: number) => [g.w.units.col.x[slotOf(g, id)], g.w.units.col.y[slotOf(g, id)]];
const dist = (g: G, a: number, b: number) => {
  const [ax, ay] = pos(g, a);
  const [bx, by] = pos(g, b);
  return Math.hypot(ax - bx, ay - by) / 1024;
};

function withAvenge<T>(on: boolean, f: () => T): T {
  const was = AVENGE.on;
  AVENGE.on = on;
  try {
    return f();
  } finally {
    AVENGE.on = was;
  }
}

test("a spearman on hold stance that the cannon hit goes for the mage; with the switch off it stays", switchedOff(DODGE, () => {
  for (const on of [true, false]) {
    withAvenge(on, () => {
      const { g, unit, mage } = shelled((g, unit) => cmd(g, 0, { c: "stance", u: [unit], stance: Stance.Hold }));
      run(g, 100);
      if (on) {
        assert.equal(g.w.units.col.target[slotOf(g, unit)], mage);
        assert.ok(dist(g, unit, mage) < 3, `it went for the mage (${dist(g, unit, mage).toFixed(1)} cells off)`);
      } else {
        assert.deepEqual(pos(g, unit), [centre(31), centre(44)], "hold: it stays");
      }
    });
  }
}));

test("a squad's soldier goes for the mage; a unit on the move keeps to its move", switchedOff(DODGE, () => {
  withAvenge(true, () => {
    // A squad: it walked here with a move command (and stands, no order, at its place).
    const squad = shelled((g, unit) => cmd(g, 0, { c: "move", u: [unit], x: 31, y: 44 }));
    assert.ok(squad.g.w.units.col.squad[slotOf(squad.g, squad.unit)] > 0);
    run(squad.g, 100);
    assert.ok(dist(squad.g, squad.unit, squad.mage) < 3, "the squad's soldier went for the mage");
    // On the move, walking north through the blast: hit, it keeps to its move.
    const moving = shelled((g, unit) => cmd(g, 0, { c: "move", u: [unit], x: 31, y: 40 }), 46);
    const s = slotOf(moving.g, moving.unit);
    assert.equal(moving.g.w.units.col.avenge[s], -1);
    assert.equal(moving.g.w.units.col.order[s], Order.Move, "it kept to its move");
  });
}));

test("it gives up once the mage is more than AVENGE.reach from its place, and goes back", switchedOff(DODGE, () => {
  withAvenge(true, () => {
    const { g, unit, mage } = shelled((g, unit) => cmd(g, 0, { c: "stance", u: [unit], stance: Stance.Hold }));
    // The mage walks off north as soon as it has fired.
    cmd(g, 1, { c: "move", u: [mage], x: 31, y: 20 });
    run(g, 400);
    const u = g.w.units.col;
    assert.equal(u.avenge[slotOf(g, unit)], -1, "given up");
    assert.ok(Math.abs(u.x[slotOf(g, unit)] - centre(31)) + Math.abs(u.y[slotOf(g, unit)] - centre(44)) < 600, "back at its place");
    assert.ok(Math.hypot(u.x[slotOf(g, mage)] - centre(31), u.y[slotOf(g, mage)] - centre(44)) > AVENGE.reach, "the mage got away");
  });
}));

test("mirror images: two hold-stance blocks shelled by mirror-image mages play as mirror images, tick by tick", switchedOff(DODGE, () => {
  withAvenge(true, () => {
    const g = emptyGame();
    const pairs: [number, number][] = [];
    const add = (owner: number, type: UnitType, x: number, y: number) => {
      const a = put(g, owner, type, x, y);
      const b = put(g, 1 - owner, type, y, x);
      pairs.push([a, b]);
      return [a, b];
    };
    const block: number[][] = [];
    for (let k = 0; k < 4; k++) block.push(add(0, UnitType.Spearman, 30 + k, 44));
    const [m1, m0] = add(1, UnitType.Mage, 31, 37);
    g.w.res[Resource.Crystal] = 100;
    g.w.res[4 + Resource.Crystal] = 100;
    g.w.ecoOn[0] = 0;
    g.w.ecoOn[1] = 0;
    g.fog.update(g.w);
    cmd(g, 0, { c: "stance", u: block.map((b) => b[0]), stance: Stance.Hold });
    cmd(g, 1, { c: "stance", u: block.map((b) => b[1]), stance: Stance.Hold });
    cmd(g, 1, { c: "cast", u: m1, fx: centre(31), fy: centre(44) });
    cmd(g, 0, { c: "cast", u: m0, fx: centre(44), fy: centre(31) });
    const u = g.w.units.col;
    let went = false;
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
        if (u.type[sa] === UnitType.Spearman && u.y[sa] < centre(42)) went = true;
      }
    }
    assert.ok(went, "the hold-stance spearmen went for the mage");
  });
}));
