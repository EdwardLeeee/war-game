// Going on with a game from its log (D-083, 繼續上一局): a game stopped at tick N and run again
// from its log goes on exactly as the game that was never stopped, with N while the AI marches
// on the player and while it retreats; a log that was changed, or from another build, does not
// go on and says why.

import assert from "node:assert/strict";
import { test } from "node:test";
import { createScriptedPlayer, planFor, SCRIPTED_THINK_EVERY, type Strategy } from "../src/ai/scripted-player.ts";
import { type ContinueInput, continueGame } from "../src/continue.ts";
import { hex8 } from "../src/core/fixed.ts";
import { rules } from "../src/core/rules.ts";
import { type AiDifficulty, type Command, HASH_EVERY, PROTOCOL_VERSION } from "../src/protocol.ts";
import { Runner } from "../src/runner.ts";
import { buildView, mapInfo } from "../src/view/view.ts";

const BUILD = "test-build";

/** A person's game against the AI as the worker runs it: the scripted player's commands arrive between ticks. */
function play(seed: number, strategy: Strategy, difficulty: AiDifficulty, ticks: number): Runner {
  const r = new Runner({ seed, scenario: "standard", ai: [false, true], maxTicks: 0, difficulty: ["normal", difficulty], autoTrain: [true, false], build: BUILD });
  const w = r.game.w;
  const player = createScriptedPlayer(0, { map: mapInfo(w.map, 0), rules: rules(w.map), frame: w.map.frames[0] }, planFor(strategy, "h1", "close"));
  let seq = 0;
  while (!r.over && r.game.tick < ticks) {
    if (r.game.tick % SCRIPTED_THINK_EVERY === 0) for (const body of player.think(buildView(r.game, 0))) r.command(0, { ...body, seq: seq++ } as never);
    r.tick();
  }
  return r;
}

/** What export_log would have sent at tick n of game r. */
function exportAt(r: Runner, n: number): ContinueInput {
  const lines = [JSON.stringify(r.header([false, true])), ...r.game.log.filter((c) => c.t < n).map((c) => JSON.stringify(c))];
  const hashes = r.hashes.filter((h) => h.tick <= n).map((h) => ({ tick: h.tick, hash: hex8(h.hash) }));
  return { log: lines.join("\n") + "\n", hashes, toTick: n, build: BUILD };
}

/** The first tick at which the AI (player 1) sent at least `n` soldiers somewhere with command `c`. */
function firstAiOrder(r: Runner, c: string, n: number): number {
  const cmd = r.game.log.find((x) => x.p === 1 && x.c === c && "u" in x && Array.isArray(x.u) && x.u.length >= n);
  assert.ok(cmd !== undefined, `the AI sends ${n} or more with "${c}" in this game`);
  return cmd.t;
}

/** Continues game `whole` from tick n and plays on `more` ticks with the person's commands from `whole`; both must agree. */
function stopAndGoOn(whole: Runner, n: number, more: number): void {
  assert.ok(whole.over || whole.game.tick >= n + more, `the whole game is played past ${n + more}`);
  const progress: number[] = [];
  const got = continueGame(exportAt(whole, n), (t) => progress.push(t));
  assert.ok(got.ok, got.ok ? "" : `${got.reason} at ${got.tick}: ${got.message}`);
  const r = got.runner;
  assert.equal(r.game.tick, n);
  assert.equal(got.human, 0);
  assert.deepEqual(progress, Array.from({ length: Math.floor(n / 1200) }, (_, k) => (k + 1) * 1200));
  const theirs = whole.game.log.filter((c) => c.p === 0 && c.t >= n && c.t < n + more);
  let k = 0;
  while (r.game.tick < n + more && !r.over) {
    for (; k < theirs.length && theirs[k].t === r.game.tick; k++) r.game.push(theirs[k]);
    r.tick();
  }
  const end = r.game.tick;
  const of = (x: Runner) => x.hashes.filter((h) => h.tick > n && h.tick <= end).map((h) => `${h.tick}:${hex8(h.hash)}`);
  assert.ok(of(r).length >= Math.floor(more / HASH_EVERY) - 1);
  assert.deepEqual(of(r), of(whole), `went on from ${n}`);
  const lines = (x: Runner) => x.game.log.filter((c) => c.t < end).map((c) => JSON.stringify(c));
  assert.deepEqual(lines(r), lines(whole), "the same log, AI commands included");
}

test("stopped while the normal AI marches and while it retreats, the game goes on as if it never stopped", () => {
  // 24000: since D-096 the AI retreats later in this game (about 19600).
  const whole = play(1, "defend", "normal", 24000);
  const march = firstAiOrder(whole, "move", 10);
  const retreat = firstAiOrder(whole, "retreat", 5);
  assert.ok(march < retreat);
  stopAndGoOn(whole, march + 5, 1500);
  stopAndGoOn(whole, retreat + 5, 1500);
});

test("stopped while the hard AI marches on the player, the game goes on as if it never stopped", () => {
  const whole = play(1, "push", "hard", 14000);
  stopAndGoOn(whole, firstAiOrder(whole, "move", 10) + 5, 1500);
});

test("a changed log, another build or protocol, or a missing hash does not go on, and says why", () => {
  const whole = play(2, "push", "normal", 3200);
  const good = exportAt(whole, 3000);
  assert.equal(continueGame(good).ok, true);
  const reason = (input: ContinueInput) => {
    const got = continueGame(input);
    return got.ok ? "ok" : `${got.reason}@${got.tick}`;
  };
  const lines = good.log.trim().split("\n");
  // An AI command changed: the AI that runs again does not send it.
  const ai = lines.findIndex((l, k) => k > 0 && (JSON.parse(l) as Command).p === 1 && (JSON.parse(l) as { c: string }).c === "build");
  assert.ok(ai > 0);
  const moved = JSON.parse(lines[ai]) as Command & { x: number };
  const changed = [...lines];
  changed[ai] = JSON.stringify({ ...moved, x: moved.x + 1 });
  assert.equal(reason({ ...good, log: changed.join("\n") }), `commands@${moved.t}`);
  // A person's command changed: the game goes another way, and the next hash says so.
  const mine = lines.findIndex((l, k) => k > 0 && (JSON.parse(l) as Command).p === 0 && (JSON.parse(l) as { c: string }).c === "build");
  assert.ok(mine > 0);
  const built = JSON.parse(lines[mine]) as Command & { x: number; y: number };
  const other = [...lines];
  other[mine] = JSON.stringify({ ...built, x: built.x + 2 });
  assert.match(reason({ ...good, log: other.join("\n") }), /^hash@/);
  // A person's command dropped: also a different game.
  assert.match(reason({ ...good, log: lines.filter((_, k) => k !== mine).join("\n") }), /^hash@/);
  // A hash changed.
  const hashes = good.hashes.map((h) => (h.tick === 1500 ? { ...h, hash: "00000000" } : h));
  assert.equal(reason({ ...good, hashes }), "hash@1500");
  assert.equal(reason({ ...good, hashes: good.hashes.filter((h) => h.tick !== 1500) }), "log@1500");
  // Another build, another protocol, not a log.
  assert.equal(reason({ ...good, build: "other" }), "build@0");
  const head = JSON.parse(lines[0]) as { protocol: number };
  assert.equal(reason({ ...good, log: [JSON.stringify({ ...head, protocol: PROTOCOL_VERSION + 1 }), ...lines.slice(1)].join("\n") }), "protocol@0");
  assert.equal(reason({ ...good, log: "not a log" }), "log@0");
  assert.equal(reason({ ...good, toTick: 2000 }), "log@2000", "commands after toTick");
});
