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
async function playAndPutAway(page: Page, ticks = 1300): Promise<{ tick: number; group: number[] }> {
  await page.goto(`./${QUERY}`);
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
  const { tick, group } = await playAndPutAway(page);
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
  await resume.tap();
  await page.waitForFunction(() => window.__proto?.ready === true && window.__proto.screen === "battle", null, { timeout: 60_000 });
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
