// Cavalry go for the back row (D-097 (c), CAV_FLANK): choosing their own target they ride round
// the enemy melee for mages, then ranged units; orders, hold stance and retreats are left alone.

import assert from "node:assert/strict";
import { test } from "node:test";
import type { Game } from "../src/core/game.ts";
import { CAV_FLANK, rules, UNITS } from "../src/core/rules.ts";
import { BuildingType, CELL_SHIFT, Order, Stance, UnitFlag, UnitType } from "../src/protocol.ts";
import { cmd, emptyGame, put, run, slotOf, switchedOff } from "./helpers.ts";

/** A 16 x 14 open block below the diagonal whose mirror image (x and y swapped) is open too, its corner 24 cells or more from it. */
function mirrorBlock(g: Game): { bx: number; by: number } {
  const w = g.w;
  for (let y = 0; y + 14 < w.size; y++) {
    for (let x = 0; x + 24 <= y; x++) {
      let ok = true;
      for (let yy = y; yy < y + 14 && ok; yy++) for (let xx = x; xx < x + 16 && ok; xx++) if (!w.walkable(xx, yy) || !w.walkable(yy, xx)) ok = false;
      if (ok) return { bx: x, by: y };
    }
  }
  throw new Error("no open block");
}

/**
 * Player `me`'s cavalry stands 6 cells from an enemy mage (within its sight) with three enemy
 * spearmen in a line between them, 3 cells from the cavalry (all on hold, the mage without
 * autocast); mirrored: x and y swapped. Returns the ids.
 */
function scene(g: Game, bx: number, by: number, me: number, mirror: boolean) {
  const at = (x: number, y: number) => (mirror ? [by + y, bx + x] : [bx + x, by + y]) as [number, number];
  const u = g.w.units.col;
  const hold = (id: number) => {
    u.stance[slotOf(g, id)] = Stance.Hold;
    return id;
  };
  const mage = hold(put(g, 1 - me, UnitType.Mage, ...at(8, 4)));
  u.flags[slotOf(g, mage)] &= ~UnitFlag.Autocast;
  const spears = [7, 8, 9].map((x) => hold(put(g, 1 - me, UnitType.Spearman, ...at(x, 7))));
  const cav = put(g, me, UnitType.Cavalry, ...at(8, 10));
  return { mage, spears, cav };
}

const cellDist = (g: Game, a: number, b: number) => {
  const u = g.w.units.col;
  const sa = slotOf(g, a);
  const sb = slotOf(g, b);
  return Math.hypot(u.x[sa] - u.x[sb], u.y[sa] - u.y[sb]) / 1024;
};

test("idle cavalry rides round the spearmen for the mage behind them; switched off, it takes the nearest spearman", () => {
  const g = emptyGame();
  const { bx, by } = mirrorBlock(g);
  const s = scene(g, bx, by, 0, false);
  g.fog.update(g.w);
  const u = g.w.units.col;
  let round = false;
  let closest = 99;
  let hit = false;
  for (let t = 0; t < 300 && !hit; t++) {
    g.step();
    const c = slotOf(g, s.cav);
    if (u.flankX[c] >= 0) round = true;
    if (t >= 20) assert.equal(u.target[c], s.mage, `tick ${g.tick}: for the mage`);
    for (const sp of s.spears) closest = Math.min(closest, cellDist(g, s.cav, sp));
    hit = slotOf(g, s.mage) < 0 || u.hp[slotOf(g, s.mage)] + u.shield[slotOf(g, s.mage)] < UNITS[UnitType.Mage].hp + UNITS[UnitType.Mage].shield;
  }
  assert.ok(round, "it headed for a point beside the spearmen");
  assert.ok(hit, "it reached the mage");
  assert.ok(closest > 1.2, `never within reach of a spearman: ${closest.toFixed(2)} cells`);
  switchedOff(CAV_FLANK, () => {
    const h = emptyGame();
    const b = mirrorBlock(h);
    const o = scene(h, b.bx, b.by, 0, false);
    h.fog.update(h.w);
    run(h, 30);
    assert.ok(o.spears.includes(h.w.units.col.target[slotOf(h, o.cav)]), "off: a spearman");
  })();
});

test("mirror images: the mirrored scene rides round the mirrored side, tick by tick", () => {
  const g = emptyGame();
  const { bx, by } = mirrorBlock(g);
  const a = scene(g, bx, by, 0, false);
  const b = scene(g, bx, by, 1, true);
  g.fog.update(g.w);
  const u = g.w.units.col;
  let side = 0;
  for (let t = 0; t < 300; t++) {
    g.step();
    const sa = slotOf(g, a.cav);
    const sb = slotOf(g, b.cav);
    assert.equal(sa < 0, sb < 0, `tick ${g.tick}: both alive or both gone`);
    if (sa < 0) break;
    assert.deepEqual([u.x[sb], u.y[sb], u.hp[sb]], [u.y[sa], u.x[sa], u.hp[sa]], `tick ${g.tick}`);
    assert.equal(u.flankSide[sb] + u.flankSide[sa], 0, `tick ${g.tick}: the mirrored side`);
    assert.deepEqual([u.flankX[sb], u.flankY[sb]], u.flankX[sa] < 0 ? [-1, -1] : [u.flankY[sa], u.flankX[sa]], `tick ${g.tick}: the mirrored point`);
    if (u.flankSide[sa] !== 0) side = u.flankSide[sa];
  }
  assert.notEqual(side, 0, "it chose a side");
});

test("orders win: an attack on a spearman, hold stance and a retreat never go for the mage", () => {
  for (const way of ["attack", "hold", "retreat"] as const) {
    const g = emptyGame();
    const { bx, by } = mirrorBlock(g);
    const s = scene(g, bx, by, 0, false);
    const u = g.w.units.col;
    if (way === "hold") u.stance[slotOf(g, s.cav)] = Stance.Hold;
    g.fog.update(g.w);
    if (way === "attack") cmd(g, 0, { c: "attack", u: [s.cav], target: s.spears[0] });
    // A retreat past the spearmen and the mage, to the far side.
    if (way === "retreat") cmd(g, 0, { c: "retreat", u: [s.cav], x: bx + 8, y: by + 1 });
    for (let t = 0; t < 200 && slotOf(g, s.cav) >= 0; t++) {
      g.step();
      const c = slotOf(g, s.cav);
      if (c < 0 || (way === "retreat" && u.order[c] !== Order.Retreat)) break;
      assert.notEqual(u.target[c], s.mage, `${way}, tick ${g.tick}`);
      assert.equal(u.flank[c], -1, `${way}, tick ${g.tick}: no dive`);
    }
  }
});

test("a move with cavalry: the cavalry dive for the mage they pass, then the whole group arrives", () => {
  const g = emptyGame();
  const w = g.w;
  const { bx, by } = mirrorBlock(g);
  const u = w.units.col;
  const mage = put(g, 1, UnitType.Mage, bx + 8, by + 2);
  u.stance[slotOf(g, mage)] = Stance.Hold;
  u.flags[slotOf(g, mage)] &= ~UnitFlag.Autocast;
  for (const x of [7, 9]) {
    const sp = put(g, 1, UnitType.Spearman, bx + x, by + 4);
    u.stance[slotOf(g, sp)] = Stance.Hold;
  }
  const group: number[] = [];
  for (let k = 0; k < 4; k++) group.push(put(g, 0, UnitType.Spearman, bx + 1, by + 7 + k));
  const cav = [put(g, 0, UnitType.Cavalry, bx + 2, by + 8), put(g, 0, UnitType.Cavalry, bx + 2, by + 9)];
  group.push(...cav);
  g.fog.update(w);
  cmd(g, 0, { c: "move", u: group, x: bx + 14, y: by + 9 });
  let dived = false;
  for (let t = 0; t < 1200; t++) {
    g.step();
    for (const c of cav) if (slotOf(g, c) >= 0 && u.target[slotOf(g, c)] === mage) dived = true;
  }
  assert.ok(dived, "the cavalry went for the mage");
  assert.ok(slotOf(g, mage) < 0, "the mage fell");
  for (const id of group) {
    const s = slotOf(g, id);
    if (s < 0) continue;
    assert.equal(u.order[s], Order.None, `unit ${id} arrived`);
    const d = Math.hypot((u.x[s] >> CELL_SHIFT) - (bx + 14), (u.y[s] >> CELL_SHIFT) - (by + 9));
    assert.ok(d <= 3, `unit ${id} ${d.toFixed(1)} cells from the goal`);
  }
});

test("no dive under known enemy arrows: a mage beside an arrow tower is left alone", () => {
  const g = emptyGame();
  const w = g.w;
  const { bx, by } = mirrorBlock(g);
  const s = scene(g, bx, by, 0, false);
  w.addBuilding(1, BuildingType.ArrowTower, bx + 10, by + 1, 100000, 1000);
  // A watcher of player 0's, so the tower is known.
  const eye = put(g, 0, UnitType.Spearman, bx + 13, by + 4);
  w.units.col.stance[slotOf(g, eye)] = Stance.Hold;
  w.units.col.hp[slotOf(g, eye)] = 100000;
  g.fog.update(w);
  for (let t = 0; t < 100; t++) {
    g.step();
    const c = slotOf(g, s.cav);
    if (c < 0) break;
    assert.notEqual(w.units.col.target[c], s.mage, `tick ${g.tick}`);
  }
});

test("a dive with no hit for 8 s gives up: the nearest enemy instead, and no dive for 5 s", () => {
  const g = emptyGame();
  const { bx, by } = mirrorBlock(g);
  const s = scene(g, bx, by, 0, false);
  g.fog.update(g.w);
  const u = g.w.units.col;
  run(g, 20);
  const c = slotOf(g, s.cav);
  assert.equal(u.flank[c], s.mage, "diving");
  // As if it had ridden for 8 s without landing a hit.
  u.flankTick[c] = g.tick - CAV_FLANK.giveUpTicks - 1;
  u.lastDealt[c] = -100000;
  g.step();
  assert.equal(u.flank[c], -1, "gave up");
  assert.ok(u.flankTick[c] > g.tick, "resting");
  assert.notEqual(u.target[c], s.mage, "the nearest enemy now");
  const until = u.flankTick[c];
  while (g.tick < until - 1) {
    g.step();
    assert.notEqual(u.target[slotOf(g, s.cav)], s.mage, `tick ${g.tick}: resting`);
  }
});

test("Rules.features.cavalryFlank only while CAV_FLANK is on", () => {
  assert.equal(rules().features.cavalryFlank, CAV_FLANK.on ? true : undefined);
  switchedOff(CAV_FLANK, () => assert.equal(rules().features.cavalryFlank, undefined))();
});
