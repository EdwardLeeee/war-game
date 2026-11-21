// D-147 step 4: the promotion rule (sim/src/ai/learn/sprt.ts), on made-up results: no games.

import assert from "node:assert/strict";
import { test } from "node:test";
import { bounds, decide, EFFECT_EX, EFFECT_VS, type Side, SPRT, zSign } from "../src/ai/learn/sprt.ts";
import { rng } from "../src/ai/learn/exam-space.ts";

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

/** Candidates through the looks as the training plays them: Q of examiner seeds differ, DRAW of the head-to-head games. */
function simulate(n: number, effEx: number, effVs: number, seed: number) {
  const r = rng(seed);
  const binom = (k: number, p: number) => {
    let x = 0;
    for (let i = 0; i < k; i++) if (r() < p) x++;
    return x;
  };
  let promoted = 0;
  for (let c = 0; c < n; c++) {
    const ex = side(0, 0, 0);
    const vs = side(0, 0, 0);
    for (;;) {
      if (ex.games < SPRT.exMax) {
        const differ = binom(SPRT.exChunk * 3, 0.3);
        const plus = binom(differ, 0.5 + effEx);
        ex.plus += plus;
        ex.minus += differ - plus;
        ex.games += SPRT.exChunk * 3;
      }
      if (vs.games < SPRT.vsMax) {
        const decided = binom(SPRT.vsChunk, 0.98);
        const plus = binom(decided, 0.5 + effVs);
        vs.plus += plus;
        vs.minus += decided - plus;
        vs.games += SPRT.vsChunk;
      }
      const d = decide(ex, vs);
      if (d.verdict === "promote") promoted++;
      if (d.verdict !== "continue") break;
    }
  }
  return promoted / n;
}

test("SPRT: equal candidates are hardly ever promoted; one 5 points better head to head mostly is", () => {
  // 1e-4 at most (both paths): in 20,000 equal candidates about 2 at most; a few more would still be chance.
  const equal = simulate(20_000, 0, 0, 7);
  assert.ok(equal <= 3e-4, `equal promoted ${equal}`);
  const better = simulate(400, 0, EFFECT_VS, 8);
  assert.ok(better >= 0.75, `5 points better promoted only ${better}`);
});
