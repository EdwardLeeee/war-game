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

test("formation: mirror-image squads spread out and close up as mirror images, tick by tick", () => {
  const g = emptyGame();
  const w = g.w;
  // A 12 x 6 open block on player 0's side of the diagonal; its mirror image is open too.
  let bx = -1;
  let by = -1;
  for (let y = 50; y < 85 && bx < 0; y++) {
    for (let x = 4; x < 36 && bx < 0; x++) {
      let ok = true;
      for (let yy = y; yy < y + 6 && ok; yy++) for (let xx = x; xx < x + 12 && ok; xx++) if (!w.walkable(xx, yy) || !w.walkable(yy, xx)) ok = false;
      if (ok) {
        bx = x;
        by = y;
      }
    }
  }
  assert.ok(bx >= 0, "an open block");
  // A mixed squad (spearmen ahead of ranged: the heading comes from where they stand) and a
  // squad of spearmen only (it faces the enemy main city); each unit's image is made right
  // after it, so both sides number their units in the same order.
  const pairs: [number, number][] = [];
  const add = (type: UnitType, x: number, y: number) => pairs.push([put(g, 0, type, x, y), put(g, 1, type, y, x)]);
  for (let k = 0; k < 4; k++) add(UnitType.Spearman, bx + k, by + 3);
  for (let k = 0; k < 3; k++) add(UnitType.Ranged, bx + k, by + 1);
  for (let k = 0; k < 4; k++) add(UnitType.Spearman, bx + 8 + (k % 2), by + 1 + Math.trunc(k / 2));
  g.fog.update(w);
  const u = w.units.col;
  for (const loose of [true, false]) {
    cmd(g, 0, { c: "formation", u: pairs.map((p) => p[0]), loose });
    cmd(g, 1, { c: "formation", u: pairs.map((p) => p[1]), loose });
    let moved = 0;
    for (let t = 0; t < 200; t++) {
      g.step();
      for (const [a, b] of pairs) {
        const sa = slotOf(g, a);
        const sb = slotOf(g, b);
        assert.equal(u.x[sb], u.y[sa], `tick ${g.tick}: x of the image is y of the original`);
        assert.equal(u.y[sb], u.x[sa], `tick ${g.tick}`);
        if (u.order[sa] === Order.Move) moved++;
      }
    }
    assert.ok(moved > 0, `${loose ? "spread out" : "closed up"}: they really moved`);
  }
});

test("joining a fight: mirror-image squads join mirror-image fights, tick by tick", () => {
  const g = emptyGame();
  const w = g.w;
  // A 4 x 14 open column on player 0's side of the diagonal; its mirror image is open too.
  let bx = -1;
  let by = -1;
  for (let y = 40; y < 80 && bx < 0; y++) {
    for (let x = 4; x < 30 && bx < 0; x++) {
      let ok = true;
      for (let yy = y; yy < y + 14 && ok; yy++) for (let xx = x; xx < x + 4 && ok; xx++) if (!w.walkable(xx, yy) || !w.walkable(yy, xx)) ok = false;
      if (ok) {
        bx = x;
        by = y;
      }
    }
  }
  assert.ok(bx >= 0, "an open column");
  const u = w.units.col;
  const pairs: [number, number][] = [];
  const add = (owner: number, type: UnitType, x: number, y: number) => {
    const a = put(g, owner, type, x, y);
    const b = put(g, 1 - owner, type, y, x);
    pairs.push([a, b]);
    return [a, b];
  };
  // An enemy that stands and never hits back, a soldier 4 cells from it, two behind (7 and 11 cells).
  for (const id of add(1, UnitType.Spearman, bx + 1, by + 1)) {
    u.stance[slotOf(g, id)] = 1;
    u.cooldown[slotOf(g, id)] = 100000;
  }
  for (const dy of [5, 8, 12]) add(0, UnitType.Spearman, bx + 1, by + 1 + dy);
  g.fog.update(w);
  let joined = 0;
  for (let t = 0; t < 150; t++) {
    g.step();
    for (const [a, b] of pairs) {
      const sa = slotOf(g, a);
      const sb = slotOf(g, b);
      assert.equal(u.x[sb], u.y[sa], `tick ${g.tick}: x of the image is y of the original`);
      assert.equal(u.y[sb], u.x[sa], `tick ${g.tick}`);
    }
    if (u.target[slotOf(g, pairs[2][0])] >= 0) joined++;
  }
  assert.ok(joined > 0, "the soldier 7 cells away joined");
});
