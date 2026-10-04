// The rules against mages of the early balance round (D-051, D-057; from #91, round 4): a
// retreat at each unit's own speed, a casting mage showing itself with idle soldiers hitting
// back, and ranged x3 against a mage's shield. Each has a switch in core/rules.ts.

import assert from "node:assert/strict";
import { test } from "node:test";
import { RETREAT_OWN_SPEED } from "../src/core/rules.ts";
import { UnitType } from "../src/protocol.ts";
import { cmd, emptyGame, openArea, put, run, slotOf } from "./helpers.ts";

/** A block 8 x 18 open on player 0's side of the diagonal whose mirror image is open too. */
function mirrorBlock(g: ReturnType<typeof emptyGame>): { bx: number; by: number } {
  const w = g.w;
  for (let y = 40; y < 78; y++) {
    for (let x = 2; x < 30; x++) {
      if (x + 8 > y) continue;
      let ok = true;
      for (let yy = y; yy < y + 18 && ok; yy++) for (let xx = x; xx < x + 8 && ok; xx++) if (!w.walkable(xx, yy) || !w.walkable(yy, xx)) ok = false;
      if (ok) return { bx: x, by: y };
    }
  }
  throw new Error("no open block");
}

/** How far (cells) 4 spearmen and 2 mages, told together to retreat 20 cells, each got in 200 ticks: spearmen, mages (means). */
function retreatGap(ownSpeed: boolean): { spear: number; mage: number; caps: number[] } {
  const saved = RETREAT_OWN_SPEED.on;
  RETREAT_OWN_SPEED.on = ownSpeed;
  try {
    const g = emptyGame();
    const a = openArea(g, 30);
    const u = g.w.units.col;
    const ids = [0, 1, 2, 3].map((k) => put(g, 0, UnitType.Spearman, a.x + 4 + k, a.y + 3));
    ids.push(put(g, 0, UnitType.Mage, a.x + 5, a.y + 2), put(g, 0, UnitType.Mage, a.x + 6, a.y + 2));
    g.fog.update(g.w);
    const y0 = ids.map((id) => u.y[slotOf(g, id)]);
    cmd(g, 0, { c: "retreat", u: ids, x: a.x + 5, y: a.y + 24 });
    run(g, 1);
    const caps = ids.map((id) => u.speedCap[slotOf(g, id)]);
    run(g, 199);
    const went = ids.map((id, k) => (u.y[slotOf(g, id)] - y0[k]) / 1024);
    const mean = (v: number[]) => v.reduce((p, x) => p + x, 0) / v.length;
    return { spear: mean(went.slice(0, 4)), mage: mean(went.slice(4)), caps };
  } finally {
    RETREAT_OWN_SPEED.on = saved;
  }
}

test("a retreat lets each run at its own speed: the fast do not wait for the slow; switched off, together", () => {
  const own = retreatGap(true);
  assert.deepEqual(own.caps, [0, 0, 0, 0, 0, 0], "no speed cap");
  assert.ok(own.spear - own.mage >= 0.6, `spearmen ${own.spear.toFixed(2)} cells, mages ${own.mage.toFixed(2)}`);
  const capped = retreatGap(false);
  assert.ok(Math.abs(capped.spear - capped.mage) < 0.2, `switched off: together (${capped.spear.toFixed(2)} and ${capped.mage.toFixed(2)})`);
});

test("retreat: mirror-image groups of mixed speed run as mirror images, tick by tick", () => {
  const g = emptyGame();
  const w = g.w;
  const { bx, by } = mirrorBlock(g);
  const u = w.units.col;
  const pairs: [number, number][] = [];
  const mine: [number[], number[]] = [[], []];
  for (const [type, x, y] of [[UnitType.Spearman, bx + 2, by + 2], [UnitType.Spearman, bx + 3, by + 2], [UnitType.Ranged, bx + 2, by + 3], [UnitType.Mage, bx + 3, by + 3]] as const) {
    const a = put(g, 0, type, x, y);
    const b = put(g, 1, type, y, x);
    pairs.push([a, b]);
    mine[0].push(a);
    mine[1].push(b);
  }
  g.fog.update(w);
  cmd(g, 0, { c: "retreat", u: mine[0], x: bx + 4, y: by + 16 });
  cmd(g, 1, { c: "retreat", u: mine[1], x: by + 16, y: bx + 4 });
  for (let t = 0; t < 300; t++) {
    g.step();
    for (const [a, b] of pairs) {
      const sa = slotOf(g, a);
      const sb = slotOf(g, b);
      assert.equal(u.x[sb], u.y[sa], `tick ${g.tick}: x of the image is y of the original`);
      assert.equal(u.y[sb], u.x[sa], `tick ${g.tick}`);
    }
  }
  assert.ok(mine[0].every((id) => u.speedCap[slotOf(g, id)] === 0), "each at its own speed");
});
