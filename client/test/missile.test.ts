// 真的箭 (R8-35 B, war-game-ui's effects.py): arrows fly at 35 m/s but never longer than 0.35 s
// (the damage is done when they leave), on a low arc to the target's chest; slings' stones higher
// and up to 0.45 s; the effects' own numbers when they have them.

import assert from "node:assert/strict";
import { test } from "node:test";
import { ARROW_FLIGHT, CHEST_M, flightOf, flightSeconds, heightAt, SLING_FLIGHT } from "../src/render/missile.ts";

test("飛行時間：35 m/s，最多 0.35 秒（20 公尺遠也是 0.35 秒）；投石最多 0.45 秒", () => {
  assert.equal(flightSeconds(7, ARROW_FLIGHT), 0.2);
  assert.equal(flightSeconds(20, ARROW_FLIGHT), 0.35);
  assert.equal(flightSeconds(20, SLING_FLIGHT), 0.45);
});

test("弧線：出手和落點的高度連直線，中間最高多 arc_k × 距離；落在胸口 1.2 公尺", () => {
  assert.equal(CHEST_M, 1.2);
  assert.equal(heightAt(0, 10, 1.45, 1.2, 0.06), 1.45);
  assert.equal(heightAt(1, 10, 1.45, 1.2, 0.06), 1.2);
  assert.ok(Math.abs(heightAt(0.5, 10, 1.2, 1.2, 0.06) - (1.2 + 0.6)) < 1e-9, "the top half way: 0.06 × 10 m");
  assert.ok(heightAt(0.5, 10, 1.2, 1.2, 0.18) > heightAt(0.5, 10, 1.2, 1.2, 0.06), "a stone higher");
});

test("效果檔有自己的數字就用它的，沒有就用 ui 的預設", () => {
  assert.deepEqual(flightOf(undefined, ARROW_FLIGHT), ARROW_FLIGHT);
  assert.deepEqual(flightOf({ frames: 1, loop: false, speed_mps: 40, max_s: 0.3 }, ARROW_FLIGHT), { speedMps: 40, maxS: 0.3, arcK: 0.06 });
  assert.deepEqual(flightOf({ frames: 4, loop: true, arc_k: 0.2 }, SLING_FLIGHT), { speedMps: 35, maxS: 0.45, arcK: 0.2 });
});
