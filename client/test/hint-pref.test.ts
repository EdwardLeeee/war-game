// 開局提示 (D-044): 「不再提示」 is kept on this device; without storage the hint just shows.

import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTownHintOff, saveTownHintOff, TOWN_HINT_KEY } from "../src/hint-pref.ts";

function memoryStore() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      m.set(k, v);
    },
    raw: m,
  };
}

const throwingStore = {
  getItem: (): string | null => {
    throw new Error("SecurityError");
  },
  setItem: (): void => {
    throw new Error("QuotaExceededError");
  },
};

test("不再提示：第一次會提示；按了之後記在這台裝置上；再打開又會提示（D-044）", () => {
  const store = memoryStore();
  assert.equal(loadTownHintOff(store), false);
  saveTownHintOff(true, store);
  assert.equal(store.raw.get(TOWN_HINT_KEY), "off");
  assert.equal(loadTownHintOff(store), true);
  saveTownHintOff(false, store);
  assert.equal(loadTownHintOff(store), false);
});

test("不再提示：瀏覽器不給存（無痕、封鎖網站資料）時，照樣提示、不會出錯", () => {
  assert.equal(loadTownHintOff(throwingStore), false);
  assert.doesNotThrow(() => saveTownHintOff(true, throwingStore));
  assert.equal(loadTownHintOff(null), false);
});
