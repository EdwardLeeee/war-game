// D-070 (core/rules.ts DEPOT_SPREAD): the economy ratio picks the resource, the depots decide where
// farmers go: the depot (not the main city) with the fewest farmers working near it gets the next
// one, at the nearest work within reach; with no depots, the nearest work as before; farmers the
// ratio moves are spread the same way; mirror images get mirror-image work.

import assert from "node:assert/strict";
import { test } from "node:test";
import { BUILDINGS, DEPOT_SPREAD, ECO_EVERY } from "../src/core/rules.ts";
import { BuildingType, Order, UnitType } from "../src/protocol.ts";
import { emptyGame, put, run, slotOf } from "./helpers.ts";

type G = ReturnType<typeof emptyGame>;
const CAMP = BUILDINGS[BuildingType.LumberCamp];

function withSpread<T>(on: boolean, f: () => T): T {
  const was = DEPOT_SPREAD.on;
  DEPOT_SPREAD.on = on;
  try {
    return f();
  } finally {
    DEPOT_SPREAD.on = was;
  }
}

/** Player 0 (and, mirrored, player 1) with `farmers` idle farmers below the main city, lumber camps by the west forest and the east grove when `camps`. */
function scene(farmers: number, camps: boolean, mirror = false) {
  const g = emptyGame();
  const w = g.w;
  const ids: number[][] = [[], []];
  const camp: number[][] = [[], []];
  for (const p of mirror ? [0, 1] : [0]) {
    const at = (x: number, y: number) => (p === 0 ? [x, y] : [y, x]) as [number, number];
    if (camps) for (const [x, y] of [[11, 70], [25, 70]]) camp[p].push(w.addBuilding(p, BuildingType.LumberCamp, ...at(x, y), CAMP.hp, 1000));
    for (let k = 0; k < farmers; k++) ids[p].push(put(g, p, UnitType.Farmer, ...at(14 + k, 81)));
    w.ecoRatio.set([0, 100, 0], p * 3);
    w.ecoOn[p] = 1;
  }
  if (!mirror) w.ecoOn[1] = 0;
  g.fog.update(w);
  return { g, ids, camp };
}

/** The lumber camp (index into camps) whose tree a farmer cuts is nearest, or -1 for the main city. */
function campOf(g: G, id: number, camps: number[]): number {
  const w = g.w;
  const u = w.units.col;
  const s = slotOf(g, id);
  const t = u.orderTarget[s];
  const x = w.nodeX[t];
  const y = w.nodeY[t];
  const b = w.buildings.col;
  const d = (bs: number) => {
    const size = BUILDINGS[b.type[bs]].size;
    const dx = Math.max(b.cellX[bs] - x, 0, x - (b.cellX[bs] + size - 1));
    const dy = Math.max(b.cellY[bs] - y, 0, y - (b.cellY[bs] + size - 1));
    return dx * dx + dy * dy;
  };
  const city = w.mainCity(u.owner[s]);
  let best = -1;
  let bestD = d(city);
  camps.forEach((c, k) => {
    if (d(w.building(c)) < bestD) {
      best = k;
      bestD = d(w.building(c));
    }
  });
  return best;
}

test("new farmers spread over two lumber camps, two each; with the switch off they go to the nearest trees", () => {
  for (const on of [true, false]) {
    withSpread(on, () => {
      const { g, ids, camp } = scene(4, true);
      run(g, ECO_EVERY + 1);
      const u = g.w.units.col;
      for (const id of ids[0]) assert.equal(u.order[slotOf(g, id)], Order.Gather);
      const per = [0, 0, 0];
      for (const id of ids[0]) per[campOf(g, id, camp[0]) + 1]++;
      if (on) assert.deepEqual(per, [0, 2, 2], "none by the main city, two at each camp");
      else assert.notDeepEqual(per, [0, 2, 2], "switch off: the nearest trees");
    });
  }
});

test("without depots of the resource, farmers go to the nearest work as before", () => {
  const targets = (on: boolean) =>
    withSpread(on, () => {
      const { g, ids } = scene(4, false);
      run(g, ECO_EVERY + 1);
      return ids[0].map((id) => g.w.units.col.orderTarget[slotOf(g, id)]);
    });
  assert.deepEqual(targets(true), targets(false));
});

test("farmers the ratio moves (food to wood) are spread over the camps too", () => {
  withSpread(true, () => {
    // Five on food; the ratio moves four (within one farmer of it, nobody moves).
    const { g, ids, camp } = scene(5, true);
    g.w.ecoRatio.set([100, 0, 0], 0);
    run(g, ECO_EVERY + 1);
    const u = g.w.units.col;
    assert.ok(ids[0].every((id) => u.order[slotOf(g, id)] === Order.Gather), "on food first");
    g.w.ecoRatio.set([0, 100, 0], 0);
    run(g, ECO_EVERY);
    const per = [0, 0, 0];
    for (const id of ids[0]) if (g.w.nodeKind[u.orderTarget[slotOf(g, id)]] === 0) per[campOf(g, id, camp[0]) + 1]++;
    assert.deepEqual(per, [0, 2, 2], "the four moved: two at each camp");
  });
});

test("mirror images: both players' farmers get mirror-image trees", () => {
  withSpread(true, () => {
    const { g, ids, camp } = scene(5, true, true);
    run(g, ECO_EVERY + 1);
    const w = g.w;
    const u = w.units.col;
    const per = [0, 0, 0];
    for (const id of ids[0]) per[campOf(g, id, camp[0]) + 1]++;
    assert.ok(per[0] === 0 && per[1] >= 2 && per[2] >= 2, `spread over both camps: ${per}`);
    for (let k = 0; k < ids[0].length; k++) {
      const a = u.orderTarget[slotOf(g, ids[0][k])];
      const b = u.orderTarget[slotOf(g, ids[1][k])];
      assert.deepEqual([w.nodeX[b], w.nodeY[b]], [w.nodeY[a], w.nodeX[a]], `farmer ${k}`);
    }
    for (let t = 0; t < 200; t++) {
      g.step();
      for (let k = 0; k < ids[0].length; k++) {
        const sa = slotOf(g, ids[0][k]);
        const sb = slotOf(g, ids[1][k]);
        assert.deepEqual([u.x[sb], u.y[sb]], [u.y[sa], u.x[sa]], `tick ${g.tick}`);
      }
    }
  });
});

