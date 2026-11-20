// 滑鼠操作 06 B (R26, design/r26/spec.md; ceo 2026-11-20): the left click selects and never orders; the right click is
// the order a tap gives the units selected and never changes what is selected; nothing selected, a right click does
// nothing. The arrow keys and the window's edge move the view.

import assert from "node:assert/strict";
import { test } from "node:test";
import { commandIntents, moveIntents, selectIntents } from "../src/input/intent.ts";
import { ViewScroll } from "../src/input/view-scroll.ts";
import { BuildingType, NodeKind, UnitType } from "../src/sim.ts";
import { EDGE_SCROLL_PX, SCROLL_PX_PER_S } from "../src/tuning.ts";
import { at, ENEMY, FakeWorld, ME } from "./fakes.ts";

const R = 22;
const SPEAR = { id: 1, owner: ME, type: UnitType.Spearman, cx: 10, cy: 10 };
const SPEAR2 = { id: 2, owner: ME, type: UnitType.Spearman, cx: 14, cy: 10 };
const FARMER = { id: 3, owner: ME, type: UnitType.Farmer, cx: 20, cy: 20 };
const FOE = { id: 9, owner: ENEMY, type: UnitType.Spearman, cx: 30, cy: 30 };
const BARRACKS = { kind: "building" as const, id: 50, owner: ME, type: BuildingType.Barracks, cx: 40, cy: 40 };
const SITE = { kind: "building" as const, id: 51, owner: ME, type: BuildingType.House, cx: 44, cy: 44, needsWork: true };
const TREE = { kind: "node" as const, id: 60, owner: 0, type: NodeKind.Tree, cx: 50, cy: 50 };
const world = () => new FakeWorld([SPEAR, SPEAR2, FARMER, FOE], [BARRACKS, SITE, TREE]);

test("左鍵點：自己的兵選他、點兩下選畫面上同一種；自己的建築選它；敵人、樹只看；空地取消選取。都不下指令", () => {
  const w = world();
  assert.deepEqual(selectIntents(w, at(10), at(10), 1, R), [{ kind: "select", units: [1] }]);
  assert.deepEqual(selectIntents(w, at(10), at(10), 2, R), [{ kind: "select", units: [1, 2] }]);
  assert.deepEqual(selectIntents(w, at(40), at(40), 1, R), [{ kind: "selectBuilding", id: 50 }]);
  assert.equal(selectIntents(w, at(30), at(30), 1, R)[0].kind, "inspect");
  assert.equal(selectIntents(w, at(50), at(50), 1, R)[0].kind, "inspect");
  assert.deepEqual(selectIntents(w, at(70), at(70), 1, R), [{ kind: "clear" }]);
});

test("右鍵點、選著兵：地面＝移動，敵人＝攻擊；點自己的兵或建築也是走過去，選取不變", () => {
  const w = world();
  const sel = { units: [1, 2], building: null };
  assert.deepEqual(commandIntents(w, sel, at(70), at(70), R), moveIntents(w, [1, 2], 70, 70));
  assert.deepEqual(commandIntents(w, sel, at(30), at(30), R), [{ kind: "command", cmd: { c: "attack", u: [1, 2], target: 9 } }]);
  assert.deepEqual(commandIntents(w, sel, at(20), at(20), R), moveIntents(w, [1, 2], 20, 20), "on a farmer of ours");
  assert.deepEqual(commandIntents(w, sel, at(40), at(40), R), moveIntents(w, [1, 2], 40, 40), "on our barracks");
  assert.deepEqual(commandIntents(w, { units: [1], building: null }, at(14), at(10), R), moveIntents(w, [1], 14, 10), "on another of ours");
});

test("右鍵點、選著村民：樹＝採集，要蓋的建築＝去蓋，好好的兵營＝走過去", () => {
  const w = world();
  const sel = { units: [3], building: null };
  assert.deepEqual(commandIntents(w, sel, at(50), at(50), R), [{ kind: "command", cmd: { c: "gather", u: [3], node: 60 } }]);
  assert.deepEqual(commandIntents(w, sel, at(44), at(44), R), [{ kind: "command", cmd: { c: "repair", u: [3], building: 51 } }]);
  assert.deepEqual(commandIntents(w, sel, at(40), at(40), R), moveIntents(w, [3], 40, 40));
});

test("右鍵點、什麼都沒選或只選了建築：不做事", () => {
  const w = world();
  assert.deepEqual(commandIntents(w, { units: [], building: null }, at(70), at(70), R), []);
  assert.deepEqual(commandIntents(w, { units: [], building: 50 }, at(30), at(30), R), []);
});

test("方向鍵和畫面邊緣：往那邊移，一軸最快每秒 SCROLL_PX_PER_S；沒焦點、滑鼠在外面、正在拉框時邊緣不動", () => {
  const v = SCROLL_PX_PER_S / 1000;
  const s = new ViewScroll();
  assert.deepEqual(s.velocity(1920, 950, true, false), { x: 0, y: 0 });
  assert.equal(s.keyDown("ArrowRight"), true);
  assert.equal(s.keyDown("a"), false);
  assert.deepEqual(s.velocity(1920, 950, true, false), { x: v, y: 0 });
  s.keyDown("ArrowUp");
  assert.deepEqual(s.velocity(1920, 950, true, false), { x: v, y: -v });
  assert.deepEqual(s.velocity(1920, 950, false, false), { x: 0, y: 0 }, "no focus");
  s.keyUp("ArrowRight");
  s.keyUp("ArrowUp");
  s.pointer = { x: EDGE_SCROLL_PX - 1, y: 500 };
  assert.deepEqual(s.velocity(1920, 950, true, false), { x: -v, y: 0 });
  assert.deepEqual(s.velocity(1920, 950, true, true), { x: 0, y: 0 }, "dragging a box");
  s.pointer = { x: EDGE_SCROLL_PX, y: 500 };
  assert.deepEqual(s.velocity(1920, 950, true, false), { x: 0, y: 0 }, "6 px in: not at the edge");
  s.pointer = { x: 1920 - EDGE_SCROLL_PX, y: 950 - 1 };
  assert.deepEqual(s.velocity(1920, 950, true, false), { x: v, y: v });
  s.pointer = { x: 1920 + 40, y: 500 };
  assert.deepEqual(s.velocity(1920, 950, true, false), { x: 0, y: 0 }, "outside the window (a drag let go past it)");
  s.pointer = { x: 1920 - EDGE_SCROLL_PX, y: 950 - 1 };
  s.keyDown("ArrowLeft");
  assert.deepEqual(s.velocity(1920, 950, true, false), { x: 0, y: v }, "the arrow against the edge: they cancel");
  s.blur();
  assert.deepEqual(s.velocity(1920, 950, true, false), { x: 0, y: 0 }, "the window left: nothing held, no pointer");
});
