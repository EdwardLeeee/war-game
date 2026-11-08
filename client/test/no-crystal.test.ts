// D-135 (the user 2026-11-08: 「魔晶感覺很雞肋都用不到 好像可以拿掉」): with rules.features.noCrystal the screen shows
// crystal nowhere; without the flag (an older simulation) as before.

import assert from "node:assert/strict";
import { test } from "node:test";
import { hasCrystal } from "../src/game/features.ts";

test("hasCrystal：rules.features.noCrystal 才算沒有魔晶；沒有這個旗標（舊模擬）、沒有 features 都照舊有", () => {
  const off = { plunderOnce: false, towers: false, garrison: false, cavalry: false };
  assert.equal(hasCrystal({ features: { ...off, noCrystal: true } }), false);
  assert.equal(hasCrystal({ features: off }), true);
  assert.equal(hasCrystal({}), true);
  assert.equal(hasCrystal(null), true);
});
