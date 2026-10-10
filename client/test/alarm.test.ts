// 閃紅提醒 (D-081): the base at the start of each attack, the alarm under half, once on the strip.

import assert from "node:assert/strict";
import { test } from "node:test";
import { alarmText, GroupAlarms, groupAdvancing } from "../src/game/alarm.ts";
import { ArmyBook } from "../src/game/army.ts";
import type { OrderState } from "../src/game/orders.ts";
import { UnitType } from "../src/sim.ts";

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

test("自動補兵帶過來的新兵（走在路上、order 是前進）不算進攻：待命的軍團不出「退」、不記基準；玩家下進攻後照常算（D-081）", () => {
  const book = new ArmyBook();
  book.saveGroup(0, [1, 2, 3].map((id) => ({ id, type: UnitType.Spearman })));
  // The group wants a fourth; one is trained: 自動補兵 adds it, and muster sends it on with a 前進 of its own.
  const typeOf = () => UnitType.Spearman;
  book.setWant(0, UnitType.Spearman, 4, typeOf);
  assert.equal(book.enlist(4, UnitType.Spearman, typeOf), 0);
  const g = book.groups[0];
  const state = (moving: number[]) => (id: number): OrderState => (moving.includes(id) ? "advance" : "idle");
  assert.equal(groupAdvancing(g.ids, g.recruits, state([4])), false, "only the recruit walks");
  const a = new GroupAlarms();
  assert.deepEqual(a.update(0, groupAdvancing(g.ids, g.recruits, state([4])), 4), { advancing: false, base: null, alarm: false, tell: false });
  // The player sends the group on: everyone 進攻中, the recruit now on his order (byHand).
  book.playerCommand({ c: "move", u: [1, 2, 3, 4], x: 50, y: 50 });
  assert.equal(groupAdvancing(g.ids, g.recruits, state([1, 2, 3, 4])), true);
  assert.equal(a.update(0, true, 4).base, 4, "the base counts from the player's attack");
  // A recruit the player ordered himself counts on his own.
  assert.equal(groupAdvancing(g.ids, g.recruits, state([4])), true);
  // Those left out (hiding in a building: null) do not make it advance.
  assert.equal(groupAdvancing([1, 2], [], (id) => (id === 1 ? null : "idle")), false);
});
