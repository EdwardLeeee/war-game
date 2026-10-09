// 哨所 (D-080): 駐守's tap, the mode line, and whom ＋槍兵 calls (the same picking as ＋遠程).

import assert from "node:assert/strict";
import { test } from "node:test";
import { features, buildable, outpostSlots } from "../src/game/features.ts";
import { type Callable, pickToHide } from "../src/game/garrison.ts";
import { isPosted, outpostModeText, POST_TYPE, POST_WRONG_TARGET, postTap } from "../src/game/outpost.ts";
import { BuildingType, Order, type Rules, UnitType } from "../src/sim.ts";

const outpost = { id: 9, owner: 0, type: BuildingType.Outpost, done: true };
const spear = (id: number) => id < 10;

test("駐守：選取裡只有槍兵去；點的不是自己蓋好的哨所就說明要點什麼", () => {
  assert.deepEqual(postTap([1, 2, 15], outpost, 0, spear), { cmd: { c: "post", u: [1, 2], building: 9 } });
  assert.deepEqual(postTap([15, 16], outpost, 0, spear), { error: "只有槍兵能駐守" });
  for (const t of [null, { ...outpost, owner: 1 }, { ...outpost, done: false }, { ...outpost, type: BuildingType.ArrowTower }]) {
    assert.deepEqual(postTap([1], t, 0, spear), { error: POST_WRONG_TARGET });
  }
});

test("攻擊／堅守的說明照這一局的 rules.outpost 寫數字", () => {
  const rules = { outpost: { slots: 6, reach: 8, chase: 12 } } as Pick<Rules, "outpost">;
  assert.equal(outpostModeText(rules, false), "攻擊：敵兵進到哨所 8 格內就去打，追到 12 格就回來");
  assert.equal(outpostModeText(rules, true), "堅守：站在哨所旁不動，只打走到身邊的；哨所或駐守的兵被打，就一起去打，追到 12 格就回來");
});

test("開關：沒開 outpost 時建造選單沒有哨所、駐守名額是 0；開了照 rules", () => {
  const off = { features: { plunderOnce: true, towers: true, garrison: true, cavalry: true }, outpost: { slots: 6, reach: 8, chase: 12 } } as Pick<Rules, "features" | "outpost">;
  assert.equal(features(off).outpost, false);
  assert.equal(buildable(off, BuildingType.Outpost), false);
  assert.equal(outpostSlots(off), 0);
  const on = { outpost: off.outpost, features: { plunderOnce: true, towers: true, garrison: true, cavalry: true, outpost: true } } as Pick<Rules, "features" | "outpost">;
  assert.equal(buildable(on, BuildingType.Outpost), true);
  assert.equal(outpostSlots(on), 6);
});

test("＋槍兵挑誰：和＋遠程一樣（站著沒指令的先、近的先、30 格內）；已經駐守或躲著的、留守的不挑", () => {
  assert.equal(POST_TYPE, UnitType.Spearman);
  assert.equal(isPosted(Order.Post), true);
  assert.equal(isPosted(Order.Garrison), false);
  const post = { cx: 20, cy: 20, size: 2 };
  const C = (id: number, x: number, more: Partial<Callable> = {}): Callable => ({ id, type: UnitType.Spearman, x, y: 20, idle: false, hiding: false, stationed: false, ...more });
  // 1 posted elsewhere (hiding true: busy), 2 stationed in a town, 3 walking near, 4 standing farther.
  const units = [C(1, 23, { idle: true, hiding: true }), C(2, 23, { idle: true, stationed: true }), C(3, 24), C(4, 30, { idle: true })];
  assert.equal(pickToHide(units, POST_TYPE, post), 4);
  assert.equal(pickToHide(units.slice(0, 3), POST_TYPE, post), 3);
  assert.equal(pickToHide(units.slice(0, 2), POST_TYPE, post), null);
});
