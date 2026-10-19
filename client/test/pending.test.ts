// 指令送出、快照還沒反映 (the user 2026-10-19): shown until the simulation has taken it.

import assert from "node:assert/strict";
import { test } from "node:test";
import { PENDING_STEPS, PendingOrders } from "../src/game/pending.ts";

test("送出的指令：遊戲暫停時一直留著（tick 不動），模擬走過兩步後放掉；被拒絕的馬上放掉", () => {
  const p = new PendingOrders();
  p.add({ k: "build", seq: 1, tick: 100, type: 1, x: 10, y: 12 });
  p.add({ k: "train", seq: 2, tick: 100, building: 7, unit: 1 });
  p.add({ k: "train", seq: 3, tick: 100, building: 7, unit: 2 });
  p.add({ k: "auto", seq: 4, tick: 100, building: 7, on: false });
  // Paused: the snapshot's tick stands still.
  for (let i = 0; i < 5; i++) p.settle(100);
  assert.deepEqual(p.sites(), [{ k: "build", seq: 1, tick: 100, type: 1, x: 10, y: 12 }]);
  assert.deepEqual(p.trains(7), [1, 2]);
  assert.deepEqual(p.trains(8), []);
  assert.equal(p.autoTrain(7), false);
  assert.equal(p.autoTrain(8), null);
  p.refused(3);
  assert.deepEqual(p.trains(7), [1]);
  p.settle(100 + PENDING_STEPS);
  assert.equal(p.size, 3);
  p.settle(100 + PENDING_STEPS + 1);
  assert.equal(p.size, 0);
});

test("自動訓練連按兩次：照最後送出的那次", () => {
  const p = new PendingOrders();
  p.add({ k: "auto", seq: 1, tick: 5, building: 3, on: false });
  p.add({ k: "auto", seq: 2, tick: 5, building: 3, on: true });
  assert.equal(p.autoTrain(3), true);
});
