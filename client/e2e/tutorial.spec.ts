// 新手教學 (R25, D-151) on core's tutorial scenario (sim PROTOCOL 3.12), 正式介面 at 932 × 336 with the iPhone's safe
// area: the entry under 開始 (none in the prototype), steps 1 and 2 done by hand, a tap outside the frame kept off
// (drags still move the camera), every step skipped in turn with what the steps after need (core's `tutorial`
// events), and the tutorial never kept nor uploaded: a game kept before it stays kept, one left for it (設定 →
// 新手教學) is kept however short.

import { expect, type Page, test } from "@playwright/test";
import type { GameRecord } from "../../services/game-logs/src/record.ts";
import { injectSafeArea, watchErrors } from "./helpers.ts";
import { drag, pinch } from "./touch.ts";

const LOGS = "https://game-logs.test/logs";
const state = (page: Page) => page.evaluate(() => window.__proto?.tutorial() ?? null);
const sentTutorial = (page: Page) => page.evaluate(() => (window.__proto?.game?.sent() ?? []).filter((c) => (c as { c: string }).c === "tutorial").map((c) => (c as { event: string }).event));

async function catchUploads(page: Page): Promise<string[]> {
  const bodies: string[] = [];
  await page.route(LOGS, async (route) => {
    bodies.push(route.request().postData() ?? "");
    await route.fulfill({ status: 201, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ ok: true }) });
  });
  return bodies;
}

async function open(page: Page, query = ""): Promise<void> {
  await page.setViewportSize({ width: 932, height: 336 });
  await page.goto(`./?test=1${query}`);
  await injectSafeArea(page);
}

async function startTutorial(page: Page): Promise<void> {
  await page.getByRole("button", { name: "新手教學" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true && window.__proto.screen === "battle", null, { timeout: 120_000 });
  await injectSafeArea(page);
  await expect.poll(async () => (await state(page))?.phase).toBe("1");
}

/** A tap in the middle of what the tutorial frames (a button, or a place on the battlefield). */
async function tapTarget(page: Page): Promise<void> {
  await expect.poll(async () => (await state(page))?.target ?? null, { timeout: 20_000 }).not.toBeNull();
  // Where it is now (the frame follows each animation frame; the villager walks).
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const t = (await state(page))?.target;
  if (t == null) throw new Error("no target");
  await page.touchscreen.tap(t.box.x + t.box.w / 2, t.box.y + t.box.h / 2);
}

async function skip(page: Page): Promise<void> {
  const before = (await state(page))?.step ?? 0;
  await page.locator(".tut-card").getByRole("button", { name: "跳過這步" }).tap();
  await expect.poll(async () => {
    const s = await state(page);
    return s === null ? -1 : s.finished ? 99 : s.step;
  }).toBeGreaterThan(before);
}

/** A game of more than a minute (the e2e scenario, fast), then away: kept for 繼續上一局. */
async function keepAGame(page: Page): Promise<number> {
  await open(page, `&scenario=e2e&tps=400&logs=${encodeURIComponent(LOGS)}`);
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true);
  await expect.poll(() => page.evaluate(() => window.__proto?.game?.header().tick ?? 0), { timeout: 60_000 }).toBeGreaterThan(1300);
  await page.evaluate(() => window.__proto?.game?.pause());
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(async () => (await page.evaluate(async () => (await window.__proto?.saved()) ?? null))?.tick ?? -1, { timeout: 15_000 }).toBeGreaterThan(1300);
  return (await page.evaluate(async () => (await window.__proto?.saved())?.tick)) ?? -1;
}

test("新手教學的入口（R25）：開局畫面「開始」下面有「新手教學」；原型（?ui=proto）沒有", async ({ page }) => {
  await open(page);
  await expect(page.getByRole("button", { name: "新手教學" })).toBeVisible();
  const [go, tut] = await Promise.all([page.locator("#start-game").boundingBox(), page.locator("#tutorial-start").boundingBox()]);
  expect((tut?.y ?? 0) > (go?.y ?? 0), "under 開始").toBe(true);
  await open(page, "&ui=proto");
  await expect(page.getByRole("button", { name: "新手教學" })).toBeHidden();
});

test("第 1、2 步照做（R25）：拖、縮放、按地圖、點小地圖打勾；點村民、點樹；做對了變綠，一下就自己往下；框以外的點擋掉、框閃，拖照常", async ({ page }) => {
  test.setTimeout(180_000);
  const check = watchErrors(page);
  await open(page);
  await startTutorial(page);
  const card = page.locator(".tut-card");
  await expect(card).toContainText("1／9看地圖");
  await expect(card.locator(".tut-list span.ok")).toHaveCount(0);
  await drag(page, { x: 420, y: 200 }, { x: 520, y: 170 });
  await expect(card.locator(".tut-list span.ok")).toHaveText(["拖動畫面"]);
  await pinch(page, { x: 460, y: 190 }, 80, 140);
  await expect(card.locator(".tut-list span.ok")).toHaveText(["拖動畫面", "兩指縮放"]);
  // 1b: 地圖 framed, the rest dimmed.
  await expect.poll(async () => (await state(page))?.target?.box.x ?? -1).toBeGreaterThanOrEqual(59);
  await page.locator(".map-btn").tap();
  await page.locator(".minimap").tap();
  await expect(card).toHaveClass(/\bdone\b/);
  await expect(card).toContainText("做得好！");
  // By itself after a second or so.
  await expect.poll(async () => (await state(page))?.phase, { timeout: 10_000 }).toBe("2a");
  await expect(card.locator(".tut-title")).toHaveText("採集");
  await expect(card.locator(".tut-body")).toHaveText("點一名村民。");
  // 2a: a villager framed; a tap elsewhere on the ground does nothing (no select, no order), the frame flashes.
  await expect.poll(async () => (await state(page))?.target ?? null, { timeout: 20_000 }).not.toBeNull();
  const t = (await state(page))?.target;
  const away = { x: (t?.box.x ?? 0) > 466 ? 250 : 650, y: 200 };
  const sent = await page.evaluate(() => window.__proto?.game?.sent().length ?? 0);
  await page.touchscreen.tap(away.x, away.y);
  await expect.poll(async () => (await state(page))?.blocked).toBe(1);
  expect(await page.evaluate(() => window.__proto?.game?.selection().units.length)).toBe(0);
  expect(await page.evaluate((n) => (window.__proto?.game?.sent() ?? []).slice(n).filter((c) => (c as { auto?: boolean }).auto !== true).length, sent)).toBe(0);
  await expect(page.locator(".tut-ring.flash")).toHaveCount(1);
  // A drag still moves the camera.
  const cam = await page.evaluate(() => window.__proto?.game?.camera());
  await drag(page, { x: 450, y: 220 }, { x: 380, y: 200 });
  await expect.poll(async () => (await page.evaluate(() => window.__proto?.game?.camera()))?.x).not.toBe(cam?.x);
  // The villager (the game held still while it is tapped), then a tree: done.
  await page.evaluate(() => window.__proto?.game?.pause());
  await page.evaluate(() => window.__proto?.game?.centerOn(16, 21, 1.1));
  await page.waitForTimeout(300);
  await tapTarget(page);
  await expect.poll(async () => (await state(page))?.phase).toBe("2b");
  await expect(card).toContainText("再點一棵樹");
  await tapTarget(page);
  await expect(card).toHaveClass(/\bdone\b/);
  await expect(card).toContainText("經濟分配");
  await expect.poll(async () => (await state(page))?.step, { timeout: 10_000 }).toBe(3);
  check();
});

test("每一步都可以跳過（R25）：跳過時放進後面要用的（兵營、槍兵、小隊清掉、小鎮、攻城砲），最後是教學完成，回開局畫面", async ({ page }) => {
  test.setTimeout(240_000);
  const check = watchErrors(page);
  await open(page, "&tps=100");
  await startTutorial(page);
  for (let s = 1; s < 9; s++) await skip(page);
  const s9 = await state(page);
  expect(s9?.step).toBe(9);
  // Step 9 began: core's siege works and the money for two engines; skipped: two engines, then at the city.
  await page.locator(".tut-card").getByRole("button", { name: "跳過這步" }).tap();
  await expect.poll(async () => (await state(page))?.phase).toBe("9c");
  await expect.poll(() => sentTutorial(page), { timeout: 30_000 }).toEqual(["houses", "spears", "near_home", "near_home_clear", "town", "siege", "engines"]);
  // What each put in the game.
  const me = await page.evaluate(() => window.__proto?.game?.me() ?? 0);
  await expect.poll(async () => (await page.evaluate(() => window.__proto?.game?.buildings() ?? [])).filter((b) => b.owner === me && b.type === 6 && b.progress >= 1000).length, { timeout: 30_000 }).toBeGreaterThan(0);
  await expect.poll(async () => (await page.evaluate(() => window.__proto?.game?.units() ?? [])).filter((u) => u.owner === me && u.type === 1).length, { timeout: 30_000 }).toBeGreaterThanOrEqual(5);
  await expect.poll(async () => (await page.evaluate(() => window.__proto?.game?.units() ?? [])).filter((u) => u.owner === me && u.type === 6).length, { timeout: 30_000 }).toBe(2);
  await expect.poll(async () => (await page.evaluate(() => window.__proto?.game?.towns() ?? [])).find((t) => t.id === 0)?.owner, { timeout: 30_000 }).toBe(me);
  await expect.poll(async () => (await page.evaluate(() => window.__proto?.game?.units() ?? [])).filter((u) => u.owner !== me && u.owner < 2 && u.type !== 0).length, { timeout: 30_000 }).toBe(0);
  // 9c: the computer's main city off the screen, a tag at the edge and 帶我去看.
  await expect(page.locator(".tut-edge")).toContainText("對手主城");
  await page.locator(".tut-card").getByRole("button", { name: "帶我去看" }).tap();
  await expect(page.locator(".tut-edge")).toHaveCount(0);
  await skip(page);
  const card = page.locator(".tut-card");
  await expect(card).toContainText("教學完成！");
  await card.getByRole("button", { name: "回開局畫面" }).tap();
  await expect(page.locator("#start")).toBeVisible();
  await expect(page.locator("#start-game")).toHaveText("開始");
  expect(await state(page)).toBeNull();
  check();
});

test("教學不存檔、不上傳（R25）：之前存的局還在、接得上，教學中切到背景或離開都沒有送紀錄", async ({ page }) => {
  test.setTimeout(240_000);
  const bodies = await catchUploads(page);
  const tick = await keepAGame(page);
  await page.goto(`./?test=1&logs=${encodeURIComponent(LOGS)}`);
  await injectSafeArea(page);
  await expect(page.getByRole("button", { name: /^繼續上一局/ })).toBeVisible();
  await expect.poll(() => bodies.length, { timeout: 20_000 }).toBeGreaterThan(0);
  const uploaded = bodies.length;
  await startTutorial(page);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  // Left by ✕.
  await page.locator(".tut-card").getByRole("button", { name: "離開教學" }).tap();
  await expect(page.getByRole("dialog", { name: "離開新手教學？" })).toBeVisible();
  await page.getByRole("button", { name: "離開", exact: true }).tap();
  await expect(page.locator("#start")).toBeVisible();
  expect((await page.evaluate(async () => (await window.__proto?.saved()) ?? null))?.tick, "the game kept before").toBe(tick);
  await expect(page.getByRole("button", { name: /^繼續上一局/ })).toBeVisible();
  expect(bodies.length, "nothing more sent").toBe(uploaded);
  expect(bodies.map((b) => (JSON.parse(b) as GameRecord).scenario)).not.toContain("tutorial");
});

test("對局中從設定開新手教學（R25）：先問；這一局存著（不到一分鐘也存），離開教學後「繼續上一局」接得上", async ({ page }) => {
  test.setTimeout(240_000);
  await open(page, "&scenario=e2e&tps=100");
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true);
  await expect.poll(() => page.evaluate(() => window.__proto?.game?.header().tick ?? 0)).toBeGreaterThan(200);
  await page.getByRole("button", { name: "選單", exact: true }).tap();
  await page.getByRole("button", { name: /^設定/ }).tap();
  await page.getByRole("button", { name: /新手教學/ }).tap();
  await expect(page.getByRole("dialog")).toContainText("這一局會存著");
  await page.getByRole("button", { name: "開始教學" }).tap();
  await page.waitForFunction(() => window.__proto?.tutorial() !== null, null, { timeout: 120_000 });
  const kept = await page.evaluate(async () => (await window.__proto?.saved()) ?? null);
  expect(kept?.tick ?? 0, "kept, however short").toBeGreaterThan(200);
  expect(kept?.init.scenario).toBe("e2e");
  await page.locator(".tut-card").getByRole("button", { name: "離開教學" }).tap();
  await page.getByRole("button", { name: "離開", exact: true }).tap();
  const resume = page.getByRole("button", { name: /^繼續上一局/ });
  await expect(resume).toBeVisible();
  await resume.tap();
  await page.waitForFunction(() => window.__proto?.ready === true && window.__proto.screen === "battle", null, { timeout: 60_000 });
  await expect.poll(() => page.evaluate(() => window.__proto?.game?.header().tick ?? 0)).toBe(kept?.tick);
});
