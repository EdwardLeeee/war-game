// 前後與點選 (方形斜看, D-088; war-game-ui 2026-10-19): drawn by the front edge, a tap reaching the
// last drawn that holds the finger, with the same order.

import assert from "node:assert/strict";
import { test } from "node:test";
import { OBLIQUE } from "../src/camera/projection.ts";
import { buildingFront, drawOrder, nodeFront, type Standing, tapped } from "../src/render/depth.ts";
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
