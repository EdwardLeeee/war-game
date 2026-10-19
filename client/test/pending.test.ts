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

test("經濟分配：照最後送出的那次；選了搶又改治理也照最後一次", () => {
  const p = new PendingOrders();
  assert.equal(p.eco(), null);
  p.add({ k: "eco", seq: 1, tick: 5, food: 40, wood: 40, gold: 20, on: true });
  p.add({ k: "eco", seq: 2, tick: 5, food: 50, wood: 30, gold: 20, on: false });
  assert.deepEqual(p.eco(), { food: 50, wood: 30, gold: 20, on: false });
  p.add({ k: "town", seq: 3, tick: 5, town: 9, choice: 0 });
  p.add({ k: "town", seq: 4, tick: 5, town: 9, choice: 1 });
  assert.equal(p.townChoice(9), 1);
  assert.equal(p.townChoice(8), null);
  p.settle(5 + PENDING_STEPS + 1);
  assert.equal(p.eco(), null);
});

test("暫停中下的指令數（暫停橫幅：已下 N 個指令）：按繼續、模擬走過之後歸零；被拒絕的不算", () => {
  const p = new PendingOrders();
  p.hold(1, 100);
  p.hold(2, 100);
  p.hold(3, 100);
  for (let i = 0; i < 5; i++) p.settle(100);
  assert.equal(p.waiting, 3);
  p.refused(2);
  assert.equal(p.waiting, 2);
  p.settle(100 + PENDING_STEPS + 1);
  assert.equal(p.waiting, 0);
});
