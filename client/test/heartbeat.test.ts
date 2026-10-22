// 閃退的線索 (ceo 2026-10-22): the heartbeat a game on screen leaves on the device, the note the
// next start makes of one left 「playing」, and the record that carries it once, with 美術 in use.

import assert from "node:assert/strict";
import { test } from "node:test";
import { checkRecord } from "../../services/game-logs/src/record.ts";
import { makeRecord } from "../src/logs/collect.ts";
import { BEAT_KEY, CRASH_KEY, crashOf, Heartbeat } from "../src/logs/heartbeat.ts";

class MemoryStorage {
  readonly map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
}

const BEAT = { since: 1_000_000, tick: 72_000, units: 213, buildings: 73, art: "x3", gpuPages: 104, gpuMB: 402, contextLost: 0, lastError: null, commit: "f4348fa" };

test("心跳：遊戲畫面開著時寫進裝置；上一次停在 playing（頁面死掉）就在下次開啟時記成意外結束，只交出一次", () => {
  const store = new MemoryStorage();
  const h = new Heartbeat(store);
  h.beat({ state: "playing", ...BEAT }, 1_000_000 + 4_650_000);
  // The page dies here. The next start:
  const next = new Heartbeat(store);
  next.startup();
  assert.equal(store.getItem(BEAT_KEY), null, "the heartbeat starts over");
  const note = next.takeCrash();
  assert.deepEqual(note, { at: 1_000_000 + 4_650_000, upS: 4650, tick: 72_000, units: 213, buildings: 73, art: "x3", gpuPages: 104, gpuMB: 402, contextLost: 0, lastError: null, commit: "f4348fa" });
  assert.equal(next.takeCrash(), null, "once");
});

test("心跳：切到背景、回開局畫面或對局結束就不算意外結束；讀不懂的也不算", () => {
  for (const state of ["away", "ended"] as const) {
    const store = new MemoryStorage();
    const h = new Heartbeat(store);
    h.beat({ state: "playing", ...BEAT });
    h.leave(state);
    const next = new Heartbeat(store);
    next.startup();
    assert.equal(next.takeCrash(), null, state);
  }
  const store = new MemoryStorage();
  store.setItem(BEAT_KEY, "{not json");
  const h = new Heartbeat(store);
  h.startup();
  assert.equal(store.getItem(CRASH_KEY), null);
  assert.equal(crashOf({ v: 1, state: "playing" }), null, "missing its numbers");
  // No storage at all (private mode): nothing, no throw.
  const none = new Heartbeat(null);
  none.startup();
  none.beat({ state: "playing", ...BEAT });
  assert.equal(none.takeCrash(), null);
});

test("紀錄：帶著用的美術（x3、x2、off）和上一次意外結束的線索；收紀錄的 Worker 照樣收", () => {
  const base = { id: "00000000-0000-4000-8000-000000000001", code: "ab12cd34", commit: "f4348fa", protocol: 1, scenario: "standard", difficulty: "hard", end: { result: "win" as const, reason: "main_city", ticks: 93007 }, lastHash: { tick: 93000, hash: "591e8f1a" }, log: '{"protocol":1,"seed":1,"scenario":"standard","ai":[false,true]}\n' };
  const note = crashOf({ v: 1, state: "playing", at: 5_000, ...BEAT });
  const r = makeRecord({ ...base, art: "x3", crash: note });
  assert.equal(r.art, "x3");
  assert.deepEqual(r.crash, note);
  assert.equal(typeof checkRecord(r), "object", "the Worker takes it");
  const plain = makeRecord({ ...base, art: "x2", crash: null });
  assert.equal(plain.art, "x2");
  assert.equal("crash" in plain, false, "no note: no field");
});
