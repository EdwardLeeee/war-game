// 滑鼠說明 (R26 03 A, design/r26/spec.md section 03; ceo 2026-11-20): where a tip goes, and its words from this game's
// rules (a number changed in the rules changes the words).

import assert from "node:assert/strict";
import { test } from "node:test";
import { MOCK_RULES } from "../src/mock/mock-port.ts";
import { BuildingType, type Rules, UnitType } from "../src/sim.ts";
import { buildingTip, orderTip, unitTip } from "../src/ui/hud/tip-text.ts";
import { tipPlace } from "../src/ui/hud/tips.ts";

const WIN = { width: 1920, height: 950 };

test("位置：按鈕上方 6，右邊對齊按鈕右邊；左右留在視窗內 4；上面放不下就放下面；介面放大時照放大的長度", () => {
  const tip = { width: 240, height: 70 };
  assert.deepEqual(tipPlace({ left: 1500, right: 1556, top: 880, bottom: 930 }, tip, WIN), { left: 1316, top: 804 });
  assert.deepEqual(tipPlace({ left: 1860, right: 1918, top: 880, bottom: 930 }, tip, WIN), { left: 1676, top: 804 }, "right edge at most 4 in");
  assert.deepEqual(tipPlace({ left: 0, right: 60, top: 880, bottom: 930 }, tip, WIN), { left: 4, top: 804 }, "left edge at least 4 in");
  assert.deepEqual(tipPlace({ left: 1500, right: 1556, top: 10, bottom: 60 }, tip, WIN), { left: 1316, top: 66 }, "no room above: under it");
  assert.deepEqual(tipPlace({ left: 1500, right: 1556, top: 880, bottom: 930 }, { width: 360, height: 105 }, WIN, 1.5), { left: 1196, top: 766 });
});

test("字：民居的人口、箭樓幾名、哨所幾名和躲進去或駐守照規則；礦場有魔晶時寫魔晶；法師照 D-135", () => {
  const rules = structuredClone(MOCK_RULES) as Rules;
  rules.buildings[BuildingType.House] = { ...rules.buildings[BuildingType.House], populationCap: 8 };
  assert.equal(buildingTip(rules, BuildingType.House), "人口上限 +8。");
  rules.buildings[BuildingType.House] = { ...rules.buildings[BuildingType.House], populationCap: 5 };
  assert.equal(buildingTip(rules, BuildingType.House), "人口上限 +5。");
  rules.features = { ...rules.features, garrison: true, outpost: true, outpostHide: true, noCrystal: true } as Rules["features"];
  rules.buildings[BuildingType.ArrowTower] = { ...rules.buildings[BuildingType.ArrowTower], holds: 3 };
  rules.outpost = { ...(rules.outpost ?? { slots: 0, reach: 0, chase: 0 }), slots: 9 } as Rules["outpost"];
  assert.equal(buildingTip(rules, BuildingType.ArrowTower), "會自己射箭。遠程兵和法師可以躲進去（3 名）。");
  assert.equal(buildingTip(rules, BuildingType.Outpost), "視野遠，任何空地都能蓋。槍兵可以躲進去（9 名），附近可以蓋箭樓。");
  assert.equal(buildingTip(rules, BuildingType.Mine), "存放金幣。蓋在金礦旁，村民少走路。");
  rules.features = { ...rules.features, outpostHide: false, noCrystal: false } as Rules["features"];
  rules.outpost = { ...(rules.outpost as NonNullable<Rules["outpost"]>), slots: 6 };
  assert.equal(buildingTip(rules, BuildingType.Outpost), "視野遠，任何空地都能蓋。槍兵可以駐守（6 名），附近可以蓋箭樓。");
  assert.equal(buildingTip(rules, BuildingType.Mine), "存放金幣和魔晶。蓋在金礦旁，村民少走路。");
  assert.equal(unitTip(UnitType.Mage), "放晶砲炸一片，射完要等一下才能再射。");
  assert.equal(orderTip("攻擊：點地面或敵人：邊走邊打，或集中打它"), "點地面或敵人：邊走邊打，或集中打它");
});
