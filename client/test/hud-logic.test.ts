import assert from "node:assert/strict";
import { test } from "node:test";
import { adjustRatio } from "../src/ui/hud/economy-ratio.ts";
import { HEADER_LENGTH, HeaderField as H } from "../src/sim.ts";
import { clock, costText, resourceLine } from "../src/ui/hud/names.ts";

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

test("遊戲時間：分:秒，每秒 20 tick；超過一小時分鐘繼續數，和結算畫面一樣（ceo 2026-10-03）", () => {
  assert.equal(clock(0), "0:00");
  assert.equal(clock(19), "0:00", "a second is 20 ticks");
  assert.equal(clock(20), "0:01");
  assert.equal(clock(20 * 599), "9:59");
  assert.equal(clock(20 * 600), "10:00");
  assert.equal(clock(20 * 3599 + 19), "59:59");
  assert.equal(clock(20 * 3600), "60:00");
  assert.equal(clock(20 * 3725), "62:05");
});

test("資源列：糧木金晶、人口，最後是遊戲時間；窄的畫面拿掉「時間」兩字", () => {
  const h = new Int32Array(HEADER_LENGTH);
  h[H.food] = 1250;
  h[H.wood] = 200;
  h[H.gold] = 100;
  h[H.crystal] = 20;
  h[H.population] = 17;
  h[H.populationCap] = 20;
  h[H.tick] = 20 * 425 + 7;
  assert.deepEqual(resourceLine(h), {
    full: "糧 1250　木 200　金 100　晶 20　人口 17/20　時間 7:05",
    short: "糧 1250　木 200　金 100　晶 20　人口 17/20　7:05",
  });
});
