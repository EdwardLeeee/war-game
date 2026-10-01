import assert from "node:assert/strict";
import { test } from "node:test";
import { type SplitUnit, splitPick, splitRange } from "../src/input/split.ts";

const SPEAR = 1;
const RANGED = 2;
const MAGE = 3;

/** n units of a type in a row along x, ids from `first`. */
function row(type: number, first: number, n: number, y = 0): SplitUnit[] {
  return Array.from({ length: n }, (_, i) => ({ id: first + i, type, x: i * 10, y }));
}

const typeCount = (units: SplitUnit[], ids: number[], type: number) => ids.filter((id) => units.find((u) => u.id === id)?.type === type).length;

test("分出 N 名：N 的範圍 1 到總數 − 1，預設一半（捨去）", () => {
  assert.deepEqual(splitRange(10), { min: 1, max: 9, initial: 5 });
  assert.deepEqual(splitRange(7), { min: 1, max: 6, initial: 3 });
  assert.deepEqual(splitRange(2), { min: 1, max: 1, initial: 1 });
  assert.deepEqual(splitRange(1), { min: 0, max: 0, initial: 0 });
});

test("分出 N 名：依兵種比例分配名額（6 槍兵、4 弓兵分出 5 名 → 3 槍兵、2 弓兵）", () => {
  const units = [...row(SPEAR, 1, 6), ...row(RANGED, 11, 4, 10)];
  const ids = splitPick(units, 5);
  assert.equal(ids.length, 5);
  assert.equal(typeCount(units, ids, SPEAR), 3);
  assert.equal(typeCount(units, ids, RANGED), 2);
});

test("分出 N 名：剩下的名額給餘數最大的兵種（7 槍、3 弓、1 法分出 4 名 → 3 槍、1 弓、0 法）", () => {
  // 4 × 7 / 11 = 2 餘 6；4 × 3 / 11 = 1 餘 1；4 × 1 / 11 = 0 餘 4 → 多的一名給槍兵。
  const units = [...row(SPEAR, 1, 7), ...row(RANGED, 11, 3, 10), ...row(MAGE, 21, 1, 20)];
  const ids = splitPick(units, 4);
  assert.deepEqual([typeCount(units, ids, SPEAR), typeCount(units, ids, RANGED), typeCount(units, ids, MAGE)], [3, 1, 0]);
});

test("分出 N 名：餘數一樣時，兵種編號小的先（2 槍、2 弓分出 1 名 → 槍兵）", () => {
  const units = [...row(RANGED, 1, 2), ...row(SPEAR, 11, 2, 10)];
  const ids = splitPick(units, 1);
  assert.equal(ids.length, 1);
  assert.equal(typeCount(units, ids, SPEAR), 1);
});

test("分出 N 名：同一種兵挑離整群中心最近的，距離一樣時 ID 小的先", () => {
  // x = 0, 10, 20, 30, 40（ID 1–5），中心在 20：先挑 ID 3，再來 ID 2 和 4 一樣近（ID 小的先），最後 ID 1 和 5。
  const units = row(SPEAR, 1, 5);
  assert.deepEqual(splitPick(units, 1), [3]);
  assert.deepEqual(splitPick(units, 2), [2, 3]);
  assert.deepEqual(splitPick(units, 3), [2, 3, 4]);
  assert.deepEqual(splitPick(units, 4), [1, 2, 3, 4]);
});

test("分出 N 名：N 超出範圍時夾到 1 或總數 − 1；少於 2 名時不分", () => {
  const units = row(SPEAR, 1, 4);
  assert.equal(splitPick(units, 0).length, 1);
  assert.equal(splitPick(units, 99).length, 3);
  assert.deepEqual(splitPick(row(SPEAR, 1, 1), 1), []);
  assert.deepEqual(splitPick([], 3), []);
});

test("分出 N 名：回傳的 ID 由小到大，不受輸入順序影響", () => {
  const units = [...row(SPEAR, 1, 6), ...row(RANGED, 11, 4, 10)];
  const reversed = [...units].reverse();
  assert.deepEqual(splitPick(reversed, 5), splitPick(units, 5));
  const ids = splitPick(units, 5);
  assert.deepEqual(ids, [...ids].sort((a, b) => a - b));
});
