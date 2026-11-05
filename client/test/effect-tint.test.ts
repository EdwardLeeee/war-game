// 晶砲預警圈 in the caster's colour (D-129, ui's design/b1/README.md 晶砲預警圈 B point 5).

import assert from "node:assert/strict";
import { test } from "node:test";
import { effectTint } from "../src/art/effect-tint.ts";

const OWN = 0x3f7fe0;
const ENEMY = 0xd9433a;
const rgb = (c: number) => [(c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff];

test("法圈染色：玩家色先調到最亮（色相不變），再往白色混 tint_white", () => {
  // 我方藍 (63, 127, 224): its blue to full, the others in proportion; then 10 % towards white (warn_sigil_t).
  assert.deepEqual(rgb(effectTint(OWN, 1, 0)), [72, 145, 255]);
  assert.deepEqual(rgb(effectTint(OWN, 1, 0.1)), [90, 156, 255]);
  // 敵方紅 (217, 67, 58), warn_core_t's 0.4.
  assert.deepEqual(rgb(effectTint(ENEMY, 1, 0.4)), [255, 149, 143]);
  // warn_rim_t: dark, 0.45 of the brightest.
  assert.deepEqual(rgb(effectTint(OWN, 0.45, 0)), [32, 65, 115]);
  // Black (no colour): grey at the value.
  assert.deepEqual(rgb(effectTint(0, 0.5, 0)), [128, 128, 128]);
});
