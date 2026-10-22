// 上城牆 (D-096): what a tap on a town means for the ranged units and mages selected, and 下城牆.

import assert from "node:assert/strict";
import { test } from "node:test";
import { goesOnWalls, heldTown, leaveWalls, WALL_FULL, WALL_NOBODY, WALL_WRONG_TARGET, wallTap } from "../src/game/walls.ts";
import { Order, TownState, UnitType } from "../src/sim.ts";

const type: Record<number, number> = { 1: UnitType.Ranged, 2: UnitType.Mage, 3: UnitType.Spearman };
const canGo = (id: number) => goesOnWalls(type[id]);

test("上城牆：只有遠程兵和法師上去；不是自己持有的城鎮、沒有能上的兵、牆上滿了，各說原因", () => {
  const ours = { id: 4, held: true, onWall: 3, capacity: 28 };
  assert.deepEqual(wallTap([1, 2, 3], ours, canGo), { cmd: { c: "wall", u: [1, 2], town: 4 } });
  assert.deepEqual(wallTap([1], null, canGo), { error: WALL_WRONG_TARGET });
  assert.deepEqual(wallTap([1], { ...ours, held: false }, canGo), { error: "不是你攻下的城鎮" });
  assert.deepEqual(wallTap([3], ours, canGo), { error: WALL_NOBODY });
  assert.deepEqual(wallTap([1], { ...ours, onWall: 28 }, canGo), { error: WALL_FULL });
});

test("持有的城鎮：自己的，而且是攻下待選、搶、修繕、治理中；中立、廢墟、別人的都不算", () => {
  for (const s of [TownState.AwaitingChoice, TownState.Plundering, TownState.Repairing, TownState.Governed]) assert.equal(heldTown(0, s, 0), true);
  assert.equal(heldTown(0, TownState.Ruins, 0), false);
  assert.equal(heldTown(1, TownState.Governed, 0), false);
});

test("下城牆：在牆上（或正要上去）的兵，每座城鎮一道指令", () => {
  assert.deepEqual(
    leaveWalls([
      { id: 1, order: Order.Wall, town: 4 },
      { id: 2, order: Order.Wall, town: 2 },
      { id: 3, order: Order.None, town: -1 },
      { id: 5, order: Order.Wall, town: 4 },
    ]),
    [
      { c: "leave_wall", u: [2], town: 2 },
      { c: "leave_wall", u: [1, 5], town: 4 },
    ],
  );
});
