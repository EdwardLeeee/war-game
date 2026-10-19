// 繼續上一局 (D-083) on core's real simulation: a game kept on the phone when the page goes to
// the background is offered on the start screen after a reload; the simulation runs it again up
// to where it was (progress on the start screen), the screen comes back as it was (groups,
// camera, speed), paused, and the game goes on: its log is the old one with more after it and
// replays in the simulation alone to the hash the game published. Played on another simulation
// (the site updated), it cannot go on; a log that does not play back the same says so.

import { expect, type Page, test } from "@playwright/test";
import { replay } from "../../sim/src/browser-replay.ts";
import type { GameRecord } from "../../services/game-logs/src/record.ts";
import { saveGroup, selectForCommands, shot } from "./helpers.ts";

const LOGS = "https://game-logs.test/logs";
const GROUP_1 = ".groups > button:nth-child(1)";

/** Console errors and page errors. */
function watchErrors(page: Page): () => void {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });
  return () => expect(errors, "page errors").toEqual([]);
}

/** Answers uploads with 201 and keeps their bodies. */
async function catchUploads(page: Page): Promise<string[]> {
  const bodies: string[] = [];
  await page.route(LOGS, async (route) => {
    bodies.push(route.request().postData() ?? "");
    await route.fulfill({ status: 201, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ ok: true }) });
  });
  return bodies;
}

const QUERY = `?test=1&scenario=e2e&tps=400&logs=${encodeURIComponent(LOGS)}`;
const header = (page: Page) => page.evaluate(() => window.__proto?.game?.header() ?? { tick: -1, paused: false, speed: 0, scenario: -1 });
const saved = (page: Page) => page.evaluate(async () => (await window.__proto?.saved()) ?? null);
const groups = (page: Page) => page.evaluate(() => window.__proto?.game?.groupInfo() ?? []);
const camera = (page: Page) => page.evaluate(() => window.__proto?.game?.camera() ?? null);

/** The page goes to the background (or comes back), as when the phone is put away. */
async function visibility(page: Page, state: "hidden" | "visible"): Promise<void> {
  await page.evaluate((s) => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => s });
    document.dispatchEvent(new Event("visibilitychange"));
  }, state);
}

async function pause(page: Page): Promise<void> {
  await page.getByRole("button", { name: "暫停", exact: true }).tap();
  await expect.poll(async () => (await header(page)).paused).toBe(true);
}

/** A game of more than a minute, our soldiers in 編隊 1, the camera moved; then away: kept for 繼續上一局. */
async function playAndPutAway(page: Page, ticks = 1300, culture: "東陸" | "西陸" | null = null): Promise<{ tick: number; group: number[] }> {
  await page.goto(`./${QUERY}`);
  if (culture !== null) await page.getByRole("radiogroup", { name: "你的陸" }).getByRole("radio", { name: culture }).tap();
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true);
  const group = await page.evaluate(() => {
    const g = window.__proto?.game;
    const me = g?.me();
    return (g?.units() ?? []).filter((u) => u.owner === me && u.type !== 0).map((u) => u.id).sort((a, b) => a - b);
  });
  expect(group.length).toBeGreaterThan(0);
  await selectForCommands(page, group);
  await saveGroup(page, GROUP_1);
  await page.evaluate(() => window.__proto?.game?.centerOn(30, 40, 1.4));
  await expect.poll(async () => (await header(page)).tick, { timeout: 60_000 }).toBeGreaterThan(ticks);
  await pause(page);
  await visibility(page, "hidden");
  await expect.poll(async () => (await saved(page))?.tick ?? -1, { timeout: 15_000 }).toBeGreaterThan(ticks);
  return { tick: (await saved(page))?.tick ?? -1, group };
}

test("繼續上一局：切到背景存起來，重新載入後開局畫面有「繼續上一局」；快轉回原來的地方，編隊、鏡頭還原，停在暫停；接著打，紀錄接在原來的後面，重播的雜湊一樣；手機上這局只留一筆（D-083）", async ({ page }, info) => {
  test.setTimeout(240_000);
  const check = watchErrors(page);
  const bodies = await catchUploads(page);
  // Played as 西陸 (the user 2026-10-19: 你的陸).
  const { tick, group } = await playAndPutAway(page, 1300, "西陸");
  expect(await page.evaluate(() => window.__proto?.game?.culture())).toBe("w");
  // 自動訓練 (on for the person) may have added new soldiers to the group by now.
  const before = { groups: await groups(page), camera: await camera(page) };
  const kept = await saved(page);
  if (kept === null) throw new Error("nothing kept");
  expect(kept.screen.army.groups[0].ids).toEqual(before.groups[0].ids);
  expect(before.groups[0].ids).toEqual(expect.arrayContaining(group));
  // The background save went up as well (D-083 PR A).
  await expect.poll(() => bodies.length, { timeout: 15_000 }).toBe(1);

  await page.reload();
  const resume = page.getByRole("button", { name: /^繼續上一局（第 \d+ 分）$/ });
  await expect(resume).toBeVisible();
  await expect(resume).toHaveText(`繼續上一局（第 ${Math.floor(tick / 1200)} 分）`);
  await expect(resume).toBeEnabled();
  await shot(page, info, "d083-continue-start");
  // The start screen's 你的陸 changed since: the game goes on as it was played.
  await page.getByRole("radiogroup", { name: "你的陸" }).getByRole("radio", { name: "東陸" }).tap();
  await resume.tap();
  await page.waitForFunction(() => window.__proto?.ready === true && window.__proto.screen === "battle", null, { timeout: 60_000 });
  expect(await page.evaluate(() => window.__proto?.game?.culture()), "as it was played").toBe("w");
  // Where it was, paused, its screen as it was.
  const h = await header(page);
  expect(h.paused).toBe(true);
  expect(h.tick).toBe(tick);
  await expect(page.getByRole("button", { name: "繼續", exact: true })).toBeVisible();
  expect(await groups(page)).toEqual(before.groups);
  const cam = await camera(page);
  expect(cam?.scale).toBeCloseTo(before.camera?.scale ?? 0, 3);
  expect(Math.abs((cam?.x ?? 0) - (before.camera?.x ?? 0))).toBeLessThan(2);
  expect(Math.abs((cam?.y ?? 0) - (before.camera?.y ?? 0))).toBeLessThan(2);
  await expect(page.locator(GROUP_1)).toContainText(`${before.groups[0].ids.length}/${before.groups[0].saved}`);

  // On: the same game goes further, then ends.
  await page.getByRole("button", { name: "繼續", exact: true }).tap();
  await expect.poll(async () => (await header(page)).tick, { timeout: 30_000 }).toBeGreaterThan(tick + 600);
  await page.getByRole("button", { name: "選單" }).tap();
  await page.getByRole("button", { name: "投降" }).tap();
  await page.getByRole("dialog").getByRole("button", { name: "投降" }).tap();
  await expect(page.getByRole("dialog", { name: "失敗" })).toBeVisible();
  await expect.poll(() => bodies.length, { timeout: 20_000 }).toBe(2);
  const rec = JSON.parse(bodies[1]) as GameRecord;
  expect(rec.result).toBe("loss");
  expect(rec.log.startsWith(kept.log), "the log goes on after the old one").toBe(true);
  expect(rec.log.length).toBeGreaterThan(kept.log.length);
  const last = rec.lastHash;
  if (last === null) throw new Error("no state hash in the record");
  expect(last.tick).toBeGreaterThan(tick);
  const replayed = replay(rec.log, last.tick).find((x) => x.tick === last.tick);
  expect(replayed?.hash, "the log played in the simulation alone").toBe(last.hash);
  // One entry for the game on the phone, and nothing left to go on with.
  await expect.poll(async () => (await page.evaluate(async () => (await window.__proto?.logs()) ?? [])).map((e) => e.rec.result)).toEqual(["loss"]);
  await expect.poll(() => saved(page)).toBeNull();
  check();
});

/** Changes the game kept on the phone, as another simulation or a damaged log would leave it. */
async function spoilSave(page: Page, what: "build" | "hash" | "screen"): Promise<void> {
  await page.evaluate(async (w) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open("war-game-continue", 1);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const store = () => db.transaction("game", "readwrite").objectStore("game");
    const s = await new Promise<{ build: string; hashes: { tick: number; hash: string }[]; screenVersion: number }>((resolve) => {
      const r = store().get("last");
      r.onsuccess = () => resolve(r.result);
    });
    // The site updated (another simulation), the hash at 1:00 (tick 1200) does not match, or
    // the screen's part is in another format (the screen alone updated).
    if (w === "build") s.build = "000000000000";
    else if (w === "screen") s.screenVersion = 999;
    else s.hashes = s.hashes.map((h) => (h.tick === 1200 ? { ...h, hash: "00000000" } : h));
    await new Promise((resolve) => {
      const r = store().put(s, "last");
      r.onsuccess = () => resolve(null);
    });
    db.close();
  }, what);
}

test("網站已經更新（模擬的 build 不同）：「繼續上一局」變灰，寫明不能繼續，開始是主要按鈕；開新局就清掉存的那一局（D-083）", async ({ page }, info) => {
  test.setTimeout(120_000);
  const check = watchErrors(page);
  await catchUploads(page);
  await playAndPutAway(page);
  await spoilSave(page, "build");
  await page.reload();
  const resume = page.getByRole("button", { name: /^繼續上一局/ });
  await expect(resume).toBeVisible();
  await expect(resume).toBeDisabled();
  await expect(page.locator("#continue-note")).toHaveText("網站已經更新，這一局不能繼續");
  await expect(page.locator("#start-game")).not.toHaveClass(/secondary/);
  await shot(page, info, "d083-continue-blocked");
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true);
  await expect.poll(() => saved(page)).toBeNull();
  check();
});

test("只有畫面改版（畫面狀態的格式不同，模擬一樣）：照樣接著打，停在暫停，不還原編隊，提示「編隊沒有還原，請重新編」（ceo 2026-10-17）", async ({ page }) => {
  test.setTimeout(120_000);
  const check = watchErrors(page);
  await catchUploads(page);
  const { tick } = await playAndPutAway(page);
  await spoilSave(page, "screen");
  await page.reload();
  const resume = page.getByRole("button", { name: /^繼續上一局/ });
  await expect(resume).toBeEnabled();
  // Every line the message strips show (one shows for 2.2 s; a busy CI may look later than that).
  await page.evaluate(() => {
    const w = window as unknown as { said: string[] };
    w.said = [];
    new MutationObserver(() => {
      // Seen: not hidden, and not inside the battlefield's buttons hidden while the game is run again.
      for (const el of document.querySelectorAll<HTMLElement>("[role=status]")) {
        const seen = !el.hidden && getComputedStyle(el).visibility !== "hidden";
        if (seen && el.textContent !== null && !w.said.includes(el.textContent)) w.said.push(el.textContent);
      }
    }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
  });
  await resume.tap();
  await page.waitForFunction(() => window.__proto?.ready === true && window.__proto.screen === "battle", null, { timeout: 60_000 });
  await expect.poll(() => page.evaluate(() => (window as unknown as { said: string[] }).said)).toContain("編隊沒有還原，請重新編");
  const h = await header(page);
  expect(h.paused).toBe(true);
  expect(h.tick).toBe(tick);
  expect((await groups(page))[0].ids).toEqual([]);
  // And on it goes.
  await page.getByRole("button", { name: "繼續", exact: true }).tap();
  await expect.poll(async () => (await header(page)).tick, { timeout: 30_000 }).toBeGreaterThan(tick + 200);
  check();
});

test("紀錄對不上（雜湊不同）：快轉停在那裡，開局畫面寫「紀錄對不上（第 1 分）」，存的那一局清掉，可以開新局（D-083）", async ({ page }) => {
  test.setTimeout(120_000);
  const check = watchErrors(page);
  await catchUploads(page);
  await playAndPutAway(page);
  await spoilSave(page, "hash");
  await page.reload();
  const resume = page.getByRole("button", { name: /^繼續上一局/ });
  await expect(resume).toBeEnabled();
  await expect(page.locator("#start-game")).toHaveClass(/secondary/);
  await resume.tap();
  await expect(page.locator("#continue-note")).toHaveText("紀錄對不上（第 1 分），這一局不能繼續", { timeout: 30_000 });
  await expect(resume).toBeHidden();
  await expect(page.locator("#continue-progress")).toBeHidden();
  await expect(page.getByRole("button", { name: "開始" })).toBeVisible();
  expect(await page.evaluate(() => window.__proto?.screen)).toBe("start");
  await expect.poll(() => saved(page)).toBeNull();
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true);
  check();
});

/**
 * An 80-minute game as core's continue-bench plays it (the scripted player defending against
 * the easy AI, so the game lasts), saved as export_log would at `ticks`, for the page's build.
 */
async function longGame(ticks: number): Promise<{ log: string; hashes: { tick: number; hash: string }[]; tick: number; build: string }> {
  const { createScriptedPlayer, planFor, SCRIPTED_THINK_EVERY } = await import("../../sim/src/ai/scripted-player.ts");
  const { hex8 } = await import("../../sim/src/core/fixed.ts");
  const { rules } = await import("../../sim/src/core/rules.ts");
  const { Runner } = await import("../../sim/src/runner.ts");
  const { buildView, mapInfo } = await import("../../sim/src/view/view.ts");
  const { simBuild } = await import("../scripts/sim-build.ts");
  const build = (await simBuild()).id;
  const r = new Runner({ seed: 1, scenario: "standard", ai: [false, true], maxTicks: 0, difficulty: ["normal", "easy"], autoTrain: [true, false], build });
  const w = r.game.w;
  const plan = { ...planFor("defend", "eco", "all"), counterAt: 9999, pushAt: 0 };
  const player = createScriptedPlayer(0, { map: mapInfo(w.map, 0), rules: rules(w.map), frame: w.map.frames[0] }, plan);
  let seq = 0;
  while (!r.over && r.game.tick < ticks) {
    if (r.game.tick % SCRIPTED_THINK_EVERY === 0) for (const body of player.think(buildView(r.game, 0))) r.command(0, { ...body, seq: seq++ } as never);
    r.tick();
  }
  const log = [JSON.stringify(r.header([false, true])), ...r.game.log.map((c) => JSON.stringify(c))].join("\n") + "\n";
  return { log, hashes: r.hashes.map((h) => ({ tick: h.tick, hash: hex8(h.hash) })), tick: r.game.tick, build };
}

test("量測（CI 的數字，不是 iPhone）：80 分鐘的局快轉要多久、進度和取消；之後存一次，主執行緒花多久（D-083）", async ({ page, browserName }, info) => {
  test.skip(browserName !== "chromium", "one browser is enough for the numbers; the screenshot is Chromium's");
  test.setTimeout(600_000);
  await catchUploads(page);
  const t0 = Date.now();
  const game = await longGame(96_000);
  const playMs = Date.now() - t0;
  expect(game.tick).toBe(96_000);
  const { ArmyBook } = await import("../src/game/army.ts");
  const { GroupAlarms } = await import("../src/game/alarm.ts");
  const { SCREEN_VERSION } = await import("../src/save/save.ts");
  await page.goto(`./${QUERY}`);
  expect(await page.evaluate(() => window.__proto?.simBuild)).toBe(game.build);
  const protocol = (JSON.parse(game.log.split("\n")[0]) as { protocol: number }).protocol;
  const save = {
    savedAt: Date.now(),
    commit: "test",
    protocol,
    build: game.build,
    game: "measure",
    init: { seed: 1, scenario: "standard", difficulty: "easy", map: "fixed", maxTicks: 0, enemyAi: true },
    log: game.log,
    hashes: game.hashes,
    tick: game.tick,
    screenVersion: SCREEN_VERSION,
    screen: { army: new ArmyBook().save(), alarms: new GroupAlarms().save(), charges: [], camera: null, speed: "normal", seq: 1, recruitMessageTick: null },
  };
  await page.evaluate(async (s) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open("war-game-continue", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("game");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    await new Promise((resolve) => {
      const r = db.transaction("game", "readwrite").objectStore("game").put(s, "last");
      r.onsuccess = () => resolve(null);
    });
    db.close();
  }, save);
  await page.reload();
  const resume = page.getByRole("button", { name: "繼續上一局（第 80 分）" });
  await expect(resume).toBeEnabled();

  // The progress, then 取消: back to the start screen, the game still kept.
  await resume.tap();
  const text = page.locator("#continue-progress-text");
  await expect(text).toHaveText(/^快轉中：第 ([2-9]|[1-7]\d)／80 分$/, { timeout: 120_000 });
  await shot(page, info, "d083-continue-progress");
  await page.getByRole("button", { name: "取消" }).tap();
  await expect(page.locator("#continue-progress")).toBeHidden();
  await expect(resume).toBeEnabled();
  expect((await saved(page))?.tick).toBe(96_000);

  // The whole way.
  const t1 = Date.now();
  await resume.tap();
  await page.waitForFunction(() => window.__proto?.ready === true && window.__proto.screen === "battle", null, { timeout: 300_000 });
  const continueMs = Date.now() - t1;
  expect((await header(page)).tick).toBe(96_000);

  // A save of the 80-minute game: what it costs the page's main thread.
  await page.evaluate(() => {
    const w = window as unknown as { longTasks: number[] };
    w.longTasks = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) w.longTasks.push(e.duration);
    }).observe({ type: "longtask" });
  });
  await page.getByRole("button", { name: "繼續", exact: true }).tap();
  await expect.poll(async () => (await header(page)).tick, { timeout: 60_000 }).toBeGreaterThan(96_200);
  await pause(page);
  // Long tasks over 2 s, paused: without a save (CI's software drawing makes frames long by
  // themselves), then from the save on. The save's own share is buildMs and putMs.
  const longTasks = async (): Promise<number[]> => {
    await page.evaluate(() => {
      (window as unknown as { longTasks: number[] }).longTasks = [];
    });
    await page.waitForTimeout(2000);
    return page.evaluate(() => (window as unknown as { longTasks: number[] }).longTasks);
  };
  const withoutSave = await longTasks();
  const during = longTasks();
  await visibility(page, "hidden");
  await expect.poll(() => page.evaluate(() => window.__proto?.lastSave?.tick ?? 0), { timeout: 30_000 }).toBeGreaterThan(96_000);
  const withSave = await during;
  const cost = await page.evaluate(() => window.__proto?.lastSave);
  const numbers = { playInNodeMs: playMs, logKB: Math.round(game.log.length / 1024), hashes: game.hashes.length, continueInBrowserMs: continueMs, save: cost, longTasks2sWithoutSaveMs: withoutSave, longTasks2sFromSaveMs: withSave };
  info.annotations.push({ type: "d083-measure", description: JSON.stringify(numbers) });
  await info.attach("d083-measure.json", { body: JSON.stringify(numbers, null, 2), contentType: "application/json" });
  console.log(`D083 MEASURE ${JSON.stringify(numbers)}`);
  expect(cost?.logBytes).toBeGreaterThan(150_000);
});
