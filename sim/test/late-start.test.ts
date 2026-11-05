// A late game to start from (late-start.ts; push-late-siege's --takeover, war-game-ai's learn/).

import assert from "node:assert/strict";
import { test } from "node:test";
import type { Ai } from "../src/ai/ai.ts";
import { createScriptedPlayer, SCRIPTED_THINK_EVERY } from "../src/ai/scripted-player.ts";
import { rules } from "../src/core/rules.ts";
import { AiSeat, latePlanFor, lateStart, WATCH_TICKS } from "../src/late-start.ts";
import { AI_THINK_EVERY, Runner } from "../src/runner.ts";
import { buildView, mapInfo } from "../src/view/view.ts";

const TICKS = 6000;

test("the seat plays player 1 as the Runner does: the same game, hash for hash", () => {
  const plan = latePlanFor();
  const own = new Runner({ seed: 3, scenario: "standard", ai: [false, true], maxTicks: 0, map: "random" });
  const map = own.game.w.map;
  const player = createScriptedPlayer(0, { map: mapInfo(map, 0), rules: rules(map), frame: map.frames[0] }, plan);
  let seq = 0;
  while (own.game.tick < TICKS) {
    if (own.game.tick % SCRIPTED_THINK_EVERY === 0) for (const body of player.think(buildView(own.game, 0))) own.command(0, { ...body, seq: seq++ });
    own.tick();
  }
  const late = lateStart({ seed: 3, map: "random", plan: latePlanFor() });
  late.runTo(TICKS);
  assert.equal(late.game.hash(), own.game.hash());
});

test("takeOver: the new AI thinks from then on, its orders dropped until `at`; from `at` its orders and no others", () => {
  const late = lateStart({ seed: 5, map: "fixed" });
  late.runTo(TICKS);
  const seen: number[] = [];
  const stub: Ai = {
    style: "balanced",
    think: () => {
      seen.push(late.game.tick);
      return [{ c: "eco_ratio", food: 40, wood: 40, gold: 20, on: true }];
    },
  };
  const at = TICKS + WATCH_TICKS;
  late.takeOver(stub, at);
  const before = late.game.log.length;
  late.runTo(at + 400);
  const p1 = late.game.log.slice(before).filter((c) => c.p === 1);
  assert.equal(seen[0], TICKS, "thinks from the first think tick on");
  assert.ok(seen.every((t) => t % AI_THINK_EVERY === 0));
  assert.ok(p1.filter((c) => c.t < at).every((c) => c.c !== "eco_ratio" || c.food !== 40), "dropped while it watches");
  const after = p1.filter((c) => c.t >= at);
  assert.ok(after.length > 0 && after.every((c) => c.c === "eco_ratio" && c.food === 40), "then only its orders");
});

test("AiSeat numbers its orders from 0 on, one after the other", () => {
  const r = new Runner({ seed: 2, scenario: "standard", ai: [false, false], maxTicks: 0 });
  const stub: Ai = { style: "balanced", think: () => [{ c: "eco_ratio", food: 50, wood: 30, gold: 20, on: true }] };
  const seat = new AiSeat(r, 1, stub);
  for (let i = 0; i < 3 * AI_THINK_EVERY; i++) {
    seat.think();
    r.tick();
  }
  assert.deepEqual(r.game.log.filter((c) => c.p === 1).map((c) => c.seq), [0, 1, 2]);
  assert.equal(seat.seq(), 3);
});
