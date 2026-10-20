// 整理隊形 (D-095): which way the soldiers face, in the order ceo and the user chose.

import assert from "node:assert/strict";
import { test } from "node:test";
import { reformCell, reformFacing, SIGHTING_TICKS } from "../src/game/reform.ts";

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
