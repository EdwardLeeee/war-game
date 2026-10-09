// ＋遠程／＋法師 (D-080): whom a tap on our arrow tower's or main city's panel calls in.

import assert from "node:assert/strict";
import { test } from "node:test";
import { CALL_REACH, type Callable, callFullText, callNoneText, pickToHide } from "../src/game/garrison.ts";
import { UnitType } from "../src/sim.ts";

const R = UnitType.Ranged;
const M = UnitType.Mage;
const tower = { cx: 20, cy: 20, size: 2 };
const C = (id: number, type: number, x: number, y: number, more: Partial<Callable> = {}): Callable => ({ id, type, x, y, idle: false, hiding: false, stationed: false, ...more });

test("挑誰：站著沒指令的先，再挑最近的；同樣遠挑編號小的", () => {
  const units = [C(1, R, 25, 20), C(2, R, 30, 20, { idle: true }), C(3, R, 40, 20, { idle: true }), C(4, R, 23, 20)];
  assert.equal(pickToHide(units, R, tower), 2, "idle before nearer ones with orders");
  assert.equal(pickToHide([C(1, R, 25, 20), C(4, R, 23, 20)], R, tower), 4, "none idle: the nearest");
  assert.equal(pickToHide([C(7, R, 24, 20, { idle: true }), C(5, R, 24, 20, { idle: true })], R, tower), 5);
});

test("不挑：別的兵種、已經躲在別棟建築（或正走過去）、城鎮留守、30 格外", () => {
  const units = [
    C(1, M, 22, 20, { idle: true }),
    C(2, R, 23, 20, { idle: true, hiding: true }),
    C(3, R, 23, 21, { idle: true, stationed: true }),
    C(4, R, 22 + CALL_REACH + 1, 20, { idle: true }),
  ];
  assert.equal(pickToHide(units, R, tower), null);
  assert.equal(pickToHide(units, M, tower), 1);
  // Right at the reach counts (to the footprint, not the centre).
  assert.equal(pickToHide([C(9, R, 22 + CALL_REACH, 21)], R, tower), 9);
});

test("提示：滿了、叫不到", () => {
  assert.equal(callFullText("箭樓", 3), "箭樓滿了（最多 3 名）");
  assert.equal(callNoneText("遠程兵"), "30 格內沒有可以叫來的遠程兵");
});
