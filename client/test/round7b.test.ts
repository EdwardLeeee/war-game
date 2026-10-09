// 第七輪 7b on the screen (D-061): what shows while a rule is off, the town's income line,
// arrow towers only on TowerLand, and the 躲進去 tap. Pure logic; checks against the real
// simulation come once core's round 7 PRs (T, D, K) land (ceo 2026-10-07: before round 7 goes live).

import assert from "node:assert/strict";
import { test } from "node:test";
import { features, garrisonTypes, holdsOf } from "../src/game/features.ts";
import { garrisonTap, isHiding } from "../src/game/garrison.ts";
import { BuildingType, Order, PlaceBit, type Rules, TownState, UnitType } from "../src/sim.ts";
import { incomeText } from "../src/ui/hud/panels.ts";
import { towerLandOk } from "../src/ui/placement.ts";

const rules = (on: boolean) =>
  ({
    features: { plunderOnce: on, towers: on, garrison: on, cavalry: on },
    garrisonTypes: [UnitType.Ranged, UnitType.Mage],
    buildings: { [BuildingType.MainCity]: { holds: 6 }, [BuildingType.ArrowTower]: { holds: 4 }, [BuildingType.House]: { holds: 0 } },
  }) as unknown as Rules;

test("開關：沒送 features 當全關；關著時沒有能躲的兵種、建築也躲不了人", () => {
  assert.deepEqual(features(null), { plunderOnce: false, towers: false, garrison: false, cavalry: false, outpost: false });
  assert.deepEqual(features({} as Rules), { plunderOnce: false, towers: false, garrison: false, cavalry: false, outpost: false });
  assert.deepEqual(garrisonTypes(rules(false)), []);
  assert.equal(holdsOf(rules(false), BuildingType.MainCity), 0);
  assert.deepEqual(garrisonTypes(rules(true)), [UnitType.Ranged, UnitType.Mage]);
  assert.equal(holdsOf(rules(true), BuildingType.MainCity), 6);
  assert.equal(holdsOf(rules(true), BuildingType.ArrowTower), 4);
  assert.equal(holdsOf(rules(true), BuildingType.House), 0);
});

test("治理收入：全額寫 100%；搶過的城從幾成開始，寫「慢慢回升」；修繕中寫修好後；其他狀態不寫", () => {
  assert.equal(incomeText(1000, TownState.Governed), "收入 100%");
  assert.equal(incomeText(400, TownState.Governed), "收入 40%，慢慢回升");
  assert.equal(incomeText(655, TownState.Governed), "收入 66%，慢慢回升");
  assert.equal(incomeText(400, TownState.Repairing), "修好後收入 40%，慢慢回升");
  assert.equal(incomeText(1000, TownState.Repairing), null);
  assert.equal(incomeText(400, TownState.Neutral), null);
  assert.equal(incomeText(400, TownState.Plundering), null);
});

test("箭樓只能放在 TowerLand：占地每一格都要是；其他建築不看這一格", () => {
  const n = 8;
  const cells = new Uint8Array(n * n);
  for (let y = 2; y < 5; y++) for (let x = 2; x < 5; x++) cells[y * n + x] = PlaceBit.TowerLand;
  const grid = { size: n, cells };
  const tower = { type: BuildingType.ArrowTower, size: 2 };
  assert.equal(towerLandOk(grid, tower, 2, 2), true);
  assert.equal(towerLandOk(grid, tower, 3, 3), true);
  assert.equal(towerLandOk(grid, tower, 4, 4), false, "half of it off TowerLand");
  assert.equal(towerLandOk(grid, tower, 7, 7), false, "off the map");
  assert.equal(towerLandOk(grid, { type: BuildingType.House, size: 2 }, 6, 6), true);
});

test("躲進去：只送遠程兵和法師，躲進自己蓋好、能躲人的主城或箭樓；其他情況說明原因", () => {
  const type: Record<number, number> = { 1: UnitType.Spearman, 2: UnitType.Ranged, 3: UnitType.Mage, 4: UnitType.Ranged };
  const hides = (id: number) => type[id] === UnitType.Ranged || type[id] === UnitType.Mage;
  const holds = (t: number) => holdsOf(rules(true), t);
  const city = { id: 50, owner: 0, type: BuildingType.MainCity, done: true };
  assert.deepEqual(garrisonTap([1, 2, 3, 4], city, 0, hides, holds), { cmd: { c: "garrison", u: [2, 3, 4], building: 50 } });
  assert.deepEqual(garrisonTap([2], { ...city, type: BuildingType.ArrowTower }, 0, hides, holds), { cmd: { c: "garrison", u: [2], building: 50 } });
  assert.deepEqual(garrisonTap([1], city, 0, hides, holds), { error: "只有遠程兵和法師能躲進去" });
  for (const target of [null, { ...city, owner: 1 }, { ...city, done: false }, { ...city, type: BuildingType.House }]) {
    assert.deepEqual(garrisonTap([2], target, 0, hides, holds), { error: "要點自己蓋好的主城或箭樓" });
  }
});

test("躲著的兵：order 是 Garrison（走去躲的和已經躲好的）", () => {
  assert.equal(isHiding(Order.Garrison), true);
  for (const o of [Order.None, Order.Move, Order.Attack, Order.Retreat, Order.Recall]) assert.equal(isHiding(o), false);
});
