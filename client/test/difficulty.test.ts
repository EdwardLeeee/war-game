import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_DIFFICULTY, DIFFICULTY_KEY, loadDifficulty, saveDifficulty } from "../src/difficulty.ts";

/** A browser storage stand-in. */
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

/** Storage that throws, as Safari's private browsing or blocked site data can. */
const throwingStore = {
  getItem: (): string | null => {
    throw new Error("SecurityError");
  },
  setItem: (): void => {
    throw new Error("QuotaExceededError");
  },
};

test("難度：第一次是簡單（D-024）", () => {
  assert.equal(DEFAULT_DIFFICULTY, "easy");
  assert.equal(loadDifficulty(memoryStore()), "easy");
});

test("難度：選過之後讀回同一個", () => {
  const store = memoryStore();
  saveDifficulty("normal", store);
  assert.equal(store.raw.get(DIFFICULTY_KEY), "normal");
  assert.equal(loadDifficulty(store), "normal");
  saveDifficulty("easy", store);
  assert.equal(loadDifficulty(store), "easy");
});

test("難度：存的值不認得時，當成沒存過", () => {
  const store = memoryStore();
  store.setItem(DIFFICULTY_KEY, "nightmare");
  assert.equal(loadDifficulty(store), "easy");
});

test("難度：儲存空間讀寫會丟錯或不存在時照常運作，當成沒存過", () => {
  assert.equal(loadDifficulty(throwingStore), "easy");
  assert.doesNotThrow(() => saveDifficulty("normal", throwingStore));
  assert.equal(loadDifficulty(null), "easy");
  assert.doesNotThrow(() => saveDifficulty("normal", null));
});
