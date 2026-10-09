// 進攻到底 (D-080): who is sent on after an attack ends, and who never is.

import assert from "node:assert/strict";
import { test } from "node:test";
import { Charges, type ChargeUnit, FOLLOW_ARRIVED_CELLS, FOLLOW_WAIT_TICKS } from "../src/game/follow.ts";

const units = (m: Record<number, ChargeUnit | null>) => (id: number) => m[id] ?? null;
const at = (x: number, y: number) => () => ({ x, y });
const gone = () => null;

test("目標倒下、攻擊結束時，還離得遠的兵接著前進到目標最後在的地方；已經到的不送", () => {
  const c = new Charges();
  c.start([1, 2, 3], 99, { x: 50, y: 50 }, 0);
  // Attacking: nothing to do, and the target moves on to (52, 50).
  assert.deepEqual(c.update(5, units({ 1: { x: 49, y: 50, attacking: true }, 2: { x: 20, y: 50, attacking: true }, 3: { x: 22, y: 51, attacking: true } }), at(52, 50)), []);
  // It falls: 1 is there, 2 and 3 are 30 cells off.
  assert.deepEqual(c.update(10, units({ 1: { x: 51, y: 50, attacking: false }, 2: { x: 22, y: 50, attacking: false }, 3: { x: 24, y: 51, attacking: false } }), gone), [{ ids: [2, 3], x: 52, y: 50 }]);
  // Once: they are not followed any more.
  assert.deepEqual(c.ids(), []);
  assert.deepEqual(c.update(20, units({ 2: { x: 23, y: 50, attacking: false } }), gone), []);
});

test("還沒在快照裡看到攻擊：等 1 秒；之後還是沒在攻擊（被拒、馬上結束），照樣前進到目標那裡", () => {
  const c = new Charges();
  c.start([1], 99, { x: 40, y: 10 }, 100);
  const idle = units({ 1: { x: 10, y: 10, attacking: false } });
  assert.deepEqual(c.update(100 + FOLLOW_WAIT_TICKS - 1, idle, at(40, 10)), [], "the order has not reached the snapshot yet");
  assert.deepEqual(c.update(100 + FOLLOW_WAIT_TICKS, idle, gone), [{ ids: [1], x: 40, y: 10 }]);
});

test("玩家的新指令、到了、躲進建築或留守、死了：都不再補送", () => {
  const c = new Charges();
  c.start([1, 2, 3, 4], 99, { x: 50, y: 50 }, 0);
  const far = { x: 10, y: 50, attacking: true };
  assert.deepEqual(c.update(5, units({ 1: far, 2: far, 3: far, 4: far }), at(50, 50)), []);
  // 1: the player sends it elsewhere. 2: hides in a tower or stays in a town (null). 3: dies (null).
  c.drop([1]);
  // 4 comes within reach and its attack ends there.
  const out = c.update(30, units({ 1: { x: 10, y: 50, attacking: false }, 4: { x: 50 - FOLLOW_ARRIVED_CELLS + 1, y: 50, attacking: false } }), gone);
  assert.deepEqual(out, []);
  assert.deepEqual(c.ids(), []);
});

test("目標從沒看到過（不知道在哪）：不補送", () => {
  const c = new Charges();
  c.start([1], 99, null, 0);
  assert.deepEqual(c.update(FOLLOW_WAIT_TICKS, units({ 1: { x: 10, y: 10, attacking: false } }), gone), []);
  assert.deepEqual(c.ids(), []);
});

test("同一刻、同一個地方的兵一起送一道前進（隊形一起排）；不同目標分開送", () => {
  const c = new Charges();
  c.start([5, 3], 90, { x: 30, y: 30 }, 0);
  c.start([7], 91, { x: 60.4, y: 20.9 }, 0);
  const all = units({ 3: { x: 1, y: 1, attacking: true }, 5: { x: 2, y: 1, attacking: true }, 7: { x: 3, y: 1, attacking: true } });
  c.update(1, all, (id) => (id === 90 ? { x: 30.5, y: 30.5 } : { x: 60.4, y: 20.9 }));
  const ended = units({ 3: { x: 1, y: 1, attacking: false }, 5: { x: 2, y: 1, attacking: false }, 7: { x: 3, y: 1, attacking: false } });
  assert.deepEqual(c.update(2, ended, gone), [
    { ids: [3, 5], x: 30, y: 30 },
    { ids: [7], x: 60, y: 20 },
  ]);
});
