// 派村民 (D-061): whom a tap on a resource sends, and how many a share is.

import assert from "node:assert/strict";
import { test } from "node:test";
import { DISPATCH_SHARES, dispatchCount, dispatchPool, NODE_RESOURCE, type Villager } from "../src/game/dispatch.ts";
import { NodeKind, Resource } from "../src/sim.ts";

const v = (id: number, x: number, y: number, gathers: Resource | null, node: number | null, idle = false): Villager => ({ id, x, y, gathers, node, idle });

test("派村民：只派採同一種資源、不在這個點的村民，離這個點近的先派（一樣近給編號小的）", () => {
  const tree = { id: 7, kind: NodeKind.Tree, cx: 10, cy: 10 };
  const list = [
    v(1, 20.5, 10.5, Resource.Wood, 3), // 10 cells off
    v(2, 12.5, 10.5, Resource.Wood, 4), // 2 cells off
    v(3, 10.5, 11.5, Resource.Wood, 7), // already at this tree
    v(4, 11.5, 10.5, Resource.Gold, 9), // gold
    v(5, 8.5, 10.5, Resource.Wood, 5), // 2 cells off, other side
    v(6, 10.5, 10.5, null, null, true), // idle
  ];
  assert.deepEqual(dispatchPool(list, tree), { from: "same", ids: [2, 5, 1] });
});

test("派村民：別處沒人在採這種資源時，改從閒置的村民派（晶脈一開始一定是這樣）", () => {
  const vein = { id: 50, kind: NodeKind.CrystalVein, cx: 30, cy: 30 };
  const list = [v(1, 30.5, 40.5, Resource.Wood, 3), v(2, 30.5, 33.5, null, null, true), v(3, 30.5, 31.5, null, null, true)];
  assert.deepEqual(dispatchPool(list, vein), { from: "idle", ids: [3, 2] });
  // Someone on the vein already, nobody elsewhere: still the idle ones.
  assert.deepEqual(dispatchPool([...list, v(4, 30.5, 30.5, Resource.Crystal, 50)], vein), { from: "idle", ids: [3, 2] });
  // Nobody at all.
  assert.deepEqual(dispatchPool([v(1, 30.5, 40.5, Resource.Wood, 3)], vein), { from: "idle", ids: [] });
});

test("派村民：野果是糧，種田的村民（採糧、不在節點）也算採糧", () => {
  const berries = { id: 12, kind: NodeKind.Berries, cx: 5, cy: 5 };
  assert.equal(NODE_RESOURCE[NodeKind.Berries], Resource.Food);
  const farmer = v(8, 9.5, 5.5, Resource.Food, null);
  assert.deepEqual(dispatchPool([farmer], berries).ids, [8]);
});

test("派村民：¼、½、全部；四捨五入、至少 1 名、不超過現有的；沒有人就是 0", () => {
  assert.deepEqual(
    DISPATCH_SHARES.map((s) => s.label),
    ["¼", "½", "全部"],
  );
  const counts = (n: number) => DISPATCH_SHARES.map((s) => dispatchCount(n, s.share));
  assert.deepEqual(counts(0), [0, 0, 0]);
  assert.deepEqual(counts(1), [1, 1, 1]);
  assert.deepEqual(counts(2), [1, 1, 2]);
  assert.deepEqual(counts(3), [1, 2, 3]);
  assert.deepEqual(counts(5), [1, 3, 5]);
  assert.deepEqual(counts(8), [2, 4, 8]);
  assert.deepEqual(counts(10), [3, 5, 10]);
});
