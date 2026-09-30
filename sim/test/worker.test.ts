// The worker's message contract (PROTOCOL.md section 6), driven through a stand-in `self`.

import assert from "node:assert/strict";
import { test } from "node:test";
import { type FromWorker, HeaderField, PROTOCOL_VERSION, type ToWorker, UNIT_STRIDE, UnitField, UnitType } from "../src/protocol.ts";

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
const of = <T extends FromWorker["type"]>(t: T) => out.filter((m) => m.type === t) as Extract<FromWorker, { type: T }>[];

test("init answers ready, then snapshots arrive in real time; commands, pause and export work", async () => {
  send({ type: "init", protocol: PROTOCOL_VERSION, seed: 5, human: 0, ai: [false, true], tps: 200, scenario: "standard" });
  const ready = of("ready")[0];
  assert.equal(ready.map.size, 96);
  assert.equal(ready.rules.units[UnitType.Farmer].hp, 25);
  await wait(300);
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
  await wait(100);
  send({ type: "export_log" });
  const log = of("log")[0].jsonl.trim().split("\n");
  const head = JSON.parse(log[0]);
  assert.deepEqual(head, { protocol: PROTOCOL_VERSION, seed: 5, scenario: "standard", ai: [false, true] });
  const moved = JSON.parse(log[1]);
  assert.equal(moved.t, pausedAt, "a command sent while paused runs on the next tick");
  assert.equal(moved.p, 0);
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
  send({ type: "init", protocol: PROTOCOL_VERSION, seed: 1, human: 0, ai: [false, false], tps: 20, scenario: "perf" });
  assert.match(of("error")[1].message, /PR-4/);
});
