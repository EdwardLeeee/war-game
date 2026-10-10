// 閃紅提醒 (D-081): the base at the start of each attack, the alarm under half, once on the strip.

import assert from "node:assert/strict";
import { test } from "node:test";
import { alarmText, GroupAlarms } from "../src/game/alarm.ts";

test("開始進攻那一刻的現有是基準；剩不到一半才閃紅，提示只跳一次", () => {
  const a = new GroupAlarms();
  assert.deepEqual(a.update(0, true, 12), { advancing: true, base: 12, alarm: false, tell: false });
  assert.equal(a.update(0, true, 6).alarm, false, "half is not fewer than half");
  assert.deepEqual(a.update(0, true, 5), { advancing: true, base: 12, alarm: true, tell: true });
  assert.deepEqual(a.update(0, true, 4), { advancing: true, base: 12, alarm: true, tell: false }, "said once");
  // New soldiers joining during the attack do not move the base.
  assert.equal(a.update(0, true, 7).alarm, false);
  assert.equal(alarmText(0, 4, 12), "編隊 1 快撐不住了（剩 4/12）");
});

test("停止進攻（撤退、堅守、站著）提醒就消失；下一次進攻重新記基準、可以再跳一次", () => {
  const a = new GroupAlarms();
  a.update(1, true, 10);
  assert.equal(a.update(1, true, 3).tell, true);
  assert.deepEqual(a.update(1, false, 3), { advancing: false, base: null, alarm: false, tell: false });
  assert.deepEqual(a.update(1, true, 3), { advancing: true, base: 3, alarm: false, tell: false }, "the new attack starts at 3");
  assert.equal(a.update(1, true, 1).tell, true, "said again in the new attack");
});

test("各編隊各算各的；基準 0 不閃", () => {
  const a = new GroupAlarms();
  a.update(0, true, 8);
  a.update(2, true, 0);
  assert.equal(a.update(0, true, 3).alarm, true);
  assert.equal(a.update(2, true, 0).alarm, false);
  assert.equal(a.update(3, false, 5).alarm, false);
});
