// More gold and wood, and a market (D-101, the user 2026-10-22/23: 「其實現在打很容易拖到後期都沒有樹跟金礦可以採」;
// ceo 2026-10-24). Both behind their switches (RICH, MARKET; off: as before).

import assert from "node:assert/strict";
import { test } from "node:test";
import { Game } from "../src/core/game.ts";
import { generateMap } from "../src/core/map.ts";
import { generateRandomMap } from "../src/core/random-map.ts";
import { BUILDINGS, MARKET, NODE_AMOUNT, RICH, rules } from "../src/core/rules.ts";
import { toCanon } from "../src/frame.ts";
import { BuildingType, HeaderField, NodeKind, Reject, Resource, UnitType } from "../src/protocol.ts";
import { buildView } from "../src/view/view.ts";
import { cmd, emptyGame, openArea, put, run, switchedOn } from "./helpers.ts";

function rejects(g: Game, p = 0): number[] {
  g.step();
  return g.events.filter((e) => e.to === p && e.ev.k === "rejected").map((e) => (e.ev as { reason: number }).reason);
}

test("RICH and MARKET off: the amounts, the maps' gold and the rules as before; no market", () => {
  assert.deepEqual([NODE_AMOUNT.goldCell, NODE_AMOUNT.tree], [400, 100]);
  const gold = generateMap().nodes.filter((x) => x.kind === NodeKind.GoldMine);
  assert.deepEqual([gold.length, gold.reduce((a, x) => a + x.amount, 0)], [16, 6400]);
  const r = rules();
  assert.equal(r.features.market, undefined);
  assert.equal(r.buildings[BuildingType.Market], undefined);
  const g = emptyGame();
  const f = put(g, 0, UnitType.Farmer, 20, 70);
  cmd(g, 0, { c: "build", u: [f], type: BuildingType.Market, x: 20, y: 66 });
  assert.deepEqual(rejects(g), [Reject.NotAvailable]);
  cmd(g, 0, { c: "trade", resource: Resource.Food, buy: true, lots: 1 });
  assert.deepEqual(rejects(g), [Reject.NotAvailable]);
});

test("RICH on: 600 gold a cell, trees as before; the fixed map's three contested mines on the axis and 3 more forests a side", switchedOn(RICH, () => {
  assert.deepEqual([NODE_AMOUNT.goldCell, NODE_AMOUNT.tree, RICH.forests], [600, 100, 3]);
  const m = generateMap();
  const gold = m.nodes.filter((x) => x.kind === NodeKind.GoldMine);
  assert.deepEqual([gold.length, gold.reduce((a, x) => a + x.amount, 0)], [28, 16800]);
  const axis = gold.filter((x) => Math.abs(x.cellX - x.cellY) <= 1);
  assert.equal(axis.length, 12, "three 2 x 2 mines straddling the diagonal");
  // Every gold cell has its mirror image (x <-> y).
  for (const x of gold) assert.ok(gold.some((y) => y.cellX === x.cellY && y.cellY === x.cellX), `${x.cellX},${x.cellY}`);
  const trees = m.nodes.filter((x) => x.kind === NodeKind.Tree);
  RICH.on = false;
  const before = generateMap().nodes.filter((x) => x.kind === NodeKind.Tree);
  RICH.on = true;
  assert.ok(trees.every((x) => x.amount === 100), "100 wood a tree");
  assert.equal(trees.length - before.length, 2 * 3 * 21, "3 forests of 21 trees a side");
}));

test("RICH on, random maps 1-20: a contested mine on the axis, its own mirror image; every gold cell 600", switchedOn(RICH, () => {
  for (let seed = 1; seed <= 20; seed++) {
    const m = generateRandomMap(seed, 129);
    const n = m.size;
    const gold = m.nodes.filter((x) => x.kind === NodeKind.GoldMine);
    assert.ok(gold.every((x) => x.amount === 600), `seed ${seed}`);
    const self = gold.filter((x) => {
      const q = toCanon(m.mirror, x.cellX, x.cellY);
      return gold.some((y) => y.cellX === q.u && y.cellY === q.v) && Math.abs(q.u - x.cellX) + Math.abs(q.v - x.cellY) <= 3;
    });
    assert.ok(self.length >= 4, `seed ${seed}: ${self.length} gold cells on the axis`);
    void n;
  }
}));

/** A finished market and granary of player 0's in an open area, the economy off, resources set. */
function marketGame() {
  const g = emptyGame();
  const w = g.w;
  w.ecoOn[0] = 0;
  w.ecoOn[1] = 0;
  const { x, y } = openArea(g, 12);
  w.addBuilding(0, BuildingType.Granary, x, y, BUILDINGS[BuildingType.Granary].hp, 1000);
  const id = w.addBuilding(0, BuildingType.Market, x + 4, y, BUILDINGS[BuildingType.Market].hp, 1000);
  for (const r of [Resource.Food, Resource.Wood, Resource.Gold]) w.res[r] = 1000;
  return { g, w, x, y, id };
}

test("MARKET on: the rules, the market after a granary; no market of one's own, no trade", switchedOn(MARKET, () => {
  const r = rules();
  assert.equal(r.features.market, true);
  assert.deepEqual([r.buildings[BuildingType.Market].size, r.buildings[BuildingType.Market].hp, r.buildings[BuildingType.Market].cost.wood], [3, 600, 150]);
  assert.deepEqual(r.buildings[BuildingType.Market].requires, [BuildingType.Granary]);
  assert.deepEqual(r.market, { lot: 100, start: 100, step: 5, min: 25, max: 300, sellPermille: 700, recoverTicks: 600, maxLots: 5 });
  const g = emptyGame();
  g.w.res[Resource.Gold] = 1000;
  cmd(g, 0, { c: "trade", resource: Resource.Food, buy: true, lots: 1 });
  assert.deepEqual(rejects(g), [Reject.NoMarket]);
  const { x, y } = openArea(g, 12);
  const f = put(g, 0, UnitType.Farmer, x + 1, y + 6);
  g.w.res[Resource.Wood] = 1000;
  cmd(g, 0, { c: "build", u: [f], type: BuildingType.Market, x, y });
  assert.deepEqual(rejects(g), [Reject.NotAvailable], "a granary first");
}));

test("MARKET on: lot by lot at one's own prices: bought dearer, sold cheaper at 70%, all or nothing", switchedOn(MARKET, () => {
  const { g, w } = marketGame();
  cmd(g, 0, { c: "trade", resource: Resource.Food, buy: true, lots: 2 });
  assert.deepEqual(rejects(g), []);
  assert.deepEqual([w.res[Resource.Food], w.res[Resource.Gold], w.marketPrice[0]], [1200, 1000 - 100 - 105, 110]);
  const ev = g.events.find((e) => e.ev.k === "traded");
  assert.deepEqual([ev?.to, ev?.ev], [0, { k: "traded", resource: Resource.Food, buy: true, lots: 2, amount: 200, gold: 205 }]);
  assert.equal(g.events.filter((e) => e.ev.k === "traded" && e.to === 1).length, 0, "to its trader only");
  // Wood sold: 70, then 66 (95 * 0.7, down), then 63; the price 85. Food's price is its own.
  cmd(g, 0, { c: "trade", resource: Resource.Wood, buy: false, lots: 3 });
  assert.deepEqual(rejects(g), []);
  assert.deepEqual([w.res[Resource.Wood], w.res[Resource.Gold], w.marketPrice[1], w.marketPrice[0]], [700, 795 + 199, 85, 110]);
  // Not enough: nothing traded; too many lots or crystal: invalid.
  w.res[Resource.Gold] = 50;
  cmd(g, 0, { c: "trade", resource: Resource.Food, buy: true, lots: 1 });
  assert.deepEqual(rejects(g), [Reject.CannotAfford]);
  assert.deepEqual([w.res[Resource.Food], w.marketPrice[0]], [1200, 110]);
  cmd(g, 0, { c: "trade", resource: Resource.Food, buy: false, lots: MARKET.maxLots + 1 });
  assert.deepEqual(rejects(g), [Reject.InvalidTarget]);
  cmd(g, 0, { c: "trade", resource: Resource.Crystal, buy: false, lots: 1 });
  assert.deepEqual(rejects(g), [Reject.InvalidTarget]);
  // Each player its own prices; the header shows one's own.
  assert.deepEqual([w.marketPrice[2], w.marketPrice[3]], [100, 100]);
  const h0 = buildView(g, 0).header;
  const h1 = buildView(g, 1).header;
  assert.deepEqual([h0[HeaderField.priceFood], h0[HeaderField.priceWood], h1[HeaderField.priceFood], h1[HeaderField.priceWood]], [110, 85, 100, 100]);
}));

test("MARKET on: prices stay within 25-300 and move a point back toward 100 every 30 s", switchedOn(MARKET, () => {
  const { g, w } = marketGame();
  w.res[Resource.Food] = 100000;
  for (let i = 0; i < 20; i++) {
    cmd(g, 0, { c: "trade", resource: Resource.Food, buy: false, lots: 5 });
    g.step();
  }
  assert.equal(w.marketPrice[0], 25, "the floor");
  w.res[Resource.Gold] = 100000;
  for (let i = 0; i < 20; i++) {
    cmd(g, 0, { c: "trade", resource: Resource.Wood, buy: true, lots: 5 });
    g.step();
  }
  assert.equal(w.marketPrice[1], 300, "the ceiling");
  // The next multiple of recoverTicks is processed at the step after that many.
  const left = MARKET.recoverTicks - (w.tick % MARKET.recoverTicks);
  run(g, left + 1);
  assert.deepEqual([w.marketPrice[0], w.marketPrice[1]], [26, 299]);
  run(g, MARKET.recoverTicks * 10);
  assert.deepEqual([w.marketPrice[0], w.marketPrice[1]], [36, 289]);
}));

const richWith = (opts: Partial<typeof RICH>, body: () => void) => () => {
  const was = { ...RICH };
  Object.assign(RICH, { on: true }, opts);
  try {
    body();
  } finally {
    Object.assign(RICH, was);
  }
};

test("RICH (v): the trees more than 20 cells from both main cities hold farTree, the rest tree", richWith({ goldCell: 600, tree: 100, farTree: 150, forests: 0 }, () => {
  for (const m of [generateMap(), generateRandomMap(3, 129)]) {
    const homes = m.spawns;
    let far = 0;
    for (const nd of m.nodes) {
      if (nd.kind !== NodeKind.Tree) continue;
      const out = homes.every((h) => (nd.cellX - h.cellX) * (nd.cellX - h.cellX) + (nd.cellY - h.cellY) * (nd.cellY - h.cellY) > 400);
      assert.equal(nd.amount, out ? 150 : 100, `${nd.cellX},${nd.cellY}`);
      if (out) far++;
    }
    assert.ok(far > 100, "most trees are far");
  }
}));

test("RICH (vi): 2 more forests by each main city, 14-20 cells out, mirror images, the wood by home up by them", richWith({ goldCell: 600, tree: 100, farTree: 0, forests: 2 }, () => {
  const m = generateMap();
  const trees = new Set(m.nodes.filter((nd) => nd.kind === NodeKind.Tree).map((nd) => nd.cellY * m.size + nd.cellX));
  for (const nd of m.nodes) if (nd.kind === NodeKind.Tree) assert.ok(trees.has(nd.cellX * m.size + nd.cellY), `mirror of ${nd.cellX},${nd.cellY}`);
  const near = (rich: boolean) => {
    RICH.forests = rich ? 2 : 0;
    const mm = generateMap();
    RICH.forests = 2;
    const s = mm.spawns[0];
    return mm.nodes.filter((nd) => nd.kind === NodeKind.Tree && (nd.cellX - s.cellX) * (nd.cellX - s.cellX) + (nd.cellY - s.cellY) * (nd.cellY - s.cellY) <= 400).length;
  };
  assert.ok(near(true) - near(false) >= 40, `forests by home: ${near(false)} -> ${near(true)} trees within 20 cells`);
  for (let seed = 1; seed <= 5; seed++) generateRandomMap(seed, 129);
}));
