// GDD §10 gesture table, one test per row. Each test drives the recogniser with pointer
// input on a fake clock and checks what the intent rules make of it. The minimap and
// control-group rows come with the HUD (PR 3).

import assert from "node:assert/strict";
import { test } from "node:test";
import { Camera } from "../src/camera/camera.ts";
import { type GestureHost, GestureRecognizer } from "../src/input/gestures.ts";
import { boxSelect, type Intent, longPressKind, type Selection, tapIntents, wheelItems } from "../src/input/intent.ts";
import { BuildingType, NodeKind, NO_OWNER, PlaceBit } from "../src/sim.ts";
import { LONG_PRESS_MS, TILE_PX } from "../src/tuning.ts";
import { Placement } from "../src/ui/placement.ts";
import { at, ENEMY, FakeWorld, ME, UnitType } from "./fakes.ts";

const R = 22;

/** A host that feeds taps and long presses to the intent rules, like game/input.ts does. */
function play(world: FakeWorld, sel: Selection) {
  const out: Intent[] = [];
  let longPress = "";
  const host: GestureHost = {
    tap: (x, y, count) => out.push(...tapIntents(world, sel, "normal", x, y, count, R)),
    longPress: (x, y) => {
      const kind = longPressKind(world, x, y, R);
      longPress = kind;
      return kind;
    },
    pressCue: () => {},
    panStart: () => {},
    pan: () => {},
    panEnd: () => {},
    box: (x0, y0, x1, y1, phase) => {
      if (phase === "end") out.push({ kind: "select", units: boxSelect(world, x0, y0, x1, y1) });
    },
    pinchStart: () => {},
    pinch: () => {},
    pinchEnd: () => {},
  };
  const g = new GestureRecognizer(host);
  let t = 1000;
  const tap = (x: number, y: number) => {
    g.down(1, x, y, t);
    g.up(1, x, y, t + 60);
    t += 100;
  };
  return { g, out, tap, longPressed: () => longPress, now: () => t };
}

const world = () =>
  new FakeWorld(
    [
      { id: 1, owner: ME, type: UnitType.Farmer, cx: 2, cy: 2 },
      { id: 2, owner: ME, type: UnitType.Spearman, cx: 5, cy: 2 },
      { id: 3, owner: ME, type: UnitType.Spearman, cx: 6, cy: 2 },
      { id: 4, owner: ME, type: UnitType.Mage, cx: 7, cy: 2 },
      { id: 5, owner: ME, type: UnitType.Spearman, cx: 60, cy: 2 },
      { id: 9, owner: ENEMY, type: UnitType.Ranged, cx: 20, cy: 20 },
    ],
    [
      { kind: "building", id: 10, owner: ME, type: BuildingType.MainCity, cx: 1, cy: 8 },
      { kind: "building", id: 11, owner: ENEMY, type: BuildingType.Barracks, cx: 30, cy: 30 },
      { kind: "node", id: 100, owner: NO_OWNER, type: NodeKind.Tree, cx: 12, cy: 12 },
    ],
    50,
  );

test("單指點單位或建築 → 選取", () => {
  const w = world();
  const p = play(w, { units: [], building: null });
  p.tap(at(5), at(2));
  p.tap(at(1) + 3, at(8) + 3);
  assert.deepEqual(p.out, [
    { kind: "select", units: [2] },
    { kind: "selectBuilding", id: 10 },
  ]);
});

test("選了農民後點自己的建築 → repair（幫忙蓋、耕作或修理，由模擬決定）；沒選農民時是選取", () => {
  const farmers = play(world(), { units: [1, 2], building: null });
  farmers.tap(at(1) + 3, at(8) + 3);
  assert.deepEqual(farmers.out, [{ kind: "command", cmd: { c: "repair", u: [1], building: 10 } }]);
  const army = play(world(), { units: [2], building: null });
  army.tap(at(1) + 3, at(8) + 3);
  assert.deepEqual(army.out, [{ kind: "selectBuilding", id: 10 }]);
});

test("選了部隊後點地面 → 前進", () => {
  const p = play(world(), { units: [2, 3], building: null });
  p.tap(at(40), at(41));
  assert.deepEqual(p.out, [{ kind: "command", cmd: { c: "move", u: [2, 3], x: 40, y: 41 } }]);
});

test("選了部隊後點敵人 → 攻擊（單位或建築）", () => {
  const p = play(world(), { units: [2, 3], building: null });
  p.tap(at(20), at(20));
  p.tap(at(30), at(30));
  assert.deepEqual(p.out, [
    { kind: "command", cmd: { c: "attack", u: [2, 3], target: 9 } },
    { kind: "command", cmd: { c: "attack", u: [2, 3], target: 11 } },
  ]);
});

test("選了農民後點資源 → 採集（一起選的軍隊走過去）", () => {
  const p = play(world(), { units: [1, 2], building: null });
  p.tap(at(12), at(12));
  assert.deepEqual(p.out, [
    { kind: "command", cmd: { c: "gather", u: [1], node: 100 } },
    { kind: "command", cmd: { c: "move", u: [2], x: 12, y: 12 } },
  ]);
});

test("單指拖曳 → 移動畫面（有慣性）", () => {
  const cam = new Camera(96 * TILE_PX, 96 * TILE_PX);
  cam.resize(932, 430);
  cam.centerOn(48 * TILE_PX, 48 * TILE_PX);
  const x0 = cam.x;
  const g = new GestureRecognizer({
    tap: () => assert.fail("a drag is not a tap"),
    longPress: () => assert.fail("a drag is not a long press"),
    pressCue: () => {},
    panStart: () => cam.stop(),
    pan: (dx, dy) => cam.panBy(dx, dy),
    panEnd: (vx, vy) => cam.fling(vx, vy),
    box: () => {},
    pinchStart: () => {},
    pinch: () => {},
    pinchEnd: () => {},
  });
  g.down(1, 500, 200, 0);
  for (let t = 16; t <= 160; t += 16) g.move(1, 500 - t, 200, t);
  g.up(1, 340, 200, 160);
  assert.equal(cam.x, x0 + 160, "the map follows the finger");
  assert.ok(cam.flinging, "and keeps sliding after the finger lifts");
  cam.update(100);
  assert.ok(cam.x > x0 + 160);
  for (let i = 0; i < 200; i++) cam.update(16);
  assert.ok(!cam.flinging, "until friction stops it");
});

test("雙指捏合 → 縮放", () => {
  const cam = new Camera(96 * TILE_PX, 96 * TILE_PX);
  cam.resize(932, 430);
  const g = new GestureRecognizer({
    tap: () => {},
    longPress: () => "none",
    pressCue: () => {},
    panStart: () => {},
    pan: () => {},
    panEnd: () => {},
    box: () => {},
    pinchStart: () => {},
    pinch: (cx, cy, factor, dx, dy) => {
      cam.panBy(dx, dy);
      cam.zoomAt(cx, cy, cam.scale * factor);
    },
    pinchEnd: () => {},
  });
  const before = cam.scale;
  g.down(1, 400, 200, 0);
  g.down(2, 500, 200, 5);
  g.move(1, 350, 200, 20);
  g.move(2, 550, 200, 20);
  assert.equal(cam.scale, before * 2);
});

test("長按空地 350 ms 後拖曳 → 框選，框內有軍隊只選軍隊", () => {
  const p = play(world(), { units: [], building: null });
  p.g.down(1, at(1) - 20, at(1) - 20, 0);
  p.g.update(LONG_PRESS_MS);
  assert.equal(p.longPressed(), "box");
  p.g.move(1, at(8) + 20, at(3), 500);
  p.g.up(1, at(8) + 20, at(3), 520);
  assert.deepEqual(p.out, [{ kind: "select", units: [2, 3, 4] }]);
});

test("長按空地 350 ms 後拖曳 → 框選，框內只有農民才選農民", () => {
  const p = play(world(), { units: [], building: null });
  p.g.down(1, at(1), at(1), 0);
  p.g.update(LONG_PRESS_MS);
  p.g.up(1, at(3), at(3), 520);
  assert.deepEqual(p.out, [{ kind: "select", units: [1] }]);
});

test("點兩下單位 → 選取畫面內所有同類單位", () => {
  const p = play(world(), { units: [], building: null });
  p.tap(at(5), at(2));
  p.tap(at(5), at(2));
  // Unit 5 is a spearman too, but off screen.
  assert.deepEqual(p.out, [
    { kind: "select", units: [2] },
    { kind: "select", units: [2, 3] },
  ]);
});

test("長按單位 → 技能輪盤：法師有晶砲、自動施放、撤退；其他兵種有撤退和姿態", () => {
  const w = world();
  const p = play(w, { units: [], building: null });
  p.g.down(1, at(7), at(2), 0);
  p.g.update(LONG_PRESS_MS);
  assert.equal(p.longPressed(), "wheel");
  assert.deepEqual(wheelItems(UnitType.Mage), ["cast", "autocast", "retreat"]);
  assert.deepEqual(wheelItems(UnitType.Spearman), ["retreat", "stance"]);
  assert.deepEqual(wheelItems(UnitType.Farmer), ["retreat", "stance"]);
  // Long press on an enemy or a building does nothing.
  assert.equal(longPressKind(w, at(20), at(20), R), "none");
  assert.equal(longPressKind(w, at(1), at(8), R), "none");
});

test("放建築 → 預覽跟著手指移動（紅綠依可蓋與否），放開後按 ✓ 或 ✗", () => {
  const size = 96;
  const cells = new Uint8Array(size * size);
  cells[10 * size + 11] = PlaceBit.Blocked;
  const grid = { size, cells };
  const house = new Placement({ type: BuildingType.House, size: 2 }, [1]);
  house.moveTo(at(10), at(10), grid);
  assert.equal(house.valid, false, "covers the blocked cell (11, 10)");
  house.moveTo(at(20), at(20), grid);
  assert.equal(house.valid, true);
  assert.equal(house.phase, "dragging");
  house.release();
  assert.equal(house.phase, "confirm");
  assert.deepEqual(house.confirm(), { c: "build", u: [1], type: BuildingType.House, x: 20, y: 20 });
  house.moveTo(at(10), at(10), grid);
  assert.equal(house.confirm(), null, "✓ does nothing while the preview is red");
});
