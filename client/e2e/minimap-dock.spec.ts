// 小地圖常開 (R26 04, design/r26/spec.md 04; ceo 2026-11-21): with a mouse on a large window (600 tall or more) the
// minimap is open from the start at the bottom left, 176 × 176 before the zoom, 地圖 right of it (186), 閒置 over it
// (188), the bar and the panels right of it (252); 全體回城 8 over 閒置 (240). 地圖 puts it away and all go back where
// they were; that is for this game only (重來 opens it again). The window made small (under 600) or narrow (its width ÷
// the zoom under 824, ceo 2026-11-21): put away, all back; again large and wide: open, unless 地圖 put it away; opened
// by 地圖 there, as on a phone (nothing moved). The most crowded bar (all six kinds, 進駐 among the commands) clear of
// the commands, ✕ in it. 新手教學's 第 1 步 does not say 「地圖」 while it is open. A phone: as it was (r6-left.spec).
//
// 減少動態效果 on (r6.css: no sliding or growing): where things are does not wait on the page's frames, which in
// Playwright's WebKit came about one a second with Chromium at work beside it.
import { expect, type Page, test } from "@playwright/test";
import { visibleBoxes, watchErrors } from "./helpers.ts";

type Left = { minimap: boolean; auto: boolean; docked: boolean; recall: string; places: number };
const left = (page: Page): Promise<Left> => page.evaluate(() => window.__proto?.game?.left() ?? { minimap: false, auto: false, docked: false, recall: "?", places: -1 });
const zoom = (page: Page): Promise<number> => page.evaluate(() => Number(getComputedStyle(document.documentElement).getPropertyValue("--ui-zoom")) || 1);

/** The fake world with every kind of ours (the gallery's cavalry, a siege engine) and 進駐 (outposts, towers). */
const CROWDED = "&r7=1&outpost=1&hide=1&siege=1&gallery=1";

async function start(page: Page, flags = ""): Promise<void> {
  await page.goto(`./?test=1&mock=1&tps=20${flags}`);
  await page.getByRole("button", { name: "開始", exact: true }).click();
  await page.waitForFunction(() => window.__proto?.ready === true && window.__proto.screen === "battle");
  await page.waitForFunction(() => (window.__proto?.game?.header().tick ?? 0) > 5);
  await page.evaluate(() => window.__proto?.game?.pause());
}

/** All six kinds of ours selected (villagers, spearmen, ranged, mages, cavalry, siege engines). */
async function selectAll(page: Page): Promise<void> {
  const kinds = await page.evaluate(() => {
    const g = window.__proto?.game;
    const me = g?.me();
    const ids = (g?.units() ?? []).filter((u) => u.owner === me && [0, 1, 2, 3, 5, 6].includes(u.type));
    g?.select(ids.map((u) => u.id));
    return new Set(ids.map((u) => u.type)).size;
  });
  expect(kinds).toBe(6);
  await expect(page.locator("#hud .sel-bar")).toBeVisible();
}

/**
 * The most crowded bar (ceo 2026-11-21): what is in it fits (the kinds that do not, 「+N 種」), ✕ in it; clear of the
 * commands (進駐 among them), in the window.
 */
async function crowdOk(page: Page): Promise<void> {
  const look = () =>
    page.evaluate(() => {
      const bar = document.querySelector("#hud .sel-bar") as HTMLElement;
      const row = bar.querySelector(".bar-row") as HTMLElement;
      const b = bar.getBoundingClientRect();
      const x = bar.querySelector(".bar-x")?.getBoundingClientRect();
      const cmds = [...document.querySelectorAll<HTMLElement>("#hud .cmds button")].filter((e) => e.offsetParent !== null);
      const over = cmds.map((e) => e.getBoundingClientRect()).some((r) => Math.min(r.right, b.right) > Math.max(r.left, b.left) && Math.min(r.bottom, b.bottom) > Math.max(r.top, b.top));
      return {
        fits: row.scrollWidth <= row.clientWidth + 1,
        x: x !== undefined && x.width > 0 && x.left >= b.left - 0.5 && x.right <= b.right + 0.5,
        over,
        inWindow: b.left >= 0 && b.top >= 0 && b.right <= innerWidth && b.bottom <= innerHeight,
        enter: cmds.some((e) => /^進駐/.test(e.textContent ?? "")),
      };
    });
  // Fitted again within an update (10 a second).
  await expect.poll(look).toEqual({ fits: true, x: true, over: false, inWindow: true, enter: true });
}

/** Where a thing is, before the zoom: its left and its bottom off the window's foot, and its size. */
async function at(page: Page, selector: string): Promise<{ left: number; bottom: number; w: number; h: number }> {
  const [b] = await visibleBoxes(page, selector);
  if (b === undefined) throw new Error(`${selector} not in sight`);
  const z = await zoom(page);
  const H = page.viewportSize()?.height ?? 0;
  return { left: b.x / z, bottom: (H - b.y - b.height) / z, w: b.width / z, h: b.height / z };
}

const near = (v: number, want: number) => Math.abs(v - want) <= 1.5;

/** Docked: each where 04 puts it (before the zoom). */
async function docked(page: Page): Promise<void> {
  await expect.poll(async () => await left(page)).toMatchObject({ minimap: true, docked: true });
  await expect(page.locator("#hud .minimap")).toBeVisible();
  // Its transition (150 ms) over.
  await expect.poll(async () => (await at(page, "#hud .minimap")).w).toBeGreaterThan(175);
  const mm = await at(page, "#hud .minimap");
  expect(near(mm.left, 4) && near(mm.bottom, 4) && near(mm.w, 176) && near(mm.h, 176), JSON.stringify(mm)).toBe(true);
  const map = await at(page, "#hud .map-btn");
  expect(near(map.left, 186) && near(map.bottom, 4), JSON.stringify(map)).toBe(true);
}

/** Put away: as before 04 (r6-left.spec): 地圖 at 4, 閒置 at 172, the bar at 72. */
async function putAway(page: Page): Promise<void> {
  await expect.poll(async () => await left(page)).toMatchObject({ minimap: false, docked: false });
  await expect(page.locator("#hud .minimap")).toBeHidden();
  const map = await at(page, "#hud .map-btn");
  expect(near(map.left, 4) && near(map.bottom, 4), JSON.stringify(map)).toBe(true);
}

// Layout at the user's size (ceo 2026-11-21: what is about layout keeps a test at 1920 × 950 in Chromium).
test.describe("滑鼠 1920×950", () => {
  test.use({ viewport: { width: 1920, height: 950 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1, reducedMotion: "reduce" });
  test.describe.configure({ timeout: 120_000 });

  test("開局就打開，在左下角 176×176；地圖在右邊、閒置在上面、選兵那一條和選取資訊在右邊（252），全體回城在閒置上面；都不互蓋、不出視窗", async ({ page }, info) => {
    test.skip(info.project.name !== "chromium", "layout: Chromium (ceo 2026-11-21)");
    // On CI's slowest (EPYC 7763) about 45 s, 73 s at worst (× 2.56 and × 4.17 of here, ceo 2026-11-21: over 60%, twice).
    test.setTimeout(150_000);
    const check = watchErrors(page);
    await start(page, CROWDED);
    await docked(page);
    expect(await zoom(page)).toBe(1.5);
    // The minimap drawn as large as it shows (R26-01: its size × the pixel ratio × the zoom), not the old one stretched.
    expect(await page.evaluate(() => (document.querySelector("#hud .minimap") as HTMLCanvasElement).width)).toBe(264);
    // 閒置 (someone idles in the fake world) over it.
    await expect(page.locator("#hud .idle-btn")).toBeVisible();
    const idle = await at(page, "#hud .idle-btn");
    expect(near(idle.left, 4) && near(idle.bottom, 188), JSON.stringify(idle)).toBe(true);
    // The selection's bar right of it, 640 wide (R26-01): the most crowded, all six kinds.
    await selectAll(page);
    const bar = await at(page, "#hud .sel-bar");
    expect(near(bar.left, 252) && near(bar.bottom, 4) && near(bar.w, 640), JSON.stringify(bar)).toBe(true);
    await crowdOk(page);
    // 全體回城 when it jumps out (the enemy at a farmer by the main city, as r6-left.spec): 8 over 閒置.
    const farmer = await page.evaluate(() => {
      const g = window.__proto?.game;
      const me = g?.me();
      return (g?.units() ?? []).find((u) => u.owner === me && u.type === 0 && u.cx >= 12 && u.cx <= 18 && u.cy >= 76 && u.cy <= 80) ?? null;
    });
    if (farmer === null) throw new Error("no farmer by the main city");
    // The fake world hands an event over with a tick: going again.
    await page.getByRole("button", { name: /^繼續/ }).click();
    const FIXED = 1024;
    const FOE = 1;
    await page.evaluate(([id, x, y, by]) => window.__proto?.game?.inject({ k: "attacked", x, y, target: id, by }), [farmer.id, Math.round((farmer.cx + 0.5) * FIXED), Math.round((farmer.cy + 0.5) * FIXED), FOE] as const);
    await expect.poll(async () => (await left(page)).recall).toBe("home");
    await expect(page.locator("#hud .recall-btn")).toBeVisible();
    // Its slide (200 ms) over.
    await expect.poll(async () => (await at(page, "#hud .recall-btn")).left).toBeGreaterThan(3);
    const recall = await at(page, "#hud .recall-btn");
    expect(near(recall.left, 4) && near(recall.bottom, 240), JSON.stringify(recall)).toBe(true);
    // None over another, all in the window.
    const boxes = await visibleBoxes(page, "#hud .minimap, #hud .side-left button, #hud .sel-bar, #hud .cmds, #hud .groups, #hud .res-bar");
    const W = 1920;
    const H = 950;
    for (const b of boxes) expect(b.x >= 0 && b.y >= 0 && b.x + b.width <= W && b.y + b.height <= H, JSON.stringify(b)).toBe(true);
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        const over = Math.min(a.x + a.width, b.x + b.width) > Math.max(a.x, b.x) && Math.min(a.y + a.height, b.y + b.height) > Math.max(a.y, b.y);
        expect(over, `${JSON.stringify(a)} over ${JSON.stringify(b)}`).toBe(false);
      }
    }
    check();
  });
});

// What it does (ceo 2026-11-21: the rest at 1366 × 768, both browsers).
test.describe("滑鼠 1366×768", () => {
  test.use({ viewport: { width: 1366, height: 768 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1, reducedMotion: "reduce" });
  test.describe.configure({ timeout: 120_000 });

  test("地圖收起、再按打開，最擠的選兵那一條跟著讓開、回來，✕ 都在條內；收起以後按 Q 選地方，小地圖自己打開也什麼都不動", async ({ page }) => {
    // On CI's slowest about 56 s, 91 s at worst (× 2.56 and × 4.17 of here); twice that.
    test.setTimeout(180_000);
    const check = watchErrors(page);
    await start(page, CROWDED);
    await docked(page);
    await selectAll(page);
    expect(near((await at(page, "#hud .sel-bar")).left, 252)).toBe(true);
    await crowdOk(page);
    // 地圖: put away, all back (the bar at 72); again: open.
    await page.locator("#hud .map-btn").click();
    await putAway(page);
    expect(near((await at(page, "#hud .sel-bar")).left, 72)).toBe(true);
    await crowdOk(page);
    // Put away, Q (攻擊 picks a spot): the minimap opens on its own over 地圖, as on a phone; the bar, 閒置 and 地圖 stay
    // where they are, and after (Esc) too (ceo 2026-11-21: they jumped aside and back at each pick).
    const where = async () => ({ bar: await at(page, "#hud .sel-bar"), idle: await at(page, "#hud .idle-btn"), map: await at(page, "#hud .map-btn") });
    const before = await where();
    await page.keyboard.press("q");
    await expect.poll(async () => await left(page)).toMatchObject({ minimap: true, auto: true, docked: false });
    await expect(page.locator("#hud .minimap")).toBeVisible();
    expect(await where()).toEqual(before);
    await page.keyboard.press("Escape");
    await expect.poll(async () => await left(page)).toMatchObject({ minimap: false, auto: false, docked: false });
    expect(await where()).toEqual(before);
    await page.locator("#hud .map-btn").click();
    await docked(page);
    expect(near((await at(page, "#hud .sel-bar")).left, 252)).toBe(true);
    await crowdOk(page);
    check();
  });

  test("視窗大小：矮到 600 以下、窄到寬÷倍數不到 824 就收起，回來再打開；1024 寬時收起、打開都重算「+N 種」；窄的時候按地圖照手機的開法", async ({ page }, info) => {
    // Chromium only: Playwright's WebKit, with Chromium at work beside it, ran no frame for 5 s and more after the window
    // changed size, and the resize event (handed over with a frame) came 5 s late or not before the test gave up (17
    // frames in the whole test, Chromium's 126).
    test.skip(info.project.name !== "chromium", "the window's size: Chromium");
    // Six sizes, each the battlefield drawn again: on CI's slowest (EPYC 7763) about 65 s, 106 s at worst (× 2.56 and
    // × 4.17 of here); twice that.
    test.setTimeout(210_000);
    const check = watchErrors(page);
    await start(page, CROWDED);
    await docked(page);
    await selectAll(page);
    // The window under 600: put away, all back; 600 again: open.
    await page.setViewportSize({ width: 1366, height: 560 });
    await putAway(page);
    await page.setViewportSize({ width: 1366, height: 768 });
    await docked(page);
    // 1024 × 768 (846 at 1.21): docked, the bar 343, the kinds folded into 「+N 種」. Put away and docked again with the
    // window as it was: fitted again each time (it was only when the window changed: ✕ pushed out).
    await page.setViewportSize({ width: 1024, height: 768 });
    await docked(page);
    await crowdOk(page);
    await page.locator("#hud .map-btn").click();
    await putAway(page);
    await crowdOk(page);
    await page.locator("#hud .map-btn").click();
    await docked(page);
    await crowdOk(page);
    // Half a 1920 screen (960 × 950 at 1.5: 640): put away; 地圖 opens it as on a phone, the bar where it was.
    await page.setViewportSize({ width: 960, height: 950 });
    await putAway(page);
    await crowdOk(page);
    await page.locator("#hud .map-btn").click();
    await expect.poll(async () => await left(page)).toMatchObject({ minimap: true, docked: false });
    await expect(page.locator("#hud .minimap")).toBeVisible();
    expect(near((await at(page, "#hud .sel-bar")).left, 72)).toBe(true);
    expect(near((await at(page, "#hud .map-btn")).left, 4)).toBe(true);
    await crowdOk(page);
    // Wide again (1236 at 1.5 is 824): docked, open as it was.
    await page.setViewportSize({ width: 1240, height: 950 });
    await docked(page);
    await crowdOk(page);
    check();
  });

  test("地圖收起過：視窗縮放後不自己打開，回開局畫面再繼續這局也收著；重來（新的一局）又打開", async ({ page }, info) => {
    // Two games' starts: on CI's slowest (EPYC 7763) about 56 s, 90 s at worst (× 2.56 and × 4.17 of here); twice that.
    test.setTimeout(180_000);
    const check = watchErrors(page);
    await start(page);
    await docked(page);
    await page.locator("#hud .map-btn").click();
    await putAway(page);
    // The window small and large again (Chromium only, as above): it stays away.
    if (info.project.name === "chromium") {
      await page.setViewportSize({ width: 1366, height: 560 });
      await page.setViewportSize({ width: 1366, height: 768 });
      await page.waitForTimeout(300);
      expect(await left(page)).toMatchObject({ minimap: false, docked: false });
      await page.setViewportSize({ width: 960, height: 950 });
      await page.setViewportSize({ width: 1366, height: 768 });
      await page.waitForTimeout(300);
      expect(await left(page)).toMatchObject({ minimap: false, docked: false });
    }
    // 回開局畫面 and 繼續這局: the same game, as it was.
    await page.getByRole("button", { name: "選單", exact: true }).click();
    await page.getByRole("button", { name: "回開局畫面" }).click();
    await page.locator("#start-game").click();
    await page.waitForFunction(() => window.__proto?.screen === "battle");
    await page.waitForTimeout(300);
    expect(await left(page)).toMatchObject({ minimap: false, docked: false });
    // 重來: a new game, open again.
    await page.getByRole("button", { name: "選單", exact: true }).click();
    await page.getByRole("button", { name: "回開局畫面" }).click();
    await page.getByRole("button", { name: "重來", exact: true }).click();
    await page.waitForFunction(() => window.__proto?.ready === true && window.__proto.screen === "battle");
    await docked(page);
    check();
  });

  test("新手教學第 1 步：小地圖開著，不說「再按左下的『地圖』」；收起來才說；過了第 1 步小地圖還開著", async ({ page }) => {
    // The real game (as mouse.spec's 新手教學): its start is slow on CI.
    test.setTimeout(180_000);
    const check = watchErrors(page);
    await page.goto("./?test=1&tps=100");
    await page.getByRole("button", { name: "新手教學" }).click();
    await page.waitForFunction(() => window.__proto?.ready === true && window.__proto.screen === "battle" && (window.__proto?.tutorial()?.step ?? 0) === 1, null, { timeout: 120_000 });
    const card = page.locator(".tut-card");
    await docked(page);
    await expect(card).toContainText("按住滾輪拖動畫面（或用方向鍵），轉滾輪縮放，再點左下的小地圖跳過去。");
    await expect(card).not.toContainText("地圖」");
    await page.locator("#hud .map-btn").click();
    await expect(card).toContainText("再按左下的「地圖」、點小地圖跳過去。");
    await page.locator("#hud .map-btn").click();
    await docked(page);
    await expect(card).toContainText("再點左下的小地圖跳過去。");
    // Step 1 done (moved, zoomed, the minimap tapped): it stays open.
    const mm = page.locator("#hud .minimap");
    await page.keyboard.down("ArrowRight");
    await page.waitForTimeout(300);
    await page.keyboard.up("ArrowRight");
    const box = await mm.boundingBox();
    if (box === null) throw new Error("no minimap");
    await page.mouse.move(960, 400);
    await page.mouse.wheel(0, -200);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForFunction(() => (window.__proto?.tutorial()?.step ?? 0) >= 2 || window.__proto?.tutorial()?.done === true, null, { timeout: 30_000 });
    await page.waitForTimeout(300);
    expect(await left(page)).toMatchObject({ minimap: true, docked: true });
    check();
  });
});
