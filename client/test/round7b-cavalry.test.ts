// 第七輪 7b, 馬廄與騎兵 (D-061): what 建造 offers while a rule is off, `requires`, and cavalry
// counted as a soldier everywhere the others are.

import assert from "node:assert/strict";
import { test } from "node:test";
import { GROUP_TYPES, isSoldier } from "../src/game/army.ts";
import { buildable, missingFor } from "../src/game/features.ts";
import { isMilitary, wheelItems } from "../src/input/intent.ts";
import { BuildingType, type Rules, UnitType } from "../src/sim.ts";
import { BUILDABLE, BUILDING_NAME, UNIT_NAME } from "../src/ui/hud/names.ts";

const rules = (on: boolean) =>
  ({
    features: { plunderOnce: on, towers: on, garrison: on, cavalry: on },
    buildings: { [BuildingType.Stable]: { requires: [BuildingType.Barracks] }, [BuildingType.House]: {} },
  }) as unknown as Rules;

test("建造：箭樓、馬廄只在開關開著時列出；其他建築一直都在", () => {
  assert.ok(BUILDABLE.includes(BuildingType.ArrowTower) && BUILDABLE.includes(BuildingType.Stable));
  assert.equal(buildable(rules(false), BuildingType.Stable), false);
  assert.equal(buildable(rules(false), BuildingType.ArrowTower), false);
  assert.equal(buildable(null, BuildingType.Stable), false, "no features sent: off");
  assert.equal(buildable(rules(true), BuildingType.Stable), true);
  assert.equal(buildable(rules(false), BuildingType.House), true);
  assert.equal(BUILDING_NAME[BuildingType.Stable], "馬廄");
});

test("requires：還沒有自己蓋好的那幾種建築時，列出缺的；有了就是空的", () => {
  assert.deepEqual(missingFor(rules(true), BuildingType.Stable, new Set()), [BuildingType.Barracks]);
  assert.deepEqual(missingFor(rules(true), BuildingType.Stable, new Set([BuildingType.Barracks])), []);
  assert.deepEqual(missingFor(rules(true), BuildingType.House, new Set()), [], "no requires");
  assert.deepEqual(missingFor(null, BuildingType.Stable, new Set()), []);
});

test("騎兵：叫騎兵，算士兵（全軍、編隊、留守），軍團畫面多一列，長按輪盤和槍兵一樣", () => {
  assert.equal(UNIT_NAME[UnitType.Cavalry], "騎兵");
  assert.equal(isSoldier(UnitType.Cavalry), true);
  assert.equal(isMilitary(UnitType.Cavalry), true);
  assert.ok(GROUP_TYPES.includes(UnitType.Cavalry));
  assert.deepEqual(wheelItems(UnitType.Cavalry), ["advance", "retreat", "hold"]);
});
