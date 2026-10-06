import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_TEST_TPS, parseParams, SPEED_TPS } from "../src/params.ts";

test("game speeds are 20, 30 and 40 ticks per second (D-024)", () => {
  assert.deepEqual(SPEED_TPS, { slow: 20, normal: 30, fast: 40 });
});

test("a plain page has no test hook and no tick-rate override", () => {
  assert.deepEqual(parseParams(""), { test: false, tps: null, mock: false, round7: false, scenario: null, enemyAi: true, hint: true, logsUrl: null });
});

test("tps, mock, r7, scenario and ai are ignored without test=1", () => {
  assert.deepEqual(parseParams("?tps=200&mock=1&r7=1&scenario=e2e&ai=0&hint=0&logs=https://x.test/logs"), { test: false, tps: null, mock: false, round7: false, scenario: null, enemyAi: true, hint: true, logsUrl: null });
});

test("test=1 turns on the hook and allows a faster tick rate and the fake world", () => {
  assert.deepEqual(parseParams("?test=1&tps=200"), { test: true, tps: 200, mock: false, round7: false, scenario: null, enemyAi: true, hint: false, logsUrl: null });
  assert.equal(parseParams("?test=1&mock=1").mock, true);
  assert.equal(parseParams("?test=1&mock=1").round7, false);
  assert.equal(parseParams("?test=1&mock=1&r7=1").round7, true);
  assert.equal(parseParams("?test=1&scenario=e2e").scenario, "e2e");
  assert.equal(parseParams("?test=1&scenario=bogus").scenario, null);
});

test("test=1&ai=0 leaves the opponent to stand still (main-flow e2e); anything else keeps the computer", () => {
  assert.equal(parseParams("?test=1&ai=0").enemyAi, false);
  assert.equal(parseParams("?test=1&ai=1").enemyAi, true);
  assert.equal(parseParams("?test=1").enemyAi, true);
});

test("tps is capped and must be a positive whole number", () => {
  assert.equal(parseParams(`?test=1&tps=${MAX_TEST_TPS * 10}`).tps, MAX_TEST_TPS);
  for (const bad of ["0", "-5", "1.5", "abc", ""]) {
    assert.equal(parseParams(`?test=1&tps=${bad}`).tps, null, bad);
  }
});

test("開局提示：玩家的頁面每局都有；測試頁要加 hint=1 才有，其他測試直接進戰場（D-044）", () => {
  assert.equal(parseParams("").hint, true);
  assert.equal(parseParams("?v=7a8b202").hint, true);
  assert.equal(parseParams("?test=1").hint, false);
  assert.equal(parseParams("?test=1&hint=1").hint, true);
  assert.equal(parseParams("?test=1&hint=0").hint, false);
});

test("對局紀錄：test=1&logs= 改傳到那個網址（e2e 攔截用）；沒有 test=1、或不是 http(s) 都不算（D-056）", () => {
  assert.equal(parseParams("?test=1&logs=https://game-logs.test/logs").logsUrl, "https://game-logs.test/logs");
  assert.equal(parseParams("?logs=https://game-logs.test/logs").logsUrl, null);
  assert.equal(parseParams("?test=1&logs=javascript:alert(1)").logsUrl, null);
  assert.equal(parseParams("?test=1").logsUrl, null);
});
