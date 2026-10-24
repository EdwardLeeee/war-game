// 點城鎮就是進攻 (D-100, the user 2026-10-23: 「攻擊城市的操作手感不太好，常常點不到」): with
// soldiers selected, a tap on the ground of a town not ours sends them at its keep (攻擊移動), or
// where tapped once the keep is down; a tap on the keep attacks it; our own town, farmers alone and
// the switch off are as before. The first time, a hint, remembered on the device. The keep is 主堡.

import assert from "node:assert/strict";
import { test } from "node:test";
import { KEEP_HINT_KEY, loadHintSeen, saveHintSeen } from "../src/hint-pref.ts";
import { type Intent, type Selection, tapIntents } from "../src/input/intent.ts";
import { BuildingType, NEUTRAL, TownSize } from "../src/sim.ts";
import { buildingName } from "../src/ui/hud/names.ts";
import { at, ENEMY, FakeWorld, ME, UnitType } from "./fakes.ts";

const R = 22;
const SMALL = TownSize.Small;

/** Soldiers and a farmer of ours by home; a neutral town (its keep standing), the enemy's, ours. */
function world(keeps = true): FakeWorld {
  const w = new FakeWorld(
    [
      { id: 1, owner: ME, type: UnitType.Farmer, cx: 2, cy: 2 },
      { id: 2, owner: ME, type: UnitType.Spearman, cx: 3, cy: 2 },
      { id: 3, owner: ME, type: UnitType.Ranged, cx: 4, cy: 2 },
    ],
    [{ kind: "building", id: 50, owner: NEUTRAL, type: BuildingType.Keep, cx: 30, cy: 30 }],
  );
  w.towns = [
    { id: 0, owner: NEUTRAL, size: SMALL, x0: 23, y0: 23, x1: 37, y1: 37, keep: { x: 30, y: 30 } },
    { id: 1, owner: ENEMY, size: SMALL, x0: 53, y0: 23, x1: 67, y1: 37, keep: null },
    { id: 2, owner: ME, size: SMALL, x0: 23, y0: 53, x1: 37, y1: 67, keep: { x: 30, y: 60 } },
  ];
  w.keeps = keeps;
  return w;
}

const soldiers: Selection = { units: [2, 3], building: null };
const tapAt = (w: FakeWorld, sel: Selection, cx: number, cy: number, mode: "normal" | "advance" = "normal"): Intent[] => tapIntents(w, sel, mode, at(cx), at(cy), 1, R);

test("點城鎮（主堡在）：選著兵點中立城鎮的地面＝攻擊移動到主堡中心格，第一次要提示", () => {
  assert.deepEqual(tapAt(world(), soldiers, 25, 34), [
    { kind: "command", cmd: { c: "move", u: [2, 3], x: 30, y: 30 } },
    { kind: "townAttack", town: 0 },
  ]);
});

test("點城鎮（主堡倒了）：攻擊移動到點的那格；敵方的城一樣", () => {
  assert.deepEqual(tapAt(world(), soldiers, 55, 25), [
    { kind: "command", cmd: { c: "move", u: [2, 3], x: 55, y: 25 } },
    { kind: "townAttack", town: 1 },
  ]);
});

test("點城鎮：兵和村民一起選，兵去打，村民照舊走到點的那格", () => {
  assert.deepEqual(tapAt(world(), { units: [1, 2, 3], building: null }, 25, 34), [
    { kind: "command", cmd: { c: "move", u: [2, 3], x: 30, y: 30 } },
    { kind: "command", cmd: { c: "move", u: [1], x: 25, y: 34 } },
    { kind: "townAttack", town: 0 },
  ]);
});

test("點主堡本身＝攻擊它", () => {
  assert.deepEqual(tapAt(world(), soldiers, 30, 30), [{ kind: "command", cmd: { c: "attack", u: [2, 3], target: 50 } }]);
});

test("攻擊模式（按攻擊再點）點城鎮的地面：一樣攻擊移動到主堡；主堡倒了到點的那格", () => {
  assert.deepEqual(tapAt(world(), soldiers, 25, 34, "advance"), [{ kind: "command", cmd: { c: "move", u: [2, 3], x: 30, y: 30 } }, { kind: "endMode" }]);
  assert.deepEqual(tapAt(world(), soldiers, 55, 25, "advance"), [{ kind: "command", cmd: { c: "move", u: [2, 3], x: 55, y: 25 } }, { kind: "endMode" }]);
  assert.deepEqual(tapAt(world(false), soldiers, 25, 34, "advance"), [{ kind: "command", cmd: { c: "move", u: [2, 3], x: 25, y: 34 } }, { kind: "endMode" }]);
});

test("照舊：自己的城是移動、只有村民、沒選兵是看城鎮、開關關著是移動", () => {
  assert.deepEqual(tapAt(world(), soldiers, 25, 55), [{ kind: "command", cmd: { c: "retreat", u: [2, 3], x: 25, y: 55 } }]);
  assert.deepEqual(tapAt(world(), { units: [1], building: null }, 25, 34), [{ kind: "command", cmd: { c: "move", u: [1], x: 25, y: 34 } }]);
  assert.deepEqual(tapAt(world(), { units: [], building: null }, 25, 34), [{ kind: "inspect", pick: { kind: "town", id: 0, owner: NEUTRAL, type: SMALL } }]);
  assert.deepEqual(tapAt(world(false), soldiers, 25, 34), [{ kind: "command", cmd: { c: "retreat", u: [2, 3], x: 25, y: 34 } }]);
});

test("提示只跳一次：記在這台裝置上；不能存的時候下次再跳", () => {
  const map = new Map<string, string>();
  const store = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) };
  assert.equal(loadHintSeen(KEEP_HINT_KEY, store), false);
  saveHintSeen(KEEP_HINT_KEY, store);
  assert.equal(loadHintSeen(KEEP_HINT_KEY, store), true);
  const broken = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  };
  saveHintSeen(KEEP_HINT_KEY, broken);
  assert.equal(loadHintSeen(KEEP_HINT_KEY, broken), false);
});

test("名字：開關開著時是主堡，關著時照舊是大城箭樓", () => {
  assert.equal(buildingName(BuildingType.Keep, { features: { plunderOnce: true, towers: true, garrison: true, cavalry: true, keep: true } }), "主堡");
  assert.equal(buildingName(BuildingType.Keep, { features: { plunderOnce: true, towers: true, garrison: true, cavalry: true } }), "大城箭樓");
  assert.equal(buildingName(BuildingType.Barracks, null), "兵營");
});
