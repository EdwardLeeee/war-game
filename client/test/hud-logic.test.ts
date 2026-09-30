import assert from "node:assert/strict";
import { test } from "node:test";
import { adjustRatio } from "../src/ui/hud/economy-ratio.ts";
import { clock, costText } from "../src/ui/hud/names.ts";

test("經濟分配: a raise comes out of the largest other share, the total stays 100", () => {
  assert.deepEqual(adjustRatio({ food: 40, wood: 35, gold: 25 }, "gold", 5), { food: 35, wood: 35, gold: 30 });
  assert.deepEqual(adjustRatio({ food: 40, wood: 35, gold: 25 }, "food", -5), { food: 35, wood: 35, gold: 30 });
});

test("經濟分配: nothing goes below 0 or above 100", () => {
  assert.deepEqual(adjustRatio({ food: 100, wood: 0, gold: 0 }, "food", 5), { food: 100, wood: 0, gold: 0 });
  assert.deepEqual(adjustRatio({ food: 0, wood: 50, gold: 50 }, "food", -5), { food: 0, wood: 50, gold: 50 });
  let r = { food: 40, wood: 35, gold: 25 };
  for (let i = 0; i < 30; i++) r = adjustRatio(r, "wood", 5);
  assert.deepEqual(r, { food: 0, wood: 100, gold: 0 });
});

test("costs and the game clock read plainly", () => {
  assert.equal(costText({ food: 40, wood: 20, gold: 0, crystal: 0 }), "糧40 木20");
  assert.equal(costText({ food: 0, wood: 0, gold: 90, crystal: 50 }), "金90 晶50");
  assert.equal(clock(0), "0:00");
  assert.equal(clock(20 * 125), "2:05");
});
