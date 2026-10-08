// 隨機地圖 (D-074) on the screen: the start screen's 地圖 kept on this device, and what the view
// knows of towns and rocks — on the fixed map all of them from `ready`; on a random map only
// those explored, from the town rows and the placement grid, kept once known.

import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_MAP, loadMapMode, MAP_KEY, MAP_NOTE, saveMapMode } from "../src/map-mode.ts";
import { MOCK_RULES } from "../src/mock/mock-port.ts";
import {
  BUILDING_STRIDE,
  BuildingField as B,
  BuildingType,
  HEADER_LENGTH,
  type MapInfo,
  NODE_STRIDE,
  NodeField as N,
  NodeKind,
  PlaceBit,
  type Snapshot,
  Terrain,
  TOWN_STRIDE,
  TownField as T,
  TownSize,
} from "../src/sim.ts";
import { GameView } from "../src/view/view.ts";

function memoryStore() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), raw: m };
}

test("地圖選項：第一次是固定地圖；選了就記在這台裝置；壞掉的值或讀不到當沒選過", () => {
  const store = memoryStore();
  assert.equal(loadMapMode(store), DEFAULT_MAP);
  assert.equal(DEFAULT_MAP, "fixed");
  saveMapMode("random", store);
  assert.equal(store.raw.get(MAP_KEY), "random");
  assert.equal(loadMapMode(store), "random");
  store.setItem(MAP_KEY, "bogus");
  assert.equal(loadMapMode(store), "fixed");
  const throwing = {
    getItem: (): string | null => {
      throw new Error("SecurityError");
    },
    setItem: () => {
      throw new Error("SecurityError");
    },
  };
  assert.equal(loadMapMode(throwing), "fixed");
  assert.doesNotThrow(() => saveMapMode("random", throwing));
  assert.deepEqual(MAP_NOTE, { fixed: "每局同一張，適合比較電腦強弱", random: "每局不同，只看得到自己家附近" });
});

const SIZE = 16;

function snapshot(o: { towns?: number[][]; nodes?: number[][]; buildings?: number[][]; placement?: Uint8Array | null }): Snapshot {
  const towns = new Int32Array((o.towns ?? []).length * TOWN_STRIDE);
  (o.towns ?? []).forEach(([id, size, cx, cy], i) => {
    towns[i * TOWN_STRIDE + T.id] = id;
    towns[i * TOWN_STRIDE + T.size] = size;
    towns[i * TOWN_STRIDE + T.cellX] = cx;
    towns[i * TOWN_STRIDE + T.cellY] = cy;
  });
  const nodes = new Int32Array((o.nodes ?? []).length * NODE_STRIDE);
  (o.nodes ?? []).forEach(([id, kind, cx, cy, amount], i) => {
    nodes[i * NODE_STRIDE + N.id] = id;
    nodes[i * NODE_STRIDE + N.kind] = kind;
    nodes[i * NODE_STRIDE + N.cellX] = cx;
    nodes[i * NODE_STRIDE + N.cellY] = cy;
    nodes[i * NODE_STRIDE + N.amount] = amount;
  });
  const buildings = new Int32Array((o.buildings ?? []).length * BUILDING_STRIDE);
  (o.buildings ?? []).forEach(([id, type, cx, cy], i) => {
    buildings[i * BUILDING_STRIDE + B.id] = id;
    buildings[i * BUILDING_STRIDE + B.type] = type;
    buildings[i * BUILDING_STRIDE + B.cellX] = cx;
    buildings[i * BUILDING_STRIDE + B.cellY] = cy;
  });
  return {
    type: "snapshot",
    header: new Int32Array(HEADER_LENGTH),
    units: new Int32Array(0),
    buildings,
    towns,
    warnings: new Int32Array(0),
    nodes,
    fog: null,
    placement: o.placement ?? null,
    idleFarmers: new Int32Array(0),
    events: [],
  };
}

test("固定地圖：城鎮和岩石一開始就全知道（照 ready）", () => {
  const terrain = new Uint8Array(SIZE * SIZE);
  terrain[3] = Terrain.Blocked;
  const map: MapInfo = { seed: 1, size: SIZE, terrain, spawns: [{ player: 0, cellX: 2, cellY: 2 }], towns: [{ id: 0, size: TownSize.Small, cellX: 8, cellY: 8, radius: 4 }] };
  const v = new GameView(0, map, MOCK_RULES);
  assert.equal(v.randomMap, false);
  assert.deepEqual(v.townList(), map.towns);
  assert.equal(v.rocks[3], 1);
  assert.equal(v.rocks.reduce((a, b) => a + b, 0), 1);
});

test("隨機地圖：開局什麼城鎮、岩石都不知道；城鎮列出現才知道，半徑照 rules；岩石照放置格，資源點和建築的格子不算", () => {
  const map: MapInfo = { seed: 1, size: SIZE, terrain: new Uint8Array(SIZE * SIZE), spawns: [{ player: 0, cellX: 2, cellY: 2 }], towns: [], mode: "random" };
  const rules = { ...MOCK_RULES, towns: [{ radius: 4 }, { radius: 6 }] } as unknown as typeof MOCK_RULES;
  const v = new GameView(0, map, rules);
  assert.equal(v.randomMap, true);
  assert.deepEqual(v.townList(), []);
  assert.equal(v.rocks.reduce((a, b) => a + b, 0), 0);
  // An explored large town, a rock at cell 20, a tree at 21, our house over 34-35 and 50-51.
  const placement = new Uint8Array(SIZE * SIZE);
  for (const i of [20, 21, 34, 35, 50, 51]) placement[i] = PlaceBit.Blocked;
  v.push(snapshot({ towns: [[3, TownSize.Large, 9, 9]], nodes: [[7, NodeKind.Tree, 5, 1, 100]], buildings: [[40, BuildingType.House, 2, 2]], placement }), 0);
  assert.deepEqual(v.townList(), [{ id: 3, size: TownSize.Large, cellX: 9, cellY: 9, radius: 6 }]);
  assert.deepEqual([...v.rocks.keys()].filter((i) => v.rocks[i] === 1), [20]);
  const version = v.rocksVersion;
  // Out of sight later (no row, no grid): what is known stays.
  v.push(snapshot({}), 1);
  assert.equal(v.townList().length, 1);
  assert.equal(v.rocks[20], 1);
  assert.equal(v.rocksVersion, version);
  // A tree whose row came after the grid (cell 22 taken for rock): no longer rock once its row comes.
  const later = new Uint8Array(SIZE * SIZE);
  later[20] = PlaceBit.Blocked;
  later[22] = PlaceBit.Blocked;
  v.push(snapshot({ placement: later }), 2);
  assert.equal(v.rocks[22], 1);
  v.push(snapshot({ nodes: [[8, NodeKind.Tree, 6, 1, 100]] }), 3);
  assert.equal(v.rocks[22], 0);
  assert.ok(v.rocksVersion > version);
});
