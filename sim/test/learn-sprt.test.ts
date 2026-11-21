// D-147 step 4: the promotion rule (sim/src/ai/learn/sprt.ts), on made-up results: no games.

import assert from "node:assert/strict";
import { test } from "node:test";
import { addLook, bounds, decide, EFFECT_EX, EFFECT_VS, H1_MAX, H1_MIN, h1Ex, pathA, type Side, SPRT, zSign } from "../src/ai/learn/sprt.ts";
import { simulate } from "../src/ai/learn/sprt-check.ts";

const side = (plus: number, minus: number, games = plus + minus): Side => ({ plus, minus, games });

test("SPRT: the bounds and the two effects follow the settings", () => {
  const { upper, lower } = bounds();
  assert.ok(Math.abs(upper - Math.log(0.9 / 5e-5)) < 1e-9);
  assert.ok(Math.abs(lower - Math.log(0.1 / (1 - 5e-5))) < 1e-9);
  assert.ok(Math.abs(EFFECT_VS - 0.05) < 1e-12);
  assert.ok(Math.abs(EFFECT_EX - 0.05 / 0.6) < 1e-12);
  assert.equal(zSign(side(0, 0)), 0);
  assert.ok(Math.abs(zSign(side(60, 40)) - 2) < 1e-9);
});

test("SPRT: a candidate playing exactly as the champion is rejected at once", () => {
  assert.equal(decide(side(0, 0, 60), side(20, 18, 40), true).verdict, "reject");
});

test("SPRT: promotes on one path only when the other is not worse; rejects when both say no, or the games run out", () => {
  // Head to head well ahead, examiners even: path B.
  const b = decide(side(30, 30, 200), side(1300, 1000, 2400));
  assert.equal(b.verdict, "promote");
  assert.match(b.why, /^B/);
  // The same head to head, but the player wins clearly more on the examiners: not promoted.
  assert.notEqual(decide(side(20, 60, 200), side(1300, 1000, 2400)).verdict, "promote");
  // Examiners well ahead, head to head even: path A.
  assert.match(decide(side(400, 200, 2000), side(500, 500, 1000)).why, /^A/);
  // Both clearly no better.
  assert.equal(decide(side(100, 140, 800), side(240, 300, 560)).verdict, "reject");
  // Neither bound, games out.
  assert.equal(decide(side(10, 10, SPRT.exMax), side(10, 10, SPRT.vsMax)).verdict, "reject");
  assert.equal(decide(side(10, 10, 60), side(10, 10, 40)).verdict, "continue");
});

test("SPRT path A: each look's H1 comes from how many seeds differ, never from which side won them", () => {
  // The same looks with every result turned the other way round: the very same H1, look by look.
  const looks = [
    [3, 1, 60],
    [0, 4, 60],
    [2, 2, 60],
    [7, 0, 60],
    [0, 0, 60],
  ];
  const a = pathA();
  const b = pathA();
  const ha = looks.map(([p, m, g]) => addLook(a, p, m, g));
  const hb = looks.map(([p, m, g]) => addLook(b, m, p, g));
  assert.deepEqual(ha, hb);
  // Q 0 (no seed differs yet), Q small, Q large: clamped to H1_MAX and H1_MIN; in between 0.5 + effect / (2 Q).
  assert.equal(h1Ex(0, 0), H1_MAX);
  assert.equal(h1Ex(0, 60), H1_MAX);
  assert.equal(h1Ex(1, 60), H1_MAX);
  assert.equal(h1Ex(60, 60), H1_MIN);
  assert.equal(H1_MIN, 0.525);
  assert.ok(Math.abs(h1Ex(18, 60) - (0.5 + 0.05 / 0.6)) < 1e-12);
  assert.ok(ha.every((h) => h >= 0.5));
});

test("SPRT: with the exam's own code (sprt-check.ts), equal candidates are hardly ever promoted; stronger ones mostly are", () => {
  // 1e-4 at most for both paths together (the full check: 1,000,000 candidates for each Q, in the PR). Here 20,000.
  for (const q of [0.056, 0.3]) {
    const equal = simulate(20_000, q, 0.002, 0, 0, 7);
    assert.ok(equal.promoted <= 3e-4, `Q ${q}: equal promoted ${equal.promoted}`);
  }
  // A candidate playing nearly as hard (Q 5.6%, PR B trial) is rejected in about 14 looks, not the first rule's 49.
  assert.ok(simulate(5_000, 0.056, 0.002, 0, 0, 8).looks < 20);
  assert.ok(simulate(2_000, 0.056, 0.002, 0, 0, 8, true).looks > 40);
  assert.ok(simulate(2_000, 0.056, 0.002, 0, 0.05, 9).promoted >= 0.8);
  assert.ok(simulate(2_000, 0.056, 0.002, 0.05, 0, 10).promoted >= 0.95);
  assert.ok(simulate(2_000, 0.3, 0.002, 0.05, 0, 11).promoted >= 0.85);
});
