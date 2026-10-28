// 兵種相剋 (選單, ceo 2026-10-07): the multipliers come from the simulation's own damage table;
// the counters that are no multiplier (GDD §6) are written beside them.

import assert from "node:assert/strict";
import { test } from "node:test";
import { counterLines, counterShort, counterTypes, ratioText } from "../src/game/counters.ts";
import { MULTIPLIERS, rules as simRules, type Rules, UnitType } from "../src/sim.ts";
import { UNIT_NAME } from "../src/ui/hud/names.ts";
import { withSwitches } from "./switches.ts";

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
  // D-097's triangle (the simulation's table: 遠程打槍 ×3.5、槍打騎 ×2.5、騎打法師和護盾 ×3); cavalry
  // beats ranged by speed, no multiplier.
  assert.deepEqual(by(UnitType.Spearman), { type: UnitType.Spearman, beats: ["騎兵 ×2.5"], fears: ["遠程兵 ×3.5", "晶砲（擠在一起時）"] });
  assert.deepEqual(by(UnitType.Ranged), { type: UnitType.Ranged, beats: ["槍兵 ×3.5"], fears: ["騎兵（跑得快，很快衝到面前；生命少）"] });
  assert.deepEqual(by(UnitType.Mage), { type: UnitType.Mage, beats: ["擠在一起的部隊（晶砲範圍傷害）"], fears: ["騎兵 ×3", "騎兵打護盾 ×3"] });
  assert.deepEqual(by(UnitType.Cavalry), { type: UnitType.Cavalry, beats: ["遠程兵（跑得快）", "法師 ×3", "法師的護盾 ×3"], fears: ["槍兵 ×2.5"] });
  // 騎兵繞後 (features.cavalryFlank): said beside them.
  const flank = counterLines({ ...withCavalry(true), features: { plunderOnce: false, towers: false, garrison: false, cavalry: true, cavalryFlank: true } }, UNIT_NAME);
  assert.deepEqual(flank.find((l) => l.type === UnitType.Cavalry)?.beats, ["遠程兵（跑得快）", "法師 ×3", "法師的護盾 ×3", "會自己繞過前排去打法師、遠程兵"]);
});

test("兵種相剋：騎兵關著時只有三種兵，和騎兵有關的倍數和說明都不列", () => {
  assert.deepEqual(counterTypes(withCavalry(false)), [UnitType.Spearman, UnitType.Ranged, UnitType.Mage]);
  const lines = counterLines(withCavalry(false), UNIT_NAME);
  const by = (t: number) => lines.find((l) => l.type === t);
  assert.deepEqual(by(UnitType.Spearman), { type: UnitType.Spearman, beats: [], fears: ["遠程兵 ×3.5", "晶砲（擠在一起時）"] });
  assert.deepEqual(by(UnitType.Ranged), { type: UnitType.Ranged, beats: ["槍兵 ×3.5"], fears: [] });
  // Nothing in the table hits a mage harder without cavalry (the menu says 沒有; the short line leaves it out).
  assert.deepEqual(by(UnitType.Mage), { type: UnitType.Mage, beats: ["擠在一起的部隊（晶砲範圍傷害）"], fears: [] });
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

test("D-097 的短句：照倍數表和不是倍數的說明寫「剋：…／怕：…」，護盾算法師；騎兵繞後開著時加說明；空的一邊不寫", async () => {
  const { counterShort } = await import("../src/game/counters.ts");
  // The triangle as the user chose it (D-097): spear > cavalry, cavalry > mages (and ranged, by speed), ranged > spear.
  const triangle = (cavalry: boolean, cavalryFlank: boolean) =>
    ({
      ...simRules(),
      features: { plunderOnce: false, towers: false, garrison: false, cavalry, ...(cavalryFlank ? { cavalryFlank: true } : {}) },
      multipliers: [
        { attacker: UnitType.Ranged, target: UnitType.Spearman, num: 7, den: 2 },
        { attacker: UnitType.Spearman, target: UnitType.Cavalry, num: 5, den: 2 },
        { attacker: UnitType.Cavalry, target: UnitType.Mage, num: 3, den: 1 },
        { attacker: UnitType.Cavalry, target: "shield", num: 3, den: 1 },
      ],
    }) as Rules;
  const on = triangle(true, true);
  assert.equal(counterShort(on, UnitType.Spearman), "剋：騎兵／怕：遠程");
  assert.equal(counterShort(on, UnitType.Ranged), "剋：槍兵／怕：騎兵");
  assert.equal(counterShort(on, UnitType.Mage), "剋：擠在一起的部隊／怕：騎兵");
  assert.equal(counterShort(on, UnitType.Cavalry), "剋：遠程、法師（會自己繞過前排去打）／怕：槍兵");
  // On a train button: without the note.
  assert.equal(counterShort(on, UnitType.Cavalry, true), "剋：遠程、法師／怕：槍兵");
  assert.equal(counterShort(triangle(true, false), UnitType.Cavalry), "剋：遠程、法師／怕：槍兵");
  // Cavalry off: nothing about it; the mage fears nobody by this table, so no 怕 at all.
  const off = triangle(false, false);
  assert.equal(counterShort(off, UnitType.Spearman), "怕：遠程");
  assert.equal(counterShort(off, UnitType.Ranged), "剋：槍兵");
  assert.equal(counterShort(off, UnitType.Mage), "剋：擠在一起的部隊");
  assert.equal(counterShort(off, UnitType.Cavalry), "");
  assert.equal(counterShort(on, UnitType.Farmer), "");
  // The simulation's own rules give the same; with its siege engines (D-099) cavalry beats them too.
  for (const siege of [false, true]) {
    const sim = withSwitches({ siege }, () => simRules());
    assert.deepEqual(
      [UnitType.Spearman, UnitType.Ranged, UnitType.Mage, UnitType.Cavalry].map((t) => counterShort(sim, t)),
      ["剋：騎兵／怕：遠程", "剋：槍兵／怕：騎兵", "剋：擠在一起的部隊／怕：騎兵", `剋：遠程、法師${siege ? "、攻城砲" : ""}（會自己繞過前排去打）／怕：槍兵`],
    );
  }
});

test("兵種相剋（D-099）：攻城砲開著時多一行，剋建築（打建築 ×3），怕騎兵 ×2 和近身的兵；騎兵那一行多攻城砲 ×2；關著時都沒有", () => {
  const on: Rules = {
    ...withCavalry(true),
    features: { plunderOnce: false, towers: false, garrison: false, cavalry: true, siege: true },
    // The whole table, the siege engine's rows in it (rules() leaves them out while SIEGE is off).
    multipliers: MULTIPLIERS,
    siege: { vsBuildings: 3, flightTicks: 20 },
  };
  assert.deepEqual(counterTypes(on), [UnitType.Spearman, UnitType.Ranged, UnitType.Mage, UnitType.Cavalry, UnitType.Siege]);
  const lines = counterLines(on, UNIT_NAME);
  assert.deepEqual(lines.find((l) => l.type === UnitType.Siege), { type: UnitType.Siege, beats: ["建築 ×3（城門更多）"], fears: ["騎兵 ×2", "近身的兵（3 格內打不到）"] });
  assert.ok(lines.find((l) => l.type === UnitType.Cavalry)?.beats.includes("攻城砲 ×2"));
  assert.equal(counterShort(on, UnitType.Siege), "剋：建築／怕：近身的兵、騎兵");
  // Off: none of it.
  assert.ok(!counterTypes(withCavalry(true)).includes(UnitType.Siege));
  assert.equal(counterShort(withCavalry(true), UnitType.Siege), "");
});
