// The game-log Worker (D-056) with a KV in memory: what it stores, what it turns away, and
// that reading needs the key.

import assert from "node:assert/strict";
import { test } from "node:test";
import { checkRecord, type GameRecord, MAX_BYTES } from "../src/record.ts";
import { type Env, handle, type KV } from "../src/worker.ts";

const ORIGIN = "https://edwardleeee.github.io";
const KEY = "test-read-key-0123456789";

class MemoryKV implements KV {
  readonly data = new Map<string, { value: string; metadata?: unknown }>();
  puts = 0;
  failPut = false;
  async get(key: string): Promise<string | null> {
    return this.data.get(key)?.value ?? null;
  }
  async put(key: string, value: string, options?: { metadata?: unknown }): Promise<void> {
    if (this.failPut) throw new Error("KV put failed: daily limit exceeded");
    this.puts++;
    this.data.set(key, { value, metadata: options?.metadata });
  }
  async list(options?: { prefix?: string; cursor?: string; limit?: number }) {
    const names = [...this.data.keys()].filter((k) => k.startsWith(options?.prefix ?? "")).sort();
    const start = options?.cursor === undefined ? 0 : Number(options.cursor);
    const limit = options?.limit ?? 1000;
    const page = names.slice(start, start + limit);
    const done = start + limit >= names.length;
    return { keys: page.map((name) => ({ name, metadata: this.data.get(name)?.metadata })), list_complete: done, cursor: done ? undefined : String(start + limit) };
  }
}

function env(kv = new MemoryKV()): Env {
  return { LOGS: kv, READ_KEY: KEY, ALLOWED_ORIGINS: `${ORIGIN}, http://localhost:4173` };
}

let n = 0;
function record(over: Partial<GameRecord> = {}): GameRecord {
  n++;
  const header = { protocol: 7, seed: 12345, scenario: "standard", ai: [false, true], maxTicks: 0, difficulty: ["normal", "easy"] };
  return {
    v: 1,
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    code: "ab12cd34",
    commit: "8f981d2",
    protocol: 7,
    scenario: "standard",
    difficulty: "easy",
    result: "win",
    reason: "main_city",
    ticks: 24000,
    lastHash: { tick: 24000, hash: "0ad3af22" },
    log: `${JSON.stringify(header)}\n{"t":5,"p":0,"seq":1,"c":"stop","u":[3]}\n`,
    ...over,
  };
}

const postReq = (body: string, origin: string | null = ORIGIN) =>
  new Request("https://war-game-logs.example.workers.dev/logs", {
    method: "POST",
    body,
    headers: { "content-type": "text/plain;charset=UTF-8", ...(origin === null ? {} : { origin }) },
  });
const getReq = (path: string, key: string | null = KEY) =>
  new Request(`https://war-game-logs.example.workers.dev${path}`, { headers: key === null ? {} : { authorization: `Bearer ${key}` } });

test("POST：合格的紀錄存一次（201），同一局再傳只回已有、不再寫入；回應帶試玩頁的 CORS", async () => {
  const kv = new MemoryKV();
  const e = env(kv);
  const r = record();
  const first = await handle(postReq(JSON.stringify(r)), e);
  assert.equal(first.status, 201);
  assert.equal(first.headers.get("access-control-allow-origin"), ORIGIN);
  assert.equal(kv.puts, 1);
  const stored = kv.data.get(`log:${r.id}`);
  assert.deepEqual(JSON.parse(stored?.value ?? ""), r);
  // The summary beside it: everything but the log, and when it arrived.
  const { log: _log, v: _v, lastHash: _hash, ...rest } = r;
  const meta = stored?.metadata as Record<string, unknown>;
  assert.deepEqual({ ...meta, received: undefined }, { ...rest, received: undefined });
  assert.match(String(meta.received), /^\d{4}-\d\d-\d\dT/);
  const again = await handle(postReq(JSON.stringify(r)), e);
  assert.equal(again.status, 200);
  assert.deepEqual(await again.json(), { ok: true, duplicate: true });
  assert.equal(kv.puts, 1, "no second write");
});

test("POST：別的網域、沒有 Origin 都擋（403），什麼都不存", async () => {
  const kv = new MemoryKV();
  for (const origin of ["https://evil.example", null]) {
    const res = await handle(postReq(JSON.stringify(record()), origin), env(kv));
    assert.equal(res.status, 403);
  }
  assert.equal(kv.puts, 0);
});

test("POST：超過 2 MB 回 413，不存", async () => {
  const kv = new MemoryKV();
  const big = record({ log: `${record().log}${"x".repeat(MAX_BYTES)}` });
  const res = await handle(postReq(JSON.stringify(big)), env(kv));
  assert.equal(res.status, 413);
  assert.equal(kv.puts, 0);
});

test("POST：不是 JSON、欄位不對、紀錄的表頭和欄位對不上，都回 400，不存", async () => {
  const kv = new MemoryKV();
  const bad = [
    "not json",
    JSON.stringify({ ...record(), id: "x" }),
    JSON.stringify({ ...record(), code: "ABCDEFGH" }),
    JSON.stringify({ ...record(), result: "won" }),
    JSON.stringify({ ...record(), ticks: -1 }),
    JSON.stringify({ ...record(), lastHash: { tick: 5, hash: "zz" } }),
    JSON.stringify({ ...record(), log: "" }),
    JSON.stringify({ ...record(), log: "not a header\n" }),
    JSON.stringify({ ...record(), protocol: 6 }),
    JSON.stringify({ ...record(), name: undefined, v: 2 }),
  ];
  for (const body of bad) {
    const res = await handle(postReq(body), env(kv));
    assert.equal(res.status, 400, body.slice(0, 60));
  }
  assert.equal(kv.puts, 0);
});

test("POST：KV 寫不進去（例如當天的寫入額度用完）回 503，手機之後再傳", async () => {
  const kv = new MemoryKV();
  kv.failPut = true;
  const res = await handle(postReq(JSON.stringify(record())), env(kv));
  assert.equal(res.status, 503);
});

test("讀取：沒帶金鑰或金鑰錯 401；沒設金鑰 503；帶對的金鑰可以列出摘要、下載整筆", async () => {
  const kv = new MemoryKV();
  const a = record();
  const b = record({ result: "loss", reason: "surrender" });
  for (const r of [a, b]) assert.equal((await handle(postReq(JSON.stringify(r)), env(kv))).status, 201);

  assert.equal((await handle(getReq("/logs", null), env(kv))).status, 401);
  assert.equal((await handle(getReq("/logs", "wrong-key"), env(kv))).status, 401);
  assert.equal((await handle(getReq(`/logs/${a.id}`, "wrong-key"), env(kv))).status, 401);
  assert.equal((await handle(getReq("/logs"), { ...env(kv), READ_KEY: undefined })).status, 503);

  const listed = await handle(getReq("/logs"), env(kv));
  assert.equal(listed.status, 200);
  const page = (await listed.json()) as { logs: { id: string; result: string; code: string }[]; cursor: string | null };
  assert.deepEqual(page.logs.map((l) => [l.id, l.result, l.code]), [[a.id, "win", "ab12cd34"], [b.id, "loss", "ab12cd34"]]);
  assert.equal(page.cursor, null);

  const one = await handle(getReq(`/logs/${b.id}`), env(kv));
  assert.equal(one.status, 200);
  assert.deepEqual(await one.json(), b);
  assert.equal((await handle(getReq("/logs/00000000-0000-4000-8000-999999999999"), env(kv))).status, 404);
});

test("讀取：超過 1,000 筆時分頁，用 cursor 拿下一頁", async () => {
  const kv = new MemoryKV();
  for (let i = 0; i < 1001; i++) {
    const r = record();
    kv.data.set(`log:${r.id}`, { value: JSON.stringify(r), metadata: { id: r.id } });
  }
  const first = (await (await handle(getReq("/logs"), env(kv))).json()) as { logs: unknown[]; cursor: string | null };
  assert.equal(first.logs.length, 1000);
  assert.notEqual(first.cursor, null);
  const second = (await (await handle(getReq(`/logs?cursor=${first.cursor}`), env(kv))).json()) as { logs: unknown[]; cursor: string | null };
  assert.equal(second.logs.length, 1);
  assert.equal(second.cursor, null);
});

test("其他路徑 404；預檢只回給試玩頁的網域", async () => {
  assert.equal((await handle(getReq("/"), env())).status, 404);
  const pre = (origin: string) => new Request("https://w.example/logs", { method: "OPTIONS", headers: { origin } });
  assert.equal((await handle(pre(ORIGIN), env())).status, 204);
  assert.equal((await handle(pre("https://evil.example"), env())).status, 403);
});

test("紀錄格式：手機產生的每一種結果都合格；表頭的協定或場景和欄位不同就不合格", () => {
  for (const result of ["win", "loss", "draw", "abandoned"] as const) {
    assert.equal(typeof checkRecord(record({ result, reason: result === "abandoned" ? "" : "surrender" })), "object");
  }
  assert.equal(typeof checkRecord(record({ lastHash: null })), "object");
  assert.equal(checkRecord(record({ scenario: "e2e" })), "log header");
});

test("fetch.ts：用讀取金鑰把還沒下載的紀錄抓到資料夾，寫 index.json；再跑一次不重抓；--code 只留一支手機的", async () => {
  const { mkdtempSync, readdirSync, readFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { download, parseEnv } = await import("../fetch.ts");
  const kv = new MemoryKV();
  const mine = record();
  const other = record({ code: "zz99yy88" });
  for (const r of [mine, other]) assert.equal((await handle(postReq(JSON.stringify(r)), env(kv))).status, 201);
  const viaWorker = (url: string, init?: RequestInit) => handle(new Request(url, init), env(kv));
  const out = mkdtempSync(join(tmpdir(), "game-logs-"));
  const url = "https://war-game-logs.example.workers.dev";
  assert.deepEqual(await download({ url, key: KEY, out, code: "" }, viaWorker), { listed: 2, kept: 2, fetched: 2 });
  assert.deepEqual(JSON.parse(readFileSync(join(out, `${mine.id}.json`), "utf8")), mine);
  assert.equal(readFileSync(join(out, `${mine.id}.jsonl`), "utf8"), mine.log, "the log alone, for headless --replay");
  assert.deepEqual(await download({ url, key: KEY, out, code: "" }, viaWorker), { listed: 2, kept: 2, fetched: 0 });
  const one = mkdtempSync(join(tmpdir(), "game-logs-"));
  assert.deepEqual(await download({ url, key: KEY, out: one, code: "ab12cd34" }, viaWorker), { listed: 2, kept: 1, fetched: 1 });
  assert.deepEqual(readdirSync(one).sort(), [`${mine.id}.json`, `${mine.id}.jsonl`, "index.json"].sort());
  await assert.rejects(download({ url, key: "wrong", out, code: "" }, viaWorker), /401/);
  assert.deepEqual(parseEnv("# saved by the deployment steps\nGAME_LOGS_URL=https://x.workers.dev\nGAME_LOGS_READ_KEY='abc'\n\n"), { GAME_LOGS_URL: "https://x.workers.dev", GAME_LOGS_READ_KEY: "abc" });
});
