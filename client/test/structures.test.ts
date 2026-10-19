// 建築與資源點的圖集 (D-085, design/b1/atlas-buildings.md section 8): which frame a building or a
// node shows. The drawing itself is e2e/art.spec.ts's gallery.

import assert from "node:assert/strict";
import { test } from "node:test";
import { buildingFrame, buildingState, CROP_STAGE_S, cropStage, type NodeEntry, nodeFrame, nodeVariant, parseBuildings, parseNodes, treeSide } from "../src/art/structures.ts";

test("建築的狀態：施工 334、667、1000 千分比分三階段，完成；完成後生命一半以下是受損，修回一半以上回到完成", () => {
  assert.deepEqual([0, 333, 334, 666, 667, 999].map((p) => buildingState(p, 100, 100)), ["build1", "build1", "build2", "build2", "build3", "build3"]);
  assert.equal(buildingState(1000, 100, 100), "done");
  assert.equal(buildingState(1000, 51, 100), "done");
  assert.equal(buildingState(1000, 50, 100), "damaged");
  // Under construction it is not damaged (its own stages).
  assert.equal(buildingState(500, 10, 100), "build2");
});

test("建築的影格：照 states 對照表；沒有的狀態用完成的", () => {
  const house = { type: 1, footprint: [2, 2] as [number, number], states: { build1: "found_2x2_E", done: "house_E_done", damaged: "house_E_damaged" } };
  assert.equal(buildingFrame(house, "build1"), "found_2x2_E");
  assert.equal(buildingFrame(house, "damaged"), "house_E_damaged");
  assert.equal(buildingFrame(house, "build3"), "house_E_done");
  const tower = { type: 9, footprint: [2, 2] as [number, number], states: { done: "town_tower_E_done" } };
  assert.equal(buildingFrame(tower, "rubble"), "town_tower_E_done");
});

test("農田的作物：有人工作每 20 秒換一個階段，成熟後回到剛播種", () => {
  assert.equal(CROP_STAGE_S, 20);
  assert.deepEqual([0, 19.9, 20, 40, 59.9, 60, 80].map((s) => cropStage(s, 3)), [0, 0, 1, 2, 2, 0, 1]);
  assert.equal(cropStage(100, 0), 0);
});

test("樹用哪一陸：6×6 格一塊，同一塊同一陸，相鄰的塊不一定一樣（一叢一叢的）", () => {
  for (let x = 0; x < 6; x++) for (let y = 0; y < 6; y++) assert.equal(treeSide(x, y), "E");
  assert.equal(treeSide(6, 0), "W");
  assert.equal(treeSide(0, 6), "W");
  assert.equal(treeSide(6, 6), "E");
  const sides = new Set<string>();
  for (let bx = 0; bx < 16; bx++) for (let by = 0; by < 16; by++) sides.add(treeSide(bx * 6, by * 6));
  assert.deepEqual([...sides].sort(), ["E", "W"]);
});

test("資源點的變體：照格子算，同一格每次一樣，一排相鄰的格子不會全部一樣", () => {
  assert.equal(nodeVariant(10, 20, 3), nodeVariant(10, 20, 3));
  assert.deepEqual(new Set([0, 1, 2].map((x) => nodeVariant(x, 5, 3))).size, 3);
  assert.equal(nodeVariant(4, 4, 0), 0);
});

test("資源點的影格：樹照那一塊的陸和變體，採完是樹樁；金礦剩第一次看到的一半以下是採過，0 是採完；野果沒有採過那一階", () => {
  const tree: NodeEntry = { kind: 0, footprint: [1, 1], variants: { E: ["tree_E_v0", "tree_E_v1", "tree_E_v2"], W: ["tree_W_v0", "tree_W_v1", "tree_W_v2"] }, depleted: { E: "tree_E_stump", W: "tree_W_stump" } };
  assert.match(nodeFrame(tree, 1, 1, 100, 100) ?? "", /^tree_E_v[012]$/);
  assert.match(nodeFrame(tree, 7, 1, 100, 100) ?? "", /^tree_W_v[012]$/);
  assert.equal(nodeFrame(tree, 7, 1, 0, 100), "tree_W_stump");
  const gold: NodeEntry = { kind: 1, footprint: [1, 1], variants: ["gold_v0", "gold_v1"], stages: ["full", "mined", "depleted"] };
  const v = `gold_v${nodeVariant(3, 3, 2)}`;
  assert.equal(nodeFrame(gold, 3, 3, 800, 800), `${v}_full`);
  assert.equal(nodeFrame(gold, 3, 3, 401, 800), `${v}_full`);
  assert.equal(nodeFrame(gold, 3, 3, 400, 800), `${v}_mined`);
  assert.equal(nodeFrame(gold, 3, 3, 0, 800), `${v}_depleted`);
  const berries: NodeEntry = { kind: 2, footprint: [1, 1], variants: ["berry_v0", "berry_v1"], stages: ["full", "depleted"] };
  assert.match(nodeFrame(berries, 3, 3, 10, 150) ?? "", /^berry_v[01]_full$/);
});

test("說明檔：只收 war-game buildings 1 和 war-game nodes 1", () => {
  assert.throws(() => parseBuildings({ format: "war-game buildings 2" }));
  assert.throws(() => parseNodes({ format: "war-game atlas 2" }));
  assert.equal(parseBuildings({ format: "war-game buildings 1", culture: "W", px_per_m: 40, buildings: {}, frames: {} }).culture, "W");
  assert.equal(parseNodes({ format: "war-game nodes 1", px_per_m: 60, nodes: {}, frames: {} }).px_per_m, 60);
});
