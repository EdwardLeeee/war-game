// 攻城砲 (D-099, PROTOCOL.md 3.9) on the fake world with siege on (?siege=1, features.siege): the
// engine's stone from it to where it lands (`siege_shot`), and an unseen engine's flying in from
// `from`'s side; dust where it lands; its reach and the ground it cannot shoot (minRange) round it
// when selected; 砲坊 in 建造 (greyed until a range); 剋／怕 for it. Off (every other page): none of it.
// The pictures go to the user with art-v6, when the feature goes on.

import { expect, type Page, test } from "@playwright/test";
import { selectForCommands, shot, watchErrors } from "./helpers.ts";
import { tap } from "./touch.ts";

const SIEGE = 6;
const SIEGE_WORKS = 14;
const units = (page: Page) => page.evaluate(() => window.__proto?.game?.units() ?? []);
const buildings = (page: Page) => page.evaluate(() => window.__proto?.game?.buildings() ?? []);
const siege = (page: Page) => page.evaluate(() => window.__proto?.game?.siege() ?? { shots: 0, rings: 0 });
const centre = (page: Page, x: number, y: number, scale = 1) => page.evaluate(([cx, cy, s]) => window.__proto?.game?.centerOn(cx, cy, s), [x, y, scale] as const);
const at = (page: Page, c: { x: number; y: number }) => page.evaluate(([x, y]) => window.__proto?.game?.cellToScreen(x, y) ?? { x: 0, y: 0 }, [c.x, c.y] as const);

async function start(page: Page, query: string): Promise<void> {
  await page.goto(`./?test=1&mock=1&tps=20${query}`);
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true, null, { timeout: 60_000 });
}

test("攻城砲關著（其他頁面都是）：建造選單沒有砲坊，兵種相剋沒有攻城砲那行", async ({ page }) => {
  const check = watchErrors(page);
  await start(page, "&r7=1");
  await selectForCommands(page, []);
  await page.getByRole("button", { name: "建造" }).tap();
  await expect(page.locator(".cmds").getByRole("button", { name: /^馬廄/ })).toBeVisible();
  await expect(page.locator(".cmds").getByRole("button", { name: /^砲坊/ })).toHaveCount(0);
  expect((await units(page)).some((u) => u.type === SIEGE)).toBe(false);
  check();
});

test("攻城砲（D-099）：石頭從攻城砲飛到落點、看不到的攻城砲的石頭從 from 那邊飛進來；選取時有射程和最短射程兩個圈；剋／怕；建造選單的砲坊要先有射場；砲坊可以訓練攻城砲", async ({ page }, info) => {
  test.setTimeout(300_000);
  const check = watchErrors(page);
  await start(page, "&siege=1&art=x3");
  const me = await page.evaluate(() => window.__proto?.game?.me() ?? 0);
  const engine = (await units(page)).find((u) => u.owner === me && u.type === SIEGE);
  if (engine === undefined) throw new Error("no siege engine");
  // Its stones: one every 3 s at the enemy's barracks, and an unseen engine's by our soldiers.
  await centre(page, 30, 60, 1.3);
  // (One every 30 ticks: CI's Chromium runs the fake world at a few ticks a second with the 3 倍 art, run 39949194910.)
  await expect.poll(async () => (await siege(page)).shots, { timeout: 60_000 }).toBeGreaterThanOrEqual(2);
  // Selected alone: its rings, its two reaches in words (D-115), and its 剋／怕 line.
  await selectForCommands(page, [engine.id]);
  await expect(page.locator(".sel-info .siege-reach")).toHaveText("射程：打建築 10 格、打兵 6 格，3 格內打不到");
  await expect.poll(async () => (await siege(page)).rings).toBe(1);
  await expect(page.locator(".sel-counters")).toHaveText("攻城砲　剋：建築／怕：近身的兵、騎兵");
  // The panel folded, the way from the engine (28, 55) to the barracks (34–36, 58–60) in view.
  await page.locator(".sel-info").getByRole("button", { name: "收起選取資訊" }).tap();
  await centre(page, 31.5, 57, 1.4);
  // A stone in the air (half way: 10 ticks after a throw at a multiple of 60).
  await page.waitForFunction(() => (window.__proto?.game?.header().tick ?? 0) % 60 === 6, null, { timeout: 60_000, polling: 16 });
  await page.getByRole("button", { name: "暫停", exact: true }).tap();
  await shot(page, info, "siege-stone-in-flight");
  await page.getByRole("button", { name: "繼續", exact: true }).tap();
  // Landed: dust (twice the size).
  await page.waitForFunction(() => (window.__proto?.game?.header().tick ?? 0) % 60 === 19, null, { timeout: 60_000, polling: 16 });
  await page.getByRole("button", { name: "暫停", exact: true }).tap();
  await shot(page, info, "siege-landed");
  await page.getByRole("button", { name: "繼續", exact: true }).tap();
  // The unseen engine's stone, coming in from the east by our soldiers at (23, 68).
  await centre(page, 24, 67, 1.6);
  await page.waitForFunction(() => (window.__proto?.game?.header().tick ?? 0) % 60 === 40, null, { timeout: 60_000, polling: 16 });
  await page.getByRole("button", { name: "暫停", exact: true }).tap();
  await shot(page, info, "siege-stone-from-afar");
  await page.getByRole("button", { name: "繼續", exact: true }).tap();

  // 建造: 砲坊 greyed until a range of ours stands (the fake world has none).
  await selectForCommands(page, []);
  await page.getByRole("button", { name: "建造" }).tap();
  const works = page.locator(".cmds").getByRole("button", { name: /^砲坊/ });
  await expect(works).toBeVisible();
  await expect(works).toBeDisabled();
  await expect(works).toContainText("要先蓋射場");
  await page.locator(".cmds").getByRole("button", { name: "返回" }).tap();
  // Our 砲坊: 訓練攻城砲, and 自動訓練 as at the barracks (D-098).
  const own = (await buildings(page)).find((b) => b.owner === me && b.type === SIEGE_WORKS);
  if (own === undefined) throw new Error("no siege works");
  await centre(page, own.cx + 1.5, own.cy + 1.5, 1.2);
  await tap(page, await at(page, { x: own.cx + 1.5, y: own.cy + 1.5 }));
  await expect.poll(async () => (await page.evaluate(() => window.__proto?.game?.selection()))?.building).toBe(own.id);
  await expect(page.locator(".sel-info")).toContainText("砲坊");
  const train = page.locator(".cmds").getByRole("button", { name: /^訓練攻城砲/ });
  await expect(train).toBeVisible();
  await expect(train.locator(".counter-sub")).toHaveText("剋：建築／怕：近身的兵、騎兵");
  await expect(page.locator(".cmds").getByRole("button", { name: /^自動訓練/ })).toBeVisible();
  await shot(page, info, "siege-works");
  await train.tap();
  await expect.poll(async () => (await page.evaluate(() => (window.__proto?.game?.sent() ?? []) as Record<string, unknown>[])).filter((c) => c.c === "train").at(-1)).toMatchObject({ c: "train", building: own.id, type: SIEGE });
  check();
});
