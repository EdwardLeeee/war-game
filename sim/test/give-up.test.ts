// Giving up a place it does not get to (D-095; core/rules.ts SLOT_GIVE_UP): the client's main-flow
// e2e step 10 (client/e2e/main-flow.spec.ts), 22 loose soldiers sent to (28, 52) on the e2e map.
// Since R6-51's ridge from (21, 41) to (28, 46), one ranged unit of the back row walked the
// group's way round it to the goal cell and then shuttled between the way and its place behind
// mates already standing, its move never done ("移動中 1" for good). Start positions: as the
// client's e2e logged them when it sent the move, three runs.

import assert from "node:assert/strict";
import { test } from "node:test";
import { Game } from "../src/core/game.ts";
import { SLOT_GIVE_UP, UNITS } from "../src/core/rules.ts";
import { Order, UnitFlag, type UnitType } from "../src/protocol.ts";
import { switchedOff } from "./helpers.ts";

/** [unit type, x, y (cells)] of each soldier. */
const STARTS: [UnitType, number, number][][] = [
  // main-flow at its tick 5774
  [[1,30.92,43.33],[1,26.36,42.58],[1,24.41,42.05],[1,30.5,41.37],[2,27.79,37.43],[2,30.85,37.38],[2,29.02,36.65],[2,26.97,35.71],[1,29.02,43.11],[1,27.69,42.43],[1,23.64,40],[1,30.86,39.39],[1,29.18,38.74],[1,27.64,39.44],[1,29.02,40.94],[1,25.54,40.68],[1,20.64,42.13],[1,26.66,40.68],[1,26.01,37.83],[1,26.05,38.76],[1,28.55,40.61],[1,19.69,48.48]],
  // main-flow at its tick 5818
  [[1,30.91,43.5],[1,26.31,42.78],[1,24.48,41.98],[1,30.49,41.53],[2,27.88,37.48],[2,30.81,37.52],[2,29.06,36.53],[2,27,35.74],[1,29.03,43.45],[1,27.58,42.65],[1,23.57,40],[1,30.63,39.53],[1,29.15,41.44],[1,29.18,38.97],[1,28.07,38.89],[1,27.33,40.75],[1,20.65,42.18],[1,26.32,38.1],[1,25.44,40.59],[1,26.48,39.22],[1,28.58,40.82],[1,19.74,46.13]],
  // main-flow at its tick 5815
  [[1,31,43.61],[1,26.51,42.57],[1,24.58,42.1],[1,30.63,41.63],[2,26.06,37.67],[2,30.71,37.58],[2,29.07,36.89],[2,27.29,36.1],[1,29.01,43.33],[1,27.74,42.58],[1,23.73,40],[1,30.87,39.64],[1,29.24,38.94],[1,27.73,39.83],[1,29.22,41.21],[1,25.57,40.81],[1,20.64,42.33],[1,27.29,40.78],[1,27.79,38.3],[1,25.99,39.21],[1,28.82,40.87],[1,19.89,46.83]],
];

/** One start's soldiers alone on the e2e map, loose, told `how` to (28, 52); ticks until none has an order (-1: not within `cap`). */
function settle(start: [UnitType, number, number][], how: "move" | "retreat", cap = 1500, face?: number): { g: Game; ids: number[]; ticks: number } {
  const g = new Game({ seed: 1, scenario: "e2e" });
  const w = g.w;
  for (let s = 0; s < w.units.count; s++) w.unitSlot[w.units.col.id[s]] = -1;
  w.units.count = 0;
  const ids = start.map(([type, x, y]) => w.addUnit(0, type, Math.round(x * 1024), Math.round(y * 1024), UNITS[type].hp));
  const u = w.units.col;
  for (const id of ids) u.flags[w.unit(id)] |= UnitFlag.Loose;
  g.fog.update(w);
  let seq = 0;
  g.push({ t: g.tick, p: 0, seq: seq++, c: how, u: ids, x: 28, y: 52 } as never);
  const done = () => ids.every((id) => u.order[w.unit(id)] === Order.None);
  let ticks = -1;
  for (let t = 1; t <= cap && ticks < 0; t++) {
    g.step();
    if (t > 5 && done()) ticks = t;
  }
  if (face !== undefined && ticks >= 0) {
    // Then 整理隊形 facing `face` where they stand.
    g.push({ t: g.tick, p: 0, seq: seq++, c: "formation", u: ids, loose: true, face } as never);
    ticks = -1;
    for (let t = 1; t <= cap && ticks < 0; t++) {
      g.step();
      if (t > 5 && done()) ticks = t;
    }
  }
  return { g, ids, ticks };
}

test("the client's three starts settle, on a move and on a retreat, about as soon as before R6-51's ridges (400-430 ticks)", () => {
  for (const how of ["move", "retreat"] as const) {
    STARTS.forEach((start, k) => {
      const { ticks } = settle(start, how);
      assert.ok(ticks > 0 && ticks <= 450, `${how}, start ${k}: ${ticks} ticks`);
    });
  }
});

test("then told to re-form facing north (formation with face) where they stand, they settle too", () => {
  STARTS.forEach((start, k) => {
    const { ticks } = settle(start, "move", 1500, 12);
    assert.ok(ticks > 0 && ticks <= 450, `start ${k}: ${ticks} ticks`);
  });
});

test(
  "switched off, the first start's ranged unit never gets to its place",
  switchedOff(SLOT_GIVE_UP, () => {
    for (const how of ["move", "retreat"] as const) {
      const { g, ids, ticks } = settle(STARTS[0], how, 3000);
      assert.equal(ticks, -1, `${how}: settled after ${ticks} ticks`);
      const u = g.w.units.col;
      assert.equal(ids.filter((id) => u.order[g.w.unit(id)] !== Order.None).length, 1, "one unit still on its way");
    }
  }),
);
