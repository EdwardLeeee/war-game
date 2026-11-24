// 量測 takes nobody's game (ceo 2026-11-24: 量測大軍交戰 from a game's 選單 went through 重來 and took the player's game
// and its 繼續上一局 away): as 新手教學, the game on screen is kept for 繼續上一局 as 量測 starts; the 量測 game, ended or
// left, clears nothing; 回開局畫面 from it offers 繼續上一局, which goes on with the player's game.
import { expect, type Page, test } from "@playwright/test";
import { openLab, watchErrors } from "./helpers.ts";

const LOGS = "https://game-logs.test/logs";
const header = (page: Page) => page.evaluate(() => window.__proto?.game?.header() ?? { tick: -1, paused: false });
const saved = (page: Page) => page.evaluate(async () => (await window.__proto?.saved()) ?? null);
const scenario = (page: Page) => page.evaluate(() => (window.__proto?.game?.init()?.scenario as string | undefined) ?? null);

test("量測不吃掉玩家的局：從遊戲裡開量測，玩家的局存起來；量測的局投降、回開局畫面都不清掉；開局畫面有「繼續上一局」，接得上玩家的局", async ({ page }) => {
  test.setTimeout(180_000);
  const check = watchErrors(page);
  await page.route(LOGS, (route) => route.fulfill({ status: 201, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ ok: true }) }));
  // The player's game, past a minute (from a minute on a game is kept), not yet saved by the minute's save.
  await page.goto(`./?test=1&scenario=e2e&tps=400&logs=${encodeURIComponent(LOGS)}`);
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true);
  await expect.poll(async () => (await header(page)).tick, { timeout: 60_000 }).toBeGreaterThan(1300);
  await page.getByRole("button", { name: "暫停", exact: true }).tap();
  await expect.poll(async () => (await header(page)).paused).toBe(true);
  const tick = (await header(page)).tick;

  // 量測 120 人 from the game's 選單: its own game; the player's kept, where it was.
  await openLab(page);
  await page.getByRole("button", { name: "量測 120 人" }).tap();
  await expect.poll(() => scenario(page), { timeout: 60_000 }).toBe("perf");
  await page.waitForFunction(() => window.__proto?.ready === true, null, { timeout: 60_000 });
  const kept = await saved(page);
  expect(kept?.init.scenario).toBe("e2e");
  expect(kept?.tick).toBeGreaterThanOrEqual(tick);

  // The 量測 game ends (投降): nothing cleared. (The 量測 panel closed first: it lies over 選單.)
  await page.getByRole("region", { name: "量測與確定性檢查" }).getByRole("button", { name: "關閉" }).tap();
  await page.getByRole("button", { name: "選單" }).tap();
  await page.getByRole("button", { name: "投降" }).tap();
  await page.getByRole("dialog").getByRole("button", { name: "投降" }).tap();
  const result = page.getByRole("dialog", { name: "失敗" });
  await expect(result).toBeVisible();
  await page.waitForTimeout(500);
  expect((await saved(page))?.tick).toBe(kept?.tick);

  // 回開局畫面: the 量測 game gone, 繼續上一局 offered, and it goes on with the player's game.
  await result.getByRole("button", { name: "回開局畫面" }).tap();
  const resume = page.getByRole("button", { name: /^繼續上一局（第 \d+ 分）$/ });
  await expect(resume).toBeVisible();
  await expect(resume).toBeEnabled();
  await resume.tap();
  await page.waitForFunction(() => window.__proto?.ready === true && window.__proto.screen === "battle", null, { timeout: 60_000 });
  expect(await scenario(page)).toBe("e2e");
  expect((await header(page)).tick).toBe(kept?.tick);
  check();
});
