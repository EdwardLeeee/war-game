import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_TEST_TPS, parseParams, SPEED_TPS } from "../src/params.ts";

test("game speeds are 15, 20 and 30 ticks per second", () => {
  assert.deepEqual(SPEED_TPS, { slow: 15, normal: 20, fast: 30 });
});

test("a plain page has no test hook and no tick-rate override", () => {
  assert.deepEqual(parseParams(""), { test: false, tps: null, mock: false });
});

test("tps and mock are ignored without test=1", () => {
  assert.deepEqual(parseParams("?tps=200&mock=1"), { test: false, tps: null, mock: false });
});

test("test=1 turns on the hook and allows a faster tick rate and the fake world", () => {
  assert.deepEqual(parseParams("?test=1&tps=200"), { test: true, tps: 200, mock: false });
  assert.equal(parseParams("?test=1&mock=1").mock, true);
});

test("tps is capped and must be a positive whole number", () => {
  assert.equal(parseParams(`?test=1&tps=${MAX_TEST_TPS * 10}`).tps, MAX_TEST_TPS);
  for (const bad of ["0", "-5", "1.5", "abc", ""]) {
    assert.equal(parseParams(`?test=1&tps=${bad}`).tps, null, bad);
  }
});
