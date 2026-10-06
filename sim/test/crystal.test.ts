// The main city's crystal (early balance, D-051, D-057; MAIN_CRYSTAL in core/rules.ts): every
// 16 s each standing main city gives its owner 1 crystal; switched off, nothing.

import assert from "node:assert/strict";
import { test } from "node:test";
import { MAIN_CRYSTAL } from "../src/core/rules.ts";
import { Resource } from "../src/protocol.ts";
import { emptyGame, run } from "./helpers.ts";

const crystal = (g: ReturnType<typeof emptyGame>, p: number) => g.w.res[p * 4 + Resource.Crystal];

test("each main city gives its owner 1 crystal every 16 s, the same for both sides", () => {
  const g = emptyGame();
  const start = [crystal(g, 0), crystal(g, 1)];
  // The tick numbered MAIN_CRYSTAL.every (16 s) is the one that pays: the first steps are ticks 0, 1, ...
  run(g, MAIN_CRYSTAL.every);
  assert.deepEqual([crystal(g, 0), crystal(g, 1)], start, "nothing before 16 s");
  run(g, 1);
  assert.deepEqual([crystal(g, 0), crystal(g, 1)], start.map((c) => c + 1));
  run(g, 9 * MAIN_CRYSTAL.every);
  assert.deepEqual([crystal(g, 0), crystal(g, 1)], start.map((c) => c + 10), "10 after 160 s");
});

test("switched off (every 0), no main city gives crystal", () => {
  const saved = MAIN_CRYSTAL.every;
  MAIN_CRYSTAL.every = 0;
  try {
    const off = emptyGame();
    const c = [crystal(off, 0), crystal(off, 1)];
    run(off, 3 * saved + 1);
    assert.deepEqual([crystal(off, 0), crystal(off, 1)], c);
  } finally {
    MAIN_CRYSTAL.every = saved;
  }
});
