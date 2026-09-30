import assert from "node:assert/strict";
import { test } from "node:test";
import { SPEED_TPS } from "../src/params.ts";
import { nextSpeed } from "../src/ui/controls.ts";

test("the speed button cycles 正常 → 快 → 慢 → 正常 (20, 30, 15 ticks per second)", () => {
  assert.equal(nextSpeed("normal"), "fast");
  assert.equal(nextSpeed("fast"), "slow");
  assert.equal(nextSpeed("slow"), "normal");
  assert.deepEqual([SPEED_TPS.normal, SPEED_TPS.fast, SPEED_TPS.slow], [20, 30, 15]);
});
