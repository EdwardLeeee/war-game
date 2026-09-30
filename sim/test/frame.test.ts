// Symmetry frames (frame.ts) and mirror fairness: mirror-image situations play out as
// mirror images, ties included.

import assert from "node:assert/strict";
import test from "node:test";
import { IDENTITY, MIRROR_XY, fromCanon, rectFromCanon, rotation, stepOrder, toCanon, xIsCanonY } from "../src/frame.ts";
import { CELL_SHIFT, Order, UnitType } from "../src/protocol.ts";
import { nearestWalkable } from "../src/core/paths.ts";
import { cmd, emptyGame, put, slotOf } from "./helpers.ts";

test("frames: step orders, round trips, footprints", () => {
  assert.deepEqual(stepOrder(IDENTITY), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(stepOrder(MIRROR_XY), [2, 1, 0, 7, 6, 5, 4, 3], "E<->S, SW<->NE, W<->N");
  assert.equal(xIsCanonY(IDENTITY), false);
  assert.equal(xIsCanonY(MIRROR_XY), true);
  for (const f of [IDENTITY, MIRROR_XY, rotation(1, 96), rotation(2, 96), rotation(3, 96)]) {
    for (const [x, y] of [[0, 0], [5, 90], [95, 3], [40, 41]]) {
      const c = toCanon(f, x, y);
      assert.deepEqual(fromCanon(f, c.u, c.v), { x, y });
      assert.ok(c.u >= 0 && c.v >= 0 && c.u < 96 && c.v < 96);
    }
    assert.equal(new Set(stepOrder(f)).size, 8);
  }
  assert.deepEqual(rectFromCanon(MIRROR_XY, 10, 20, 3), { x: 20, y: 10 });
  // A quarter turn: canonical (u, v) is real (95 - v, u)... inverted, u 10..11, v 20..21 is x 20..21, y 84..85.
  assert.deepEqual(rectFromCanon(rotation(1, 96), 10, 20, 2), { x: 20, y: 84 });
});

test("a unit and its mirror image walk mirror-image paths, tick by tick", () => {
  const g = emptyGame();
  const w = g.w;
  const n = w.size;
  const at = (x: number, y: number) => {
    const c = nearestWalkable(w, x, y);
    return { x: c % n, y: Math.trunc(c / n) };
  };
  // Far apart on player 0's side of the diagonal, across forests and rock.
  const from = at(10, 60);
  const to = at(38, 90);
  const a = put(g, 0, UnitType.Spearman, from.x, from.y);
  const b = put(g, 1, UnitType.Spearman, from.y, from.x);
  cmd(g, 0, { c: "retreat", u: [a], x: to.x, y: to.y });
  cmd(g, 1, { c: "retreat", u: [b], x: to.y, y: to.x });
  const u = w.units.col;
  let moved = 0;
  for (let t = 0; t < 800; t++) {
    g.step();
    const sa = slotOf(g, a);
    const sb = slotOf(g, b);
    assert.equal(u.x[sb], u.y[sa], `tick ${g.tick}: x of the mirror is y of the original`);
    assert.equal(u.y[sb], u.x[sa], `tick ${g.tick}`);
    if (u.order[sa] === Order.Retreat) moved++;
  }
  assert.ok(moved > 100, "it really travelled");
  assert.ok(Math.abs((u.x[slotOf(g, a)] >> CELL_SHIFT) - to.x) <= 1, "and arrived");
});
