// The scripted player (ai/scripted-player.ts, D-046): it plays from its own view through ordinary
// commands (its imports are checked with the AI's in boundaries.test.ts), the same game every
// time from a seed, and its fixed plans are the ones measured.

import assert from "node:assert/strict";
import { test } from "node:test";
import { createScriptedPlayer, type Plan, planFor, SCRIPTED_THINK_EVERY } from "../src/ai/scripted-player.ts";
import { rules } from "../src/core/rules.ts";
import { BuildingType, TownSize, UnitType } from "../src/protocol.ts";
import { Runner } from "../src/runner.ts";
import { buildView, mapInfo } from "../src/view/view.ts";
import { cmd, emptyGame, put } from "./helpers.ts";

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

test("without a range (an option outside the fixed groups) it trains spearmen, no ranged", () => {
  const r = play(1, { ...planFor("push", "h1", "close"), noRange: true }, 12000);
  const w = r.game.w;
  const b = w.buildings.col;
  for (let s = 0; s < w.buildings.count; s++) assert.ok(b.owner[s] !== 0 || b.type[s] !== BuildingType.Range, "no range");
  assert.equal(w.trained[UnitType.Ranged], 0);
  assert.ok(w.trained[UnitType.Spearman] >= 6, "spearmen trained");
});

test("the fixed plans: strategies, speeds and formations", () => {
  const push = planFor("push", "h1", "close");
  assert.deepEqual([push.townAt, push.pushAt, push.counterAt, push.farmers, push.production, push.loose, push.woodBias], [6, 24, 14, 22, 2, 0, false]);
  const defend = planFor("defend", "eco", "all");
  assert.deepEqual([defend.townAt, defend.pushAt, defend.farmers, defend.production, defend.loose, defend.woodBias], [6, 0, 30, 6, 2, true]);
  assert.deepEqual([planFor("notown", "h1", "shooters").townAt, planFor("notown", "h1", "shooters").loose], [0, 1]);
  assert.deepEqual([push.staticRatio, push.noMage, push.noRange], [false, false, false]);
  assert.equal(SCRIPTED_THINK_EVERY, 40);
});

test("enemies beaten 16-24 cells from the main city count as a wave: the player counters (D-050)", () => {
  // Six enemy spearmen 20 cells out (outside the 16 of the defence), seen by one of ours, then
  // gone: that is a wave beaten, and with 16 soldiers at home the player marches on the enemy
  // (the notown plan, so no town trip comes first).
  const g = emptyGame();
  const w = g.w;
  const home = w.map.spawns[0];
  const sx = home.cellX < w.size / 2 ? 1 : -1;
  const sy = home.cellY < w.size / 2 ? 1 : -1;
  const foes: number[] = [];
  for (let k = 0; k < 6; k++) foes.push(put(g, 1, UnitType.Spearman, home.cellX + sx * (14 + (k % 3)), home.cellY + sy * (14 + Math.trunc(k / 3))));
  put(g, 0, UnitType.Spearman, home.cellX + sx * 12, home.cellY + sy * 12);
  for (let k = 0; k < 16; k++) put(g, 0, UnitType.Spearman, home.cellX + sx * (5 + (k % 4)), home.cellY + sy * (5 + Math.trunc(k / 4)));
  g.fog.update(w);
  const player = createScriptedPlayer(0, { map: w.map, rules: rules(), frame: w.map.frames[0] }, planFor("notown", "h1", "close"));
  for (let t = 0; t < 600 && player.state().marches === 0; t++) {
    if (w.tick === 50) for (const id of foes) if (w.unit(id) >= 0) w.units.col.hp[w.unit(id)] = 0;
    if (w.tick % SCRIPTED_THINK_EVERY === 0) for (const body of player.think(buildView(g, 0))) cmd(g, 0, body);
    g.step();
  }
  assert.equal(player.state().waves, 1, "one wave beaten");
  assert.equal(player.state().marches, 1, "and a march on the enemy's main city");
});

test("random maps (D-074): it starts knowing only its home, scouts, and finds the AI; the race is fixed-map only", () => {
  const r = new Runner({ seed: 2, scenario: "standard", ai: [false, true], maxTicks: 0, map: "random" });
  const g = r.game;
  const map = g.w.map;
  const know = { map: mapInfo(map, 0), rules: rules(), frame: map.frames[0] };
  assert.throws(() => createScriptedPlayer(0, know, { ...planFor("push", "h1", "close"), race: "edge" }), /fixed map only/);
  const player = createScriptedPlayer(0, know, planFor("push", "h1", "close"));
  let seq = 0;
  while (!r.over && g.w.tick < 9000) {
    if (g.w.tick % SCRIPTED_THINK_EVERY === 0) for (const body of player.think(buildView(g, 0))) r.command(0, { ...body, seq: seq++ });
    r.tick();
  }
  const found = player.state().found;
  assert.ok(found > 0 && found < 9000, `found the AI's base at tick ${found}`);
});
