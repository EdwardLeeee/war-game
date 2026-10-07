// 兵種相剋 (選單, ceo 2026-10-07): the lines come from the simulation's own damage table.

import assert from "node:assert/strict";
import { test } from "node:test";
import { counterLines, counterTypes, ratioText } from "../src/game/counters.ts";
import { rules as simRules, type Rules, UnitType } from "../src/sim.ts";
import { UNIT_NAME } from "../src/ui/hud/names.ts";

const withCavalry = (on: boolean): Rules => ({ ...simRules(), features: { plunderOnce: false, towers: false, garrison: false, cavalry: on } });

test("兵種相剋：倍數照模擬的表，寫成 ×3、×2.5", () => {
  assert.equal(ratioText({ num: 3, den: 1 }), "3");
  assert.equal(ratioText({ num: 5, den: 2 }), "2.5");
  assert.equal(ratioText({ num: 3, den: 2 }), "1.5");
});

test("兵種相剋：騎兵開著時四種兵，剋誰、怕誰都從 rules.multipliers 來", () => {
  const lines = counterLines(withCavalry(true), UNIT_NAME);
  assert.deepEqual(
    lines.map((l) => l.type),
    [UnitType.Spearman, UnitType.Ranged, UnitType.Mage, UnitType.Cavalry],
  );
  const by = (t: number) => lines.find((l) => l.type === t);
  assert.deepEqual(by(UnitType.Spearman), { type: UnitType.Spearman, beats: ["打騎兵 ×3"], fears: ["遠程兵 ×2.5"] });
  assert.deepEqual(by(UnitType.Ranged), { type: UnitType.Ranged, beats: ["打槍兵 ×2.5", "打法師的護盾 ×3"], fears: [] });
  assert.deepEqual(by(UnitType.Mage), { type: UnitType.Mage, beats: [], fears: ["遠程兵打護盾 ×3", "騎兵 ×2", "騎兵打護盾 ×2"] });
  assert.deepEqual(by(UnitType.Cavalry), { type: UnitType.Cavalry, beats: ["打法師 ×2", "打法師的護盾 ×2"], fears: ["槍兵 ×3"] });
});

test("兵種相剋：騎兵關著時只有三種兵，和騎兵有關的倍數不列", () => {
  assert.deepEqual(counterTypes(withCavalry(false)), [UnitType.Spearman, UnitType.Ranged, UnitType.Mage]);
  const lines = counterLines(withCavalry(false), UNIT_NAME);
  assert.deepEqual(lines.find((l) => l.type === UnitType.Spearman)?.beats, []);
  assert.deepEqual(lines.find((l) => l.type === UnitType.Mage)?.fears, ["遠程兵打護盾 ×3"]);
  assert.deepEqual(counterLines(null, UNIT_NAME).map((l) => [l.beats, l.fears]), [[[], []], [[], []], [[], []]]);
});
