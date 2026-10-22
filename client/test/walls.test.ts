// 上城牆 (D-096): what a tap on a town means for the ranged units and mages selected, and 下城牆;
// the gates' looks and the way into the town from a stretch of wall (art-v5.2).

import assert from "node:assert/strict";
import { test } from "node:test";
import { gateLook, inward } from "../src/art/castle.ts";
import { type AtlasJson, animFor, stoneFrom } from "../src/art/spec.ts";
import { goesOnWalls, heldTown, leaveWalls, WALL_FULL, WALL_NOBODY, WALL_WRONG_TARGET, wallTap } from "../src/game/walls.ts";
import { Action, Order, TownState, UnitType } from "../src/sim.ts";

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

test("城門的樣子（D-096，ui 的建議）：廢墟 ruin；沒有門 broken；血量一半以下 damaged；城主的兵在門口開著；其他關著；沒開城門規則照舊開著", () => {
  const base = { gates: true, ruins: false, standing: true, hp: 850, max: 850, holderNear: false };
  assert.equal(gateLook(base), "closed");
  assert.equal(gateLook({ ...base, holderNear: true }), "intact");
  assert.equal(gateLook({ ...base, hp: 425 }), "damaged");
  assert.equal(gateLook({ ...base, hp: 426 }), "closed");
  assert.equal(gateLook({ ...base, hp: 300, holderNear: true }), "damaged", "damaged even when they are by it");
  assert.equal(gateLook({ ...base, standing: false }), "broken");
  assert.equal(gateLook({ ...base, ruins: true, standing: false }), "ruin");
  assert.equal(gateLook({ ...base, gates: false, standing: false }), "intact");
});

test("牆段往城裡的方向（D-096）：看名字的北南西東；角樓和城門沒有", () => {
  assert.deepEqual(inward("pal_n"), [0, 1]);
  assert.deepEqual(inward("sw_s"), [0, -1]);
  assert.deepEqual(inward("pal_w"), [1, 0]);
  assert.deepEqual(inward("sw_e"), [-1, 0]);
  assert.equal(inward("pal_corner"), null);
  assert.equal(inward("sw_gate_x3"), null);
  assert.equal(inward("pal_x"), null, "art-v5's pieces have no side");
});

test("民兵投石（D-096，art-v5.2）：在牆上出手才用 sling，沒有這個動作照舊 attack；石頭從右手前上方出發，鏡像的圖右邊換到左邊", () => {
  const anims = { idle: { frames: 1, loop: true }, attack: { frames: 8, loop: false }, sling: { frames: 10, loop: false, hit: 6 } };
  const a = { anims } as unknown as AtlasJson;
  assert.equal(animFor(a, Action.Attack, null, true), "sling");
  assert.equal(animFor(a, Action.Attack, null, false), "attack");
  assert.equal(animFor({ anims: { ...anims, sling: undefined } } as unknown as AtlasJson, Action.Attack, null, true), "attack");
  const m: [number, number, number] = [0.41, 0.96, 1.78];
  // Facing the camera (direction 6, south): right is west.
  const s = stoneFrom(6, false, m, "oblique");
  assert.ok(Math.abs(s.x + 0.41) < 1e-9 && Math.abs(s.y - 0.96) < 1e-9 && s.up === 1.78);
  // Facing east (direction 0): forward east, right south.
  const e = stoneFrom(0, false, m, "oblique");
  assert.ok(Math.abs(e.x - 0.96) < 1e-9 && Math.abs(e.y - 0.41) < 1e-9);
  // Mirrored: the right hand on the left.
  const w = stoneFrom(6, true, m, "oblique");
  assert.ok(Math.abs(w.x - 0.41) < 1e-9 && Math.abs(w.y - 0.96) < 1e-9);
});
