// D-147 step 4: the promotion rule (sim/src/ai/learn/sprt.ts), on made-up results: no games. The ways the first rules
// broke (2026-11-23, D-162) are fixed cases, each with a control that must break: a check that cannot fail shows nothing.

import assert from "node:assert/strict";
import { test } from "node:test";
import { addA, addB, bounds, decide, LAMBDA_A, LAMBDA_B, lambdaA, lambdaB, noPairs, pairOf, type Pairs, pathA, type PathA, pathB, type PathB, type Side, SPRT, zSign } from "../src/ai/learn/sprt.ts";
import { afterPromotion, expectedA, expectedB, exOf, LEANING, nullCases, pairAt, simulate, UNEVEN } from "../src/ai/learn/sprt-check.ts";

const side = (plus: number, minus: number, games = plus + minus): Side => ({ plus, minus, games });
const a = (plus: number, minus: number, games: number, llr = 0): PathA => ({ plus, minus, games, llr });
const b = (plus: number, minus: number, games: number, llr = 0): PathB => ({ plus, minus, games, llr, seeds: games / 2, squares: games / 2 });
const pairs = (p: Partial<Pairs>): Pairs => ({ ...noPairs(), ...p });
const LIMIT = 2 * SPRT.alpha;
const ONE = 1 + 1e-9;

test("SPRT: promote at 1/alpha, so each path's chance is alpha and the two add to 1e-4", () => {
  const { upper, lower } = bounds();
  assert.ok(Math.abs(Math.exp(upper) - 20_000) < 1e-6);
  assert.ok(Math.abs(lower - Math.log(0.1 / (1 - 5e-5))) < 1e-9);
  assert.equal(LIMIT, 1e-4);
  assert.equal(zSign(side(0, 0)), 0);
  assert.ok(Math.abs(zSign(side(60, 40)) - 2) < 1e-9);
});

test("SPRT: lambda comes from the looks before alone: whatever this look holds, its lambda is the same", () => {
  const before = a(3, 2, 120);
  const want = lambdaA(before);
  for (const look of [[side(20, 0), side(20, 0), side(20, 0)], [side(0, 20), side(0, 20), side(0, 20)], [side(0, 0, 20), side(0, 0, 20), side(0, 0, 20)]]) assert.equal(addA({ ...before }, look), want);
  const beforeB = pathB();
  addB(beforeB, pairs({ ww: 3, wl: 15, ll: 2 }));
  const wantB = lambdaB(beforeB);
  for (const p of [pairs({ ww: 20 }), pairs({ ll: 20 }), pairs({ wl: 20 }), pairs({ dd: 20 })]) assert.equal(addB({ ...beforeB }, p), wantB);
  // The first look: the assumed values, not the games'.
  assert.ok(Math.abs(addA(pathA(), [side(20, 0), side(20, 0), side(20, 0)]) - 0.05 / 0.3) < 1e-12);
  assert.ok(Math.abs(addB(pathB(), pairs({ ww: 20 })) - 0.1) < 1e-12);
});

test("SPRT: lambda is clamped, so no factor reaches 0", () => {
  assert.equal(lambdaA(a(0, 0, 60)), LAMBDA_A.max);
  assert.equal(lambdaA(a(30, 30, 60)), LAMBDA_A.min);
  assert.equal(lambdaB({ ...b(20, 20, 40), squares: 0 }), LAMBDA_B.max);
  assert.ok(Math.abs(lambdaB({ ...b(40, 0, 40), squares: 80 }) - 0.05) < 1e-12);
  assert.ok(LAMBDA_A.min > 0 && LAMBDA_B.min > 0);
  assert.ok(1 - LAMBDA_A.max > 0 && 1 - 2 * LAMBDA_B.max > 0);
  // The worst look there can be, after the boldest lambda: still a finite logarithm.
  const worstA = a(0, 0, 60);
  addA(worstA, [side(0, 20), side(0, 20), side(0, 20)]);
  assert.ok(Number.isFinite(worstA.llr));
  const worstB = { ...b(20, 20, 40), squares: 0 };
  addB(worstB, pairs({ ll: 20 }));
  assert.ok(Number.isFinite(worstB.llr));
});

test("SPRT path A: every examiner plays as many games in a look, else it throws", () => {
  assert.throws(() => addA(pathA(), [side(0, 0, 20), side(0, 0, 20), side(0, 0, 10)]), /condition 4/);
});

test("SPRT path B: a seed is one unit, X its two games' sum", () => {
  assert.deepEqual([pairOf(1, 1), pairOf(1, -1), pairOf(-1, 1), pairOf(1, 0), pairOf(0, 1), pairOf(-1, -1), pairOf(0, -1), pairOf(-1, 0), pairOf(0, 0)], ["ww", "wd", "wd", "wl", "wl", "dd", "ld", "ld", "ll"]);
  const p = pathB();
  addB(p, pairs({ ww: 1, wd: 1, wl: 1, dd: 1, ld: 1, ll: 1 }));
  // By lambda 0.1: X = 2, 1, 0, 0, -1, -2.
  assert.ok(Math.abs(p.llr - Math.log(1.2 * 1.1 * 0.9 * 0.8)) < 1e-12);
  assert.deepEqual([p.plus, p.minus, p.games, p.seeds, p.squares], [4, 4, 12, 6, 10]);
});

test("SPRT: promotes on one path only when the other is not worse; rejects when both say no, or the games run out", () => {
  const up = bounds().upper;
  const low = bounds().lower;
  assert.match(decide(a(30, 30, 240), b(1300, 1000, 2400, up), false).why, /^B/);
  // The same head to head, but the player wins clearly more on the examiners: not promoted.
  assert.notEqual(decide(a(20, 60, 240), b(1300, 1000, 2400, up), false).verdict, "promote");
  assert.match(decide(a(400, 200, 2040, up), b(500, 500, 1360), false).why, /^A/);
  assert.notEqual(decide(a(400, 200, 2040, up), b(400, 600, 1360), false).verdict, "promote");
  assert.equal(decide(a(100, 140, 780, low), b(240, 300, 520, low), false).verdict, "reject");
  assert.equal(decide(a(10, 10, SPRT.exMax), b(10, 10, SPRT.vsMax), false).verdict, "reject");
  assert.equal(decide(a(10, 10, 60), b(10, 10, 40), false).verdict, "continue");
  assert.equal(decide(a(0, 0, 60), b(20, 18, 40), true).verdict, "reject");
});

test("SPRT, exactly: a look's expected factor is at most 1 however the two spawns go together; as two units it is not", () => {
  const later: PathB = pathB();
  addB(later, pairs({ ww: 2, wl: 16, ll: 2 }));
  for (const p of [0.098, 0.25, 0.4, 0.5]) {
    assert.ok(expectedB(pairAt(p)) <= ONE, `P(++) ${p}, the first look`);
    assert.ok(expectedB(pairAt(p), later) <= ONE, `P(++) ${p}, a later look`);
  }
  for (const p of [0.4, 0.5]) assert.ok(expectedB(pairAt(p), pathB(), true) > 1.05, `control ${p}`);
});

test("SPRT, exactly: a look's expected factor is at most 1 where the examiners differ or go together; not the broken ways", () => {
  // No better on average, one examiner only +, one only -.
  assert.ok(expectedA(UNEVEN) <= ONE);
  assert.ok(expectedA(UNEVEN, a(2, 1, 120)) <= ONE);
  // Controls: lambda from the counts with this look's (though only the number is used); one seed for the three.
  assert.ok(expectedA(UNEVEN, pathA(), true) > 1.005, "lambda with this look's counts");
  assert.ok(expectedA(exOf(0.3), pathA(), false, true) > 1.5, "three examiners on one seed");
  assert.ok(expectedA(exOf(0.056)) <= ONE, "seeds of their own");
});

test("SPRT: with the exam's own code, no case no better is promoted over the bound; the broken ways are", () => {
  // 20,000 each here; 1,000,000 each: node src/ai/learn/sprt-check.ts all (the PR's numbers).
  for (const [name, c] of nullCases()) {
    const x = simulate(20_000, c, 7);
    assert.ok(x.promoted <= 3 * LIMIT, `${name}: promoted ${x.promoted}`);
  }
  const tied = simulate(3_000, { examiners: exOf(0.056), pair: pairAt(0.25) }, 7, { tiedExaminers: true });
  assert.ok(tied.promoted > 50 * LIMIT, `control, examiners tied: ${tied.promoted}`);
  const two = simulate(20_000, { examiners: exOf(0.056), pair: pairAt(0.5) }, 7, { gamesAsUnits: true });
  assert.ok(two.promoted > 10 * LIMIT, `control, two units a seed: ${two.promoted}`);
  const some = simulate(20_000, { examiners: exOf(0.056), pair: pairAt(0.4) }, 7, { gamesAsUnits: true });
  assert.ok(some.promoted > 3 * LIMIT, `control, two units a seed, 0.4: ${some.promoted}`);
});

test("SPRT: after a promotion on seeds it leans on, a new block is within the bound; the seeds kept are not", () => {
  const kept = afterPromotion(50_000, LEANING, 5, true, 100);
  const fresh = afterPromotion(50_000, LEANING, 5, false, 100);
  assert.ok(kept.tries >= 10_000, `champions ${kept.champions}`);
  assert.ok(kept.promoted >= 20 && kept.promoted / kept.tries > 5 * LIMIT, `control, kept: ${kept.promoted}/${kept.tries}`);
  assert.ok(fresh.promoted / fresh.tries <= 3 * LIMIT, `a new block: ${fresh.promoted}/${fresh.tries}`);
});

test("SPRT: stronger candidates mostly are promoted, and an equal one is rejected without using up the games", () => {
  assert.ok(simulate(3_000, { examiners: exOf(0.056), pair: pairAt(0.25, 0.05) }, 9).promoted >= 0.8);
  assert.ok(simulate(3_000, { examiners: exOf(0.056), pair: pairAt(0.098, 0.05) }, 9).promoted >= 0.83);
  assert.ok(simulate(3_000, { examiners: exOf(0.056, 0.05), pair: pairAt(0.25) }, 10).promoted >= 0.95);
  assert.ok(simulate(3_000, { examiners: exOf(0.3, 0.05), pair: pairAt(0.25) }, 11).promoted >= 0.85);
  assert.ok(simulate(5_000, { examiners: exOf(0.056), pair: pairAt(0.25) }, 12).looks < 20);
});
