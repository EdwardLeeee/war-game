// 整理隊形 (D-095): which way the soldiers face (the user 2026-10-24: 「軍隊整理應該改成是面向前進的方向整隊」).

import assert from "node:assert/strict";
import { test } from "node:test";
import { dir16 } from "../src/sim.ts";
import { ARRIVED_CELLS, enemyTooClose, oneCluster, REFORM_CLEAR_CELLS, REFORM_LINK_CELLS, reformCell, reformFacing } from "../src/game/reform.ts";

const centre = { x: 10, y: 10 };
const middle = { x: 48, y: 48 };

test("整理隊形的方向：有指令（現在的或最後送的）就面向它要去的地方，不管附近的敵人和敵方主城", () => {
  // Sent east to (30, 10): east, though the enemy's main city is north.
  assert.deepEqual(reformFacing(centre, { to: { x: 30, y: 10 }, went: { x: 1, y: 0 } }, { x: 10, y: 0 }, middle), { dir: { x: 1, y: 0 }, from: "order" });
  // From where they are now (the middle of the group), not from where they were sent: south of it now, so north-east.
  const r = reformFacing({ x: 30, y: 20 }, { to: { x: 40, y: 10 }, went: { x: 1, y: 0 } }, null, middle);
  assert.equal(r.from, "order");
  assert.ok(Math.abs((r.dir?.x ?? 0) - Math.SQRT1_2) < 1e-9 && Math.abs((r.dir?.y ?? 0) + Math.SQRT1_2) < 1e-9);
});

test("整理隊形的方向：已經到了（指令的地點 2 格內）就面向剛才走的方向；不知道怎麼走來的就不變", () => {
  assert.equal(ARRIVED_CELLS, 2);
  assert.deepEqual(reformFacing({ x: 29, y: 11 }, { to: { x: 30, y: 10 }, went: { x: 0, y: -5 } }, { x: 80, y: 80 }, middle), { dir: { x: 0, y: -1 }, from: "went" });
  assert.deepEqual(reformFacing({ x: 30, y: 10 }, { to: { x: 30, y: 10 }, went: null }, { x: 80, y: 80 }, middle), { dir: null, from: "keep" });
});

test("整理隊形的方向：從沒下過指令（剛訓練出來）才看敵方主城（看過的），沒看過就面向地圖中央", () => {
  assert.deepEqual(reformFacing(centre, null, { x: 10, y: 0 }, middle), { dir: { x: 0, y: -1 }, from: "city" });
  const r = reformFacing(centre, null, null, middle);
  assert.equal(r.from, "centre");
  assert.equal(dir16(Math.round((r.dir?.x ?? 0) * 1024), Math.round((r.dir?.y ?? 0) * 1024)), 2, "south-east, to the middle");
  // Standing on the middle itself: as they are.
  assert.deepEqual(reformFacing(middle, null, null, middle), { dir: null, from: "keep" });
});

test("整理隊形走向的格子：中心往那個方向一格", () => {
  assert.deepEqual(reformCell({ x: 18.5, y: 59.5 }, { x: 1, y: 0 }), { x: 19, y: 59 });
  assert.deepEqual(reformCell({ x: 18.5, y: 59.5 }, { x: 0, y: -1 }), { x: 18, y: 58 });
});

test("整理隊形：任何一名士兵 8 格內有敵人就不整理（量過：4～6 格外的弓兵讓整理中的隊伍 6 秒掉 96 血，站著只掉 12～17）", () => {
  assert.equal(REFORM_CLEAR_CELLS, 8);
  const group = [{ x: 10, y: 10 }, { x: 10, y: 14 }];
  // 7.9 cells from the second soldier (the first is farther): too close.
  assert.equal(enemyTooClose(group, [{ x: 10, y: 21.9 }]), true);
  // 8 cells from the nearest: clear; none in sight: clear.
  assert.equal(enemyTooClose(group, [{ x: 10, y: 22 }, { x: 18, y: 10 }]), false);
  assert.equal(enemyTooClose(group, []), false);
});

test("整理隊形：彼此 8 格內連得起來（可以經過別人）算同一堆，模擬原地排；有一群離得更遠就不是", () => {
  assert.equal(REFORM_LINK_CELLS, 8);
  // A line 8 cells apart each: linked through the middle one, though the ends are 16 apart.
  assert.equal(oneCluster([{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 16, y: 0 }]), true);
  // Spearmen 6 cells ahead after a chase: still one lot. 9 cells: two.
  assert.equal(oneCluster([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 6 }, { x: 1, y: 6.5 }]), true);
  assert.equal(oneCluster([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 9 }, { x: 1, y: 9.5 }]), false);
  assert.equal(oneCluster([{ x: 5, y: 5 }]), true);
  assert.equal(oneCluster([]), false);
});

test("整理隊形的 face：方向換成模擬的 16 方位（0 東、4 南、8 西、12 北，世界座標）", () => {
  const face = (x: number, y: number) => dir16(Math.round(x * 1024), Math.round(y * 1024));
  assert.deepEqual([face(1, 0), face(0, 1), face(-1, 0), face(0, -1)], [0, 4, 8, 12]);
  // 45 degrees south-east, and a little east of south (22.5 degrees is a step).
  assert.equal(face(Math.SQRT1_2, Math.SQRT1_2), 2);
  assert.equal(face(Math.sin(Math.PI / 8), Math.cos(Math.PI / 8)), 3);
});
