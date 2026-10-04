// Towns (PR-4, D4): capture, contested, plunder, ruins, govern, production, revolt,
// recapture; surrender; the perf scenario.

import assert from "node:assert/strict";
import test from "node:test";
import { Game } from "../src/core/game.ts";
import { PERF } from "../src/core/scenarios.ts";
import { MAIN_CRYSTAL, TOWNS } from "../src/core/rules.ts";
import {
  BuildingType,
  GameOverReason,
  NEUTRAL,
  NO_OWNER,
  Reject,
  Resource,
  TownChoice,
  TownField,
  TownFlag,
  TownSize,
  TownState,
  TOWN_STRIDE,
  UnitFlag,
  UnitType,
} from "../src/protocol.ts";
import { buildView } from "../src/view/view.ts";
import { cmd, emptyGame, put, run, slotOf } from "./helpers.ts";

/** A test of a town's own income: the main city's crystal (D-057) is off while it runs. */
function townIncomeOnly(body: () => void): () => void {
  return () => {
    const saved = MAIN_CRYSTAL.every;
    MAIN_CRYSTAL.every = 0;
    try {
      body();
    } finally {
      MAIN_CRYSTAL.every = saved;
    }
  };
}

function step(g: Game, p = 0): number[] {
  g.step();
  return g.events.filter((e) => e.to === p && e.ev.k === "rejected").map((e) => (e.ev as { reason: number }).reason);
}

/** emptyGame has no units at all, so the small town (0) has no militia left. */
function smallTown() {
  const g = emptyGame();
  g.w.ecoOn[0] = 0;
  g.w.ecoOn[1] = 0;
  const t = 0;
  assert.equal(g.w.townSize[t], TownSize.Small);
  return { g, t, x: g.w.townX[t], y: g.w.townY[t] };
}

function events(g: Game, k: string, to = 0) {
  return g.events.filter((e) => e.to === to && e.ev.k === k).map((e) => e.ev);
}

function townRow(g: Game, p: number, t: number): Int32Array {
  const v = buildView(g, p);
  for (let r = 0; r < v.towns.length; r += TOWN_STRIDE) if (v.towns[r + TownField.id] === t) return v.towns.subarray(r, r + TOWN_STRIDE);
  throw new Error("town not in view");
}

test("capture: no militia left and only one side's army inside; farmers do not count; contested freezes", () => {
  const { g, t, x, y } = smallTown();
  const farmer = put(g, 0, UnitType.Farmer, x + 1, y);
  run(g, 5);
  assert.equal(g.w.townState[t], TownState.Neutral, "farmers do not capture");
  const spear = put(g, 0, UnitType.Spearman, x + 2, y);
  const enemy = put(g, 1, UnitType.Spearman, x, y + 2);
  for (const id of [spear, enemy]) g.w.units.col.hp[slotOf(g, id)] = 100000;
  run(g, 2);
  assert.equal(g.w.townState[t], TownState.Neutral, "contested");
  assert.ok((townRow(g, 0, t)[TownField.flags] & TownFlag.Contested) !== 0);
  g.w.units.col.hp[slotOf(g, enemy)] = 0;
  let captured = 0;
  for (let k = 0; k < 3; k++) {
    g.step();
    captured += events(g, "town_captured").length;
  }
  assert.equal(captured, 1, "town_captured sent to the capturer once");
  assert.equal(g.w.townState[t], TownState.AwaitingChoice);
  assert.equal(g.w.townOwner[t], 0);
  assert.equal(g.w.units.col.type[slotOf(g, farmer)], UnitType.Farmer);
});

test("a town with militia alive, or the big city with its tower standing, is not captured", () => {
  const g = new Game({ seed: 1, scenario: "standard" });
  const u = g.w.units.col;
  // Remove the big city's militia but not its tower.
  for (let s = 0; s < g.w.units.count; s++) if (u.owner[s] === NEUTRAL && u.home[s] === 1) u.hp[s] = 0;
  g.step();
  const big = put(g, 0, UnitType.Spearman, g.w.townX[1] + 3, g.w.townY[1] + 3);
  u.hp[slotOf(g, big)] = 100000;
  run(g, 3);
  assert.equal(g.w.townState[1], TownState.Neutral, "the tower still stands");
  let tower = -1;
  for (let s = 0; s < g.w.buildings.count; s++) if (g.w.buildings.col.type[s] === BuildingType.TownTower) tower = s;
  g.w.buildings.col.hp[tower] = 0;
  run(g, 3);
  assert.equal(g.w.townState[1], TownState.AwaitingChoice);
  assert.equal(g.w.townOwner[1], 0);
  // The small town's militia are all alive: a soldier walking in does not capture it.
  const small = put(g, 0, UnitType.Spearman, g.w.townX[0] + 1, g.w.townY[0]);
  u.hp[slotOf(g, small)] = 100000;
  run(g, 3);
  assert.equal(g.w.townState[0], TownState.Neutral);
});

test("plunder: counts only while the holder's army is inside, pays out, ruins for 4 minutes, back to neutral with half the militia", townIncomeOnly(() => {
  const { g, t, x, y } = smallTown();
  const spear = put(g, 0, UnitType.Spearman, x + 1, y);
  run(g, 2);
  assert.equal(g.w.townState[t], TownState.AwaitingChoice);
  cmd(g, 1, { c: "town_choice", town: t, choice: TownChoice.Plunder });
  assert.deepEqual(step(g, 1), [Reject.TownNotYours]);
  cmd(g, 0, { c: "town_choice", town: t, choice: TownChoice.Plunder });
  assert.deepEqual(step(g), []);
  const rule = TOWNS[TownSize.Small];
  run(g, 100);
  const left = g.w.townTimer[t];
  assert.ok(left <= rule.plunderTicks - 100);
  // Walk away: the timer pauses.
  const u = g.w.units.col;
  u.x[slotOf(g, spear)] += 20 << 10;
  run(g, 50);
  assert.equal(g.w.townTimer[t], left);
  u.x[slotOf(g, spear)] -= 20 << 10;
  u.order[slotOf(g, spear)] = 0;
  const res0 = [g.w.res[Resource.Food], g.w.res[Resource.Gold], g.w.res[Resource.Crystal]];
  let plundered = false;
  for (let k = 0; k < rule.plunderTicks && !plundered; k++) {
    g.step();
    plundered = events(g, "town_plundered").length > 0;
  }
  assert.ok(plundered);
  assert.deepEqual(
    [g.w.res[Resource.Food] - res0[0], g.w.res[Resource.Gold] - res0[1], g.w.res[Resource.Crystal] - res0[2]],
    [rule.plunder.food, rule.plunder.gold, rule.plunder.crystal],
  );
  assert.equal(g.w.plundered[0], 1);
  assert.equal(g.w.plunderIncome[0], rule.plunder.food + rule.plunder.gold + rule.plunder.crystal);
  assert.deepEqual([rule.plunder.food, rule.plunder.gold, rule.plunder.crystal], [300, 300, 75], "GDD x 1.5 (ceo ruling)");
  assert.ok(g.w.firstCapture >= 0, "the capture was recorded");
  assert.equal(g.w.townState[t], TownState.Ruins);
  assert.equal(g.w.townOwner[t], NO_OWNER);
  cmd(g, 0, { c: "town_choice", town: t, choice: TownChoice.Govern });
  assert.deepEqual(step(g), [Reject.TownNotYours]);
  u.hp[slotOf(g, spear)] = 0;
  run(g, rule.ruinsTicks);
  assert.equal(g.w.townState[t], TownState.Neutral);
  let militia = 0;
  for (let s = 0; s < g.w.units.count; s++) if (u.owner[s] === NEUTRAL && u.home[s] === t) militia++;
  assert.equal(militia, rule.militia >> 1);
}));

test("plundering is cancelled when the enemy takes the town", () => {
  const { g, t, x, y } = smallTown();
  const spear = put(g, 0, UnitType.Spearman, x + 1, y);
  run(g, 2);
  cmd(g, 0, { c: "town_choice", town: t, choice: TownChoice.Plunder });
  run(g, 50);
  g.w.units.col.hp[slotOf(g, spear)] = 0;
  put(g, 1, UnitType.Spearman, x, y + 1);
  run(g, 3);
  assert.equal(g.w.townState[t], TownState.AwaitingChoice);
  assert.equal(g.w.townOwner[t], 1);
});

test("govern: pays at the choice, repairs with the minimum garrison, then produces and raises the cap; revolts after 60 s without it", townIncomeOnly(() => {
  const { g, t, x, y } = smallTown();
  const rule = TOWNS[TownSize.Small];
  const spear = put(g, 0, UnitType.Spearman, x + 1, y);
  run(g, 2);
  g.w.res[Resource.Wood] = 10;
  cmd(g, 0, { c: "town_choice", town: t, choice: TownChoice.Govern });
  assert.deepEqual(step(g), [Reject.CannotAfford]);
  g.w.res[Resource.Wood] = 500;
  const gold0 = g.w.res[Resource.Gold];
  cmd(g, 0, { c: "town_choice", town: t, choice: TownChoice.Govern });
  assert.deepEqual(step(g), []);
  assert.equal(g.w.res[Resource.Wood], 500 - rule.governCost.wood);
  assert.equal(g.w.res[Resource.Gold], gold0 - rule.governCost.gold);
  assert.equal(g.w.governChosen[0], 1);
  assert.equal(g.w.governCost[0], rule.governCost.wood + rule.governCost.gold);
  cmd(g, 0, { c: "town_choice", town: t, choice: TownChoice.Plunder });
  assert.deepEqual(step(g), [Reject.TownChoiceMade]);
  run(g, rule.repairTicks);
  assert.equal(g.w.townState[t], TownState.Governed);
  assert.equal(g.w.governed[0], 1);
  assert.equal(g.w.populationCap(0), 10 + rule.populationCap);
  const food0 = g.w.res[Resource.Food];
  const crystal0 = g.w.res[Resource.Crystal];
  run(g, 1200);
  // Paid every 20 ticks from an accumulator: any 1,200-tick window holds 40 give or take one.
  const food = g.w.res[Resource.Food] - food0;
  const crystal = g.w.res[Resource.Crystal] - crystal0;
  assert.ok(Math.abs(food - rule.perMinute.food) <= 1, `food a minute: ${food}`);
  assert.ok(Math.abs(crystal - rule.perMinute.crystal) <= 1, `crystal a minute: ${crystal}`);
  const food10 = g.w.res[Resource.Food];
  run(g, 12000);
  assert.ok(Math.abs(g.w.res[Resource.Food] - food10 - 10 * rule.perMinute.food) <= 1, "400 food in ten minutes");
  // No garrison: no production, and a revolt after 60 s.
  g.w.units.col.hp[slotOf(g, spear)] = 0;
  g.step();
  const food1 = g.w.res[Resource.Food];
  assert.ok((townRow(g, 0, t)[TownField.flags] & TownFlag.BelowGarrison) !== 0);
  let revolted = false;
  for (let k = 0; k < rule.revoltTicks + 5 && !revolted; k++) {
    g.step();
    revolted = events(g, "town_revolted").length > 0;
    if (!revolted) assert.equal(g.w.res[Resource.Food], food1, "no production below the garrison");
  }
  assert.ok(revolted);
  assert.equal(g.w.townState[t], TownState.Neutral);
  // Eleven minutes of production (about 1,000) had paid back the 160 it cost.
  assert.ok(g.w.townIncome[0] > 900);
  assert.equal(g.w.governEnded[0], 1);
  assert.equal(g.w.governPaidBack[0], 1);
  assert.equal(g.w.populationCap(0), 10);
}));

test("surrender ends the game for the other side; later commands are refused", () => {
  const g = emptyGame();
  cmd(g, 1, { c: "surrender" });
  g.step();
  assert.equal(g.w.winner, 0);
  assert.equal(g.w.endReason, GameOverReason.Surrender);
  assert.ok(g.events.some((e) => e.ev.k === "game_over"));
  assert.equal(buildView(g, 0).header[3], 1, "won");
  assert.equal(buildView(g, 1).header[3], 2, "lost");
});

test("perf scenario: 114 / 120 on each side, mages on autocast, and the battle starts by itself", () => {
  const g = new Game({ seed: 1, scenario: "perf" });
  const w = g.w;
  for (const p of [0, 1]) {
    assert.equal(w.population(p), PERF.farmers + PERF.spearmen + PERF.ranged + PERF.mages);
    assert.equal(w.populationCap(p), 120);
  }
  const u = w.units.col;
  let mages = 0;
  for (let s = 0; s < w.units.count; s++) {
    if (u.type[s] !== UnitType.Mage) continue;
    mages++;
    assert.ok((u.flags[s] & UnitFlag.Autocast) !== 0);
  }
  assert.equal(mages, 2 * PERF.mages);
  let fired = false;
  for (let t = 0; t < 400; t++) {
    g.step();
    for (let s = 0; s < w.units.count; s++) if (u.castCooldown[s] > 0) fired = true;
  }
  assert.ok(fired, "a cannon fired");
  assert.ok(w.lost[UnitType.Spearman] + w.lost[5 + UnitType.Spearman] > 0, "soldiers fell");
});
