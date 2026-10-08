// 隨機地圖 (D-074) on core's real simulation. Watched (?test=1&watch=1: the computer plays
// both sides and the page sees the whole map) and played by a person (since the AI scouts,
// #176): at the start only home is known; villagers sent out bring towns and rocks into view.
// Frame times on the random map are measured beside the fixed map's, the same page for the same
// time (ceo: 129 × 129 is 1.8 times the cells of 96 × 96; the phone must not get slower):
// watched, and played with the same scouting orders, where every rock explored paints the
// ground again. These are this runner's numbers, not the iPhone's.

import { expect, type Page, test } from "@playwright/test";
import { shot, watchErrors } from "./helpers.ts";

const MAIN_CITY = 0;
const FARMER = 0;
// The scouting measurement plays this seed: its random map has rocks along the scouts' ways
// (seeds 1–10 tried: 0–18 rock cells found in 20 seconds, this one 55), so the ground is painted
// again within the window on every run (a fresh seed found none on CI's WebKit once, run 37730054591).
const SCOUT_SEED = 8;
// The person's game plays this seed: a scout meets a town by tick 559 (seeds 2, 3, 6, 8, 10 tried:
// 555–1171); with a fresh seed CI's WebKit once found none in 60 seconds (run 37732088471).
const PLAY_SEED = 6;

let checkErrors: () => void;

test.beforeEach(({ page }) => {
  checkErrors = watchErrors(page);
});

test.afterEach(() => {
  checkErrors();
});

async function watch(page: Page, map: "fixed" | "random", tps = 30): Promise<void> {
  await page.goto(`./?test=1&watch=1&map=${map}&tps=${tps}`);
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true);
}

const tick = (page: Page) => page.evaluate(() => window.__proto?.game?.header().tick ?? -1);
const knownTowns = (page: Page) => page.evaluate(() => window.__proto?.game?.knownTowns() ?? []);
const knownRocks = (page: Page) => page.evaluate(() => window.__proto?.game?.knownRocks() ?? 0);
const round = (v: number | undefined) => Math.round((v ?? 0) * 100) / 100;

/** A person plays (player 0) on this map; with a seed, the same map every run. */
async function play(page: Page, map: "fixed" | "random", tps: number, seed?: number): Promise<void> {
  await page.goto(`./?test=1&map=${map}&tps=${tps}${seed === undefined ? "" : `&seed=${seed}`}`);
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true);
}

/**
 * Our five villagers sent out to look (撤退: straight on, past whatever they meet): to the middle
 * of the map, along both sides from home, and to the far ends of those sides. The same orders
 * on either map, worked out from home and the map's size.
 */
async function scout(page: Page): Promise<number> {
  const size = await page.evaluate(() => window.__proto?.game?.mapSize() ?? 0);
  const home = await page.evaluate(() => window.__proto?.game?.home() ?? null);
  const me = await page.evaluate(() => window.__proto?.game?.me() ?? 0);
  if (home === null || size === 0) throw new Error("no home");
  const villagers = (await page.evaluate(() => window.__proto?.game?.units() ?? [])).filter((u) => u.owner === me && u.type === FARMER).map((u) => u.id);
  expect(villagers.length, "villagers to send").toBeGreaterThanOrEqual(3);
  const c = size >> 1;
  const clamp = (v: number) => Math.min(size - 2, Math.max(1, Math.round(v)));
  const far = (h: number) => 2 * c - h;
  const targets = [
    { x: c, y: c },
    { x: c, y: home.cy },
    { x: home.cx, y: c },
    { x: far(home.cx), y: home.cy },
    { x: home.cx, y: far(home.cy) },
  ].map((t) => ({ x: clamp(t.x), y: clamp(t.y) }));
  for (let i = 0; i < villagers.length && i < targets.length; i++) {
    const t = targets[i];
    await page.evaluate(([id, x, y]) => window.__proto?.game?.send({ c: "retreat", u: [id], x, y }), [villagers[i], t.x, t.y] as const);
  }
  return Math.min(villagers.length, targets.length);
}

test("觀戰隨機地圖：模擬接受、開始跑；觀戰看得到整張圖的城鎮和岩石", async ({ page }) => {
  await watch(page, "random", 100);
  expect(await page.evaluate(() => window.__proto?.game?.mapMode())).toBe("random");
  expect(await page.evaluate(() => window.__proto?.game?.init())).toMatchObject({ human: null, ai: [true, true], map: "random" });
  const t0 = await tick(page);
  await expect.poll(() => tick(page), { timeout: 30_000 }).toBeGreaterThan(t0 + 200);
  // Watching, every town of the map comes with its row (core #172: 7 towns), and the rocks with the grid.
  await expect.poll(async () => (await page.evaluate(() => window.__proto?.game?.knownTowns() ?? [])).length, { timeout: 30_000 }).toBe(7);
  await expect.poll(() => page.evaluate(() => window.__proto?.game?.knownRocks() ?? 0), { timeout: 30_000 }).toBeGreaterThan(0);
});

test("人類玩家玩隨機地圖（偵察 #176 之後）：開局只知道自己家，看不到敵方主城；派村民去探，城鎮和岩石才出現在畫面和小地圖上", async ({ page }, info) => {
  test.setTimeout(240_000);
  await play(page, "random", 100, PLAY_SEED);
  expect(await page.evaluate(() => window.__proto?.game?.mapMode())).toBe("random");
  expect(await page.evaluate(() => window.__proto?.game?.init())).toMatchObject({ human: 0, map: "random" });
  const me = await page.evaluate(() => window.__proto?.game?.me() ?? -1);
  const all = await page.evaluate(() => window.__proto?.game?.buildings() ?? []);
  expect(all.some((b) => b.owner === me && b.type === MAIN_CITY), "our main city").toBe(true);
  expect(all.some((b) => b.owner !== me && b.type === MAIN_CITY), "no enemy main city at the start").toBe(false);
  const towns0 = await knownTowns(page);
  const rocks0 = await knownRocks(page);
  expect(towns0.length, "towns known at the start (core #172: 7 on the map)").toBeLessThan(7);
  await scout(page);
  await expect.poll(async () => (await knownTowns(page)).length, { timeout: 120_000 }).toBeGreaterThan(towns0.length);
  await expect.poll(() => knownRocks(page), { timeout: 60_000 }).toBeGreaterThan(rocks0);
  // Each town now known stands where the page knows it, from its row (cellX, cellY, size).
  const found = (await page.evaluate(() => window.__proto?.game?.towns() ?? [])).filter((t) => !towns0.includes(t.id));
  expect(found.length).toBeGreaterThan(0);
  const town = found[0];
  await page.getByRole("button", { name: "暫停", exact: true }).tap();
  await expect.poll(async () => (await page.evaluate(() => window.__proto?.game?.header().paused)) === true).toBe(true);
  await page.evaluate(([x, y]) => window.__proto?.game?.centerOn(x, y), [town.cx, town.cy] as const);
  await shot(page, info, "random-human-scouted");
});

test("畫面量測：人類玩家在固定地圖和隨機地圖下同樣的偵察指令，各 20 秒；隨機地圖每探到岩石就重畫地面（這台 CI 的數字，不是 iPhone）", async ({ page }, info) => {
  test.setTimeout(150_000);
  const rows: Record<string, unknown>[] = [];
  for (const map of ["fixed", "random"] as const) {
    await play(page, map, 30, SCOUT_SEED);
    const sent = await scout(page);
    const rocks0 = await knownRocks(page);
    await page.evaluate(() => window.__proto?.game?.frameTimes(true));
    await page.evaluate(() => window.__proto?.game?.terrainRepaints(true));
    await page.waitForTimeout(20_000);
    const s = await page.evaluate(() => window.__proto?.game?.frameTimes(false));
    const r = await page.evaluate(() => window.__proto?.game?.terrainRepaints(false));
    expect(s?.frames ?? 0, `${map}: frames drawn`).toBeGreaterThan(50);
    rows.push({
      map,
      seed: SCOUT_SEED,
      scouts: sent,
      rocksLearned: (await knownRocks(page)) - rocks0,
      frames: s?.frames,
      fpsFromMedian: round(s?.fps),
      gapMedianMs: round(s?.gapMedian),
      gapP95Ms: round(s?.gapP95),
      drawMedianMs: round(s?.drawMedian),
      drawP95Ms: round(s?.drawP95),
      drawMaxMs: round(s?.drawMax),
      terrainRepaints: r?.count,
      repaintMeanMs: round((r?.count ?? 0) > 0 ? (r?.totalMs ?? 0) / (r?.count ?? 1) : 0),
      repaintMaxMs: round(r?.maxMs),
    });
    if (map === "random") expect(r?.count ?? 0, "the ground painted again while scouting").toBeGreaterThan(0);
  }
  const text = JSON.stringify({ browser: info.project.name, viewport: page.viewportSize(), rows }, null, 2);
  console.log(`scouting frame times ${text}`);
  await info.attach("scouting-frame-times", { body: text, contentType: "application/json" });
});

test("畫面量測：觀戰固定地圖和隨機地圖各 20 秒，一格的間隔和畫一格的時間並列（這台 CI 的數字，不是 iPhone）", async ({ page }, info) => {
  test.setTimeout(150_000);
  const rows: Record<string, unknown>[] = [];
  for (const map of ["fixed", "random"] as const) {
    await watch(page, map);
    // Let the page settle, then one window over the same span of play.
    await page.waitForTimeout(3_000);
    await page.evaluate(() => window.__proto?.game?.frameTimes(true));
    await page.waitForTimeout(20_000);
    const s = await page.evaluate(() => window.__proto?.game?.frameTimes(false));
    expect(s?.frames ?? 0, `${map}: frames drawn`).toBeGreaterThan(50);
    rows.push({ map, frames: s?.frames, fpsFromMedian: round(s?.fps), gapMedianMs: round(s?.gapMedian), gapP95Ms: round(s?.gapP95), drawMedianMs: round(s?.drawMedian), drawP95Ms: round(s?.drawP95), drawMaxMs: round(s?.drawMax) });
  }
  const text = JSON.stringify({ browser: info.project.name, viewport: page.viewportSize(), rows }, null, 2);
  console.log(`map frame times ${text}`);
  await info.attach("map-frame-times", { body: text, contentType: "application/json" });
});
