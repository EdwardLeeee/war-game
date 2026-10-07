// The worker's message contract (PROTOCOL.md section 6), driven through a stand-in `self`.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type FromWorker,
  GameOverReason,
  HeaderField,
  MAX_TICKS,
  PROTOCOL_VERSION,
  type ToWorker,
  UNIT_STRIDE,
  UnitField,
  UnitType,
} from "../src/protocol.ts";

const out: FromWorker[] = [];
const fake = {
  postMessage(msg: FromWorker) {
    out.push(msg);
  },
  onmessage: null as ((e: { data: ToWorker }) => void) | null,
};
(globalThis as unknown as { self: unknown }).self = fake;
await import("../src/worker.ts");
const send = (data: ToWorker) => fake.onmessage!({ data });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Waits until `ok()` holds (at most 3 s), so a busy machine does not fail the test. */
async function until(ok: () => boolean): Promise<void> {
  for (let k = 0; k < 300 && !ok(); k++) await wait(10);
}
const of = <T extends FromWorker["type"]>(t: T) => out.filter((m) => m.type === t) as Extract<FromWorker, { type: T }>[];

test("init answers ready, then snapshots arrive in real time; commands, pause and export work", async () => {
  send({ type: "init", protocol: PROTOCOL_VERSION, seed: 5, human: 0, ai: [false, true], tps: 200, scenario: "standard" });
  const ready = of("ready")[0];
  assert.equal(ready.map.size, 96);
  assert.equal(ready.rules.units[UnitType.Farmer].hp, 25);
  await until(() => of("snapshot").length > 10 && (of("snapshot").at(-1)?.header[HeaderField.tick] ?? 0) > 10);
  const snaps = of("snapshot");
  assert.ok(snaps.length > 10, `${snaps.length} snapshots`);
  const last = snaps.at(-1)!;
  assert.ok(last.header[HeaderField.tick] > 10);
  assert.equal(last.header[HeaderField.speed], 20000);
  // Own farmers are in the snapshot; move one.
  let farmer = -1;
  for (let o = 0; o < last.units.length; o += UNIT_STRIDE) {
    if (last.units[o + UnitField.owner] === 0 && last.units[o + UnitField.type] === UnitType.Farmer) farmer = last.units[o + UnitField.id];
  }
  assert.ok(farmer >= 0);
  send({ type: "pause" });
  const pausedAt = of("snapshot").at(-1)!.header[HeaderField.tick];
  send({ type: "command", cmd: { c: "move", u: [farmer], x: 30, y: 60, seq: 9 } });
  await wait(100);
  assert.equal(of("snapshot").at(-1)!.header[HeaderField.tick], pausedAt, "no ticks while paused");
  assert.equal(of("snapshot").at(-1)!.header[HeaderField.paused], 1);
  send({ type: "resume" });
  await until(() => (of("snapshot").at(-1)?.header[HeaderField.tick] ?? 0) > pausedAt + 2);
  send({ type: "export_log" });
  const log = of("log")[0].jsonl.trim().split("\n");
  const head = JSON.parse(log[0]);
  // The person's buildings train on their own, the AI's do not (round 6, D-054); a replay needs it.
  assert.deepEqual(head, { protocol: PROTOCOL_VERSION, seed: 5, scenario: "standard", ai: [false, true], maxTicks: 0, difficulty: ["normal", "normal"], autoTrain: [true, false] });
  // The AI's own commands are in the log too; find the human's by player and seq.
  const moved = log.slice(1).map((l) => JSON.parse(l)).find((c) => c.p === 0 && c.seq === 9);
  assert.ok(moved !== undefined, "the human's command is in the log");
  assert.equal(moved.t, pausedAt, "a command sent while paused runs on the next tick");
  send({ type: "pause" });
});

test("determinism runs a whole game and reports hashes; a wrong protocol is an error", () => {
  out.length = 0;
  send({ type: "determinism", protocol: PROTOCOL_VERSION, seed: 2, scenario: "standard", maxTicks: 300 });
  const progress = of("determinism_progress");
  assert.deepEqual(progress.map((p) => p.tick), [0, 100, 200, 300]);
  const done = of("determinism_done")[0];
  assert.equal(done.ticks, 300);
  assert.equal(done.finalHash, progress.at(-1)!.hash);
  send({ type: "init", protocol: 999, seed: 1, human: 0, ai: [false, false], tps: 20, scenario: "standard" });
  assert.match(of("error")[0].message, /protocol/);
  send({ type: "init", protocol: PROTOCOL_VERSION, seed: 1, human: 0, ai: [false, false], tps: 20, scenario: "nowhere" as never });
  assert.match(of("error")[1].message, /unknown scenario/);
  send({ type: "init", protocol: PROTOCOL_VERSION, seed: 1, human: 0, ai: [false, false], tps: 20, scenario: "perf" });
  send({ type: "pause" });
  assert.equal(of("ready").at(-1)!.player, 0);
  assert.equal(of("snapshot").at(-1)!.header[HeaderField.scenario], 2, "perf");
  assert.equal(of("error").length, 2);
});

test("the time limit comes with init: none when a person plays, MAX_TICKS for AI against AI, or as given", async () => {
  const header = () => {
    send({ type: "export_log" });
    return JSON.parse(of("log").at(-1)!.jsonl.split("\n")[0]);
  };
  out.length = 0;
  send({ type: "init", protocol: PROTOCOL_VERSION, seed: 3, human: null, ai: [true, true], tps: 20, scenario: "standard" });
  send({ type: "pause" });
  assert.equal(header().maxTicks, MAX_TICKS);
  send({ type: "init", protocol: PROTOCOL_VERSION, seed: 3, human: 0, ai: [false, true], tps: 20, scenario: "standard", difficulty: ["normal", "easy"] });
  send({ type: "pause" });
  assert.deepEqual([header().maxTicks, header().difficulty], [0, ["normal", "easy"]]);
  send({ type: "init", protocol: PROTOCOL_VERSION, seed: 3, human: 0, ai: [false, false], tps: 1000, scenario: "standard", maxTicks: 40 });
  await until(() => of("game_over").length > 0);
  const over = of("game_over")[0];
  assert.deepEqual([over.winner, over.reason, over.stats.ticks], [-1, GameOverReason.TimeLimit, 40]);
  send({ type: "init", protocol: PROTOCOL_VERSION, seed: 3, human: 0, ai: [false, true], tps: 20, scenario: "standard", difficulty: ["brutal" as never] });
  assert.match(of("error").at(-1)!.message, /difficulty/);
});

test("random maps (D-074): AI against AI only for now; a spectator gets the whole map, the log header says random", () => {
  out.length = 0;
  send({ type: "init", protocol: PROTOCOL_VERSION, seed: 4, human: 0, ai: [false, true], tps: 20, scenario: "standard", map: "random" });
  assert.match(of("error").at(-1)!.message, /AI against AI only/);
  assert.equal(of("ready").length, 0, "no game for a person on a random map");
  send({ type: "init", protocol: PROTOCOL_VERSION, seed: 4, human: null, ai: [true, true], tps: 20, scenario: "standard", map: "random" });
  send({ type: "pause" });
  const ready = of("ready").at(-1)!;
  assert.deepEqual([ready.map.size, ready.map.mode, ready.map.spawns.length, ready.map.towns.length], [129, "random", 2, 7]);
  send({ type: "export_log" });
  assert.equal(JSON.parse(of("log").at(-1)!.jsonl.split("\n")[0]).map, "random");
  send({ type: "init", protocol: PROTOCOL_VERSION, seed: 4, human: 0, ai: [false, true], tps: 20, scenario: "standard" });
  send({ type: "pause" });
  assert.deepEqual([of("ready").at(-1)!.map.size, of("ready").at(-1)!.map.mode], [96, "fixed"]);
  send({ type: "export_log" });
  assert.equal(JSON.parse(of("log").at(-1)!.jsonl.split("\n")[0]).map, undefined, "fixed-map logs as before");
});
