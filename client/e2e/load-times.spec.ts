// 開一局要等多久 (D-091; the user 2026-10-20: 「我現在開一局新的都會等蠻久的ㄟ」): ?test=1&loadtimes=1
// lists where starting a game spends its time, live while it loads and after, over everything;
// the 量測 panel has it too. Three starts at 3 倍 (CI's numbers, not the iPhone's): the page just
// opened, a second game on the same page (the atlases kept), and after a reload: the atlases
// from the service worker's copy on the phone (public/sw.js).

import { expect, type Page, type TestInfo, test } from "@playwright/test";
import type { LoadReport } from "../src/lab/load-times.ts";
import { openLab, shot, watchErrors } from "./helpers.ts";

// The atlases from the service worker's copy after the reload (the other tests block it).
test.use({ serviceWorkers: "allow" });

const report = (page: Page) => page.evaluate(() => window.__proto?.loadTimes() ?? null);

/** The start measured to its first frame; printed for the CI log and attached. */
async function measured(page: Page, info: TestInfo, name: string): Promise<LoadReport> {
  await expect.poll(async () => (await report(page))?.marks.frame !== undefined, { timeout: 90_000 }).toBe(true);
  const r = await report(page);
  if (r === null) throw new Error("no load times");
  const lines = await page.locator(".load-times").textContent();
  console.log(`[loadtimes ${info.project.name} ${name}]\n${lines}`);
  await info.attach(`loadtimes-${name}.json`, { body: JSON.stringify(r, null, 1), contentType: "application/json" });
  return r;
}

/** Each step after the one before. */
function inOrder(r: LoadReport): void {
  const m = r.marks;
  const steps = [0, m.art, m.artDone, m.init, m.ready, m.drawn, m.frame];
  for (let i = 1; i < steps.length; i++) expect(steps[i], `step ${i} of ${JSON.stringify(m)}`).toBeGreaterThanOrEqual(steps[i - 1] ?? Number.POSITIVE_INFINITY);
}

test("載入計時（D-091）：剛打開、同一頁再開一局、重新整理後，各花多少時間；畫面上一行一行列出，量測面板也有（3 倍，CI 的數字）", async ({ page }, info) => {
  test.setTimeout(240_000);
  const check = watchErrors(page);
  await page.goto("./?test=1&loadtimes=1&art=x3");
  // The service worker in charge before the first game, as when the player reads the start screen.
  const sw = await page.evaluate(() => "serviceWorker" in navigator);
  if (sw) await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 10_000 });
  await page.getByRole("button", { name: "開始" }).tap();
  // While it loads: the lines are there already.
  await expect(page.locator(".load-times")).toContainText("載入計時：開始（這頁第 1 局，剛打開）");
  const first = await measured(page, info, "first");
  inOrder(first);
  expect(first.art).toBe("載入");
  const pictures = first.files.filter((f) => f.decoded !== null);
  expect(pictures.length).toBeGreaterThan(20);
  for (const f of first.files) {
    expect(f.bytes, f.name).toBeGreaterThan(0);
    expect(f.source, f.name).toBe("網路");
  }
  const box = page.locator(".load-times");
  await expect(box).toContainText("合計");
  await expect(box).toContainText("第一格繪製");
  if (info.project.name === "chromium") await shot(page, info, "load-times-first");
  // A tap folds it to the total, another opens it again.
  await box.tap();
  await expect(box).toHaveText(/^合計 \d+\.\d\d 秒$/);
  await box.tap();
  await expect(box).toContainText("模擬啟動");
  // The 量測 panel has this game's.
  await openLab(page);
  await expect(page.locator(".lab-load")).toContainText("載入計時：開始");
  await page.getByRole("region", { name: "量測與確定性檢查" }).getByRole("button", { name: "關閉" }).tap();

  // A second game on the same page: the atlases are kept.
  await page.getByRole("button", { name: "選單", exact: true }).tap();
  await page.getByRole("button", { name: "回開局畫面" }).tap();
  await page.getByRole("button", { name: "重來", exact: true }).tap();
  const again = await measured(page, info, "again");
  inOrder(again);
  expect(again.game).toBe(2);
  expect(again.trigger).toBe("重來");
  expect(again.art).toBe("沿用");
  expect(again.files).toHaveLength(0);

  // Reloaded: the atlases again, from the browser's cache as far as the server lets it.
  await page.reload();
  await page.getByRole("button", { name: "開始" }).tap();
  const reloaded = await measured(page, info, "reload");
  inOrder(reloaded);
  expect(reloaded.game).toBe(1);
  expect(reloaded.page).toBe("reload");
  expect(reloaded.files.length).toBe(first.files.length);
  // With the service worker: every file from the phone, nothing downloaded.
  if (sw) for (const f of reloaded.files) expect(f.source, f.name).toBe("手機裡");
  check();
});

test("載入計時：沒有 loadtimes=1 的測試頁不在畫面上列出，量測面板照樣有", async ({ page }) => {
  await page.goto("./?test=1&mock=1");
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true);
  await expect.poll(async () => (await report(page))?.marks.frame !== undefined).toBe(true);
  await expect(page.locator(".load-times")).toHaveCount(0);
  expect((await report(page))?.art).toBe("關");
  await openLab(page);
  await expect(page.locator(".lab-load")).toContainText("美術 0.00 秒（美術關）");
});
