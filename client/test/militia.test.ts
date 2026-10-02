// 離民兵太近 (ceo, D-044 round 4): a building whose farmers the town's militia would reach.

import assert from "node:assert/strict";
import { test } from "node:test";
import { MILITIA_CLEARANCE, militiaHold, militiaTownNear } from "../src/game/militia.ts";
import { TownState } from "../src/sim.ts";

// The fake world's neutral town (30, 66), militia 3; its centre is (30.5, 66.5).
const town = (state: number | null = TownState.Neutral, militia = 3, id = 0, cellX = 30, cellY = 66) => ({ id, cellX, cellY, state, militia });

test("離民兵太近：12 格內有民兵的中立城鎮才警告；距離是建築中心到城鎮中心，剛好 12 格也算（和 core 的電腦一樣）", () => {
  assert.equal(MILITIA_CLEARANCE, 12);
  const towns = [town()];
  // A 3 x 3 building at (41, 65): centre (42.5, 66.5), exactly 12 cells east.
  assert.equal(militiaTownNear(towns, 41, 65, 3)?.id, 0);
  assert.equal(militiaTownNear(towns, 42, 65, 3), null, "13 cells");
  // The same corner, a 2 x 2 building: its centre is half a cell nearer.
  assert.equal(militiaTownNear(towns, 42, 66, 2), null, "12.5 cells");
  assert.equal(militiaTownNear(towns, 41, 66, 2)?.id, 0, "11.5 cells");
  // Diagonal: a 2 x 2 at (22, 74), centre (23, 75), is 11.3 cells away; at (21, 76), 13.5.
  assert.equal(militiaTownNear(towns, 22, 74, 2)?.id, 0);
  assert.equal(militiaTownNear(towns, 21, 76, 2), null);
});

test("離民兵太近：民兵都倒了、被自己或對手拿下、廢墟，都不警告；還沒探索過的城鎮照開局的樣子警告", () => {
  assert.equal(militiaHold(town()), true);
  assert.equal(militiaHold(town(TownState.Neutral, 0)), false, "militia all fallen, not captured yet");
  for (const state of [TownState.AwaitingChoice, TownState.Plundering, TownState.Repairing, TownState.Governed, TownState.Ruins]) {
    assert.equal(militiaHold(town(state, 0)), false, `state ${state}`);
    assert.equal(militiaTownNear([town(state, 0)], 30, 66, 2), null, `state ${state}`);
  }
  // Never explored: every town starts neutral with militia.
  assert.equal(militiaHold(town(null, 0)), true);
  assert.equal(militiaTownNear([town(null, 0)], 30, 66, 2)?.id, 0);
});

test("離民兵太近：兩座都夠近時指比較近的那一座", () => {
  const towns = [town(TownState.Neutral, 3, 0, 30, 66), town(TownState.Neutral, 6, 1, 20, 66)];
  assert.equal(militiaTownNear(towns, 22, 66, 2)?.id, 1);
  assert.equal(militiaTownNear(towns, 28, 66, 2)?.id, 0);
  assert.equal(militiaTownNear([], 28, 66, 2), null);
});
