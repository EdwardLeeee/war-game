// 有新版本 (D-042): the page reads the deployed build's commit past every cache and tells the
// player when it is another one.

import assert from "node:assert/strict";
import { test } from "node:test";
import { deployedCommit, isNewer, updateHref } from "../src/version.ts";

const answer = (body: unknown, ok = true) =>
  (async () => ({ ok, json: async () => body }) as Response) as unknown as typeof fetch;

test("有新版本：版本檔的 commit 和頁面不同才算；讀不到時不算", () => {
  assert.equal(isNewer("40eb6c3", "40eb6c3"), false);
  assert.equal(isNewer("40eb6c3", "7a8b202"), true);
  assert.equal(isNewer("40eb6c3", null), false);
});

test("讀版本檔：每次都繞過快取；檔案不在、格式不對、網路錯誤時當作沒有", async () => {
  const asked: { url?: string; init?: RequestInit } = {};
  const fetchFn = (async (url: string, init?: RequestInit) => {
    asked.url = url;
    asked.init = init;
    return { ok: true, json: async () => ({ commit: "7a8b202" }) } as Response;
  }) as unknown as typeof fetch;
  assert.equal(await deployedCommit(fetchFn), "7a8b202");
  assert.equal(asked.init?.cache, "no-store");
  assert.match(asked.url ?? "", /^version\.json\?t=\d+$/, "relative to the page, with a fresh query");
  assert.equal(await deployedCommit(answer({}, false)), null, "404 (vite dev has no version.json)");
  assert.equal(await deployedCommit(answer({ commit: 7 })), null);
  assert.equal(await deployedCommit(answer({ commit: "" })), null);
  assert.equal(await deployedCommit(answer(null)), null);
  const broken = (async () => {
    throw new TypeError("offline");
  }) as unknown as typeof fetch;
  assert.equal(await deployedCommit(broken), null);
});

test("更新：帶著新的 commit 換到新網址，原本的參數都留著（舊的 index.html 可能還在快取裡）", () => {
  assert.equal(updateHref("https://example.org/war-game/proto/", "7a8b202"), "https://example.org/war-game/proto/?v=7a8b202");
  assert.equal(updateHref("https://example.org/war-game/proto/?test=1&mock=1", "7a8b202"), "https://example.org/war-game/proto/?test=1&mock=1&v=7a8b202");
  // Updating again replaces the old mark.
  assert.equal(updateHref("https://example.org/war-game/proto/?v=40eb6c3&test=1", "7a8b202"), "https://example.org/war-game/proto/?v=7a8b202&test=1");
});
