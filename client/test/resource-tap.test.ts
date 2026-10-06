// User report 2026-09-30 (iPhone, commit 8a0b002): 「點果樹跟金礦沒反應耶」. Farmers crowd a
// resource while they work, and a tap on the resource picked the nearest unit (a farmer
// within the 22 pt radius) and re-selected it instead of ordering gather.

import assert from "node:assert/strict";
import { test } from "node:test";
import { tapIntents } from "../src/input/intent.ts";
import { BuildingType, NodeKind, NO_OWNER } from "../src/sim.ts";
import { TILE_PX } from "../src/tuning.ts";
import { FakeWorld, ME, UnitType } from "./fakes.ts";

const R = 22;
const CORE = 12;

// Berries at cell (12, 12); a farmer working it stands in the next cell, (13, 12).
const world = () =>
  new FakeWorld(
    [
      { id: 1, owner: ME, type: UnitType.Farmer, cx: 13, cy: 12 },
      { id: 2, owner: ME, type: UnitType.Farmer, cx: 2, cy: 2 },
      { id: 3, owner: ME, type: UnitType.Spearman, cx: 3, cy: 2 },
    ],
    [
      { kind: "node", id: 100, owner: NO_OWNER, type: NodeKind.Berries, cx: 12, cy: 12 },
      { kind: "building", id: 10, owner: ME, type: BuildingType.Farm, cx: 20, cy: 20 },
    ],
  );
const sel = { units: [1, 2], building: null };
// The right edge of the berries' cell: 18 px from the farmer's centre (inside 22, outside 12).
const nearEdge = { x: 12 * TILE_PX + 30, y: 12 * TILE_PX + TILE_PX / 2 };

test("資源點旁邊有自己的單位時，已選村民點資源點 → gather（不是改選那名村民）", () => {
  assert.deepEqual(tapIntents(world(), sel, "normal", nearEdge.x, nearEdge.y, 1, R, CORE), [
    { kind: "command", cmd: { c: "gather", u: [1, 2], node: 100 } },
  ]);
});

test("點在資源點附近（不在格子上，但在 22 pt 內）也算採集", () => {
  const justOutside = { x: 12 * TILE_PX - 4, y: 12 * TILE_PX + TILE_PX / 2 }; // 20 px from its centre
  assert.deepEqual(tapIntents(world(), sel, "normal", justOutside.x, justOutside.y, 1, R, CORE)[0], {
    kind: "command",
    cmd: { c: "gather", u: [1, 2], node: 100 },
  });
});

test("手指正好點在單位身上（12 pt 內）→ 選取那個單位", () => {
  const onFarmer = { x: 13 * TILE_PX + 20, y: 12 * TILE_PX + TILE_PX / 2 };
  assert.deepEqual(tapIntents(world(), sel, "normal", onFarmer.x, onFarmer.y, 1, R, CORE), [{ kind: "select", units: [1] }]);
});

test("一起選的軍隊不去採集，而是走過去", () => {
  assert.deepEqual(tapIntents(world(), { units: [1, 3], building: null }, "normal", nearEdge.x, nearEdge.y, 1, R, CORE), [
    { kind: "command", cmd: { c: "gather", u: [1], node: 100 } },
    { kind: "command", cmd: { c: "move", u: [3], x: 12, y: 12 } },
  ]);
});

test("沒選村民時，點資源點是查看（畫面會顯示它的名稱和剩下的量）", () => {
  assert.deepEqual(tapIntents(world(), { units: [], building: null }, "normal", 12 * TILE_PX + 16, 12 * TILE_PX + 16, 1, R, CORE), [
    { kind: "inspect", pick: { kind: "node", id: 100, owner: NO_OWNER, type: NodeKind.Berries } },
  ]);
});

test("已選村民點自己的農田（旁邊有人）→ repair（耕作），不是改選", () => {
  const w = world();
  w.units.push({ id: 4, owner: ME, type: UnitType.Farmer, cx: 21, cy: 20 });
  assert.deepEqual(tapIntents(w, sel, "normal", 20 * TILE_PX + 30, 20 * TILE_PX + 16, 1, R, CORE), [
    { kind: "command", cmd: { c: "repair", u: [1, 2], building: 10 } },
  ]);
});
