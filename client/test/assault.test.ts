// 攻城打到底 (the user 2026-10-25: 「攻進去就停了不會繼續打至佔領，要再按第二次才會繼續打」): soldiers
// sent at a town not ours who stand with no order go at its nearest defender; from outside while
// every gate stands, at the nearest gate (ceo); none seen, into its centre; an order to them that
// the snapshot does not show yet is not sent again; another order of the player's ends it.

import assert from "node:assert/strict";
import { test } from "node:test";
import { ASSAULT_EVERY, ASSAULT_SENT_TICKS, type AssaultScene, Assaults, assaultOrders } from "../src/game/assault.ts";

const SCENE: AssaultScene = {
  attackers: [
    { id: 1, x: 20, y: 30, idle: true, inside: true },
    { id: 2, x: 21, y: 30, idle: true, inside: true },
    { id: 3, x: 22, y: 31, idle: false, inside: true },
  ],
  // Militia on the far wall, one nearer; the tower.
  defenders: [
    { id: 50, x: 26, y: 36 },
    { id: 51, x: 22, y: 33 },
    { id: 60, x: 24, y: 34 },
  ],
  gates: [{ id: 70, x: 24, y: 23 }],
  open: true,
  centre: { x: 24.5, y: 30.5 },
};

test("城裡站著沒有指令的兵：派去打最近的守軍（民兵、牆上的民兵、箭樓），有指令的不管", () => {
  assert.deepEqual(assaultOrders(SCENE), [{ c: "attack", u: [1, 2], target: 51 }]);
  assert.deepEqual(assaultOrders({ ...SCENE, attackers: SCENE.attackers.map((a) => ({ ...a, idle: false })) }), []);
});

test("門還沒破、兵停在牆外：先打最近的城門（ceo）；有門破了就照城裡的打", () => {
  const outside: AssaultScene = {
    ...SCENE,
    open: false,
    attackers: [
      { id: 1, x: 24, y: 21, idle: true, inside: false },
      { id: 2, x: 25, y: 21, idle: true, inside: false },
      { id: 4, x: 22, y: 33, idle: true, inside: true },
    ],
    gates: [
      { id: 70, x: 24, y: 23 },
      { id: 71, x: 30, y: 30 },
    ],
  };
  assert.deepEqual(assaultOrders(outside), [
    { c: "attack", u: [1, 2], target: 70 },
    { c: "attack", u: [4], target: 51 },
  ]);
  // The nearest from where they stand together (23.7, 25): the militia at (22, 33).
  assert.deepEqual(assaultOrders({ ...outside, open: true }), [{ c: "attack", u: [1, 2, 4], target: 51 }]);
  // No gate seen: as if open (they walk up and see it next time).
  assert.deepEqual(assaultOrders({ ...outside, gates: [] }), [{ c: "attack", u: [1, 2, 4], target: 51 }]);
});

test("守軍都看不到：攻擊移動到城中心；已經在中心的不再送", () => {
  assert.deepEqual(assaultOrders({ ...SCENE, defenders: [] }), [{ c: "move", u: [1, 2], x: 24, y: 30 }]);
  const there: AssaultScene = { ...SCENE, defenders: [], attackers: [{ id: 1, x: 24, y: 31, idle: true, inside: true }] };
  assert.deepEqual(assaultOrders(there), []);
});

test("誰在攻哪座城：玩家下攻擊就記下，換下別的指令就不算；死了的拿掉；同一名兵只算一座城", () => {
  const a = new Assaults();
  a.begin(5, [1, 2, 3]);
  a.begin(6, [3, 4]);
  assert.deepEqual(a.list(), [
    { town: 5, ids: [1, 2] },
    { town: 6, ids: [3, 4] },
  ]);
  a.drop([1, 2]);
  assert.deepEqual(a.list(), [{ town: 6, ids: [3, 4] }]);
  a.prune((id) => id !== 4);
  assert.deepEqual(a.list(), [{ town: 6, ids: [3] }]);
  a.end(6);
  assert.deepEqual(a.list(), []);
});

test("後到的兵加入攻城：同編隊站在城旁的才由 Game 交進來；已在攻城的、攻城開始後玩家另外下過指令的不算；全隊新指令就全停", () => {
  const a = new Assaults();
  // No attack on this town: nobody joins.
  assert.deepEqual(a.join(5, [1]), []);
  a.begin(5, [1, 2]);
  a.begin(6, [3]);
  assert.deepEqual(a.join(5, [2, 3, 4]), [4], "2 and 3 are in an attack already");
  assert.deepEqual(a.list(), [
    { town: 5, ids: [1, 2, 4] },
    { town: 6, ids: [3] },
  ]);
  // The player sends 7, a recruit, somewhere else: it stays out of it from then on.
  a.drop([7]);
  assert.deepEqual(a.join(5, [7]), []);
  // His own attack on the town takes it in again.
  a.begin(5, [7]);
  assert.deepEqual(a.list()[0], { town: 5, ids: [1, 2, 4, 7] });
  // Put into another group, no order of his: it leaves the attack and may join the new group's.
  a.drop([4], false);
  assert.deepEqual(a.join(5, [4]), [4]);
  // All of it ordered away: nothing left, and the next attack starts clean.
  a.drop([1, 2, 3, 4, 7]);
  assert.deepEqual(a.list(), []);
  a.begin(5, [1]);
  assert.deepEqual(a.join(5, [2]), [2]);
});

test("送出去的自動攻擊：快照看到他們有指令、被拒、或 30 秒都沒消息才再送；兩次之間至少隔 1 秒", () => {
  const a = new Assaults();
  a.begin(5, [1, 2]);
  const none = () => false;
  assert.equal(a.due(5, 100, none), true);
  a.sentNow(5, 7, 100, [1]);
  a.sentNow(5, 8, 100, [2]);
  // The page behind its snapshots: 40 steps and still no order shown: not again.
  assert.equal(a.due(5, 140, none), false);
  // Shown: again once ASSAULT_EVERY has passed since.
  assert.equal(a.due(5, 100 + ASSAULT_EVERY - 1, (id) => id === 2), false);
  assert.equal(a.due(5, 100 + ASSAULT_EVERY, none), true);
  a.sentNow(5, 9, 200, [1]);
  a.refused(9);
  assert.equal(a.due(5, 200 + ASSAULT_EVERY, none), true);
  a.sentNow(5, 10, 300, [1]);
  assert.equal(a.due(5, 300 + ASSAULT_SENT_TICKS, none), false);
  assert.equal(a.due(5, 301 + ASSAULT_SENT_TICKS, none), true, "lost");
});
