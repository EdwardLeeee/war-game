import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_TEST_TPS, parseParams, SPEED_TPS } from "../src/params.ts";

test("game speeds are 15, 20 and 30 ticks per second", () => {
  assert.deepEqual(SPEED_TPS, { slow: 20, normal: 30, fast: 40 });
});

test("a plain page has no test hook and no tick-rate override", () => {
  assert.deepEqual(parseParams(""), { test: false, tps: null, mock: false, scenario: null });
});

test("tps, mock and scenario are ignored without test=1", () => {
  assert.deepEqual(parseParams("?tps=200&mock=1&scenario=e2e"), { test: false, tps: null, mock: false, scenario: null });
});

test("test=1 turns on the hook and allows a faster tick rate and the fake world", () => {
  assert.deepEqual(parseParams("?test=1&tps=200"), { test: true, tps: 200, mock: false, scenario: null });
  assert.equal(parseParams("?test=1&mock=1").mock, true);
  assert.equal(parseParams("?test=1&scenario=e2e").scenario, "e2e");
  assert.equal(parseParams("?test=1&scenario=bogus").scenario, null);
});

test("tps is capped and must be a positive whole number", () => {
  assert.equal(parseParams(`?test=1&tps=${MAX_TEST_TPS * 10}`).tps, MAX_TEST_TPS);
  for (const bad of ["0", "-5", "1.5", "abc", ""]) {
    assert.equal(parseParams(`?test=1&tps=${bad}`).tps, null, bad);
  }
});
