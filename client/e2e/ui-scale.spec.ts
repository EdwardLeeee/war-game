// 介面放大 (R26-01 B, D-154; design/r26/spec.md 01) on a computer's window with a mouse: the interface (#hud, #start)
// 1.5 times at 1920 × 950 and 1.21 at 1366 × 768 (自動), 1 under 600 tall (a phone held sideways never changes);
// 設定 → 介面大小 (large windows only) sets 100%／125%／150%, at once and remembered. What sits at a point of the
// battlefield's screen sits there still: the box, the wheel, ✓ ✗ by the preview, 進駐's tags, the attack arrow, a tap on
// the minimap, the tutorial's frame. With a mouse the game starts 1.3 times as close.

import { expect, type Page, test } from "@playwright/test";
import { watchErrors } from "./helpers.ts";

// 1920 × 950 drawn with the CPU in CI's Chromium: on the slowest machine (AMD EPYC 7763, #535's run 44762845583) 50.9,
// 57.1 and 59.8 s of the 60 these had; twice that.
test.describe.configure({ timeout: 120_000 });
test.use({ isMobile: false, hasTouch: false, deviceScaleFactor: 1 });

const BIG = { width: 1920, height: 950 };
const zoomOf = (page: Page, id: string) => page.evaluate((i) => Number(getComputedStyle(document.getElementById(i) as HTMLElement).zoom || 1), id);

async function start(page: Page, size = BIG, query = "&mock=1&tps=20"): Promise<void> {
  await page.setViewportSize(size);
  await page.goto(`./?test=1${query}`);
  await page.getByRole("button", { name: "開始", exact: true }).click();
  await page.waitForFunction(() => window.__proto?.ready === true && window.__proto.screen === "battle");
  await page.waitForFunction(() => (window.__proto?.game?.header().tick ?? 0) > 5);
}

/** A rectangle on the screen, rounded. */
async function rect(page: Page, selector: string): Promise<{ x: number; y: number; w: number; h: number }> {
  const b = await page.locator(selector).filter({ visible: true }).first().boundingBox();
  if (b === null) throw new Error(`no ${selector}`);
  return { x: b.x, y: b.y, w: b.width, h: b.height };
}

test("倍數：1920×950 是 1.5、1366×768 是 1.21、不到 600 高是 1（手機橫向 336 高一樣）；戰場不放大", async ({ page }) => {
  for (const [size, z] of [
    [BIG, 1.5],
    [{ width: 1366, height: 768 }, 1.21],
    [{ width: 1280, height: 599 }, 1],
    [{ width: 932, height: 336 }, 1],
  ] as const) {
    await page.setViewportSize(size);
    await page.goto("./?test=1&mock=1");
    await expect.poll(() => zoomOf(page, "start"), { message: `${size.width}×${size.height}` }).toBeCloseTo(z, 2);
    expect(await zoomOf(page, "hud")).toBeCloseTo(z, 2);
    expect(await zoomOf(page, "stage")).toBe(1);
  }
});

test("設定 → 介面大小：只在大視窗出現；選 100% 馬上變回 1、記在這台裝置，重新整理後一樣；自動又回到 1.5", async ({ page }) => {
  const check = watchErrors(page);
  await start(page);
  await page.getByRole("button", { name: "選單", exact: true }).click();
  await page.getByRole("button", { name: /^設定/ }).click();
  const row = page.getByRole("radiogroup", { name: "介面大小" });
  await expect(row).toBeVisible();
  await expect(row.getByRole("radio", { name: "自動" })).toHaveAttribute("aria-checked", "true");
  await row.getByRole("radio", { name: "100%" }).click();
  await expect.poll(() => zoomOf(page, "hud")).toBe(1);
  await expect(page.getByRole("radiogroup", { name: "介面大小" }).getByRole("radio", { name: "100%" })).toHaveAttribute("aria-checked", "true");
  await page.reload();
  await expect.poll(() => zoomOf(page, "start")).toBe(1);
  await start(page);
  await page.getByRole("button", { name: "選單", exact: true }).click();
  await page.getByRole("button", { name: /^設定/ }).click();
  await page.getByRole("radiogroup", { name: "介面大小" }).getByRole("radio", { name: "自動" }).click();
  await expect.poll(() => zoomOf(page, "hud")).toBeCloseTo(1.5, 2);
  // A phone's window: no such row.
  await page.setViewportSize({ width: 932, height: 336 });
  await page.getByRole("button", { name: "回選單" }).click();
  await page.getByRole("button", { name: /^設定/ }).click();
  await expect(page.getByRole("radiogroup", { name: "介面風格" })).toBeVisible();
  await expect(page.getByRole("radiogroup", { name: "介面大小" })).toHaveCount(0);
  check();
});

test("滑鼠開局拉近 1.3 倍；框選的框、指令輪盤、放建築的 ✓ ✗ 都在滑鼠指的地方", async ({ page }) => {
  const check = watchErrors(page);
  await start(page);
  expect((await page.evaluate(() => window.__proto?.game?.camera().scale ?? 0)) ?? 0).toBeCloseTo(1.3, 2);
  // The left button's box (R26 06 B): on the screen where it was dragged.
  await page.mouse.move(700, 300);
  await page.mouse.down();
  await page.mouse.move(900, 420, { steps: 4 });
  const box = await rect(page, ".marquee");
  expect(Math.abs(box.x - 700)).toBeLessThan(3);
  expect(Math.abs(box.y - 300)).toBeLessThan(3);
  // Its border outside the dragged box (2 px, 3 on the screen at 1.5).
  expect(Math.abs(box.w - 200)).toBeLessThan(8);
  expect(Math.abs(box.h - 120)).toBeLessThan(8);
  await page.mouse.up();
  // The wheel: a finger's long press on a soldier of ours (a mouse has none, 06 B), its buttons round that point.
  const me = await page.evaluate(() => window.__proto?.game?.me() ?? 0);
  const spear = (await page.evaluate(() => window.__proto?.game?.units() ?? [])).find((u) => u.owner === me && u.type === 1);
  if (spear === undefined) throw new Error("no spearman");
  await page.evaluate(([x, y]) => window.__proto?.game?.centerOn(x, y, 1.3), [spear.fx - 0.5, spear.fy - 0.5] as const);
  await page.waitForTimeout(300);
  const at = (await page.evaluate(() => window.__proto?.game?.units() ?? [])).find((u) => u.id === spear.id);
  if (at === undefined) throw new Error("gone");
  const touch = (type: string) =>
    page.evaluate(
      ([t, x, y]) => document.querySelector("canvas")?.dispatchEvent(new PointerEvent(t, { pointerId: 7, pointerType: "touch", isPrimary: true, button: 0, buttons: t === "pointerup" ? 0 : 1, clientX: x, clientY: y, bubbles: true, cancelable: true })),
      [type, at.sx, at.sy] as const,
    );
  await touch("pointerdown");
  await expect.poll(() => page.evaluate(() => window.__proto?.game?.wheel() ?? null)).not.toBeNull();
  await touch("pointerup");
  const items = await page.locator(".wheel-item").evaluateAll((es) => es.map((e) => e.getBoundingClientRect()).map((r) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 })));
  expect(items.length).toBeGreaterThan(0);
  for (const p of items) expect(Math.hypot(p.x - at.sx, p.y - at.sy), "a wheel button round the point").toBeLessThan(200);
  await page.keyboard.press("Escape");
  await page.mouse.click(40, 500);
  // ✓ ✗ beside the preview (a house).
  await page.evaluate(() => window.__proto?.game?.select([]));
  await page.evaluate(() => window.__proto?.game?.startPlacement(1));
  const p = await page.evaluate(() => window.__proto?.game?.placement() ?? null);
  if (p === null) throw new Error("no placement");
  const ghost = await page.evaluate(([x, y]) => window.__proto?.game?.cellToScreen(x, y) ?? { x: 0, y: 0 }, [p.cellX, p.cellY] as const);
  // A click puts the preview there (as a drag let go does), ✓ ✗ beside it.
  await page.mouse.click(ghost.x + 60, ghost.y + 40);
  await expect.poll(async () => (await page.evaluate(() => window.__proto?.game?.placement() ?? null))?.phase).toBe("confirm");
  const place = await rect(page, ".place-confirm");
  const now = await page.evaluate(() => window.__proto?.game?.placement() ?? null);
  if (now === null) throw new Error("no placement");
  const g = await page.evaluate(([x, y]) => window.__proto?.game?.cellToScreen(x, y) ?? { x: 0, y: 0 }, [now.cellX, now.cellY] as const);
  expect(Math.hypot(place.x + place.w / 2 - g.x, place.y + place.h / 2 - g.y), "✓ ✗ by the preview").toBeLessThan(260);
  check();
});

test("進駐的標籤在它的建築旁邊；警示箭頭在畫面邊上、不蓋按鈕；點小地圖正中間，鏡頭到地圖正中間", async ({ page }) => {
  const check = watchErrors(page);
  // The fake world with 進駐 (its rules as the game's now: market=1 takes them).
  await start(page, BIG, "&mock=1&tps=20&market=1");
  // 進駐: soldiers selected, then the tags as laid out on the screen.
  await page.locator(".army-btn").click();
  await page.getByRole("button", { name: /^進駐/ }).first().click();
  await expect.poll(() => page.evaluate(() => window.__proto?.game?.mode())).toBe("enter");
  await page.waitForTimeout(600);
  const laid = await page.evaluate(() => (window.__proto?.game?.enter().tags ?? []).filter((t) => t.mode === "full"));
  expect(laid.length).toBeGreaterThan(0);
  const shown = await page.locator(".enter-tag.shown").evaluateAll((es) => es.map((e) => e.getBoundingClientRect()).map((r) => ({ x: r.x, y: r.y, w: r.width, h: r.height })));
  for (const t of laid) {
    const near = shown.some((r) => Math.abs(r.x - t.x) < 3 && Math.abs(r.y - t.y) < 3 && Math.abs(r.w - t.w) < 3);
    expect(near, `the tag of ${t.name} where it was laid out (${Math.round(t.x)}, ${Math.round(t.y)})`).toBe(true);
  }
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /^取消/ }).first().click().catch(() => {});
  // The attack arrow: a place far off, the arrow inside the window, on no button.
  const city = await page.evaluate(() => (window.__proto?.game?.buildings() ?? []).find((b) => b.owner === window.__proto?.game?.me() && b.type === 0));
  if (city === undefined) throw new Error("no main city");
  await page.evaluate(([x, y]) => window.__proto?.game?.centerOn(x, y, 1.3), [city.cx + 40, city.cy - 30] as const);
  await page.evaluate(([id, x, y]) => window.__proto?.game?.inject({ k: "attacked", x, y, target: id, by: 1 }), [city.id, Math.round((city.cx + 2) * 1024), Math.round((city.cy + 2) * 1024)] as const);
  const arrow = await rect(page, ".alert-arrow");
  expect(arrow.x).toBeGreaterThanOrEqual(0);
  expect(arrow.y).toBeGreaterThanOrEqual(0);
  expect(arrow.x + arrow.w).toBeLessThanOrEqual(BIG.width);
  expect(arrow.y + arrow.h).toBeLessThanOrEqual(BIG.height);
  const covered = await page.evaluate(() => {
    const a = document.querySelector(".alert-arrow")?.getBoundingClientRect();
    if (a === undefined) return ["no arrow"];
    return [...document.querySelectorAll<HTMLElement>("#hud button")]
      .filter((e) => e.closest(".alert-arrows") === null)
      .map((e) => ({ e, r: e.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && r.width < innerWidth * 0.8 && Math.min(a.right, r.right) > Math.max(a.left, r.left) && Math.min(a.bottom, r.bottom) > Math.max(a.top, r.top))
      .map(({ e }) => e.getAttribute("aria-label") || e.textContent || "");
  });
  expect(covered, "the arrow over no button").toEqual([]);
  // The minimap's middle: the camera to the map's middle.
  await page.getByRole("button", { name: /地圖/ }).first().click();
  const mm = await rect(page, "canvas.minimap");
  await page.mouse.click(mm.x + mm.w / 2, mm.y + mm.h / 2);
  const size = await page.evaluate(() => (window.__proto?.game?.init() as { map?: { size?: number } } | null)?.map?.size ?? null);
  const c = await page.evaluate(() => window.__proto?.game?.centreCell() ?? { x: 0, y: 0 });
  if (size !== null) {
    expect(Math.abs(c.x - size / 2)).toBeLessThan(4);
    expect(Math.abs(c.y - size / 2)).toBeLessThan(4);
  }
  check();
});

test("新手教學 1920×950：說明卡放大了，框框住按鈕（第 3 步「建造」）", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize(BIG);
  await page.goto("./?test=1&tps=100");
  await page.getByRole("button", { name: "新手教學" }).click();
  await page.waitForFunction(() => window.__proto?.ready === true && window.__proto.screen === "battle", null, { timeout: 120_000 });
  const state = () => page.evaluate(() => window.__proto?.tutorial() ?? null);
  for (let s = 1; s <= 2; s++) {
    const before = (await state())?.step ?? 0;
    await page.locator(".tut-card").getByRole("button", { name: "跳過這步" }).click();
    await expect.poll(async () => (await state())?.step ?? 0, { timeout: 60_000 }).toBeGreaterThan(before);
  }
  await expect.poll(async () => (await state())?.phase, { timeout: 60_000 }).toBe("3a");
  await expect.poll(async () => (await state())?.target ?? null).not.toBeNull();
  // The frame drawn for this target (a busy WebKit draws it a little after the step changes).
  await expect
    .poll(async () => {
      const target = (await state())?.target?.box;
      const ring = await rect(page, ".tut-ring").catch(() => null);
      if (target == null || ring === null) return 999;
      return Math.max(Math.abs(ring.x + ring.w / 2 - (target.x + target.w / 2)), Math.abs(ring.y + ring.h / 2 - (target.y + target.h / 2)), Math.abs(ring.w - target.w) - 12);
    }, { message: "the frame round the target", timeout: 10_000 })
    .toBeLessThan(4);
  const card = await rect(page, ".tut-card");
  expect(card.x + card.w).toBeLessThanOrEqual(BIG.width);
  expect(await zoomOf(page, "hud")).toBeCloseTo(1.5, 2);
});
