// The scripted player (ai/scripted-player.ts, D-046): it plays from its own view through ordinary
// commands (its imports are checked with the AI's in boundaries.test.ts), the same game every
// time from a seed, and its fixed plans are the ones measured.

import assert from "node:assert/strict";
import { test } from "node:test";
import { createScriptedPlayer, type Plan, planFor, SCRIPTED_THINK_EVERY } from "../src/ai/scripted-player.ts";
import { rules } from "../src/core/rules.ts";
import { TownSize, UnitType } from "../src/protocol.ts";
import { Runner } from "../src/runner.ts";
import { buildView } from "../src/view/view.ts";

/** The scripted player as player 0 against the normal AI for `ticks`, as src/scripted-games.ts plays it. */
function play(seed: number, plan: Plan, ticks: number): Runner {
  const r = new Runner({ seed, scenario: "standard", ai: [false, true], maxTicks: 0 });
  const g = r.game;
  const map = g.w.map;
  const player = createScriptedPlayer(0, { map, rules: rules(), frame: map.frames[0] }, plan);
  let seq = 0;
  while (!r.over && g.w.tick < ticks) {
    if (g.w.tick % SCRIPTED_THINK_EVERY === 0) for (const body of player.think(buildView(g, 0))) r.command(0, { ...body, seq: seq++ });
    r.tick();
  }
  return r;
}

test("the scripted player plays the same game twice from one seed", () => {
  const plan = planFor("push", "h1", "close");
  const a = play(3, plan, 6000);
  const b = play(3, plan, 6000);
  assert.equal(a.game.hash(), b.game.hash());
  assert.equal(a.game.log.length, b.game.log.length);
  assert.ok(a.game.log.some((c) => c.p === 0), "it sent commands");
});

test("the push plan trains an army and takes the small town nearest its main city by minute 10", () => {
  const r = play(1, planFor("push", "h1", "close"), 12000);
  const w = r.game.w;
  const home = w.map.spawns[0];
  const town = w.map.towns
    .filter((t) => t.size === TownSize.Small)
    .sort((a, b) => (a.cellX - home.cellX) ** 2 + (a.cellY - home.cellY) ** 2 - (b.cellX - home.cellX) ** 2 - (b.cellY - home.cellY) ** 2)[0];
  assert.ok(w.plundered[0] >= 1 || w.townOwner[town.id] === 0, "the town taken");
  assert.ok(w.trained[UnitType.Spearman] + w.trained[UnitType.Ranged] >= 6, "soldiers trained");
});

test("the fixed plans: strategies, speeds and formations", () => {
  const push = planFor("push", "h1", "close");
  assert.deepEqual([push.townAt, push.pushAt, push.counterAt, push.farmers, push.production, push.loose, push.woodBias], [6, 24, 14, 22, 2, 0, false]);
  const defend = planFor("defend", "eco", "all");
  assert.deepEqual([defend.townAt, defend.pushAt, defend.farmers, defend.production, defend.loose, defend.woodBias], [6, 0, 30, 6, 2, true]);
  assert.deepEqual([planFor("notown", "h1", "shooters").townAt, planFor("notown", "h1", "shooters").loose], [0, 1]);
  assert.equal(SCRIPTED_THINK_EVERY, 40);
});
