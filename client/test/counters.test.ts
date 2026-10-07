// 兵種相剋 (選單, ceo 2026-10-07): the multipliers come from the simulation's own damage table;
// the counters that are no multiplier (GDD §6) are written beside them.

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

test("兵種相剋：騎兵開著時四種兵；倍數從 rules.multipliers 來，晶砲、騎兵跑得快這類不是倍數的剋制也寫上", () => {
  const lines = counterLines(withCavalry(true), UNIT_NAME);
  assert.deepEqual(
    lines.map((l) => l.type),
    [UnitType.Spearman, UnitType.Ranged, UnitType.Mage, UnitType.Cavalry],
  );
  const by = (t: number) => lines.find((l) => l.type === t);
  assert.deepEqual(by(UnitType.Spearman), { type: UnitType.Spearman, beats: ["騎兵 ×3"], fears: ["遠程兵 ×2.5", "晶砲（擠在一起時）"] });
  // 遠程打騎兵 ×1.8 (core, round 7 PR K): read from the table like the rest.
  assert.deepEqual(by(UnitType.Ranged), { type: UnitType.Ranged, beats: ["槍兵 ×2.5", "法師的護盾 ×3", "騎兵 ×1.8"], fears: ["騎兵（跑得快，很快衝到面前；生命少）"] });
  assert.deepEqual(by(UnitType.Mage), { type: UnitType.Mage, beats: ["擠在一起的部隊（晶砲範圍傷害）"], fears: ["遠程兵打護盾 ×3", "騎兵 ×2", "騎兵打護盾 ×2"] });
  assert.deepEqual(by(UnitType.Cavalry), { type: UnitType.Cavalry, beats: ["遠程兵（跑得快）", "法師 ×2", "法師的護盾 ×2"], fears: ["遠程兵 ×1.8", "槍兵 ×3"] });
});

test("兵種相剋：騎兵關著時只有三種兵，和騎兵有關的倍數和說明都不列", () => {
  assert.deepEqual(counterTypes(withCavalry(false)), [UnitType.Spearman, UnitType.Ranged, UnitType.Mage]);
  const lines = counterLines(withCavalry(false), UNIT_NAME);
  const by = (t: number) => lines.find((l) => l.type === t);
  assert.deepEqual(by(UnitType.Spearman), { type: UnitType.Spearman, beats: [], fears: ["遠程兵 ×2.5", "晶砲（擠在一起時）"] });
  assert.deepEqual(by(UnitType.Ranged), { type: UnitType.Ranged, beats: ["槍兵 ×2.5", "法師的護盾 ×3"], fears: [] });
  assert.deepEqual(by(UnitType.Mage), { type: UnitType.Mage, beats: ["擠在一起的部隊（晶砲範圍傷害）"], fears: ["遠程兵打護盾 ×3"] });
  // No damage table (rules from an old simulation): only the counters that are no multiplier.
  assert.deepEqual(
    counterLines(null, UNIT_NAME).map((l) => [l.beats, l.fears]),
    [
      [[], ["晶砲（擠在一起時）"]],
      [[], []],
      [["擠在一起的部隊（晶砲範圍傷害）"], []],
    ],
  );
});
