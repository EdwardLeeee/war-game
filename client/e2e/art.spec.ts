// 正式美術（D-085）on core's real simulation with stand-in atlases (scripts/make-test-atlas.ts,
// ?test=1&art=test): the units are drawn from atlases instead of the shapes, the 量測 panel has
// 美術 (off unless chosen there, kept on the device), a measurement says
// which atlases, how many pages and the draw calls a frame, and a measurement cut short by a
// reload is told on the start screen. The atlases are only the picture: the game is the same.

import { expect, type Page, test } from "@playwright/test";
import { openLab, shot, watchErrors } from "./helpers.ts";

const art = (page: Page) => page.evaluate(() => window.__proto?.game?.art() ?? null);

async function start(page: Page, query: string): Promise<void> {
  await page.goto(`./?test=1&${query}`);
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true, null, { timeout: 60_000 });
}

test("美術（測試圖）：兵從圖集畫，不再是幾何圖形；載入 10 種兵的頁；關掉時照舊畫圖形", async ({ page }) => {
  const check = watchErrors(page);
  await start(page, "art=test&scenario=e2e");
  // Every unit on screen from its atlas: 10 units × colour, team, shadow (+ the mages' shields) and the effects.
  await expect.poll(async () => (await art(page))?.units ?? 0).toBeGreaterThan(0);
  const a = await art(page);
  expect(a?.label).toBe("測試圖");
  expect(a?.pages).toBe(10 * 3 + 2 + 1);
  const units = await page.evaluate(() => (window.__proto?.game?.units() ?? []).filter((u) => u.action !== 7).length);
  expect(a?.units).toBe(units);
  check();
});

test("美術選了關：照舊畫幾何圖形；量測面板的美術是「關」，選 3 倍會記在這台裝置，下一局起才用（D-085）", async ({ page }, info) => {
  const check = watchErrors(page);
  await start(page, "scenario=e2e");
  expect(await art(page)).toBeNull();
  await openLab(page);
  const group = page.getByRole("radiogroup", { name: "美術" });
  await expect(group.getByRole("radio", { name: "關" })).toHaveAttribute("aria-checked", "true");
  // This build has the Release art.lock.json pins.
  await expect(group.getByRole("radio", { name: "3 倍" })).toBeEnabled();
  await expect(group.getByRole("radio", { name: "2 倍" })).toBeEnabled();
  await shot(page, info, "art-lab-panel");
  await group.getByRole("radio", { name: "3 倍" }).tap();
  await expect(group.getByRole("radio", { name: "3 倍" })).toHaveAttribute("aria-checked", "true");
  expect(await page.evaluate(() => localStorage.getItem("war-game.proto.art"))).toBe("x3");
  // Not this game: the shapes still.
  expect(await art(page)).toBeNull();
  check();
});

test("量測（測試圖）：結果框寫美術是哪一套、幾頁圖，和每張畫面的繪製次數", async ({ page }) => {
  test.setTimeout(150_000);
  const check = watchErrors(page);
  await start(page, "art=test&scenario=e2e");
  await openLab(page);
  await page.getByRole("button", { name: "量測 120 人" }).tap();
  // A game of the perf scenario of its own, the atlases kept.
  await page.waitForFunction(() => window.__proto?.ready === true && window.__proto.game?.header().scenario === 2, null, { timeout: 60_000 });
  const result = page.locator(".lab-result");
  await expect(result).toContainText("美術：測試圖，33 頁圖", { timeout: 90_000 });
  await expect(result).toContainText(/每張畫面的繪製次數：中位數 [1-9][\d.]*、最多 [1-9]/);
  check();
});

test("量測到一半頁面重新載入了（Safari 記憶體不足）：開局畫面寫明是哪一次量測", async ({ page }) => {
  await page.goto("./?test=1");
  await page.evaluate(() => sessionStorage.setItem("war-game.proto.measuring", "美術 3 倍，37 頁圖、場景 perf360"));
  await page.reload();
  await expect(page.locator("#measure-note")).toHaveText("上次量測到一半，頁面重新載入了（美術 3 倍，37 頁圖、場景 perf360）");
  // Once: told, then forgotten.
  await page.reload();
  await expect(page.locator("#measure-note")).toBeHidden();
});

test("ASTC 樣本（art-v1）：量測面板和按鈕讓開，左右各一名完整的槍兵，上面寫「一般圖」「壓縮圖（ASTC）」；點一下關閉，面板回來；顯示卡沒有 ASTC 時寫明（D-085）", async ({ page, browserName }, info) => {
  const check = watchErrors(page);
  await start(page, "scenario=e2e");
  await openLab(page);
  const panel = page.getByRole("region", { name: "量測與確定性檢查" });
  await page.getByRole("button", { name: "ASTC 樣本" }).tap();
  // On the phone the panel hid the sample (ceo 2026-10-18): the interface steps aside.
  await expect(panel).toBeHidden();
  await expect(page.getByRole("button", { name: "選單" })).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.__proto?.game?.astc() ?? null), { timeout: 15_000 }).toMatch(/^(shown|no-astc)$/);
  if (browserName === "chromium") await shot(page, info, "art-astc-sample");
  await page.touchscreen.tap(400, 200);
  await expect(panel).toBeVisible();
  await expect(page.getByRole("button", { name: "選單" })).toBeVisible();
  check();
});

test.describe("新的裝置（沒選過美術）", () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test("預設 3 倍：兵從圖集畫，量測面板的美術是「3 倍」（D-087）", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "33 pages at 3 倍: one browser is enough (WebKit on CI draws in software)");
    const check = watchErrors(page);
    await start(page, "scenario=e2e");
    await expect.poll(async () => (await art(page))?.label ?? null, { timeout: 30_000 }).toBe("3 倍");
    await openLab(page);
    await expect(page.getByRole("radiogroup", { name: "美術" }).getByRole("radio", { name: "3 倍" })).toHaveAttribute("aria-checked", "true");
    check();
  });
});

test("你的陸（使用者 2026-10-19 自選）：開局畫面一列東陸／西陸，第一次是東陸，選了記在這台裝置；電腦穿另一陸；perf 交戰的樣子給 ceo 看（CI 的 Chromium）", async ({ page, browserName }, info) => {
  test.setTimeout(240_000);
  const check = watchErrors(page);
  await page.goto("./?test=1&art=x3&scenario=perf");
  const row = page.getByRole("radiogroup", { name: "你的陸" });
  await expect(row.getByRole("radio", { name: "東陸" })).toHaveAttribute("aria-checked", "true");
  if (browserName === "chromium") await shot(page, info, "art-start-screen-e");
  await row.getByRole("radio", { name: "西陸" }).tap();
  await expect(row.getByRole("radio", { name: "西陸" })).toHaveAttribute("aria-checked", "true");
  expect(await page.evaluate(() => localStorage.getItem("war-game.proto.culture"))).toBe("w");
  if (browserName === "chromium") await shot(page, info, "art-start-screen-w");
  await page.reload();
  await expect(page.getByRole("radiogroup", { name: "你的陸" }).getByRole("radio", { name: "西陸" })).toHaveAttribute("aria-checked", "true");
  if (browserName !== "chromium") return check();
  // The perf battle as 西陸 (we) against 東陸 (the computer), then as 東陸: 3 倍.
  for (const [label, name] of [["西陸", "w"], ["東陸", "e"]] as const) {
    await page.goto("./?test=1&art=x3&scenario=perf");
    await page.getByRole("radiogroup", { name: "你的陸" }).getByRole("radio", { name: label }).tap();
    await page.getByRole("button", { name: "開始" }).tap();
    await page.waitForFunction(() => window.__proto?.ready === true, null, { timeout: 60_000 });
    expect(await page.evaluate(() => window.__proto?.game?.culture())).toBe(name);
    await expect.poll(async () => (await art(page))?.units ?? 0, { timeout: 30_000 }).toBeGreaterThan(100);
    await page.evaluate(() => window.__proto?.game?.centerOn(48, 52, 1.6));
    await page.waitForTimeout(3000);
    await shot(page, info, `art-culture-${name}`);
  }
  check();
});

/** The gallery (?gallery=1, src/mock/mock-port.ts): table origin and rows, cell (x + c + 2r, y − c + 2r). */
const OURS = { x: 50, y: 80 };
const THEIRS = { x: 72, y: 84 };
const galleryCell = (t: { x: number; y: number }, r: number, c: number) => ({ x: t.x + c + 2 * r, y: t.y - c + 2 * r });

test("兵種展示（art-v1，3 倍）：兩陸每種兵的待機、走路、攻擊、倒下，村民工作，法師施法、受擊、碎盾，民兵；給 ceo 看（D-085）", async ({ page, browserName }, info) => {
  test.skip(browserName !== "chromium", "pictures for ceo");
  test.setTimeout(120_000);
  const check = watchErrors(page);
  await start(page, "mock=1&gallery=1&art=x3&tps=20");
  await expect.poll(async () => (await art(page))?.units ?? 0, { timeout: 30_000 }).toBeGreaterThan(40);
  expect((await art(page))?.label).toBe("3 倍");
  // The fallen gone at tick 20, a shield shattered at 30: the gallery stands still at 36, while both still show.
  await page.waitForFunction(() => window.__proto?.game?.header().tick === 36, null, { timeout: 30_000 });
  await expect.poll(async () => (await art(page))?.corpses ?? 0).toBeGreaterThanOrEqual(10);
  for (const [name, table, r] of [["ours-1", OURS, 1], ["ours-2", OURS, 4], ["theirs-1", THEIRS, 1], ["theirs-2", THEIRS, 3.5]] as const) {
    const c = galleryCell(table, r, 3.5);
    await page.evaluate(([x, y]) => window.__proto?.game?.centerOn(x - 0.5, y - 0.5, 1.3), [c.x, c.y] as const);
    await page.waitForTimeout(300);
    await shot(page, info, `art-gallery-${name}`);
  }
  check();
});

test("建築展示（art-v3，3 倍，方形斜看）：每種建築的施工三階段、完成、受損、瓦礫，東陸（A）和西陸（B）；資源點；給 ceo 看（D-085、D-088）", async ({ page, browserName }, info) => {
  test.skip(browserName !== "chromium", "pictures for ceo");
  test.setTimeout(150_000);
  const check = watchErrors(page);
  for (const side of ["e", "w"]) {
    await start(page, `mock=1&gallery=b&art=x3&culture=${side}&tps=20`);
    // Destroyed at tick 20 (their rubble), standing still at 36.
    await page.waitForFunction(() => window.__proto?.game?.header().tick === 36, null, { timeout: 30_000 });
    const a = await art(page);
    expect(a?.rubble, "a rubble a type, the field none (it leaves no rubble)").toBe(11);
    expect(a?.nodes ?? 0).toBeGreaterThanOrEqual(30);
    // Rows of 4 types each (the gallery's cell (4 + 5c, 4 + 7r)); the nodes beside.
    for (let g = 0; g < 3; g++) {
      // A little above the rows' middle: the pictures stand above their footprints.
      const r = 1.2 + 4 * g;
      await page.evaluate(([x, y]) => window.__proto?.game?.centerOn(x, y, 0.52), [4 + 15, 4 + 7 * r - 1] as const);
      await page.waitForTimeout(300);
      await shot(page, info, `art-buildings-${side}-${g + 1}`);
    }
    if (side === "e") {
      await page.evaluate(() => window.__proto?.game?.centerOn(89.5, 71.5, 0.95));
      await page.waitForTimeout(300);
      await shot(page, info, "art-nodes");
    }
  }
  check();
});

test("真的模擬開局（3 倍）：家裡的主城、樹林和資源點從圖集畫；點主城的屋頂也選得到（D-085）", async ({ page, browserName }, info) => {
  test.skip(browserName !== "chromium", "33 + 20 pages at 3 倍: one browser is enough (WebKit on CI draws in software)");
  test.setTimeout(120_000);
  const check = watchErrors(page);
  await start(page, "art=x3&scenario=standard");
  await expect.poll(async () => (await art(page))?.buildings ?? 0, { timeout: 30_000 }).toBeGreaterThan(0);
  expect((await art(page))?.nodes ?? 0).toBeGreaterThan(20);
  await page.waitForTimeout(1000);
  await shot(page, info, "art-start");
  // The main city's roof stands above its footprint: a tap there selects it.
  const me = await page.evaluate(() => window.__proto?.game?.me() ?? 0);
  const city = (await page.evaluate(() => window.__proto?.game?.buildings() ?? [])).find((b) => b.owner === me && b.type === 0);
  if (city === undefined) throw new Error("no main city");
  // Its footprint's middle on screen, and the roof well above it (no farmer stands inside the city).
  const mid = await page.evaluate(([x, y]) => window.__proto?.game?.cellToScreen(x, y) ?? { x: 0, y: 0 }, [city.cx + city.size / 2 - 0.5, city.cy + city.size / 2 - 0.5] as const);
  expect(await page.evaluate(([x, y]) => window.__proto?.game?.pickAt(x, y - 80) ?? null, [mid.x, mid.y] as const)).toBe("building");
  check();
});
