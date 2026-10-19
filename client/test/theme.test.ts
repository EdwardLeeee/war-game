// 介面風格 (R6-20): A 銅木 the first time and when unreadable, the device's choice after.

import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTheme, saveTheme, THEME_KEY, THEME_LABEL } from "../src/theme.ts";

test("介面風格：第一次是 A 銅木；選了 B 墨漆金線記在這台裝置；壞掉的值或讀不到當沒選過", () => {
  const map = new Map<string, string>();
  const store = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) };
  assert.equal(loadTheme(store), "a");
  saveTheme("b", store);
  assert.equal(loadTheme(store), "b");
  map.set(THEME_KEY, "c");
  assert.equal(loadTheme(store), "a");
  const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  assert.equal(loadTheme(broken), "a");
  saveTheme("b", broken);
  assert.deepEqual(THEME_LABEL, { a: "A 銅木", b: "B 墨漆金線" });
});
