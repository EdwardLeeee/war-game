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
