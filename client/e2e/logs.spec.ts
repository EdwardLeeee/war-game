// 對局紀錄自動收集 (D-056) on core's real simulation: a game that ends is kept on the phone
// and uploaded (here to a URL the test catches, `?test=1&logs=`); the uploaded log replays to
// the same state hash in the simulation alone. Without a URL nothing goes out; a failed
// upload goes when the page opens again; 重來 keeps a game of more than a minute.

import { expect, type Page, test } from "@playwright/test";
import { replay } from "../../sim/src/browser-replay.ts";
import type { GameRecord } from "../../services/game-logs/src/record.ts";
import { tap } from "./touch.ts";

const LOGS = "https://game-logs.test/logs";

/** Console errors and page errors, except the ones a refused upload makes on purpose. */
function watchErrors(page: Page, allow: RegExp | null = null): () => void {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && (allow === null || !allow.test(m.text()))) errors.push(`console: ${m.text()}`);
  });
  return () => expect(errors, "page errors").toEqual([]);
}

/** Answers uploads with the given statuses in turn (the last one repeats) and keeps their bodies. */
async function catchUploads(page: Page, statuses: number[]): Promise<string[]> {
  const bodies: string[] = [];
  await page.route(LOGS, async (route) => {
    bodies.push(route.request().postData() ?? "");
    const status = statuses.length > 1 ? (statuses.shift() as number) : statuses[0];
    await route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ ok: status < 300 }) });
  });
  return bodies;
}

const tick = (page: Page) => page.evaluate(() => window.__proto?.game?.header().tick ?? -1);
const kept = (page: Page) => page.evaluate(async () => (await window.__proto?.logs()) ?? []);

async function start(page: Page, query: string): Promise<void> {
  await page.goto(`./?test=1&scenario=e2e&ai=0&${query}`);
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true);
}

/** Every farmer selected and sent a few cells off with a tap: an order of the player's own in the log. */
async function orderFarmers(page: Page): Promise<void> {
  const target = await page.evaluate(() => {
    const g = window.__proto?.game;
    if (g == null) return null;
    const me = g.me();
    const farmers = g.units().filter((u) => u.owner === me && u.type === 0);
    g.select(farmers.map((u) => u.id));
    return g.openCellNear(farmers[0].cx + 3, farmers[0].cy - 3);
  });
  if (target === null) throw new Error("no open cell near the farmers");
  await tap(page, await page.evaluate(([x, y]) => window.__proto?.game?.cellToScreen(x, y) ?? { x: 0, y: 0 }, [target.x, target.y] as const));
  await expect.poll(() => page.evaluate(() => (window.__proto?.game?.sent().at(-1) as { c?: string } | undefined)?.c)).toBe("move");
}

async function surrender(page: Page): Promise<void> {
  await page.getByRole("button", { name: "選單" }).tap();
  await page.getByRole("button", { name: "投降" }).tap();
  await page.getByRole("dialog").getByRole("button", { name: "投降" }).tap();
  await expect(page.getByRole("dialog", { name: "失敗" })).toBeVisible();
}

test("對局紀錄：投降後存在手機上並上傳；內容是這局的版本、難度、勝負和指令紀錄；用它重播，最後雜湊和這局一樣（D-056）", async ({ page }) => {
  test.setTimeout(120_000);
  const check = watchErrors(page);
  const bodies = await catchUploads(page, [201]);
  await page.goto(`./?test=1&scenario=e2e&ai=0&tps=200&logs=${encodeURIComponent(LOGS)}`);
  // 紀錄代號 on the start screen: 8 random characters kept on this device.
  const code = await page.evaluate(() => window.__proto?.recordCode ?? "");
  expect(code).toMatch(/^[a-z0-9]{8}$/);
  await expect(page.locator("#record-code")).toHaveText(`紀錄代號 ${code}`);
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true);
  await orderFarmers(page);
  const ordered = await tick(page);
  // A few state hashes after the order.
  await expect.poll(() => tick(page), { timeout: 30_000 }).toBeGreaterThan(ordered + 400);
  await surrender(page);

  await expect.poll(() => bodies.length, { timeout: 20_000 }).toBe(1);
  const rec = JSON.parse(bodies[0]) as GameRecord;
  const commit = await page.evaluate(() => window.__proto?.commit);
  expect(rec).toMatchObject({ v: 1, code, commit, scenario: "e2e", difficulty: "easy", result: "loss", reason: "surrender" });
  expect(rec.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(Object.keys(rec).sort(), "nothing else: no account, no device name").toEqual(["code", "commit", "difficulty", "id", "lastHash", "log", "protocol", "reason", "result", "scenario", "ticks", "v"]);
  const lines = rec.log.trim().split("\n");
  expect(JSON.parse(lines[0])).toMatchObject({ protocol: rec.protocol, scenario: "e2e", ai: [false, false] });
  expect(lines.slice(1).map((l) => (JSON.parse(l) as { c: string }).c)).toEqual(expect.arrayContaining(["move", "surrender"]));
  expect(rec.ticks).toBeGreaterThan(ordered + 400);
  // Kept on the phone and marked sent.
  await expect.poll(async () => (await kept(page)).map((e) => [e.id, e.state])).toEqual([[rec.id, "sent"]]);

  // The same log in the simulation alone (no Worker, no page) reaches the same state.
  const last = rec.lastHash;
  if (last === null) throw new Error("no state hash in the record");
  expect(last.tick).toBeGreaterThan(ordered);
  const replayed = replay(rec.log, last.tick).find((h) => h.tick === last.tick);
  expect(replayed?.hash, `replay of ${lines.length - 1} commands to tick ${last.tick}`).toBe(last.hash);
  check();
});

test("對局紀錄：還沒部署收紀錄的網址時，只存在手機上，不傳出去", async ({ page }) => {
  const check = watchErrors(page);
  const out: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST") out.push(r.url());
  });
  await start(page, "tps=200");
  await expect.poll(() => tick(page)).toBeGreaterThan(200);
  await surrender(page);
  await expect.poll(async () => (await kept(page)).map((e) => [e.rec.result, e.state])).toEqual([["loss", "pending"]]);
  expect(out, "nothing posted").toEqual([]);
  check();
});

test("對局紀錄：上傳失敗（503）不顯示錯誤，紀錄留著；下次打開遊戲時再傳，成功就標記已傳", async ({ page }) => {
  const check = watchErrors(page, /status of 503/);
  const bodies = await catchUploads(page, [503, 201]);
  await start(page, `tps=200&logs=${encodeURIComponent(LOGS)}`);
  await expect.poll(() => tick(page)).toBeGreaterThan(200);
  await surrender(page);
  await expect.poll(() => bodies.length, { timeout: 20_000 }).toBe(1);
  await expect.poll(async () => (await kept(page)).map((e) => e.state)).toEqual(["pending"]);
  await expect(page.getByRole("status").filter({ hasText: /上傳|紀錄/ })).toHaveCount(0);
  // The page opens again (the same phone): the waiting record goes up.
  await page.reload();
  await page.waitForFunction(() => window.__proto?.screen === "start");
  await expect.poll(() => bodies.length, { timeout: 20_000 }).toBe(2);
  expect(bodies[1]).toBe(bodies[0]);
  await expect.poll(async () => (await kept(page)).map((e) => e.state)).toEqual(["sent"]);
  check();
});

test("對局紀錄：重來時，打了一分鐘以上的局存成「沒打完」；不到一分鐘就重來的不存", async ({ page }) => {
  test.setTimeout(120_000);
  const check = watchErrors(page);
  await start(page, "tps=400");
  // A minute of game time is 1,200 ticks.
  await expect.poll(() => tick(page), { timeout: 30_000 }).toBeGreaterThan(1300);
  await page.getByRole("button", { name: "選單" }).tap();
  await page.getByRole("button", { name: "重來（開新的一局）" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true && (window.__proto?.game?.header().tick ?? 9999) < 1000);
  await expect.poll(async () => (await kept(page)).map((e) => [e.rec.result, e.rec.reason, e.state])).toEqual([["abandoned", "", "pending"]]);
  expect((await kept(page))[0].rec.ticks).toBeGreaterThan(1300);
  // Again before a minute of game time: not kept. Paused first, so that a slow runner does
  // not let it pass the minute (dispatch run 37221206636, Chromium: it did at 400 ticks a second).
  await page.getByRole("button", { name: "暫停", exact: true }).tap();
  await expect.poll(() => page.evaluate(() => window.__proto?.game?.header().paused)).toBe(true);
  expect(await tick(page)).toBeLessThan(1200);
  await page.getByRole("button", { name: "選單" }).tap();
  await page.getByRole("button", { name: "重來（開新的一局）" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true);
  await page.waitForTimeout(500);
  expect((await kept(page)).length).toBe(1);
  check();
});
