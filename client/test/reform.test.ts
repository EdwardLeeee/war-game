// 整理隊形 (D-095): which way the soldiers face, in the order ceo and the user chose.

import assert from "node:assert/strict";
import { test } from "node:test";
import { dir16 } from "../src/sim.ts";
import { enemyTooClose, oneCluster, REFORM_CLEAR_CELLS, REFORM_LINK_CELLS, reformCell, reformFacing, SIGHTING_TICKS } from "../src/game/reform.ts";

const centre = { x: 10, y: 10 };

test("整理隊形的方向：先看最近看得到的敵人；看不到就用 60 秒內最後看到敵人的地方；再來是上次走的方向；再來是看過的敵方主城；都沒有就不變", () => {
  // The nearest of two in sight (east, 3 cells), not the farther north one.
  assert.deepEqual(reformFacing(centre, [{ x: 13, y: 10 }, { x: 10, y: 0 }], [], 1000, { x: -1, y: 0 }, { x: 80, y: 80 }), { dir: { x: 1, y: 0 }, from: "enemy" });
  // None in sight: a sighting 59 s ago (south) counts; one older than a minute does not.
  const seen = [{ x: 10, y: 15, tick: 1000 - 59 * 20 }, { x: 5, y: 10, tick: 1000 - SIGHTING_TICKS - 1 }];
  assert.deepEqual(reformFacing(centre, [], seen, 1000, { x: -1, y: 0 }, null), { dir: { x: 0, y: 1 }, from: "seen" });
  // Only the old sighting: the way they were last sent (west).
  assert.deepEqual(reformFacing(centre, [], seen.slice(1), 1000, { x: -2, y: 0 }, { x: 80, y: 10 }), { dir: { x: -1, y: 0 }, from: "last" });
  // Never sent: the enemy's main city, known.
  assert.deepEqual(reformFacing(centre, [], [], 1000, null, { x: 10, y: 0 }), { dir: { x: 0, y: -1 }, from: "city" });
  // Not known either (a random map, not scouted: no peeking into the fog): as they are.
  assert.deepEqual(reformFacing(centre, [], [], 1000, null, null), { dir: null, from: "keep" });
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
