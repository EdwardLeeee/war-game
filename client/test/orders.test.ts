// 進攻中／撤退中／堅守／待命 (D-050, D-054): the state the buttons light up for and 取消即堅守 reads.

import assert from "node:assert/strict";
import { test } from "node:test";
import { allIn, orderCounts, orderState } from "../src/game/orders.ts";
import { Order, Stance, UnitType } from "../src/sim.ts";

const units = new Map<number, { type: number; stance: number; order: number }>([
  [1, { type: UnitType.Spearman, stance: Stance.Aggressive, order: Order.None }],
  [2, { type: UnitType.Spearman, stance: Stance.Aggressive, order: Order.Move }],
  [3, { type: UnitType.Ranged, stance: Stance.Aggressive, order: Order.Attack }],
  [4, { type: UnitType.Mage, stance: Stance.Aggressive, order: Order.Cast }],
  [5, { type: UnitType.Spearman, stance: Stance.Hold, order: Order.None }],
  [6, { type: UnitType.Spearman, stance: Stance.Hold, order: Order.Retreat }],
  [7, { type: UnitType.Farmer, stance: Stance.Aggressive, order: Order.Gather }],
]);
const w = {
  unitType: (id: number) => units.get(id)?.type ?? -1,
  unitStance: (id: number) => units.get(id)?.stance ?? -1,
  unitOrder: (id: number) => units.get(id)?.order ?? -1,
};

test("狀態：撤退指令＝撤退中；堅守；前進、攻擊、晶砲＝進攻中；站著沒有指令＝待命（D-054）", () => {
  assert.equal(orderState(w, 1), "idle");
  assert.equal(orderState(w, 2), "advance");
  assert.equal(orderState(w, 3), "advance");
  assert.equal(orderState(w, 4), "advance");
  assert.equal(orderState(w, 5), "hold");
  assert.equal(orderState(w, 6), "retreat", "a retreat order wins over the stance");
});

test("狀態：只算士兵；全部同一種時才算 allIn（那顆按鈕亮、再按就停下堅守）", () => {
  assert.deepEqual(orderCounts(w, [1, 2, 3, 4, 5, 6, 7]), { advance: 3, retreat: 1, hold: 1, idle: 1 });
  assert.equal(orderCounts(w, [7]), null, "farmers only");
  assert.equal(allIn(w, [2, 3, 7], "advance"), true, "the farmer does not count");
  assert.equal(allIn(w, [2, 3, 1], "advance"), false);
  assert.equal(allIn(w, [6], "retreat"), true);
  assert.equal(allIn(w, [7], "advance"), false, "no soldier: nothing lit");
});
