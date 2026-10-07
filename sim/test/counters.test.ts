// The rules against mages of the early balance round (D-051, D-057; from #91, round 4): a
// retreat at each unit's own speed, a casting mage showing itself with idle soldiers hitting
// back, and ranged x3 against a mage's shield. Each has a switch in core/rules.ts.

import assert from "node:assert/strict";
import { test } from "node:test";
import { AVENGE, CANNON, COUNTER_ATTACK, DODGE, RETREAT_OWN_SPEED, REVEAL_CAST, SHIELD, SHORT_CANNON, UNITS } from "../src/core/rules.ts";
import { damage } from "../src/core/units.ts";
import { CELL_SHIFT, Stance, UnitType } from "../src/protocol.ts";
import { cmd, emptyGame, openArea, put, run, slotOf, switchedOff } from "./helpers.ts";

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

/**
 * A 3 x 3 block of player 0's spearmen standing (one on hold) with a farmer beside it; player 1's
 * mage 8 cells off, out of their sight, shells the block once. With COUNTER_ATTACK set to `on`;
 * with `squad`, the block first walks to its place as a squad (a move command).
 */
function shelled(on: boolean, squad = false) {
  const saved = COUNTER_ATTACK.on;
  COUNTER_ATTACK.on = on;
  const g = emptyGame();
  const w = g.w;
  const a = openArea(g, 30);
  const u = w.units.col;
  w.ecoOn[0] = 0;
  const block: number[] = [];
  for (let k = 0; k < 9; k++) block.push(put(g, 0, UnitType.Spearman, a.x + 5 + (k % 3), a.y + 5 + Math.trunc(k / 3)));
  const holder = block[6];
  u.stance[slotOf(g, holder)] = Stance.Hold;
  const farmer = put(g, 0, UnitType.Farmer, a.x + 9, a.y + 7);
  const mage = put(g, 1, UnitType.Mage, a.x + 6, a.y + 14);
  u.stance[slotOf(g, mage)] = Stance.Hold;
  w.res[1 * 4 + 3] = 100;
  g.fog.update(w);
  if (squad) {
    cmd(g, 0, { c: "move", u: block, x: a.x + 6, y: a.y + 6 });
    run(g, 200);
    assert.ok(block.every((id) => u.squad[slotOf(g, id)] !== 0), "a squad");
  }
  cmd(g, 1, { c: "cast", u: mage, fx: ((a.x + 6) << CELL_SHIFT) + 512, fy: ((a.y + 6) << CELL_SHIFT) + 512 });
  const restore = () => {
    COUNTER_ATTACK.on = saved;
  };
  return { g, w, u, a, block, holder, farmer, mage, restore };
}

/** Steps until the mage fired; the tick, or -1. */
function untilShot(g: ReturnType<typeof emptyGame>, mage: number): number {
  const u = g.w.units.col;
  for (let t = 0; t < 200; t++) {
    g.step();
    if (u.castCooldown[slotOf(g, mage)] > 0) return g.tick;
  }
  return -1;
}

test("counter-attack: soldiers without a squad, shelled by a mage they cannot see, charge it; hold and farmers stay", switchedOff([DODGE, AVENGE, SHORT_CANNON], () => {
  for (const on of [true, false]) {
    const { g, u, block, holder, farmer, mage, restore } = shelled(on);
    try {
      const at = (id: number) => [u.x[slotOf(g, id)], u.y[slotOf(g, id)]];
      const holdAt = at(holder);
      const farmerAt = at(farmer);
      assert.ok(untilShot(g, mage) > 0, "the mage fired");
      run(g, 40);
      const chasing = block.filter((id) => slotOf(g, id) >= 0 && u.target[slotOf(g, id)] === mage).length;
      if (on) {
        assert.ok(chasing >= 3, `${chasing} go for the mage`);
        assert.equal(u.target[slotOf(g, holder)], -1, "hold stays");
        assert.deepEqual(at(holder), holdAt, "hold does not move");
        assert.deepEqual(at(farmer), farmerAt, "the farmer does not move");
      } else {
        assert.equal(chasing, 0, "without it nobody goes for the unseen mage");
      }
    } finally {
      restore();
    }
  }
}));

test("counter-attack is not for a squad: soldiers that came by a move command do not charge the unseen mage", switchedOff([SHORT_CANNON, DODGE, AVENGE], () => {
  const { g, u, block, mage, restore } = shelled(true, true);
  try {
    assert.ok(untilShot(g, mage) > 0, "the mage fired");
    run(g, 40);
    assert.equal(block.filter((id) => slotOf(g, id) >= 0 && u.target[slotOf(g, id)] === mage).length, 0);
  } finally {
    restore();
  }
}));

test("counter-attack: once the mage is gone beyond 8 cells, the soldiers go back to their places and stay there", switchedOff([SHORT_CANNON, DODGE, AVENGE], () => {
  const { g, w, u, a, block, mage, restore } = shelled(true);
  try {
    assert.ok(untilShot(g, mage) > 0);
    run(g, 20);
    assert.ok(block.some((id) => u.target[slotOf(g, id)] === mage), "they went for it");
    // The mage gets away: 20 cells off, out of sight; no more shots.
    const ms = slotOf(g, mage);
    u.y[ms] = ((a.y + 28) << CELL_SHIFT) + 512;
    u.castCooldown[ms] = CANNON.cooldownTicks * 10;
    w.res[1 * 4 + 3] = 0;
    const home = (id: number) => Math.hypot(u.x[slotOf(g, id)] - u.anchorX[slotOf(g, id)], u.y[slotOf(g, id)] - u.anchorY[slotOf(g, id)]) / 1024;
    run(g, 200);
    const alive = block.filter((id) => slotOf(g, id) >= 0);
    for (const id of alive) assert.ok(home(id) <= 1, `soldier ${id} back (${home(id).toFixed(2)} cells off)`);
    for (let t = 0; t < 100; t++) {
      g.step();
      for (const id of alive) {
        assert.equal(u.target[slotOf(g, id)], -1, `tick ${g.tick}: no target`);
        assert.ok(home(id) <= 1, `tick ${g.tick}: soldier ${id} stays`);
      }
    }
  } finally {
    restore();
  }
}));

test("a mage calibrating the cannon, and for 2 s after it fired, is seen by the other player in its cell", switchedOff([AVENGE, SHORT_CANNON, DODGE], () => {
  for (const on of [true, false]) {
    const saved = REVEAL_CAST.on;
    REVEAL_CAST.on = on;
    try {
      const g = emptyGame();
      const w = g.w;
      const a = openArea(g, 24);
      const u = w.units.col;
      put(g, 0, UnitType.Spearman, a.x + 6, a.y + 6);
      const mage = put(g, 1, UnitType.Mage, a.x + 6, a.y + 14);
      u.stance[slotOf(g, mage)] = Stance.Hold;
      w.res[1 * 4 + 3] = 100;
      g.fog.update(w);
      const seen = () => {
        const s = slotOf(g, mage);
        return g.fog.visible[0][(u.y[s] >> CELL_SHIFT) * w.size + (u.x[s] >> CELL_SHIFT)] === 1;
      };
      assert.equal(seen(), false, "8 cells off, out of sight");
      cmd(g, 1, { c: "cast", u: mage, fx: ((a.x + 6) << CELL_SHIFT) + 512, fy: ((a.y + 6) << CELL_SHIFT) + 512 });
      run(g, 10);
      g.fog.update(w);
      assert.equal(seen(), on, "calibrating");
      assert.ok(untilShot(g, mage) > 0, "fired");
      run(g, REVEAL_CAST.ticks - 5);
      g.fog.update(w);
      assert.equal(seen(), on, "just under 2 s after");
      run(g, 10);
      g.fog.update(w);
      assert.equal(seen(), false, "more than 2 s after");
    } finally {
      REVEAL_CAST.on = saved;
    }
  }
}));

test("counter-attack: mirror-image blocks shelled by mirror-image mages charge as mirror images, tick by tick", switchedOff([SHORT_CANNON, DODGE, AVENGE], () => {
  const g = emptyGame();
  const w = g.w;
  const { bx, by } = mirrorBlock(g);
  const u = w.units.col;
  const pairs: [number, number][] = [];
  const add = (owner: number, type: UnitType, x: number, y: number) => {
    const a = put(g, owner, type, x, y);
    const b = put(g, 1 - owner, type, y, x);
    pairs.push([a, b]);
    return [a, b];
  };
  // A 3 x 3 block of player 0 standing, and player 1's mage 8 cells off; and the mirror image.
  const block: number[] = [];
  for (let k = 0; k < 9; k++) block.push(add(0, UnitType.Spearman, bx + 3 + (k % 3), by + 2 + Math.trunc(k / 3))[0]);
  const [mage0, mage1] = add(1, UnitType.Mage, bx + 4, by + 11);
  for (const m of [mage0, mage1]) u.stance[slotOf(g, m)] = Stance.Hold;
  w.res[0 * 4 + 3] = 100;
  w.res[1 * 4 + 3] = 100;
  g.fog.update(w);
  // mage0 is player 1's (shelling player 0's block), mage1 player 0's (its mirror image).
  cmd(g, 1, { c: "cast", u: mage0, fx: ((bx + 4) << CELL_SHIFT) + 512, fy: ((by + 3) << CELL_SHIFT) + 512 });
  cmd(g, 0, { c: "cast", u: mage1, fx: ((by + 3) << CELL_SHIFT) + 512, fy: ((bx + 4) << CELL_SHIFT) + 512 });
  let charged = 0;
  for (let t = 0; t < 250; t++) {
    g.step();
    for (const [a, b] of pairs) {
      const sa = slotOf(g, a);
      const sb = slotOf(g, b);
      assert.equal(sa < 0, sb < 0, `tick ${g.tick}: both alive or both gone`);
      if (sa < 0) continue;
      assert.equal(u.x[sb], u.y[sa], `tick ${g.tick}: x of the image is y of the original`);
      assert.equal(u.y[sb], u.x[sa], `tick ${g.tick}`);
    }
    if (block.some((id) => slotOf(g, id) >= 0 && u.target[slotOf(g, id)] === mage0)) charged++;
  }
  assert.ok(charged > 0, "the block went for the mage");
}));

test("counter-attacks off: hitById stays out of the hash", () => {
  const saved = COUNTER_ATTACK.on;
  COUNTER_ATTACK.on = false;
  try {
    const g = emptyGame();
    const id = put(g, 0, UnitType.Spearman, 20, 60);
    const h = g.hash();
    g.w.units.col.hitById[slotOf(g, id)] = 5;
    assert.equal(g.hash(), h);
  } finally {
    COUNTER_ATTACK.on = saved;
  }
});

test("ranged hit a mage's shield x3: 15 a shot (was 7, x3/2)", () => {
  assert.equal(damage(UNITS[UnitType.Ranged].attack, UnitType.Ranged, SHIELD), 15);
  assert.equal(damage(UNITS[UnitType.Ranged].attack, UnitType.Ranged, UnitType.Mage), 5, "the hp after the shield as before");
  assert.equal(damage(UNITS[UnitType.Spearman].attack, UnitType.Spearman, SHIELD), 6, "others as before");
});
