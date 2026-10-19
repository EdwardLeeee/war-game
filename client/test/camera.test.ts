import assert from "node:assert/strict";
import { test } from "node:test";
import { Camera } from "../src/camera/camera.ts";
import { MAX_ZOOM, TILE_PX } from "../src/tuning.ts";

const WORLD = 96 * TILE_PX;

function camera(): Camera {
  const c = new Camera(WORLD, WORLD);
  c.resize(932, 430);
  c.centerOn(WORLD / 2, WORLD / 2);
  return c;
}

test("screen and world coordinates round-trip", () => {
  const c = camera();
  c.zoomAt(100, 100, 1.7);
  const w = c.screenToWorld(321, 123);
  const s = c.worldToScreen(w.x, w.y);
  assert.ok(Math.abs(s.x - 321) < 1e-9 && Math.abs(s.y - 123) < 1e-9);
});

test("zooming keeps the point under the fingers in place", () => {
  const c = camera();
  const before = c.screenToWorld(600, 300);
  c.zoomAt(600, 300, 2);
  const after = c.screenToWorld(600, 300);
  assert.ok(Math.abs(before.x - after.x) < 1e-9 && Math.abs(before.y - after.y) < 1e-9);
});

test("zoom is limited to the whole map at the far end and MAX_ZOOM at the near end", () => {
  const c = camera();
  c.zoomAt(0, 0, 0.001);
  assert.equal(c.scale, 430 / WORLD);
  c.zoomAt(0, 0, 99);
  assert.equal(c.scale, MAX_ZOOM);
});

test("the screen centre cannot leave the map", () => {
  const c = camera();
  c.panBy(1e6, 1e6);
  const centre = c.screenToWorld(c.width / 2, c.height / 2);
  assert.equal(centre.x, 0);
  assert.equal(centre.y, 0);
});

test("a slow release does not fling", () => {
  const c = camera();
  c.fling(0.001, 0);
  assert.equal(c.flinging, false);
});

// --- 菱形畫面 (D-085, docs/sprite-atlas.md section 1) ---------------------------------------

import { DIAMOND } from "../src/camera/projection.ts";

function diamond(): Camera {
  const c = new Camera(WORLD, WORLD, DIAMOND);
  c.resize(814, 380);
  c.centerOn(WORLD / 2, WORLD / 2);
  return c;
}

test("菱形：一格在縮放 1 時往右下 28.28、往下 14.14 pt（規格第 1 節）；(0,0) 在上角；兩個出生點一左一右，大城在中間", () => {
  const cell = (x: number, y: number) => DIAMOND.toPlane(x * TILE_PX, y * TILE_PX);
  const step = cell(1, 0);
  assert.ok(Math.abs(step.x - 28.28) < 0.01 && Math.abs(step.y - 14.14) < 0.01, JSON.stringify(step));
  const down = cell(0, 1);
  assert.ok(Math.abs(down.x + 28.28) < 0.01 && Math.abs(down.y - 14.14) < 0.01, "+y goes down-left");
  // The top corner: no cell of the map above it.
  for (const [x, y] of [[0, 96], [96, 0], [96, 96], [48, 48]]) assert.ok(cell(x, y).y > cell(0, 0).y);
  // The fixed map's spawns (16, 78) and (78, 16): left and right of the big city (48, 48), about level with it.
  const left = cell(16, 78);
  const right = cell(78, 16);
  const city = cell(48, 48);
  assert.ok(left.x < city.x && city.x < right.x);
  assert.equal(left.y, right.y);
  assert.ok(Math.abs(left.y - city.y) <= 2 * 14.15, "within two cells' height");
});

test("菱形：螢幕和世界座標來回一樣；縮放時手指下的地面不動", () => {
  const c = diamond();
  c.zoomAt(100, 100, 1.7);
  const w = c.screenToWorld(321, 123);
  const s = c.worldToScreen(w.x, w.y);
  assert.ok(Math.abs(s.x - 321) < 1e-9 && Math.abs(s.y - 123) < 1e-9);
  const before = c.screenToWorld(600, 300);
  c.zoomAt(600, 300, 2);
  const after = c.screenToWorld(600, 300);
  assert.ok(Math.abs(before.x - after.x) < 1e-6 && Math.abs(before.y - after.y) < 1e-6);
});

test("菱形：縮到最小時整個菱形放得進畫面；畫面中心不離開地圖（拉到角落時停在那個角）", () => {
  const c = diamond();
  c.zoomAt(0, 0, 0.001);
  const corners = [c.worldToScreen(0, 0), c.worldToScreen(WORLD, 0), c.worldToScreen(0, WORLD), c.worldToScreen(WORLD, WORLD)];
  const span = { w: Math.max(...corners.map((p) => p.x)) - Math.min(...corners.map((p) => p.x)), h: Math.max(...corners.map((p) => p.y)) - Math.min(...corners.map((p) => p.y)) };
  assert.ok(span.w <= 814 + 1e-6 && span.h <= 380 + 1e-6, JSON.stringify(span));
  assert.ok(Math.abs(span.h - 380) < 1e-6 || Math.abs(span.w - 814) < 1e-6, "as large as fits");
  const d = diamond();
  d.panBy(0, 1e6);
  const centre = d.screenToWorld(d.width / 2, d.height / 2);
  assert.ok(centre.x >= -1e-6 && centre.y >= -1e-6 && centre.x <= WORLD + 1e-6 && centre.y <= WORLD + 1e-6, JSON.stringify(centre));
  // The visible box holds every corner of the screen.
  const v = d.visible();
  for (const p of d.corners()) assert.ok(p.x >= v.x0 - 1e-6 && p.x <= v.x1 + 1e-6 && p.y >= v.y0 - 1e-6 && p.y <= v.y1 + 1e-6);
});
