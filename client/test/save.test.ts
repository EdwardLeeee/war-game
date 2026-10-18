// 繼續上一局 (D-083): what the screen keeps beside the simulation comes back as it was after a
// trip through storage (structured clone, as IndexedDB keeps it); the save on the phone, read
// back, is trusted only when it looks like one; the start screen's and the failures' words;
// the simulation's build is the Worker's sources only.

import assert from "node:assert/strict";
import { test } from "node:test";
import { GroupAlarms } from "../src/game/alarm.ts";
import { ArmyBook } from "../src/game/army.ts";
import { Charges } from "../src/game/follow.ts";
import { nextSeq } from "../src/game/game.ts";
import { canGoOn, continueLabel, failureText, MemorySaveBackend, minuteOf, progressText, SAVE_EVERY_TICKS, type SavedGame, SaveStore, SCREEN_VERSION, screenUsable, UPDATED_TEXT } from "../src/save/save.ts";
import { CELL, UnitType } from "../src/sim.ts";
import { simBuild } from "../scripts/sim-build.ts";

const SPEAR = UnitType.Spearman;
const RANGED = UnitType.Ranged;
const at = (id: number, type: number, cx: number, cy: number) => ({ id, type, x: cx * CELL + CELL / 2, y: cy * CELL + CELL / 2 });

/** A book with a bit of everything: groups (one never checked), a recruit, a garrison, soldiers kept out. */
function book(): ArmyBook {
  const b = new ArmyBook();
  b.saveGroup(0, [
    { id: 1, type: SPEAR },
    { id: 2, type: SPEAR },
    { id: 3, type: RANGED },
  ]);
  b.groups[0].refill = false;
  b.groups[0].goal = { x: 5000, y: 7000 };
  b.groups[0].checked = 120;
  b.saveGroup(1, [{ id: 4, type: RANGED }]);
  b.enlist(9, RANGED, (id) => (id === 9 || id === 4 ? RANGED : null));
  b.station([at(5, SPEAR, 10, 10), at(6, SPEAR, 11, 10)], { id: 2, cellX: 10, cellY: 10, radius: 4 }, 2);
  b.keepOut([8, 7]);
  return b;
}

test("編隊、留守、出來的兵：存起來（經過 structured clone）再還原，一模一樣；沒檢查過的 −∞ 也還原", () => {
  const before = book();
  const state = structuredClone(before.save());
  assert.equal(state.groups[2].checked, null, "−∞ is kept as null");
  const after = new ArmyBook();
  after.restore(state);
  assert.deepEqual(after.save(), before.save());
  assert.deepEqual(after.groups, before.groups);
  assert.equal(after.groups[2].checked, Number.NEGATIVE_INFINITY);
  assert.deepEqual(after.garrisonOf(2), [5, 6]);
  assert.equal(after.isKeptOut(7), true);
  assert.equal(after.isKeptOut(1), false);
  // And through JSON too (null stays null; nothing else is lost).
  const viaJson = new ArmyBook();
  viaJson.restore(JSON.parse(JSON.stringify(before.save())));
  assert.deepEqual(viaJson.save(), before.save());
});

test("閃紅的基準和跳過的提示、進攻到底的兵：存起來再還原", () => {
  const a = new GroupAlarms();
  a.update(0, true, 10);
  a.update(0, true, 4);
  a.update(2, true, 6);
  const b = new GroupAlarms();
  b.restore(structuredClone(a.save()));
  assert.deepEqual(b.save(), { base: [10, null, 6, null], told: [true, false, false, false] });
  // Goes on as the saved one would: still told, no second line.
  assert.deepEqual(b.update(0, true, 3), a.update(0, true, 3));

  const c = new Charges();
  c.start([3, 1], 99, { x: 40, y: 12 }, 50);
  c.start([7], 98, null, 60);
  const d = new Charges();
  d.restore(structuredClone(c.save()));
  assert.deepEqual(d.ids(), [1, 3, 7]);
  assert.deepEqual(d.save(), c.save());
});

test("接著打的指令編號：接在紀錄裡最大的那個後面（電腦的也算）", () => {
  const log = ['{"protocol":1,"seed":5}', '{"t":3,"p":0,"seq":4,"c":"move"}', '{"t":9,"p":1,"seq":17,"c":"train"}', '{"t":12,"p":0,"seq":6,"c":"stop"}'].join("\n");
  assert.equal(nextSeq(log), 18);
  assert.equal(nextSeq('{"protocol":1}\n'), 1);
});

function saved(over: Partial<SavedGame> = {}): SavedGame {
  return {
    savedAt: 1,
    commit: "abc1234",
    protocol: 9,
    build: "0123456789ab",
    game: "g-1",
    init: { seed: 7, scenario: "standard", difficulty: "easy", map: "fixed", maxTicks: 0, enemyAi: true },
    log: '{"protocol":9}\n',
    hashes: [{ tick: 0, hash: "00000001" }],
    tick: 25_000,
    screenVersion: SCREEN_VERSION,
    screen: { army: book().save(), alarms: new GroupAlarms().save(), charges: [], camera: { x: 1, y: 2, scale: 1.5 }, speed: "fast", seq: 40, recruitMessageTick: null },
    ...over,
  };
}

test("手機上只存一局：存、讀回、清掉；讀回來的東西不像存檔就當沒有；儲存不能用時不出錯", async () => {
  const mem = new MemorySaveBackend();
  const store = new SaveStore(Promise.resolve(mem));
  assert.equal(await store.load(), null);
  assert.equal(await store.save(saved()), true);
  assert.deepEqual(await store.load(), saved());
  assert.equal(await store.save(saved({ tick: 26_000 })), true);
  assert.equal((await store.load())?.tick, 26_000, "one game, the last save");
  await store.clear();
  assert.equal(await store.load(), null);
  // Something else under the key (an old format, a broken write): nothing to go on with.
  mem.value = { log: 5 } as unknown as SavedGame;
  assert.equal(await store.load(), null);
  // No storage (private browsing), or storage failing.
  const none = new SaveStore(Promise.resolve(null));
  assert.equal(await none.save(saved()), false);
  assert.equal(await none.load(), null);
  await none.clear();
  const failing = new SaveStore(Promise.resolve({ get: () => Promise.reject(new Error("x")), put: () => Promise.reject(new Error("x")), clear: () => Promise.reject(new Error("x")) }));
  assert.equal(await failing.load(), null);
  assert.equal(await failing.save(saved()), false);
  await failing.clear();
});

test("開局畫面和快轉的字；能不能接著打看模擬（protocol 和 build）；畫面狀態格式不同時照樣接著打", () => {
  assert.equal(SAVE_EVERY_TICKS, 1200, "every minute of game time");
  assert.equal(minuteOf(25_000), 20);
  assert.equal(continueLabel(saved()), "繼續上一局（第 20 分）");
  assert.equal(progressText(2400, 96_000), "快轉中：第 2／80 分");
  assert.equal(canGoOn(saved(), 9, "0123456789ab"), true);
  assert.equal(canGoOn(saved(), 10, "0123456789ab"), false, "another protocol");
  assert.equal(canGoOn(saved(), 9, "ba9876543210"), false, "another simulation");
  assert.equal(screenUsable(saved()), true);
  assert.equal(screenUsable(saved({ screenVersion: SCREEN_VERSION + 1 })), false);
  // Two kinds of words (ceo 2026-10-17).
  assert.equal(failureText("protocol", 0), UPDATED_TEXT);
  assert.equal(failureText("build", 0), "網站已經更新，這一局不能繼續");
  for (const reason of ["log", "commands", "hash"] as const) assert.equal(failureText(reason, 15_000), "紀錄對不上（第 12 分），這一局不能繼續");
});

test("模擬的 build：只算 worker 打包進去的模擬檔案，12 碼，每次一樣", async () => {
  const a = await simBuild();
  assert.match(a.id, /^[0-9a-f]{12}$/);
  assert.ok(a.files.includes("sim/src/worker.ts"));
  assert.ok(a.files.includes("sim/src/core/game.ts"));
  assert.ok(a.files.every((f) => f.startsWith("sim/src/")), a.files.join(", "));
  // core's measuring tools are not in the Worker.
  assert.ok(!a.files.includes("sim/src/tournament.ts"));
  assert.ok(!a.files.includes("sim/src/continue-bench.ts"));
  assert.equal((await simBuild()).id, a.id);
});
