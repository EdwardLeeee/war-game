import assert from "node:assert/strict";
import { test } from "node:test";
import { compare } from "../src/lab/determinism.ts";
import type { ExpectedHashes } from "../src/sim.ts";

const expected: ExpectedHashes = {
  protocol: 1,
  seed: 1,
  scenario: "standard",
  maxTicks: 300,
  hashes: { "0": "aaaaaaaa", "100": "bbbbbbbb", "200": "cccccccc", "300": "dddddddd" },
  final: { tick: 300, hash: "dddddddd", winner: -1 },
};
const done = { ticks: 300, finalHash: "dddddddd", totalMs: 5, tickMedianMs: 0, tickMaxMs: 1 };
const progress = [
  { tick: 0, hash: "aaaaaaaa" },
  { tick: 100, hash: "bbbbbbbb" },
  { tick: 200, hash: "cccccccc" },
  { tick: 300, hash: "dddddddd" },
];

test("every hash and the final state equal to CI's: same", () => {
  const r = compare(expected, progress, done);
  assert.equal(r.same, true);
  assert.equal(r.compared, 5);
  assert.equal(r.mismatches, 0);
});

test("one different hash: not the same, and says where it first differs", () => {
  const r = compare(expected, [...progress.slice(0, 2), { tick: 200, hash: "00000000" }, progress[3]], done);
  assert.equal(r.same, false);
  assert.equal(r.mismatches, 1);
  assert.equal(r.firstMismatchTick, 200);
});

test("a game that ends at another tick is not the same", () => {
  assert.equal(compare(expected, progress, { ...done, ticks: 299 }).same, false);
});

test("without CI's file there is nothing to compare: same is null", () => {
  const r = compare(null, progress, done);
  assert.equal(r.same, null);
  assert.equal(r.compared, 0);
});
