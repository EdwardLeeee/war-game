// 等錢治理 (ceo 2026-10-21; the user: 「錢夠了自動開始修繕」): what is missing, when the game sends
// 治理 by itself, and the reserve raised while towns wait so that 自動訓練 does not spend the cost.

import assert from "node:assert/strict";
import { test } from "node:test";
import { affords, costText, GovernWaits, RETRY_TICKS, shortfall } from "../src/game/govern-wait.ts";

const c = (food: number, wood: number, gold: number, crystal = 0) => ({ food, wood, gold, crystal });
const SMALL = c(0, 80, 80);
const LARGE = c(0, 150, 150);
const OWN = c(0, 150, 100, 15);

test("還差多少：只列不夠的資源；花費照資源列的順序寫", () => {
  assert.deepEqual(shortfall(LARGE, c(500, 200, 120, 20)), c(0, 0, 30));
  assert.deepEqual(shortfall(SMALL, c(0, 50, 20)), c(0, 30, 60));
  assert.equal(costText(SMALL), "木 80、金 80");
  assert.equal(costText(shortfall(SMALL, c(0, 50, 20))), "木 30、金 60");
  assert.equal(affords(LARGE, c(0, 150, 150)), true);
  assert.equal(affords(LARGE, c(0, 150, 149)), false);
});

test("等錢時預留暫時提高到等待中最大的花費（每種資源取玩家自己的和花費的較大者），最後一座結束時送回玩家自己的", () => {
  const w = new GovernWaits();
  assert.equal(w.raised(), null);
  // A small town: 木 80、金 80 are under the player's 150/100, nothing to send.
  assert.equal(w.start(1, SMALL, OWN), null);
  assert.deepEqual(w.raised(), OWN);
  // A large city too: gold up to 150.
  assert.deepEqual(w.start(2, LARGE, OWN), c(0, 150, 150, 15));
  assert.equal(w.raisedText(), "木 150、金 150");
  // The same town again changes nothing.
  assert.equal(w.start(2, LARGE, OWN), null);
  // The large city's wait ends: back to the player's own (the small town's cost is under it).
  assert.deepEqual(w.end(2), OWN);
  // The last one: the player's own again, already in effect.
  assert.equal(w.end(1), null);
  assert.equal(w.raised(), null);
  assert.equal(w.raisedText(), "");
  assert.equal(w.size, 0);
});

test("等錢時玩家改預留：那就是他自己的值，暫時提高的照樣疊在上面；結束後送回他改的", () => {
  const w = new GovernWaits();
  assert.deepEqual(w.start(2, LARGE, OWN), c(0, 150, 150, 15));
  // He lowers gold to 50 and raises wood to 200: gold stays raised to 150 for the wait.
  assert.deepEqual(w.setOwn(c(0, 200, 50, 15)), c(0, 200, 150, 15));
  assert.deepEqual(w.ownReserve(c(9, 9, 9, 9)), c(0, 200, 50, 15));
  assert.deepEqual(w.end(2), c(0, 200, 50, 15));
  // Nothing waiting: what he sets is what is sent.
  assert.deepEqual(w.setOwn(c(0, 100, 100, 0)), c(0, 100, 100, 0));
  assert.deepEqual(w.ownReserve(c(1, 2, 3, 4)), c(1, 2, 3, 4));
});

test("錢夠了才送治理；送出去沒有回應前不再送；因為錢被同一步花掉而被拒，1 秒後再試", () => {
  const w = new GovernWaits();
  w.start(2, LARGE, OWN);
  assert.equal(w.due(2, c(0, 200, 149), 100), false);
  assert.equal(w.due(2, c(0, 200, 150), 100), true);
  w.sent(2, 41);
  assert.equal(w.isSent(2), true);
  assert.equal(w.townOf(41), 2);
  assert.equal(w.due(2, c(0, 200, 150), 101), false);
  w.retry(2, 110);
  assert.equal(w.isSent(2), false);
  assert.equal(w.due(2, c(0, 200, 150), 110 + RETRY_TICKS - 1), false);
  assert.equal(w.due(2, c(0, 200, 150), 110 + RETRY_TICKS), true);
  assert.equal(w.due(9, c(0, 999, 999), 999), false);
});

test("等錢治理存進存檔：等待中的城鎮、花費和玩家自己的預留；繼續後照樣等", () => {
  const w = new GovernWaits();
  w.start(2, LARGE, OWN);
  w.sent(2, 7);
  const saved = JSON.parse(JSON.stringify(w.save()));
  assert.deepEqual(saved, { towns: [{ town: 2, cost: LARGE }], own: OWN });
  const back = new GovernWaits();
  back.restore(saved);
  assert.deepEqual(back.list(), [2]);
  assert.deepEqual(back.raised(), c(0, 150, 150, 15));
  assert.equal(back.isSent(2), false);
  assert.deepEqual(back.end(2), OWN);
  // A save from before (no field), or with nothing waiting.
  back.restore(undefined);
  assert.equal(back.size, 0);
  back.restore({ towns: [], own: null });
  assert.equal(back.raised(), null);
});
