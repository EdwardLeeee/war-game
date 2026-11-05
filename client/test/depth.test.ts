// 前後與點選 (方形斜看, D-088; war-game-ui 2026-10-19): drawn by the front edge, a tap reaching the
// last drawn that holds the finger, with the same order.

import assert from "node:assert/strict";
import { test } from "node:test";
import { DIAMOND, OBLIQUE } from "../src/camera/projection.ts";
import { buildingFront, depthOf, drawOrder, nodeFront, pieceDepth, POST_LIFT, type Standing, tapped } from "../src/render/depth.ts";
import { TILE_PX } from "../src/tuning.ts";

const plane = (cx: number, cy: number) => OBLIQUE.toPlane(cx * TILE_PX, cy * TILE_PX);

/** A 3 × 3 building at (10, 10): its picture as tall again as its footprint is deep. */
function barracks(id: number): Standing {
  const front = buildingFront(10, 3);
  const a = plane(10, 10);
  const b = plane(13, 13);
  return { id, front, x: 10, box: { x0: a.x, y0: a.y - 3 * 20, x1: b.x, y1: b.y } };
}

/** A unit at (x, y) cells: 0.5 cell wide, 1.8 m tall on the plane. */
function soldier(id: number, x: number, y: number): Standing {
  const p = plane(x, y);
  return { id, front: y, x, box: { x0: p.x - 10, y0: p.y - 31, x1: p.x + 10, y1: p.y } };
}

test("前後：站在建築前緣前面的兵，排在建築後面畫；前緣一樣時 x 小的先畫、再看編號", () => {
  const b = barracks(1);
  const front = soldier(2, 11.5, 13.4);
  const behind = soldier(3, 11.5, 9.6);
  const order = [front, b, behind].sort(drawOrder).map((s) => s.id);
  assert.deepEqual(order, [3, 1, 2]);
  assert.ok(drawOrder({ ...front, front: 13, x: 4 }, { ...b, x: 10 }) < 0, "level: the smaller x first");
  assert.equal(nodeFront(7), 8);
});

test("點選：站在建築正後方的兵，被擋住的部分點到的是建築；露出來的部分點到兵", () => {
  const b = barracks(1);
  // Just behind its back edge (y 10): the building is drawn over him.
  const hidden = soldier(2, 11.5, 9.8);
  const p = plane(11.5, 9.8);
  assert.equal(tapped([hidden, b], p.x, p.y - 5)?.id, 1);
  // A soldier beside it, clear of its picture: him.
  const beside = soldier(3, 14.5, 12);
  const q = plane(14.5, 12);
  assert.equal(tapped([beside, b], q.x, q.y - 5)?.id, 3);
  // In front of it: him, over the building.
  const front = soldier(4, 11.5, 13.5);
  const f = plane(11.5, 13.5);
  assert.equal(tapped([front, b], f.x, f.y - 15)?.id, 4);
});

/** A unit's depth where it stands (cells), as world.ts gives it: its point's y on the plane. */
const unitAt = (p: typeof DIAMOND, x: number, y: number) => p.toPlane(x * TILE_PX, y * TILE_PX).y;

test("菱形（art-v7）：城牆片、懸崖照錨點的 x + y 排，和兵一樣；越東邊的牆不會畫得比牆後的兵早（ui 2026-11-06）", () => {
  // A wall piece far east (anchor 30.5, 10.5, front edge 11) and a soldier just behind it (north) and just in front.
  const wall = pieceDepth(DIAMOND, 30.5, 10.5, 11, 30, 1);
  assert.ok(unitAt(DIAMOND, 30.5, 9.8) < wall, "牆後的兵先畫，被牆擋住");
  assert.ok(unitAt(DIAMOND, 30.5, 11.2) > wall, "牆前的兵後畫");
  assert.ok(unitAt(DIAMOND, 29.8, 10.5) < wall, "牆西邊（後面）的兵也先畫");
  // Square-on's front edge alone put that soldier behind the wall in front of it as a diamond.
  assert.ok(unitAt(DIAMOND, 30.5, 9.8) > depthOf(DIAMOND.toPlane(0, 11 * TILE_PX).y, 30, 1), "以前的算法：牆後的兵畫在牆前");
  // A single SW arm (anchor x, y + 1, front y + 1.99) under the posts at its two ends (each POST_LIFT nearer).
  const arm = pieceDepth(DIAMOND, 10, 6, 6.99, 10, 2);
  const eastPost = pieceDepth(DIAMOND, 10.5, 5.5, 6, 10, 3, POST_LIFT);
  const westPost = pieceDepth(DIAMOND, 9.5, 6.5, 7, 9, 4, POST_LIFT);
  assert.ok(eastPost > arm && westPost > arm, "岩柱蓋住臂的兩端");
});

test("方形斜看照舊：前緣的 y，再來 x、id（depthOf）", () => {
  assert.equal(pieceDepth(OBLIQUE, 30.5, 10.5, 11, 30, 1), depthOf(OBLIQUE.toPlane(0, 11 * TILE_PX).y, 30, 1));
  assert.equal(pieceDepth(OBLIQUE, 10.5, 5.5, 6, 10, 3, POST_LIFT), depthOf(OBLIQUE.toPlane(0, 6 * TILE_PX).y, 10, 3));
});
