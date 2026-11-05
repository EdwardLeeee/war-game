// Ranks on the march (D-095, D-119; core/rules.ts MARCH_ORDER; the user 2026-11-04: 「整隊功能你沒做好，
// 我按整隊的時候部隊還是要往我點的地方前進，具體作法應該是說法師跟射手如果在前面就要停下來等槍兵走過來」): a group
// on its way re-formed with `formation` `ranks` keeps its goal and gets its ranks right on the way;
// without `ranks` moves and retreats walk as ever.

import assert from "node:assert/strict";
import { test } from "node:test";
import { dir16 } from "../src/core/fixed.ts";
import { MARCH_ORDER } from "../src/core/rules.ts";
import { Order, UnitType } from "../src/protocol.ts";
import { cmd, emptyGame, openArea, put, run, slotOf, switchedOff } from "./helpers.ts";

type G = ReturnType<typeof emptyGame>;
const S = 20;
const KIND: Record<number, string> = { [UnitType.Spearman]: "spear", [UnitType.Ranged]: "ranged", [UnitType.Mage]: "mage" };
const NORTH = dir16(0, -1024);

/** Client's block (docs/research/2026-10-formation-march.md): 3 mages in the north row, 4 ranged, 8 spearmen; facing south. */
function block(): { g: G; ids: number[]; a: { x: number; y: number } } {
  const g = emptyGame();
  const a = openArea(g, 30);
  const ids: number[] = [];
  for (let k = 0; k < 3; k++) ids.push(put(g, 0, UnitType.Mage, a.x + 13 + k, a.y + 27));
  for (let k = 0; k < 4; k++) ids.push(put(g, 0, UnitType.Ranged, a.x + 13 + k, a.y + 28));
  for (let k = 0; k < 8; k++) ids.push(put(g, 0, UnitType.Spearman, a.x + 13 + (k % 4), a.y + 29 + Math.trunc(k / 4)));
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
 * The block told (`order`) to go 24 cells north, back past its mages (the research's table 1), and
 * re-formed after `at` ticks (-1 never), with `ranks` or not: from then, the ticks until the
 * spearmen's mean is in front of the ranged's and theirs in front of the mages' for good, the ticks
 * until all stood, whether the goal was kept and reached, and every position each tick.
 */
function turnBack(order: "move" | "retreat", at: number, ranks = true) {
  const { g, ids, a } = block();
  cmd(g, 0, { c: order, u: ids, x: a.x + 14, y: a.y + 4 });
  run(g, 1);
  const u = g.w.units.col;
  const goal = u.orderTarget[slotOf(g, ids[0])];
  let inOrder = -1;
  let stood = -1;
  let most = 0;
  const track: number[][] = [];
  for (let t = 1; t <= 90 * S && stood < 0; t++) {
    if (t === at) cmd(g, 0, { c: "formation", u: ids, loose: false, face: NORTH, ...(ranks ? { ranks: true } : {}) });
    run(g, 1);
    const m = meanY(g, ids);
    const ok = m.spear < m.ranged && m.ranged < m.mage;
    if (!ok) inOrder = -1;
    else if (inOrder < 0) inOrder = t;
    for (const id of ids) most = Math.max(most, u.waited[slotOf(g, id)]);
    track.push(ids.flatMap((id) => [u.x[slotOf(g, id)], u.y[slotOf(g, id)]]));
    if (t > at && ids.every((id) => u.order[slotOf(g, id)] === Order.None)) stood = t;
  }
  const kept = ids.every((id) => u.order[slotOf(g, id)] === Order.None || u.orderTarget[slotOf(g, id)] === goal);
  const there = ids.every((id) => Math.abs((u.y[slotOf(g, id)] >> 10) - (a.y + 4)) <= 4);
  return { g, ids, inOrder: inOrder < 0 ? -1 : inOrder - Math.max(at, 0), stood, kept, there, most, track, last: meanY(g, ids) };
}

for (const order of ["move", "retreat"] as const) {
  test(`${order}, turned back, 整隊 with ranks after 1 s: spearmen in front, mages last within 8 s, at the same goal and about as soon`, () => {
    const on = turnBack(order, 1 * S);
    const none = turnBack(order, -1);
    assert.ok(on.inOrder > 0 && on.inOrder <= 8 * S, `in order ${on.inOrder / S} s after 整隊`);
    assert.ok(on.kept && on.there, "the same goal, and there");
    assert.ok(on.stood > 0 && on.stood <= none.stood + 8 * S, `all stood after ${on.stood / S} s (without 整隊 ${none.stood / S} s)`);
    // North is smaller y: spearmen, then ranged, then mages.
    assert.ok(on.last.spear < on.last.ranged && on.last.ranged < on.last.mage, JSON.stringify(on.last));
    assert.ok(on.most > 0 && on.most <= MARCH_ORDER.maxWait, `waited at most ${on.most} ticks`);
  });
}

test("formation without ranks, and moves and retreats without it: as before, tick by tick (rule on and off)", () => {
  for (const order of ["move", "retreat"] as const) {
    const on = turnBack(order, 1 * S, false);
    let off = on;
    switchedOff(MARCH_ORDER, () => {
      off = turnBack(order, 1 * S, false);
    })();
    assert.deepEqual(on.track, off.track, order);
    assert.equal(on.most, 0, "nobody waited");
  }
});

test("soldiers far behind in the group hold nobody up: three spearmen 20 cells back", () => {
  const { g, ids, a } = block();
  for (let k = 0; k < 3; k++) ids.push(put(g, 0, UnitType.Spearman, a.x + 3 + k, a.y + 29));
  g.fog.update(g.w);
  const u = g.w.units.col;
  cmd(g, 0, { c: "retreat", u: ids, x: a.x + 14, y: a.y + 4 });
  run(g, S);
  cmd(g, 0, { c: "formation", u: ids, loose: false, face: NORTH, ranks: true });
  let most = 0;
  for (let t = 0; t < 40 * S; t++) {
    run(g, 1);
    for (const id of ids.slice(0, 7)) most = Math.max(most, u.waited[slotOf(g, id)]);
  }
  assert.ok(most < 7 * S, `the ranged and mages waited at most ${most / S} s`);
});

test("a new command ends it: a move after the 整隊 walks as ever", () => {
  const { g, ids, a } = block();
  const u = g.w.units.col;
  cmd(g, 0, { c: "move", u: ids, x: a.x + 14, y: a.y + 4 });
  run(g, S);
  cmd(g, 0, { c: "formation", u: ids, loose: false, face: NORTH, ranks: true });
  run(g, 1);
  assert.ok(ids.some((id) => u.ranked[slotOf(g, id)] !== 0));
  cmd(g, 0, { c: "move", u: ids, x: a.x + 14, y: a.y + 2 });
  run(g, 1);
  run(g, 10 * S);
  assert.ok(
    ids.every((id) => u.waited[slotOf(g, id)] === 0),
    "nobody waits",
  );
});

test("nobody waits longer than MARCH_ORDER.maxWait: a mixed crowd of 40 gets there", () => {
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
    run(g, S);
    cmd(g, 0, { c: "formation", u: ids, loose: false, face: dir16(to > a.x + 14 ? 1024 : -1024, 0), ranks: true });
    for (let t = 0; t < 60 * S && !ids.every((id) => u.order[slotOf(g, id)] === Order.None); t++) {
      run(g, 1);
      for (const id of ids) most = Math.max(most, u.waited[slotOf(g, id)]);
    }
    assert.ok(ids.every((id) => u.order[slotOf(g, id)] === Order.None), "all got there");
  }
  assert.ok(most > 0 && most <= MARCH_ORDER.maxWait, `waited at most ${most} ticks`);
});

test("`ranks` not a boolean: rejected", () => {
  const { g, ids } = block();
  cmd(g, 0, { c: "formation", u: ids, loose: false, ranks: 1 });
  run(g, 1);
  assert.ok(g.events.some((e) => e.ev.k === "rejected"));
});

test("switched off: ranks does nothing and the unit columns it keeps (waited, ranked) stay out of the hash", switchedOff(MARCH_ORDER, () => {
  const on = turnBack("move", 1 * S);
  assert.equal(on.most, 0);
  const g = emptyGame();
  const id = put(g, 0, UnitType.Ranged, 20, 60);
  const h = g.hash();
  g.w.units.col.waited[slotOf(g, id)] = 5;
  g.w.units.col.ranked[slotOf(g, id)] = 3;
  assert.equal(g.hash(), h);
}));
