// R6-2 on the fake world (?test=1&mock=1&ui=r6): the left (R6-13, D-087 C: 需要時才出現), the alarms
// (R6-22) and what took over from 重設 (R6-30). No 重設; 閒置 only while someone idles; the
// minimap behind 地圖, open on its own while 進攻 or 撤退 picks a spot; 全體回城 jumps out when an
// enemy player's soldiers hurt our farmers or buildings near the main city, and reads 回去工作
// while they hide; 地圖 flashes red and counts the places under attack while the minimap is put
// away; × goes back to nothing selected.

import { expect, type Page, test } from "@playwright/test";
import { injectSafeArea, selectForCommands, shot, visibleBoxes, watchErrors } from "./helpers.ts";

// Fake-world layout (src/mock/mock-port.ts), in cells: our main city at (8, 80), 4 x 4; five idle
// farmers at (13–17, 78); our spearmen from (22, 68). The enemy is owner 1; 2 is NEUTRAL (militia).
const FOE = 1;
const NEUTRAL = 2;
const FIXED = 1024;

const left = (page: Page) => page.evaluate(() => window.__proto?.game?.left() ?? { minimap: false, auto: false, recall: "?", places: -1 });
const mode = (page: Page) => page.evaluate(() => window.__proto?.game?.mode() ?? "");
const lastSent = (page: Page) => page.evaluate(() => window.__proto?.game?.sent().at(-1) as Record<string, unknown> | undefined);
const own = (page: Page, type: number) =>
  page.evaluate((t) => {
    const g = window.__proto?.game;
    const me = g?.me();
    return (g?.units() ?? []).filter((u) => u.owner === me && u.type === t).sort((a, b) => a.id - b.id);
  }, type);
/** An `attacked` event on this unit (where it stands), by this owner. */
const hit = (page: Page, u: { id: number; cx: number; cy: number }, by: number) =>
  page.evaluate(([id, x, y, b]) => window.__proto?.game?.inject({ k: "attacked", x, y, target: id, by: b }), [u.id, Math.round((u.cx + 0.5) * FIXED), Math.round((u.cy + 0.5) * FIXED), by] as const);
const box = async (page: Page, sel: string) => (await visibleBoxes(page, sel))[0];
const near = (v: number, want: number) => Math.abs(v - want) <= 2;

async function start(page: Page, look: "a" | "b"): Promise<void> {
  await page.goto("./?test=1&mock=1&tps=20&ui=r6");
  await page.evaluate((t) => localStorage.setItem("war-game.proto.theme", t), look);
  await page.reload();
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true);
  await injectSafeArea(page, { top: 0, right: 0, bottom: 0, left: 0 });
  await page.evaluate(() => window.__proto?.game?.centerOn(14, 76, 1.1));
}

for (const look of ["a", "b"] as const) {
  const name = look === "a" ? "A 銅木" : "B 墨漆金線";

  test(`左邊（R6-13）${name}：沒有重設；有閒置的村民才有閒置鈕、角上寫人數；地圖鈕打開、收起方形的小地圖；位置照規格`, async ({ page }, info) => {
    const check = watchErrors(page);
    await start(page, look);
    await expect(page.getByRole("button", { name: "重設" })).toHaveCount(0);
    // Five idle at the start.
    const idle = page.locator(".idle-btn");
    await expect(idle).toBeVisible();
    await expect(idle.locator(".badge")).toHaveText("5");
    const ib = await box(page, ".idle-btn");
    expect(near(ib.x, 4) && near(ib.y, 164) && near(ib.width, 68) && near(ib.height, 44), `閒置 ${JSON.stringify(ib)}`).toBe(true);
    const map = page.getByRole("button", { name: "地圖", exact: true });
    const mb = await map.boundingBox();
    expect(mb !== null && near(mb.x, 4) && near(mb.y, 332) && near(mb.width, 60) && near(mb.height, 44), `地圖 ${JSON.stringify(mb)}`).toBe(true);
    // Put away at the start.
    await expect(page.locator(".minimap")).toBeHidden();
    expect((await left(page)).minimap).toBe(false);
    await shot(page, info, `r6-13-left-${look}`);
    await map.tap();
    await expect(page.locator(".minimap")).toBeVisible();
    await expect(map).toHaveClass(/\bactive\b/);
    // Once it has grown open (150 ms; slower on CI's WebKit).
    await expect
      .poll(async () => {
        const mm = await box(page, ".minimap");
        return mm !== undefined && near(mm.x, 4) && near(mm.y, 216) && near(mm.width, 112) && near(mm.height, 112) ? true : JSON.stringify(mm);
      }, { message: "小地圖 at 4, 216, 112 × 112" })
      .toBe(true);
    await shot(page, info, `r6-13-map-open-${look}`);
    await map.tap();
    await expect(page.locator(".minimap")).toBeHidden();
    check();
  });

  test(`家裡被攻擊（R6-13 NEW-02、INV-37）${name}：敵方的兵打主城附近的村民 → 全體回城跳出來、訊息條；按了全體回城變回去工作；民兵、或打到兵，不跳`, async ({ page }, info) => {
    const check = watchErrors(page);
    await start(page, look);
    const recall = page.locator(".recall-btn");
    await expect(recall).toBeHidden();
    // One of the five idle by the main city (8, 80).
    const farmer = (await own(page, 0)).find((f) => f.cx >= 12 && f.cx <= 18 && f.cy >= 76 && f.cy <= 80);
    if (farmer === undefined) throw new Error("no farmer by the main city");
    const [spear] = await own(page, 1);
    // A town's militia on a farmer, an enemy's on a soldier: no reason to hide the farmers.
    await hit(page, farmer, NEUTRAL);
    await hit(page, spear, FOE);
    await page.waitForTimeout(300);
    expect((await left(page)).recall).toBe("");
    await expect(recall).toBeHidden();
    // The enemy's on a farmer by the main city.
    await hit(page, farmer, FOE);
    await expect.poll(async () => (await left(page)).recall).toBe("home");
    await expect(recall).toBeVisible();
    await expect(recall).toContainText("全體回城");
    await expect(recall).toContainText("家裡被攻擊");
    await expect(page.locator(".toast")).toHaveText("家裡被攻擊：主城附近有敵兵");
    // Once it has slid in (200 ms; slower on CI's WebKit).
    await expect
      .poll(async () => {
        const rb = await box(page, ".recall-btn");
        return rb !== undefined && near(rb.x, 4) && near(rb.y, 106) && near(rb.width, 100) && near(rb.height, 50) ? true : JSON.stringify(rb);
      }, { message: "全體回城 at 4, 106, 100 × 50" })
      .toBe(true);
    await shot(page, info, `r6-13-home-hit-${look}`);
    // Only a reminder: nothing was sent until the player taps it.
    expect((await lastSent(page))?.c).not.toBe("recall");
    await recall.tap();
    await expect.poll(() => lastSent(page)).toMatchObject({ c: "recall", on: true });
    await expect(recall).toContainText("回去工作");
    await expect(recall).toContainText("村民躲著");
    await page.waitForTimeout(250);
    await shot(page, info, `r6-13-go-back-${look}`);
    await recall.tap();
    await expect.poll(() => lastSent(page)).toMatchObject({ c: "recall", on: false });
    await expect(recall).toBeHidden();
    // In the menu, always.
    await page.getByRole("button", { name: "選單", exact: true }).tap();
    await expect(page.locator(".dialog").getByRole("button", { name: "全體回城", exact: true })).toBeVisible();
    await page.locator(".dialog").getByRole("button", { name: "關閉" }).tap();
    check();
  });

  test(`地圖收著時被攻擊（R6-22）${name}：地圖鈕閃紅、寫幾處；打開小地圖就不閃，改由小地圖上的紅圈閃`, async ({ page }, info) => {
    const check = watchErrors(page);
    await start(page, look);
    const map = page.locator(".map-btn");
    // Two places far apart.
    const [spear] = await own(page, 1);
    await hit(page, { id: spear.id, cx: 80, cy: 20 }, FOE);
    await hit(page, { id: spear.id, cx: 60, cy: 40 }, FOE);
    await expect.poll(async () => (await left(page)).places).toBe(2);
    await expect(map.locator(".badge")).toHaveText("2");
    await expect(map).toHaveAttribute("aria-label", "地圖：2 處被攻擊");
    // Flashing: lit and not, 0.4 s each.
    const seen = new Set<boolean>();
    for (let i = 0; i < 12 && seen.size < 2; i++) {
      seen.add(await map.evaluate((e) => e.classList.contains("alarm")));
      await page.waitForTimeout(110);
    }
    expect([...seen].sort()).toEqual([false, true]);
    // The lit one for the picture: 減少動態效果 keeps it so.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(map).toHaveClass(/\balarm\b/);
    await shot(page, info, `r6-22-map-alarm-${look}`);
    await page.emulateMedia({ reducedMotion: null });
    await map.tap();
    await expect.poll(async () => (await left(page)).places).toBe(0);
    await expect(map.locator(".badge")).toBeHidden();
    await expect(map).not.toHaveClass(/\balarm\b/);
    check();
  });
}

test("地圖鈕警報，減少動態效果（R6-22）：不閃，一直是紅的", async ({ page }) => {
  const check = watchErrors(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await start(page, "a");
  const [spear] = await own(page, 1);
  await hit(page, { id: spear.id, cx: 80, cy: 20 }, FOE);
  const map = page.locator(".map-btn");
  for (let i = 0; i < 8; i++) {
    await expect(map).toHaveClass(/\balarm\b/);
    await page.waitForTimeout(110);
  }
  check();
});

test("進攻、撤退選位置時小地圖自動打開，選完或取消後收回；自己打開的不收（R6-13 NEW-03）", async ({ page }, info) => {
  const check = watchErrors(page);
  await start(page, "a");
  const soldiers = (await own(page, 1)).map((u) => u.id);
  await selectForCommands(page, soldiers);
  await page.locator(".cmds").getByRole("button", { name: /^撤退/ }).tap();
  await expect.poll(() => mode(page)).toBe("retreat");
  await expect.poll(async () => await left(page)).toMatchObject({ minimap: true, auto: true });
  await expect(page.locator(".minimap")).toBeVisible();
  await shot(page, info, "r6-13-retreat-map-a");
  // Picked on the minimap: done, and it goes away again.
  const mm = await page.locator(".minimap").boundingBox();
  if (mm === null) throw new Error("no minimap");
  await page.touchscreen.tap(mm.x + mm.width * 0.5, mm.y + mm.height * 0.5);
  await expect.poll(() => mode(page)).toBe("normal");
  await expect.poll(async () => (await left(page)).minimap).toBe(false);
  await expect(page.locator(".minimap")).toBeHidden();
  // 進攻, then 取消.
  await page.locator(".cmds").getByRole("button", { name: /^進攻/ }).tap();
  await expect.poll(() => mode(page)).toBe("advance");
  await expect.poll(async () => (await left(page)).minimap).toBe(true);
  await page.locator(".prompt").getByRole("button", { name: "取消" }).tap();
  await expect.poll(async () => (await left(page)).minimap).toBe(false);
  // Opened by hand: it stays after.
  await page.getByRole("button", { name: "地圖", exact: true }).tap();
  await page.locator(".cmds").getByRole("button", { name: /^撤退/ }).tap();
  await page.locator(".prompt").getByRole("button", { name: "取消" }).tap();
  await expect.poll(() => mode(page)).toBe("normal");
  expect(await left(page)).toMatchObject({ minimap: true, auto: false });
  check();
});

test("×（R6-30）：回到什麼都沒選——選位置中按 × 也離開選位置；建造選單也關掉", async ({ page }) => {
  const check = watchErrors(page);
  await start(page, "a");
  const soldiers = (await own(page, 1)).map((u) => u.id);
  await selectForCommands(page, soldiers);
  await page.locator(".cmds").getByRole("button", { name: /^進攻/ }).tap();
  await expect.poll(() => mode(page)).toBe("advance");
  await page.getByRole("button", { name: "取消選取" }).tap();
  await expect.poll(() => mode(page)).toBe("normal");
  expect(await page.evaluate(() => window.__proto?.game?.selection())).toEqual({ units: [], building: null });
  await expect(page.locator(".prompt")).toBeHidden();
  // The build menu, open, and ×.
  const farmers = (await own(page, 0)).map((u) => u.id);
  await selectForCommands(page, farmers);
  await page.locator(".cmds").getByRole("button", { name: /^建造/ }).tap();
  await expect(page.locator(".cmds").getByRole("button", { name: /^民居/ })).toBeVisible();
  await page.getByRole("button", { name: "取消選取" }).tap();
  expect(await page.evaluate(() => window.__proto?.game?.selection())).toEqual({ units: [], building: null });
  await selectForCommands(page, farmers);
  await expect(page.locator(".cmds").getByRole("button", { name: /^建造/ })).toBeVisible();
  check();
});

test("放建築的提示列有「取消」（R6-30 NEW-12）：按了和 ✗ 一樣，預覽收掉、跳出「已取消蓋民居」", async ({ page }, info) => {
  const check = watchErrors(page);
  await start(page, "a");
  const farmers = (await own(page, 0)).map((u) => u.id);
  await selectForCommands(page, farmers);
  await page.locator(".cmds").getByRole("button", { name: /^建造/ }).tap();
  await page.locator(".cmds").getByRole("button", { name: /^民居/ }).tap();
  await expect.poll(() => mode(page)).toMatch(/^place:/);
  const cancel = page.locator(".prompt").getByRole("button", { name: "取消", exact: true });
  await expect(cancel).toBeVisible();
  await shot(page, info, "r6-30-place-cancel-a");
  await cancel.tap();
  await expect.poll(() => mode(page)).toBe("normal");
  await expect(page.locator(".prompt")).toBeHidden();
  await expect(page.locator(".toast")).toHaveText("已取消蓋民居");
  await expect(page.locator(".toast")).toHaveClass(/\btoast-info\b/);
  check();
});
