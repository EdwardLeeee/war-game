// Statistics of the early balance round (D-057; from round 4): what last hurt a dying farmer,
// and towns lost to a revolt. They stay out of the hash: games play and hash as without them.

import assert from "node:assert/strict";
import { test } from "node:test";
import { NEUTRAL, Stance, UnitType } from "../src/protocol.ts";
import { HitCause } from "../src/core/world.ts";
import { cmd, emptyGame, openArea, put, run, slotOf } from "./helpers.ts";

test("a farmer's death is counted by what last hurt it: militia, an enemy soldier, a crystal cannon", () => {
  const g = emptyGame();
  const w = g.w;
  const a = openArea(g, 30);
  const u = w.units.col;
  w.ecoOn[0] = 0;
  // Three farmers far apart: one by a militia man, one by an enemy spearman, one under a mage's cannon.
  put(g, 0, UnitType.Farmer, a.x + 2, a.y + 2);
  put(g, NEUTRAL, UnitType.Militia, a.x + 3, a.y + 2);
  put(g, 0, UnitType.Farmer, a.x + 2, a.y + 14);
  put(g, 1, UnitType.Spearman, a.x + 3, a.y + 14);
  const target = put(g, 0, UnitType.Farmer, a.x + 26, a.y + 26);
  const mage = put(g, 1, UnitType.Mage, a.x + 26, a.y + 20);
  u.stance[slotOf(g, mage)] = Stance.Hold;
  w.res[1 * 4 + 3] = 100;
  g.fog.update(w);
  cmd(g, 1, { c: "cast", u: mage, fx: u.x[slotOf(g, target)], fy: u.y[slotOf(g, target)] });
  run(g, 300);
  assert.deepEqual(Array.from(w.farmerDeaths.subarray(0, 5)), [0, 1, 1, 1, 0], "none, militia, unit, cannon, arrow");
});

test("the statistics are not in the hash", () => {
  const g = emptyGame();
  const id = put(g, 0, UnitType.Spearman, 20, 60);
  const h = g.hash();
  g.w.units.col.hitCause[slotOf(g, id)] = HitCause.Cannon;
  g.w.farmerDeaths[3] = 7;
  g.w.revolts[1] = 2;
  assert.equal(g.hash(), h);
});
