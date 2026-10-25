// 寫實地面 開／關 (ceo 2026-10-25): on by default; off kept on this device; without storage, on.

import assert from "node:assert/strict";
import { test } from "node:test";
import { GROUND_KEY, loadGroundOn, saveGroundOn } from "../src/ground-pref.ts";

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

test("寫實地面開關：預設開；關了記在這台裝置上，再打開也記；不能存的時候照舊開", () => {
  const store = memoryStore();
  assert.equal(loadGroundOn(store), true);
  saveGroundOn(false, store);
  assert.equal(store.raw.get(GROUND_KEY), "off");
  assert.equal(loadGroundOn(store), false);
  saveGroundOn(true, store);
  assert.equal(loadGroundOn(store), true);
  const broken = {
    getItem: (): string | null => {
      throw new Error("SecurityError");
    },
    setItem: (): void => {
      throw new Error("QuotaExceededError");
    },
  };
  saveGroundOn(false, broken);
  assert.equal(loadGroundOn(broken), true);
  assert.equal(loadGroundOn(null), true);
});
