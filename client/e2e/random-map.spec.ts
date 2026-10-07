// 隨機地圖 (D-074) on the fake world played as a random map (?test=1&mock=1, the start screen's
// 地圖 or &map=random): the start screen's choice, kept on this device; at the start only what
// is around home is known (no enemy main city, no town never explored); scouting brings a town
// and rocks onto the battlefield and the minimap. The fixed map knows everything as before.

import { expect, type Page, test } from "@playwright/test";
import { injectSafeArea, shot, watchErrors } from "./helpers.ts";

// Fake-world layout (src/mock/mock-port.ts), in cells.
const BIG_TOWN = 3;
const BIG_TOWN_AT = { x: 48, y: 48 };

let checkErrors: () => void;

test.beforeEach(({ page }) => {
  checkErrors = watchErrors(page);
});

test.afterEach(() => {
  checkErrors();
});

async function start(page: Page): Promise<void> {
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true);
}

/** The start card inside the safe area of the phone held sideways (814 × 380 less the home indicator), with nothing to scroll and the 原型介面 label clear of it. */
async function cardFits(page: Page, when: string): Promise<void> {
  await injectSafeArea(page);
  const screen = await page.locator("#start").boundingBox();
  const card = await page.locator("#start .card").boundingBox();
  if (screen === null || card === null) throw new Error(`${when}: no start card`);
  expect(card.y, `${when}: card top`).toBeGreaterThanOrEqual(screen.y);
  expect(card.y + card.height, `${when}: card bottom`).toBeLessThanOrEqual(screen.y + screen.height);
  expect(await page.locator("#start .card").evaluate((c) => c.scrollHeight - c.clientHeight), `${when}: nothing to scroll`).toBeLessThanOrEqual(1);
  // Clear of the 原型介面 label at the top left.
  const label = await page.locator("#proto-label").boundingBox();
  if (label !== null) expect(label.x + label.width <= card.x || label.y >= card.y + card.height || label.y + label.height <= card.y, `${when}: label clear of the card`).toBe(true);
}

const knownTowns = (page: Page) => page.evaluate(() => window.__proto?.game?.knownTowns() ?? []);
const knownRocks = (page: Page) => page.evaluate(() => window.__proto?.game?.knownRocks() ?? 0);
const buildings = (page: Page) => page.evaluate(() => window.__proto?.game?.buildings() ?? []);
const centre = (page: Page, c: { x: number; y: number }) => page.evaluate(([x, y]) => window.__proto?.game?.centerOn(x, y), [c.x, c.y] as const);

test("開局畫面：地圖選項，第一次是固定地圖；選隨機地圖會換說明、記在這台裝置，重新整理後還是隨機地圖；對局中回開局畫面也放得下", async ({ page }, info) => {
  await page.goto("./?test=1&mock=1");
  const maps = page.getByRole("radiogroup", { name: "地圖" });
  await expect(maps.getByRole("radio", { name: "固定地圖" })).toBeChecked();
  await expect(page.locator("#map-note")).toHaveText("每局同一張，適合比較電腦強弱");
  await maps.getByRole("radio", { name: "隨機地圖" }).tap();
  await expect(maps.getByRole("radio", { name: "隨機地圖" })).toBeChecked();
  await expect(maps.getByRole("radio", { name: "固定地圖" })).not.toBeChecked();
  await expect(page.locator("#map-note")).toHaveText("每局不同，只看得到自己家附近");
  // The whole start screen still fits on the phone held sideways.
  await cardFits(page, "start");
  await shot(page, info, "random-start-screen");
  await page.reload();
  await expect(page.getByRole("radiogroup", { name: "地圖" }).getByRole("radio", { name: "隨機地圖" })).toBeChecked();
  // The game starts on it.
  await start(page);
  expect(await page.evaluate(() => window.__proto?.game?.mapMode())).toBe("random");
  // 回開局畫面 in a game: 繼續這局 and 重來, and the line that a new choice waits for 重來 in place of the note on the shapes.
  await page.getByRole("button", { name: "選單" }).tap();
  await page.getByRole("button", { name: "回開局畫面" }).tap();
  await expect(page.getByRole("button", { name: "繼續這局" })).toBeVisible();
  await expect(page.locator("#difficulty-note")).toBeVisible();
  await expect(page.locator("#about-note")).toBeHidden();
  await cardFits(page, "in a game");
  await shot(page, info, "random-start-screen-in-game");
});

test("隨機地圖開局：看得到自己的主城，看不到敵方主城和沒探過的大城；派兵探過以後，大城和那邊的岩石才出現", async ({ page }, info) => {
  await page.goto("./?test=1&mock=1&map=random");
  await start(page);
  expect(await page.evaluate(() => window.__proto?.game?.mapMode())).toBe("random");
  const me = await page.evaluate(() => window.__proto?.game?.me() ?? 0);
  const all = await buildings(page);
  expect(all.some((b) => b.owner === me && b.type === 0), "our main city").toBe(true);
  expect(all.some((b) => b.owner !== me && b.type === 0), "no enemy main city").toBe(false);
  // Towns near home are explored from the start; the big town in the middle is not.
  const towns0 = await knownTowns(page);
  expect(towns0.length).toBeGreaterThan(0);
  expect(towns0).not.toContain(BIG_TOWN);
  const rocks0 = await knownRocks(page);
  await shot(page, info, "random-start");
  // Scout: a spearman of ours walks into the middle (put there; the fake world walks slowly).
  const spear = (await page.evaluate(() => window.__proto?.game?.units() ?? [])).find((u) => u.owner === me && u.type === 1);
  if (spear === undefined) throw new Error("no spearman");
  await page.evaluate(([id, x, y]) => window.__proto?.game?.place([id], [{ x, y }]), [spear.id, BIG_TOWN_AT.x - 2, BIG_TOWN_AT.y + 2] as const);
  await expect.poll(() => knownTowns(page), { timeout: 30_000 }).toContain(BIG_TOWN);
  await expect.poll(() => knownRocks(page), { timeout: 30_000 }).toBeGreaterThan(rocks0);
  // Still no enemy main city: it is far beyond.
  expect((await buildings(page)).some((b) => b.owner !== me && b.type === 0)).toBe(false);
  await centre(page, BIG_TOWN_AT);
  await shot(page, info, "random-scouted");
  // The town is a town to tap like any other.
  const at = await page.evaluate(([x, y]) => window.__proto?.game?.cellToScreen(x, y) ?? { x: 0, y: 0 }, [BIG_TOWN_AT.x + 0.5, BIG_TOWN_AT.y + 2.5] as const);
  expect(await page.evaluate(([x, y]) => window.__proto?.game?.pickAt(x, y) ?? null, [at.x, at.y] as const)).toBe("town");
});

test("固定地圖照舊：開局就知道全部城鎮和岩石，敵方主城在地圖上（只是在霧裡）", async ({ page }) => {
  await page.goto("./?test=1&mock=1&map=fixed");
  await start(page);
  expect(await page.evaluate(() => window.__proto?.game?.mapMode())).toBe("fixed");
  expect(await knownTowns(page)).toEqual([0, 1, 2, 3, 4]);
  // The fake world's rocks: two ridges of 4 x 16 cells and a line of 10.
  expect(await knownRocks(page)).toBe(74);
});
