// Loose soldiers keep their distance (round 6, D-054; LOOSE_KEEP in core/rules.ts): a player's
// loose soldiers push apart to 2 cells from the loose soldiers of their own team (squad, or the
// group on a retreat) while they walk, chase and fight. Close formations play exactly as before.

import assert from "node:assert/strict";
import { test } from "node:test";
import { Game } from "../src/core/game.ts";
import { LOOSE_KEEP, UNITS } from "../src/core/rules.ts";
import { Action, UnitType } from "../src/protocol.ts";
import { cmd, emptyGame, openArea, put, run, slotOf } from "./helpers.ts";

/** Each unit's distance to its nearest mate, in cells: the least and the mean. */
function spacing(g: Game, ids: number[]): { min: number; mean: number } {
  const u = g.w.units.col;
  const d = ids.map((a) => {
    let best = Infinity;
    for (const b of ids) {
      if (a === b) continue;
      best = Math.min(best, Math.hypot(u.x[slotOf(g, a)] - u.x[slotOf(g, b)], u.y[slotOf(g, a)] - u.y[slotOf(g, b)]) / 1024);
    }
    return best;
  });
  return { min: Math.min(...d), mean: d.reduce((p, v) => p + v, 0) / d.length };
}

/** Runs `scene` with LOOSE_KEEP.spacing set to `keep`. */
function withSpacing<T>(keep: number, scene: () => T): T {
  const saved = LOOSE_KEEP.spacing;
  LOOSE_KEEP.spacing = keep;
  try {
    return scene();
  } finally {
    LOOSE_KEEP.spacing = saved;
  }
}

/**
 * 12 ranged of player 0 (loose or close) move on 6 spearmen of player 1 standing 14 cells off.
 * The game's hash at the end and the ranged's spacing 8 s after the first of them shot.
 */
function rangedWalkUp(loose: boolean): { hash: number; after: { min: number; mean: number } } {
  const g = emptyGame();
  const a = openArea(g, 30);
  const u = g.w.units.col;
  const ranged: number[] = [];
  for (let k = 0; k < 12; k++) ranged.push(put(g, 0, UnitType.Ranged, a.x + 9 + (k % 6), a.y + 2 + Math.trunc(k / 6)));
  for (let k = 0; k < 6; k++) put(g, 1, UnitType.Spearman, a.x + 9 + k, a.y + 16);
  g.fog.update(g.w);
  if (loose) cmd(g, 0, { c: "formation", u: ranged, loose: true });
  cmd(g, 0, { c: "move", u: ranged, x: a.x + 11, y: a.y + 18 });
  let first = -1;
  let after = { min: 0, mean: 0 };
  for (let t = 0; t < 400; t++) {
    g.step();
    const alive = ranged.filter((id) => slotOf(g, id) >= 0);
    if (first < 0 && alive.some((id) => u.action[slotOf(g, id)] === Action.Attack)) first = g.tick;
    if (first >= 0 && g.tick === first + 160) after = spacing(g, alive);
  }
  return { hash: g.hash(), after };
}

/**
 * 12 spearmen of player 0 (loose or close), re-formed in place; 12 spearmen of player 1 walk up
 * to them. With `attack`, player 0's spearmen are told to attack one of them once it is in
 * sight (a squad without a group). Player 0's spacing 2 s after the first of them struck, and
 * the game's hash at the end.
 */
function spearmenFight(loose: boolean, attack: boolean): { hash: number; after: { min: number; mean: number } } {
  const g = emptyGame();
  const a = openArea(g, 30);
  const u = g.w.units.col;
  const mine: number[] = [];
  for (let k = 0; k < 12; k++) mine.push(put(g, 0, UnitType.Spearman, a.x + 9 + (k % 6), a.y + 4 + Math.trunc(k / 6)));
  const foes: number[] = [];
  for (let k = 0; k < 12; k++) foes.push(put(g, 1, UnitType.Spearman, a.x + 9 + (k % 6), a.y + 20 + Math.trunc(k / 6)));
  g.fog.update(g.w);
  if (loose) cmd(g, 0, { c: "formation", u: mine, loose: true });
  cmd(g, 1, { c: "move", u: foes, x: a.x + 11, y: a.y + 4 });
  let first = -1;
  let ordered = !attack;
  let after = { min: 0, mean: 0 };
  for (let t = 0; t < 500; t++) {
    const s = slotOf(g, foes[2]);
    if (!ordered && s >= 0 && g.fog.visible[0][(u.y[s] >> 10) * g.w.size + (u.x[s] >> 10)] !== 0) {
      cmd(g, 0, { c: "attack", u: mine, target: foes[2] });
      ordered = true;
    }
    g.step();
    if (attack && ordered && t < 499 && first < 0) {
      const m = slotOf(g, mine[0]);
      if (m >= 0 && u.squad[m] !== 0) assert.equal(u.group[m], -1, "an attack: a squad and no group");
    }
    const alive = mine.filter((id) => slotOf(g, id) >= 0);
    if (first < 0 && alive.some((id) => u.action[slotOf(g, id)] === Action.Attack)) first = g.tick;
    if (first >= 0 && g.tick === first + 40) after = spacing(g, alive);
  }
  assert.ok(ordered, "the attack was given");
  return { hash: g.hash(), after };
}

test("loose ranged on a move keep about 2 cells apart in the fight; a close formation fights exactly as before", () => {
  const on = withSpacing(2 * 1024, () => rangedWalkUp(true));
  const off = withSpacing(0, () => rangedWalkUp(true));
  // Measured: nearest 1.62, mean 1.88 cells; without it 0.70 / 0.74.
  assert.ok(on.after.min >= 1.5 && on.after.mean >= 1.8, `loose, kept apart: nearest ${on.after.min.toFixed(2)}, mean ${on.after.mean.toFixed(2)}`);
  assert.ok(off.after.mean < 1.2, `loose without it, bunched: mean ${off.after.mean.toFixed(2)}`);
  assert.notEqual(on.hash, off.hash);
  assert.equal(withSpacing(2 * 1024, () => rangedWalkUp(false)).hash, withSpacing(0, () => rangedWalkUp(false)).hash, "close: the same game either way");
});

test("every loose soldier keeps apart (E4): spearmen standing, and spearmen on an attack (a squad with no group)", () => {
  // Measured, mean nearest mate in cells: standing 1.79 (without it 1.18), attacking 1.52 (0.85).
  for (const [attack, least, most] of [[false, 1.6, 1.35], [true, 1.4, 1.0]] as const) {
    const on = withSpacing(2 * 1024, () => spearmenFight(true, attack));
    const off = withSpacing(0, () => spearmenFight(true, attack));
    const how = attack ? "attacking" : "standing";
    assert.ok(on.after.mean >= least, `${how}, loose, kept apart: mean ${on.after.mean.toFixed(2)} cells`);
    assert.ok(off.after.mean < most, `${how}, loose without it, pressed together: mean ${off.after.mean.toFixed(2)}`);
    assert.notEqual(on.hash, off.hash);
    assert.equal(withSpacing(2 * 1024, () => spearmenFight(false, attack)).hash, withSpacing(0, () => spearmenFight(false, attack)).hash, `${how}, close: the same game`);
  }
});

test("mirror-image loose squads march, fight and keep apart as mirror images, tick by tick", () => {
  const g = emptyGame();
  const w = g.w;
  // An 8 x 18 open block on player 0's side of the diagonal; its mirror image is open too.
  let bx = -1;
  let by = -1;
  for (let y = 40; y < 78 && bx < 0; y++) {
    for (let x = 2; x < 30 && bx < 0; x++) {
      if (x + 8 > y) continue;
      let ok = true;
      for (let yy = y; yy < y + 18 && ok; yy++) for (let xx = x; xx < x + 8 && ok; xx++) if (!w.walkable(xx, yy) || !w.walkable(yy, xx)) ok = false;
      if (ok) {
        bx = x;
        by = y;
      }
    }
  }
  assert.ok(bx >= 0, "an open block");
  const u = w.units.col;
  const pairs: [number, number][] = [];
  const add = (owner: number, type: UnitType, x: number, y: number) => {
    const a = put(g, owner, type, x, y);
    const b = put(g, 1 - owner, type, y, x);
    pairs.push([a, b]);
    return [a, b];
  };
  // Two enemies that stand and never hit back; 4 loose ranged and 4 loose spearmen 14 cells off.
  for (const x of [bx + 2, bx + 5]) {
    for (const id of add(1, UnitType.Spearman, x, by + 1)) {
      u.stance[slotOf(g, id)] = 1;
      u.cooldown[slotOf(g, id)] = 100000;
    }
  }
  const squad: [number[], number[]] = [[], []];
  for (let k = 0; k < 8; k++) {
    const [a, b] = add(0, k < 4 ? UnitType.Ranged : UnitType.Spearman, bx + 2 + (k % 4), by + 15 + Math.trunc(k / 4));
    squad[0].push(a);
    squad[1].push(b);
  }
  g.fog.update(w);
  for (const p of [0, 1]) cmd(g, p, { c: "formation", u: squad[p], loose: true });
  cmd(g, 0, { c: "move", u: squad[0], x: bx + 3, y: by + 3 });
  cmd(g, 1, { c: "move", u: squad[1], x: by + 3, y: bx + 3 });
  let fighting = 0;
  for (let t = 0; t < 400; t++) {
    g.step();
    for (const [a, b] of pairs) {
      const sa = slotOf(g, a);
      const sb = slotOf(g, b);
      assert.equal(sa < 0, sb < 0, `tick ${g.tick}: both alive or both gone`);
      if (sa < 0) continue;
      assert.equal(u.x[sb], u.y[sa], `tick ${g.tick}: x of the image is y of the original`);
      assert.equal(u.y[sb], u.x[sa], `tick ${g.tick}`);
    }
    if (squad[0].some((id) => slotOf(g, id) >= 0 && u.target[slotOf(g, id)] >= 0)) fighting++;
  }
  assert.ok(fighting > 0, "they fought");
  const alive = squad[0].filter((id) => slotOf(g, id) >= 0);
  assert.ok(spacing(g, alive).mean >= 1.8, `mean nearest mate ${spacing(g, alive).mean.toFixed(2)} cells`);
});

test("loose soldiers by a rock spread out and then stand still (#116)", () => {
  // The client's case: in the e2e game, 16 loose soldiers of player 0 stand bunched below the
  // rock at (21-23, 39) and are told to move to (26, 44). One of them ends below the rock, and
  // the push of the mate nearest it ran into the rock; it was pushed off the place it stood on,
  // walked back, and was pushed off again, for good.
  const g = new Game({ seed: 1, scenario: "e2e" });
  const w = g.w;
  const u = w.units.col;
  for (let s = 0; s < w.units.count; s++) {
    if ((u.owner[s] === 0 && u.type[s] !== UnitType.Farmer) || (u.type[s] === UnitType.Militia && u.home[s] === 0)) u.hp[s] = 0;
  }
  g.step();
  const start = [
    [1, 27.32, 40.42], [1, 26.5, 40.4], [1, 24.84, 40.06], [1, 27.95, 39.67], [2, 24.76, 39.33], [2, 28.3, 38.44], [2, 26.76, 38.27], [2, 26.05, 38.35],
    [1, 27.14, 39.72], [1, 26.41, 39.71], [1, 25.46, 39.32], [1, 25.74, 39.98], [1, 26.12, 39.06], [1, 22.73, 43.29], [1, 19.03, 59.54], [1, 18.04, 77.01],
  ] as const;
  const ids = start.map(([t, x, y]) => w.addUnit(0, t, Math.round(x * 1024), Math.round(y * 1024), UNITS[t].hp));
  cmd(g, 0, { c: "formation", u: ids, loose: true });
  run(g, 20);
  cmd(g, 0, { c: "move", u: ids, x: 26, y: 44 });
  run(g, 1200);
  const moving: number[] = [];
  let last = ids.map((id) => [u.x[slotOf(g, id)], u.y[slotOf(g, id)]]);
  for (let k = 0; k < 8; k++) {
    run(g, 50);
    const now = ids.map((id) => [u.x[slotOf(g, id)], u.y[slotOf(g, id)]]);
    moving.push(now.filter((p, j) => Math.hypot(p[0] - last[j][0], p[1] - last[j][1]) > 5).length);
    last = now;
  }
  // Measured: 3-5 of them still moving in every 50 ticks, the nearest pair 1.82 cells apart; now
  // none, and 2.00 cells.
  assert.deepEqual(moving, [0, 0, 0, 0, 0, 0, 0, 0], `moving per 50 ticks after a minute: ${moving.join(" ")}`);
  assert.ok(spacing(g, ids).min >= 1.95, `nearest pair ${spacing(g, ids).min.toFixed(2)} cells`);
});
