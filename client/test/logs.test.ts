// 對局紀錄 (D-056) on the phone: 紀錄代號, keeping the last 50 games once each, uploading
// them quietly and trying again later, and what a record holds.

import assert from "node:assert/strict";
import { test } from "node:test";
import { checkRecord, type GameRecord } from "../../services/game-logs/src/record.ts";
import { newRecordCode, RECORD_CODE_KEY, recordCode } from "../src/logs/code.ts";
import { GAME_LOGS_URL, LogCollector, logsUrlFor, MIN_ABANDONED_TICKS, makeRecord, reasonName, resultFor } from "../src/logs/collect.ts";
import { KEEP_GAMES, type LogBackend, LogStore, MemoryBackend } from "../src/logs/store.ts";
import { fetchPoster, KEEPALIVE_MAX, type Poster, uploadPending } from "../src/logs/upload.ts";
import { GameOverReason, TICKS_PER_SECOND } from "../src/sim.ts";

class MemoryStorage {
  readonly map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
}

let n = 0;
function rec(over: Partial<GameRecord> = {}): GameRecord {
  n++;
  return makeRecord({
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    code: "ab12cd34",
    commit: "8f981d2",
    protocol: 7,
    scenario: "standard",
    difficulty: "easy",
    end: { result: "win", reason: "main_city", ticks: 24000 },
    lastHash: { tick: 24000, hash: "0ad3af22" },
    log: `${JSON.stringify({ protocol: 7, seed: 5, scenario: "standard", ai: [false, true] })}\n`,
    ...over,
  });
}

test("紀錄代號：8 個小寫英數字；第一次產生並存起來，之後一直用同一個；存的不對就換新的", () => {
  const store = new MemoryStorage();
  const a = recordCode(store);
  assert.match(a, /^[a-z0-9]{8}$/);
  assert.equal(store.getItem(RECORD_CODE_KEY), a);
  assert.equal(recordCode(store), a);
  store.setItem(RECORD_CODE_KEY, "Not A Code");
  const b = recordCode(store);
  assert.match(b, /^[a-z0-9]{8}$/);
  assert.equal(store.getItem(RECORD_CODE_KEY), b);
});

test("紀錄代號：瀏覽器儲存不能用（私密瀏覽）時，這一頁用同一個代號，遊戲照常", () => {
  const broken = {
    getItem: () => {
      throw new Error("SecurityError");
    },
    setItem: () => {
      throw new Error("SecurityError");
    },
  };
  const a = recordCode(broken);
  assert.match(a, /^[a-z0-9]{8}$/);
  assert.equal(recordCode(broken), a);
  assert.equal(recordCode(null), a);
});

test("紀錄代號：只用 252 以下的位元組，每個字一樣常見；全是 252 以上就再抽", () => {
  let call = 0;
  const bytes = (len: number) => new Uint8Array(len).fill(call++ === 0 ? 255 : 36 + 1);
  assert.equal(newRecordCode(bytes), "bbbbbbbb");
  assert.equal(call, 2);
});

test("存：一局只存一次（局編號去重），只留最近 50 局，新存的是待上傳", async () => {
  const store = new LogStore(new MemoryBackend());
  const first = rec();
  assert.equal(await store.save(first, 1000), true);
  assert.equal(await store.save(first, 2000), false, "the same game again");
  assert.deepEqual((await store.pending()).map((e) => [e.id, e.state]), [[first.id, "pending"]]);
  for (let i = 0; i < KEEP_GAMES + 4; i++) await store.save(rec(), 3000 + i);
  const kept = await store.list();
  assert.equal(kept.length, KEEP_GAMES);
  assert.equal(kept.some((e) => e.id === first.id), false, "the oldest went");
  assert.ok(kept[0].savedAt > kept[KEEP_GAMES - 1].savedAt, "newest first");
});

test("上傳：成功（201、已有的 200）就標記已傳；400、413 標記不收、不再傳；503 或沒網路就停，下次再傳", async () => {
  const store = new LogStore(new MemoryBackend());
  const [a, b, c, d] = [rec(), rec(), rec(), rec()];
  for (const [i, r] of [a, b, c, d].entries()) await store.save(r, i);
  const answers = [201, 200, 400, 503];
  const posted: string[] = [];
  const post: Poster = async (_url, body) => {
    posted.push((JSON.parse(body) as GameRecord).id);
    return answers.shift() as number;
  };
  assert.equal(await uploadPending(store, "https://logs.test/logs", post), 2);
  assert.deepEqual(posted, [a.id, b.id, c.id, d.id], "oldest first");
  const state = new Map((await store.list()).map((e) => [e.id, e.state]));
  assert.deepEqual([state.get(a.id), state.get(b.id), state.get(c.id), state.get(d.id)], ["sent", "sent", "rejected", "pending"]);

  // Next time: only the one still waiting; no network at first, then it goes.
  const offline: Poster = async () => {
    throw new TypeError("Failed to fetch");
  };
  assert.equal(await uploadPending(store, "https://logs.test/logs", offline), 0);
  const again: string[] = [];
  assert.equal(await uploadPending(store, "https://logs.test/logs", async (_u, body) => (again.push((JSON.parse(body) as GameRecord).id), 201)), 1);
  assert.deepEqual(again, [d.id]);
  assert.deepEqual(await store.pending(), []);
});

test("沒有網址（還沒部署）：只存不傳", async () => {
  const store = new LogStore(new MemoryBackend());
  await store.save(rec(), 1);
  let calls = 0;
  assert.equal(await uploadPending(store, "", async () => (calls++, 201)), 0);
  assert.equal(calls, 0);
  assert.equal((await store.pending()).length, 1);
});

test("收集：存好就傳；存不了（沒有 IndexedDB）或傳不出去都不丟錯", async () => {
  const backend = new MemoryBackend();
  const bodies: string[] = [];
  const logs = new LogCollector(Promise.resolve(backend), "https://logs.test/logs", async (_u, b) => (bodies.push(b), 201));
  const r = rec();
  assert.equal(await logs.keep(r), true);
  await logs.flush();
  assert.deepEqual(bodies.map((b) => JSON.parse(b)), [r]);
  assert.equal((await logs.list())[0].state, "sent");

  const none = new LogCollector(Promise.resolve(null), "https://logs.test/logs", async () => 201);
  assert.equal(await none.keep(rec()), false);
  assert.equal(await none.flush(), 0);

  const failing: LogBackend = {
    all: async () => {
      throw new Error("QuotaExceededError");
    },
    put: async () => {},
    remove: async () => {},
  };
  const broken = new LogCollector(Promise.resolve(failing), "https://logs.test/logs", async () => 201);
  assert.equal(await broken.keep(rec()), false);
  const offline = new LogCollector(Promise.resolve(new MemoryBackend()), "https://logs.test/logs", async () => {
    throw new TypeError("Failed to fetch");
  });
  assert.equal(await offline.keep(rec()), true);
  assert.equal(await offline.flush(), 0);
});

test("紀錄：只有局編號、代號、版本、協定、場景、難度、勝負、遊戲時間、最後雜湊和指令紀錄，收紀錄的 Worker 認得", () => {
  const r = rec();
  assert.deepEqual(Object.keys(r).sort(), ["code", "commit", "difficulty", "id", "lastHash", "log", "protocol", "reason", "result", "scenario", "ticks", "v"]);
  assert.equal(typeof checkRecord(r), "object");
  assert.equal(typeof checkRecord(rec({ result: "abandoned", reason: "", lastHash: null })), "object");
});

test("勝負與原因：我贏是 win、對手贏是 loss、沒有贏家是 draw；原因寫成英文字", () => {
  assert.equal(resultFor(0, 0), "win");
  assert.equal(resultFor(1, 0), "loss");
  assert.equal(resultFor(-1, 0), "draw");
  assert.equal(reasonName(GameOverReason.MainCityDestroyed), "main_city");
  assert.equal(reasonName(GameOverReason.Surrender), "surrender");
  assert.equal(reasonName(GameOverReason.TimeLimit), "time_limit");
  assert.equal(MIN_ABANDONED_TICKS, 60 * TICKS_PER_SECOND);
});

test("上傳的請求：text/plain（跨網域不用預檢）、不帶 cookie；64 KB 以下用 keepalive，頁面關掉也會送完", async () => {
  const seen: RequestInit[] = [];
  const fake = (async (_url: string, init: RequestInit) => (seen.push(init), new Response(null, { status: 201 }))) as unknown as typeof fetch;
  const post = fetchPoster(fake);
  assert.equal(await post("https://logs.test/logs", "x".repeat(100)), 201);
  assert.equal(await post("https://logs.test/logs", "x".repeat(KEEPALIVE_MAX + 1)), 201);
  assert.deepEqual(
    seen.map((i) => [i.method, (i.headers as Record<string, string>)["content-type"], i.credentials, i.keepalive]),
    [
      ["POST", "text/plain;charset=UTF-8", "omit", true],
      ["POST", "text/plain;charset=UTF-8", "omit", false],
    ],
  );
});

test("收紀錄的網址：玩家的頁面傳到 Worker 的 /logs（https）；測試頁不傳，除非給了 ?logs=（D-056）", () => {
  assert.match(GAME_LOGS_URL, /^https:\/\/[a-z0-9.-]+\.workers\.dev\/logs$/);
  assert.equal(logsUrlFor(false, null), GAME_LOGS_URL);
  assert.equal(logsUrlFor(true, null), "", "CI never posts to the real Worker");
  assert.equal(logsUrlFor(true, "https://game-logs.test/logs"), "https://game-logs.test/logs");
});
