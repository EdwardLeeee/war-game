// The measurement and the determinism check never overlap, and anything that distorts a
// measurement marks it 無效 (engine spike finding 8).

import assert from "node:assert/strict";
import { test } from "node:test";
import { Lab, WARMUP_MS, WINDOW_MS } from "../src/lab/lab.ts";

const ok = { hidden: false, paused: false, normalSpeed: true };

function run(lab: Lab, t0: number, each: (t: number) => void = () => {}) {
  let result = null;
  for (let t = t0; t <= t0 + WARMUP_MS + WINDOW_MS + 100 && result === null; t += 16) {
    each(t);
    result = lab.frame(t, 16, ok);
  }
  return result;
}

test("while measuring, the determinism check cannot start, and the other way round", () => {
  const lab = new Lab();
  assert.ok(lab.startMeasure(0));
  assert.equal(lab.startCheck(), false);
  assert.match(lab.blockedCheck() ?? "", /量測進行中/);

  const other = new Lab();
  assert.ok(other.startCheck());
  assert.equal(other.startMeasure(0), false);
  assert.match(other.blockedMeasure() ?? "", /確定性檢查進行中/);
  other.endCheck();
  assert.equal(other.blockedMeasure(), null);
});

test("a clean measurement reports the numbers and passes the spike's thresholds", () => {
  const lab = new Lab();
  lab.startMeasure(0);
  const r = run(lab, 0, () => lab.tick(400, null, 20));
  assert.ok(r !== null);
  assert.equal(r.valid, true);
  assert.equal(r.fpsMedian, 62.5);
  assert.equal(r.tickMedianMs, 0.4);
  assert.equal(r.pass, true);
  assert.equal(lab.phase, "idle");
});

test("the mean tick time uses the batch sums (1 ms timer resolution on iOS)", () => {
  const lab = new Lab();
  lab.startMeasure(0);
  let n = 0;
  const r = run(lab, 0, () => {
    n++;
    // Each tick reads as 0 or 1000 µs; every 20th tick the batch says 7000 µs over 20 ticks.
    lab.tick(n % 3 === 0 ? 1000 : 0, n % 20 === 0 ? 7000 : null, 20);
  });
  assert.ok(r !== null);
  assert.equal(r.tickMedianMs, 0);
  assert.equal(r.tickMeanMs, 0.35);
});

test("pausing, hiding the page, another speed or no ticks make the result 無效", () => {
  for (const [ctx, reason] of [
    [{ ...ok, paused: true }, /暫停/],
    [{ ...ok, hidden: true }, /背景/],
    [{ ...ok, normalSpeed: false }, /速度/],
  ] as const) {
    const lab = new Lab();
    lab.startMeasure(0);
    let r = null;
    for (let t = 0; r === null; t += 16) {
      lab.tick(400, null, 20);
      r = lab.frame(t, 16, t > WARMUP_MS + 1000 && t < WARMUP_MS + 1100 ? ctx : ok);
    }
    assert.equal(r.valid, false);
    assert.equal(r.pass, false);
    assert.match(r.reasons.join(), reason);
  }
  const idle = new Lab();
  idle.startMeasure(0);
  const r = run(idle, 0);
  assert.ok(r !== null);
  assert.equal(r.valid, false);
  assert.match(r.reasons.join(), /0 個 tick/);
});

test("the check starting anyway during a measurement spoils it", () => {
  const lab = new Lab();
  lab.startMeasure(0);
  lab.spoil("確定性檢查同時在跑");
  const r = run(lab, 0, () => lab.tick(400, null, 20));
  assert.ok(r !== null);
  assert.deepEqual(r.reasons, ["確定性檢查同時在跑"]);
});
