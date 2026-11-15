// 新手教學 (R25, D-151) on core's tutorial scenario (sim PROTOCOL 3.12), 正式介面 at 932 × 336 with the iPhone's safe
// area: the entry under 開始 (none in the prototype), steps 1 and 2 done by hand, a tap outside the frame kept off
// (drags still move the camera), every step skipped in turn with what the steps after need (core's `tutorial`
// events), and the tutorial never kept nor uploaded: a game kept before it stays kept, one left for it (設定 →
// 新手教學) is kept however short.

import { expect, type Page, test } from "@playwright/test";
import type { GameRecord } from "../../services/game-logs/src/record.ts";
import { injectSafeArea, watchErrors } from "./helpers.ts";
import { drag, longPress, pinch } from "./touch.ts";

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
  // Where it is now and stays (the frame follows each animation frame; a villager walks; the camera may bring it into reach).
  let last = "";
  await expect.poll(async () => {
    const t = (await state(page))?.target ?? null;
    const now = JSON.stringify(t === null ? null : [Math.round(t.box.x), Math.round(t.box.y), Math.round(t.box.w), Math.round(t.box.h)]);
    const same = t !== null && now === last;
    last = now;
    if (!same) await page.waitForTimeout(150);
    return same;
  }, { timeout: 30_000 }).toBe(true);
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
  // 9c: nobody selected, 全軍 framed first; then the computer's main city off the screen, a tag at the edge and 帶我去看.
  await expect.poll(async () => (await state(page))?.target?.box.x ?? -1).toBeGreaterThan(700);
  await page.locator(".army-btn").tap();
  // Selected, and the frame gone from 全軍 to the target (or 帶我去看).
  await expect.poll(() => page.evaluate(() => window.__proto?.game?.selection().units.length ?? 0)).toBeGreaterThan(0);
  await expect.poll(async () => (await state(page))?.target?.box.x ?? 0).toBeLessThan(700);
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

/** The step's phase, after it changed (at most `ms`). */
async function phase(page: Page, id: string, ms = 60_000): Promise<void> {
  await expect.poll(async () => (await state(page))?.phase, { timeout: ms }).toBe(id);
}

/** Its target on the screen: 帶我去看 first when it is off it. */
async function inSight(page: Page): Promise<void> {
  const go = page.locator(".tut-card").getByRole("button", { name: "帶我去看" });
  // The card drawn for this target first (a frame on the screen, or 帶我去看 for one off it).
  await expect.poll(async () => (await go.isVisible()) || ((await state(page))?.target ?? null) !== null, { timeout: 20_000 }).toBe(true);
  for (let k = 0; k < 3 && (await go.isVisible()); k++) {
    await go.tap();
    await page.waitForTimeout(500);
  }
  await expect.poll(async () => (await state(page))?.target ?? null, { timeout: 10_000 }).not.toBeNull();
}

/** A step done by hand, then the next one by itself. */
async function done(page: Page, step: number, ms = 90_000): Promise<void> {
  await expect.poll(async () => {
    const s = await state(page);
    return s === null ? -1 : s.finished ? 99 : s.step;
  }, { timeout: ms }).toBeGreaterThan(step);
}

test("九步照做到打下對手主城（R25，真模擬）：蓋兵營、練兵、拉框選兵走到集合點、編軍團、守家、打小鎮治理進駐、練砲打主城，最後是教學完成", async ({ page }) => {
  test.setTimeout(900_000);
  const check = watchErrors(page);
  await open(page, "&tps=100");
  await startTutorial(page);
  for (let s = 1; s <= 2; s++) await skip(page);
  // 3 蓋兵營: 建造, 兵營, a good spot, ✓; the card away while the game's prompt says it; then built.
  await phase(page, "3a");
  await tapTarget(page);
  await phase(page, "3b");
  await tapTarget(page);
  await phase(page, "3c");
  await expect(page.locator(".tut-card")).toBeHidden();
  const spot = await page.evaluate(() => {
    const g = window.__proto?.game;
    const home = g?.buildings().find((b) => b.owner === g.me() && b.type === 0);
    // The camera at home, so that the spot is on the screen.
    g?.centerOn((home?.cx ?? 16) + 4, (home?.cy ?? 18) + 4, 1.1);
    const c = g?.buildSpotNear(6, (home?.cx ?? 16) + 6, (home?.cy ?? 18) + 4) ?? null;
    return c === null ? null : g?.cellToScreen(c.x + 1, c.y + 1) ?? null;
  });
  if (spot === null) throw new Error("no spot for the barracks");
  await page.waitForTimeout(500);
  // As the game's prompt says: the preview dragged there, let go (then ✓).
  const ghost = await page.evaluate(() => {
    const p = window.__proto?.game?.placement();
    return p == null ? null : window.__proto?.game?.cellToScreen(p.cellX + 1, p.cellY + 1) ?? null;
  });
  await drag(page, ghost ?? { x: 466, y: 168 }, spot);
  await expect(page.locator(".place-confirm")).toBeVisible();
  await tapTarget(page);
  await phase(page, "3d");
  await done(page, 3);
  // 4 練兵: the barracks, then 訓練槍兵 five times; trained.
  await phase(page, "4a");
  await tapTarget(page);
  await expect.poll(async () => (await page.evaluate(() => window.__proto?.game?.selection().building ?? null)) !== null).toBe(true);
  for (let i = 0; i < 5; i++) await tapTarget(page);
  await phase(page, "4b");
  await done(page, 4, 180_000);
  // 5 選兵和移動: a box round them, then the glowing spot; there.
  await phase(page, "5a");
  await expect.poll(async () => (await state(page))?.target ?? null).not.toBeNull();
  const box = (await state(page))?.target?.box;
  if (box == null) throw new Error("no box");
  // From a corner on open ground (nothing to pick there) to the one across.
  const corners = [
    [{ x: box.x + 6, y: box.y + 6 }, { x: box.x + box.w - 6, y: box.y + box.h - 6 }],
    [{ x: box.x + box.w - 6, y: box.y + box.h - 6 }, { x: box.x + 6, y: box.y + 6 }],
    [{ x: box.x + box.w - 6, y: box.y + 6 }, { x: box.x + 6, y: box.y + box.h - 6 }],
    [{ x: box.x + 6, y: box.y + box.h - 6 }, { x: box.x + box.w - 6, y: box.y + 6 }],
  ];
  let from = corners[0];
  for (const c of corners) if ((await page.evaluate(([x, y]) => window.__proto?.game?.pickAt(x, y) ?? null, [c[0].x, c[0].y] as const)) === null) {
    from = c;
    break;
  }
  await longPress(page, from[0], from[1]);
  await phase(page, "5b");
  await tapTarget(page);
  await done(page, 5, 120_000);
  // 6 編軍團: 1, then 改成剛才選的 (its title line only over 軍團畫面).
  await phase(page, "6a");
  await tapTarget(page);
  await phase(page, "6b");
  await expect.poll(async () => (await state(page))?.place).toBe("slim");
  await tapTarget(page);
  await done(page, 6);
  // 7 守家: near_home's squad; 全軍撤退, then at them.
  await phase(page, "7a");
  expect(await sentTutorial(page)).toContain("near_home");
  await tapTarget(page);
  await phase(page, "7b", 120_000);
  await expect.poll(async () => (await page.evaluate(() => window.__proto?.game?.units() ?? [])).filter((u) => u.owner === 1).length, { timeout: 60_000 }).toBeGreaterThan(0);
  await expect.poll(async () => {
    await inSight(page);
    return (await state(page))?.target ?? null;
  }, { timeout: 60_000 }).not.toBeNull();
  // The squad walks: held still while one is tapped (the order runs when the game goes on).
  await page.evaluate(() => window.__proto?.game?.pause());
  await tapTarget(page);
  await page.getByRole("button", { name: "繼續", exact: true }).tap();
  await done(page, 7, 180_000);
  // 8 打城鎮: to the town (帶我去看), at it; 治理 with the card at the left; repaired; 進駐.
  await phase(page, "8a");
  // Everyone selected (全軍: 8a frames it first when nobody is), then at the town.
  await page.locator(".army-btn").tap();
  // Selected, and the frame gone from 全軍 to the target (or 帶我去看).
  await expect.poll(() => page.evaluate(() => window.__proto?.game?.selection().units.length ?? 0)).toBeGreaterThan(0);
  await expect.poll(async () => (await state(page))?.target?.box.x ?? 0).toBeLessThan(700);
  // At the town: the order (攻擊移動 to its keep) sent; else the camera there again and once more (WebKit on a busy
  // machine lost the tap now and then, the camera back home after it: 1 in 6 runs, not understood yet).
  const before = await page.evaluate(() => window.__proto?.game?.sent().length ?? 0);
  const ordered = () => page.evaluate((n) => (window.__proto?.game?.sent() ?? []).slice(n).some((c) => (c as { c: string; auto?: boolean }).auto !== true && ["move", "attack"].includes((c as { c: string }).c)), before);
  for (let k = 0; k < 3; k++) {
    await inSight(page);
    await tapTarget(page);
    if (await expect.poll(ordered, { timeout: 3_000 }).toBe(true).then(() => true, () => false)) break;
  }
  await phase(page, "8b", 180_000);
  await expect.poll(async () => (await state(page))?.place).toBe("side");
  await tapTarget(page);
  await phase(page, "8c");
  await phase(page, "8d", 60_000);
  await expect.poll(async () => (await state(page))?.target ?? null).not.toBeNull();
  await tapTarget(page);
  await expect.poll(() => page.evaluate(() => window.__proto?.game?.mode())).toBe("enter");
  await inSight(page);
  await tapTarget(page);
  await done(page, 8, 60_000);
  // 9: core's siege works; two engines; everyone (全軍) to the computer's main city.
  await phase(page, "9a");
  await expect.poll(async () => (await state(page))?.target ?? null, { timeout: 30_000 }).not.toBeNull();
  await tapTarget(page);
  await expect.poll(async () => (await page.evaluate(() => window.__proto?.game?.selection().building ?? null)) !== null).toBe(true);
  for (let i = 0; i < 2; i++) await tapTarget(page);
  await phase(page, "9c", 120_000);
  await page.locator(".army-btn").tap();
  // Selected, and the frame gone from 全軍 to the target (or 帶我去看).
  await expect.poll(() => page.evaluate(() => window.__proto?.game?.selection().units.length ?? 0)).toBeGreaterThan(0);
  await expect.poll(async () => (await state(page))?.target?.box.x ?? 0).toBeLessThan(700);
  await inSight(page);
  await tapTarget(page);
  await expect.poll(async () => (await state(page))?.finished, { timeout: 300_000 }).toBe(true);
  await expect(page.locator(".tut-card")).toContainText("教學完成！");
  // At the left of the result (R25 9e), its two buttons there.
  await expect.poll(async () => (await state(page))?.place).toBe("side");
  await expect(page.locator(".tut-card").getByRole("button", { name: "開始第一局" })).toBeVisible();
  const [card, result] = await Promise.all([page.locator(".tut-card").boundingBox(), page.locator(".stats-card").boundingBox()]);
  expect((card?.x ?? 0) + (card?.width ?? 0), "the card left of the result").toBeLessThanOrEqual(result?.x ?? 0);
  await page.screenshot({ path: test.info().outputPath("tutorial-9e.png") });
  check();
});
