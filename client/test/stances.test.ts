// 姿態 sent and not shown yet (D-081): what 前進 and 撤退 go by right after 取消 or 堅守.

import assert from "node:assert/strict";
import { test } from "node:test";
import { SentStances, STANCE_WAIT_TICKS } from "../src/game/stances.ts";
import { Stance } from "../src/sim.ts";

test("取消（堅守）之後馬上前進：快照還寫積極，照剛送出的堅守算，所以前進會把他們改回積極", () => {
  const s = new SentStances();
  s.note([1, 2], Stance.Hold, 100);
  assert.equal(s.of(1, Stance.Aggressive), Stance.Hold);
  assert.equal(s.of(3, Stance.Aggressive), Stance.Aggressive, "nothing sent: the snapshot's");
});

test("快照跟上了就忘掉；單位不見、或等太久（模擬拒絕）也忘掉", () => {
  const s = new SentStances();
  s.note([1, 2, 3], Stance.Hold, 100);
  s.settle(101, (id) => (id === 1 ? Stance.Hold : id === 2 ? null : Stance.Aggressive));
  assert.equal(s.of(1, Stance.Aggressive), Stance.Aggressive, "shown, forgotten");
  assert.equal(s.of(2, Stance.Aggressive), Stance.Aggressive, "gone");
  assert.equal(s.of(3, Stance.Aggressive), Stance.Hold, "still waiting");
  s.settle(100 + STANCE_WAIT_TICKS + 1, () => Stance.Aggressive);
  assert.equal(s.of(3, Stance.Aggressive), Stance.Aggressive, "waited too long");
});

test("後送的蓋過先送的", () => {
  const s = new SentStances();
  s.note([1], Stance.Hold, 100);
  s.note([1], Stance.Aggressive, 101);
  assert.equal(s.of(1, Stance.Hold), Stance.Aggressive);
});
