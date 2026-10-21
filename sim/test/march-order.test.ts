// Ranks on the march (D-095; core/rules.ts MARCH_ORDER; the user: 「常常跑一跑法師就跑到前排」):
// on a move, ranged and mages ahead of their group's spearmen stand and let them pass; a group
// already in order walks as before; a retreat is left as it is; nobody waits longer than
// MARCH_ORDER.maxWait a command. The rule is off for now (ceo 2026-10-21: its marches arrive
// strung out, README); these tests switch it on.

import assert from "node:assert/strict";
import { test } from "node:test";
import { MARCH_ORDER } from "../src/core/rules.ts";
import { Order, UnitType } from "../src/protocol.ts";
import { cmd, emptyGame, openArea, put, run, slotOf, switchedOff, switchedOn } from "./helpers.ts";

type G = ReturnType<typeof emptyGame>;
const KIND: Record<number, string> = { [UnitType.Spearman]: "spear", [UnitType.Ranged]: "ranged", [UnitType.Mage]: "mage" };

/** Client's block (docs/research/2026-10-formation-march.md): 3 mages in the north row, 4 ranged, 8 spearmen; facing south. */
function block(): { g: G; ids: number[]; a: { x: number; y: number } } {
  const g = emptyGame();
  const a = openArea(g, 30);
  const ids: number[] = [];
  for (let k = 0; k < 3; k++) ids.push(put(g, 0, UnitType.Mage, a.x + 13 + k, a.y + 13));
  for (let k = 0; k < 4; k++) ids.push(put(g, 0, UnitType.Ranged, a.x + 13 + k, a.y + 14));
  for (let k = 0; k < 8; k++) ids.push(put(g, 0, UnitType.Spearman, a.x + 13 + (k % 4), a.y + 15 + Math.trunc(k / 4)));
  g.fog.update(g.w);
  return { g, ids, a };
}

/** Each kind's mean y (cells). */
function meanY(g: G, ids: number[]): Record<string, number> {
  const u = g.w.units.col;
  const sum: Record<string, number[]> = {};
  for (const id of ids) (sum[KIND[u.type[slotOf(g, id)]]] ??= []).push(u.y[slotOf(g, id)] / 1024);
  return Object.fromEntries(Object.entries(sum).map(([k, v]) => [k, v.reduce((p, q) => p + q, 0) / v.length]));
}

/**
 * The block told (`order`) to go 10 cells north, back past its mages: ticks with the mages' mean
 * ahead (north) of the spearmen's, ticks until all stood, and every unit's position each tick.
 */
function turnBack(order: "move" | "retreat") {
  const { g, ids, a } = block();
  cmd(g, 0, { c: order, u: ids, x: a.x + 14, y: a.y + 3 });
  const u = g.w.units.col;
  let magesAhead = 0;
  let stood = -1;
  const track: number[][] = [];
  for (let t = 1; t <= 60 * 20 && stood < 0; t++) {
    run(g, 1);
    const m = meanY(g, ids);
    if (m.mage < m.spear) magesAhead++;
    track.push(ids.flatMap((id) => [u.x[slotOf(g, id)], u.y[slotOf(g, id)]]));
    if (ids.every((id) => u.order[slotOf(g, id)] === Order.None)) stood = t;
  }
  return { g, ids, magesAhead, stood, track, last: meanY(g, ids) };
}

test("turned back on a move, the spearmen pass the ranged and mages within a few seconds and it takes about as long", switchedOn(MARCH_ORDER, () => {
  const on = turnBack("move");
  let before = { magesAhead: 0, stood: 0 };
  switchedOff(MARCH_ORDER, () => {
    before = turnBack("move");
  })();
  assert.ok(before.magesAhead > 8 * 20, `before: mages ahead ${before.magesAhead / 20} s`);
  assert.ok(on.magesAhead < 0.5 * before.magesAhead && on.magesAhead < 5 * 20, `mages ahead ${on.magesAhead / 20} s (before ${before.magesAhead / 20} s)`);
  assert.ok(on.stood > 0 && on.stood <= before.stood + 3 * 20, `all stood after ${on.stood / 20} s (before ${before.stood / 20} s)`);
  // North is smaller y: spearmen, then ranged, then mages.
  assert.ok(on.last.spear < on.last.ranged && on.last.ranged < on.last.mage, JSON.stringify(on.last));
  const u = on.g.w.units.col;
  assert.ok(on.ids.every((id) => u.waited[slotOf(on.g, id)] <= MARCH_ORDER.maxWait));
}));

test("a retreat is left as it is: the same, tick by tick, with the rule on and off", switchedOn(MARCH_ORDER, () => {
  const on = turnBack("retreat");
  let off = on;
  switchedOff(MARCH_ORDER, () => {
    off = turnBack("retreat");
  })();
  assert.equal(on.stood, off.stood);
  assert.deepEqual(on.track, off.track);
}));

test("a move with the spearmen already in front walks as before, tick by tick", switchedOn(MARCH_ORDER, () => {
  const walk = () => {
    const { g, ids, a } = block();
    cmd(g, 0, { c: "move", u: ids, x: a.x + 14, y: a.y + 27 });
    const u = g.w.units.col;
    const track: number[][] = [];
    for (let t = 0; t < 20 * 20; t++) {
      run(g, 1);
      track.push(ids.flatMap((id) => [u.x[slotOf(g, id)], u.y[slotOf(g, id)]]));
    }
    return track;
  };
  const on = walk();
  let off: number[][] = [];
  switchedOff(MARCH_ORDER, () => {
    off = walk();
  })();
  assert.deepEqual(on, off);
}));

test("nobody waits longer than MARCH_ORDER.maxWait: a mixed crowd of 40 gets there", switchedOn(MARCH_ORDER, () => {
  const g = emptyGame();
  const a = openArea(g, 30);
  const ids: number[] = [];
  const kinds = [UnitType.Spearman, UnitType.Ranged, UnitType.Spearman, UnitType.Ranged, UnitType.Mage];
  for (let k = 0; k < 40; k++) ids.push(put(g, 0, kinds[k % 5], a.x + 1 + (k % 5), a.y + 11 + Math.trunc(k / 5)));
  g.fog.update(g.w);
  const u = g.w.units.col;
  let most = 0;
  for (const to of [a.x + 27, a.x + 2]) {
    cmd(g, 0, { c: "move", u: ids, x: to, y: a.y + 14 });
    run(g, 1);
    for (let t = 0; t < 60 * 20 && !ids.every((id) => u.order[slotOf(g, id)] === Order.None); t++) {
      run(g, 1);
      for (const id of ids) most = Math.max(most, u.waited[slotOf(g, id)]);
    }
    assert.ok(ids.every((id) => u.order[slotOf(g, id)] === Order.None), "all got there");
  }
  assert.ok(most > 0 && most <= MARCH_ORDER.maxWait, `waited at most ${most} ticks`);
}));

test("switched off: the unit column it keeps (waited) stays out of the hash", switchedOff(MARCH_ORDER, () => {
  const g = emptyGame();
  const id = put(g, 0, UnitType.Ranged, 20, 60);
  const h = g.hash();
  g.w.units.col.waited[slotOf(g, id)] = 5;
  assert.equal(g.hash(), h);
}));
