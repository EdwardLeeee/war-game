// 滑鼠操作 06 B (R26, design/r26/spec.md; the user 2026-11-18, ceo 2026-11-20), a computer's window (1366 × 768, a
// mouse, no touch) on the fake world: the left button dragged is a box at once (no hold first), a left click selects
// and never orders (on open ground it clears); a right click is the order a tap gives the units selected and keeps
// them selected, dragged it does nothing, with nothing selected nothing; the middle button drags the view; the arrow
// keys and the window's edge move it; whichever button began goes on (the other is not taken); let go over a panel or
// outside the window, a box ends as it is; the browser's menu stays away. And 新手教學's 第 5 步 with the mouse's words.

import { expect, type Page, test } from "@playwright/test";
import { watchErrors } from "./helpers.ts";

const W = 1366;
const H = 768;
test.use({ viewport: { width: W, height: H }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 });
// 1366 × 768, R26's smaller window (ui-scale.spec has 1920 × 950's): Chromium on CI draws with the CPU, a third less
// to draw than 1920 × 950 (its right-click test 96 s of 120 there on an EPYC 7763, #548's run 44838086316).
test.describe.configure({ timeout: 120_000 });

const selection = (page: Page) => page.evaluate(() => window.__proto?.game?.selection().units ?? []);
const orders = (page: Page) => page.evaluate(() => (window.__proto?.game?.sent() ?? []).filter((c) => (c as { auto?: boolean }).auto !== true) as { c: string; u?: number[]; target?: number }[]);
const camera = (page: Page) => page.evaluate(() => window.__proto?.game?.camera() ?? { x: 0, y: 0, scale: 1, flinging: false });

async function start(page: Page): Promise<void> {
  await page.goto("./?test=1&mock=1&tps=20");
  await page.getByRole("button", { name: "開始", exact: true }).click();
  await page.waitForFunction(() => window.__proto?.ready === true && window.__proto.screen === "battle");
  await page.waitForFunction(() => (window.__proto?.game?.header().tick ?? 0) > 5);
  // Every menu the browser was asked for, and whether the page kept it away.
  await page.evaluate(() => {
    const w = window as unknown as { menus: boolean[] };
    w.menus = [];
    document.addEventListener("contextmenu", (e) => w.menus.push(e.defaultPrevented));
  });
}

const menusKept = (page: Page) => page.evaluate(() => (window as unknown as { menus: boolean[] }).menus.every((p) => p));

/** Open ground on the battlefield: nothing picked there, the canvas on top. */
const open = (page: Page, p: { x: number; y: number }) =>
  page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.tagName === "CANVAS" && (window.__proto?.game?.pickAt(x, y) ?? null) === null, [p.x, p.y] as const);

/** Our army (spearmen, archers, cavalry), the camera on it, and a box round it from open ground on the battlefield. */
async function soldiersBox(page: Page): Promise<{ ids: number[]; from: { x: number; y: number }; to: { x: number; y: number } }> {
  const me = await page.evaluate(() => window.__proto?.game?.me() ?? 0);
  const army = async () => (await page.evaluate(() => window.__proto?.game?.units() ?? [])).filter((u) => u.owner === me && [1, 2, 3].includes(u.type));
  const first = await army();
  expect(first.length, "soldiers of ours").toBeGreaterThan(0);
  const mx = first.reduce((a, u) => a + u.fx, 0) / first.length;
  const my = first.reduce((a, u) => a + u.fy, 0) / first.length;
  await page.evaluate(([x, y]) => window.__proto?.game?.centerOn(x - 0.5, y - 0.5, 1), [mx, my] as const);
  await page.waitForTimeout(300);
  const now = await army();
  const xs = now.map((u) => u.sx);
  const ys = now.map((u) => u.sy);
  for (const m of [40, 60, 80, 110]) {
    const [x0, x1, y0, y1] = [Math.min(...xs) - m, Math.max(...xs) + m, Math.min(...ys) - m, Math.max(...ys) + m];
    for (const [from, to] of [
      [{ x: x0, y: y1 }, { x: x1, y: y0 }],
      [{ x: x1, y: y1 }, { x: x0, y: y0 }],
      [{ x: x0, y: y0 }, { x: x1, y: y1 }],
      [{ x: x1, y: y0 }, { x: x0, y: y1 }],
    ]) {
      if (await open(page, from)) return { ids: now.map((u) => u.id).sort((a, b) => a - b), from, to };
    }
  }
  throw new Error("no open corner round the army");
}

/** The box selected them: every soldier in it, and soldiers only (as the long press's box: military first). */
async function expectBoxed(page: Page, ids: number[]): Promise<void> {
  await expect.poll(async () => (await selection(page)).filter((u) => ids.includes(u)).length).toBe(ids.length);
  const me = await page.evaluate(() => window.__proto?.game?.me() ?? 0);
  const units = await page.evaluate(() => window.__proto?.game?.units() ?? []);
  for (const id of await selection(page)) {
    const u = units.find((v) => v.id === id);
    expect(u?.owner, "ours").toBe(me);
    expect(u?.type, "no farmer with soldiers").not.toBe(0);
  }
}

/** The left button's box round our army: they are selected. */
async function boxArmy(page: Page): Promise<{ ids: number[]; from: { x: number; y: number }; to: { x: number; y: number } }> {
  const b = await soldiersBox(page);
  await page.mouse.move(b.from.x, b.from.y);
  await page.mouse.down();
  await page.mouse.move(b.to.x, b.to.y, { steps: 4 });
  await page.mouse.up();
  await expectBoxed(page, b.ids);
  return b;
}

/** Open ground a few dozen px off `p` on screen. */
async function groundNear(page: Page, p: { x: number; y: number }): Promise<{ x: number; y: number }> {
  for (const d of [160, 220, 280, 120]) {
    for (const [dx, dy] of [
      [d, 0],
      [-d, 0],
      [0, d],
      [0, -d],
      [d, d],
      [-d, -d],
    ]) {
      const q = { x: p.x + dx, y: p.y + dy };
      if (q.x > 60 && q.y > 60 && q.x < W - 60 && q.y < H - 60 && (await open(page, q))) return q;
    }
  }
  throw new Error("no open ground near");
}

test("左鍵拖曳就框選，不用先按住等；放開選到框裡的兵（和長按框選一樣）", async ({ page }) => {
  const check = watchErrors(page);
  await start(page);
  const { ids, from, to } = await soldiersBox(page);
  const cam = await camera(page);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  // Straight away (well under the long press's 350 ms): the box is up.
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 2 });
  await expect(page.locator(".marquee")).toBeVisible();
  await page.mouse.move(to.x, to.y, { steps: 2 });
  await page.mouse.up();
  await expect(page.locator(".marquee")).toBeHidden();
  await expectBoxed(page, ids);
  expect(await camera(page), "the left button does not drag the view").toEqual(cam);
  check();
});

test("左鍵點：點兵選他，點兩下選畫面上同一種；選著兵時點空地是取消選取，不下指令", async ({ page }) => {
  const check = watchErrors(page);
  await start(page);
  const { ids, from } = await boxArmy(page);
  const me = await page.evaluate(() => window.__proto?.game?.me() ?? 0);
  const units = await page.evaluate(() => window.__proto?.game?.units() ?? []);
  const one = units.find((u) => u.id === ids[0]);
  if (one === undefined) throw new Error("gone");
  const sent = (await orders(page)).length;
  // On open ground: none selected, no order.
  await page.mouse.click(from.x, from.y);
  await expect.poll(() => selection(page)).toEqual([]);
  // On a soldier: that one; a double click: those of its kind on the screen.
  const at = (await page.evaluate(() => window.__proto?.game?.units() ?? [])).find((u) => u.id === one.id);
  if (at === undefined) throw new Error("gone");
  await page.mouse.click(at.sx, at.sy);
  await expect.poll(() => selection(page)).toEqual([one.id]);
  await page.waitForTimeout(500);
  await page.mouse.dblclick(at.sx, at.sy);
  const kind = units.filter((u) => u.owner === me && u.type === one.type).length;
  await expect.poll(async () => (await selection(page)).length).toBeGreaterThan(1);
  expect((await selection(page)).length).toBeLessThanOrEqual(kind);
  // Left clicks ordered nothing.
  expect((await orders(page)).length).toBe(sent);
  check();
});

test("右鍵點：選著兵時點地面就走過去，選取不變；點敵人就打；右鍵拖、什麼都沒選時右鍵都不做事；瀏覽器的右鍵選單不出來", async ({ page }) => {
  const check = watchErrors(page);
  await start(page);
  const { ids, from } = await boxArmy(page);
  // On open ground: they walk there (移動), still selected.
  const there = await groundNear(page, from);
  await page.mouse.click(there.x, there.y, { button: "right" });
  await expect.poll(async () => (await orders(page)).at(-1)?.c).toMatch(/^(retreat|move)$/);
  expect(((await orders(page)).at(-1)?.u ?? []).slice().sort((a, b) => a - b)).toEqual(ids);
  expect(await selection(page)).toEqual(ids);
  // Dragged: nothing.
  let sent = (await orders(page)).length;
  const cam = await camera(page);
  await page.mouse.move(there.x, there.y);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(there.x + 150, there.y + 60, { steps: 5 });
  await page.mouse.up({ button: "right" });
  await page.waitForTimeout(300);
  await expect(page.locator(".marquee")).toBeHidden();
  expect((await orders(page)).length).toBe(sent);
  expect(await selection(page)).toEqual(ids);
  expect(await camera(page)).toEqual(cam);
  // An enemy: attacked.
  const me = await page.evaluate(() => window.__proto?.game?.me() ?? 0);
  const foe = (await page.evaluate(() => window.__proto?.game?.units() ?? [])).find((u) => u.owner !== me && u.owner < 4);
  if (foe !== undefined) {
    await page.evaluate(([x, y]) => window.__proto?.game?.centerOn(x - 0.5, y - 0.5, 1), [foe.fx, foe.fy] as const);
    await page.waitForTimeout(300);
    const f = (await page.evaluate(() => window.__proto?.game?.units() ?? [])).find((u) => u.id === foe.id);
    if (f === undefined) throw new Error("gone");
    await page.mouse.click(f.sx, f.sy, { button: "right" });
    await expect.poll(async () => (await orders(page)).at(-1)).toMatchObject({ c: "attack", target: foe.id });
    expect(await selection(page)).toEqual(ids);
  }
  // Nothing selected: nothing.
  await page.evaluate(() => window.__proto?.game?.select([]));
  sent = (await orders(page)).length;
  const ground = await groundNear(page, { x: W / 2, y: H / 2 });
  await page.mouse.click(ground.x, ground.y, { button: "right" });
  await page.waitForTimeout(300);
  expect((await orders(page)).length).toBe(sent);
  expect(await menusKept(page), "the browser's menu kept away").toBe(true);
  check();
});

test("按住滾輪拖：畫面跟著移動，選取不變；方向鍵和滑鼠到畫面邊緣也移動畫面，離開邊緣就停", async ({ page }) => {
  const check = watchErrors(page);
  await start(page);
  await boxArmy(page);
  const chosen = await selection(page);
  // The middle button: 1 to 1 (no fling left: a still pointer before letting go).
  let cam = await camera(page);
  await page.mouse.move(900, 500);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(1000, 540, { steps: 5 });
  await page.waitForTimeout(150);
  await page.mouse.up({ button: "middle" });
  const moved = await camera(page);
  expect(Math.abs(moved.x - cam.x) + Math.abs(moved.y - cam.y), "the view moved").toBeGreaterThan(50);
  expect(await selection(page)).toEqual(chosen);
  await expect(page.locator(".marquee")).toBeHidden();
  // The arrow keys: right moves the view right (its x grows) while held, and stops when let go. (Held until it has
  // moved: a busy page may draw no frame in a given 0.4 s, and the view moves by the frame.)
  cam = await camera(page);
  await page.keyboard.down("ArrowRight");
  await expect.poll(async () => (await camera(page)).x, { message: "ArrowRight" }).toBeGreaterThan(cam.x);
  await page.keyboard.up("ArrowRight");
  await page.waitForTimeout(200);
  const still = await camera(page);
  await page.waitForTimeout(300);
  expect((await camera(page)).x, "stopped").toBe(still.x);
  // The window's edge (the left one): the view goes left while the pointer is there.
  cam = await camera(page);
  await page.mouse.move(2, H / 2);
  await expect.poll(async () => (await camera(page)).x).toBeLessThan(cam.x);
  await page.mouse.move(W / 2, H / 2);
  await page.waitForTimeout(200);
  const off = await camera(page);
  await page.waitForTimeout(300);
  expect((await camera(page)).x, "off the edge: stopped").toBe(off.x);
  check();
});

test("左鍵框選拖到按鈕上、拖出視窗才放開：框選照樣結束，之後左鍵照常", async ({ page }) => {
  await start(page);
  const { ids, from } = await soldiersBox(page);
  const over = await page.locator(".top-right button").first().boundingBox();
  if (over === null) throw new Error("no button");
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(over.x + over.width / 2, over.y + over.height / 2, { steps: 6 });
  await expect(page.locator(".marquee")).toBeVisible();
  await page.mouse.up();
  await expect(page.locator(".marquee")).toBeHidden();
  // Out of the window, let go there.
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(W + 40, from.y, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator(".marquee")).toBeHidden();
  // Nothing left half done: a box round the army selects it.
  await boxArmy(page);
  expect((await selection(page)).filter((u) => ids.includes(u)).length).toBe(ids.length);
  expect(await menusKept(page)).toBe(true);
});

test("先開始的為準：左鍵框選中按右鍵，照樣框選、沒有指令；右鍵按著時按左鍵，不框、選取不變", async ({ page }) => {
  await start(page);
  const b = await soldiersBox(page);
  await page.evaluate(() => window.__proto?.game?.select([]));
  const sent = (await orders(page)).length;
  // The left box, the right button pressed and let go meanwhile.
  await page.mouse.move(b.from.x, b.from.y);
  await page.mouse.down();
  await page.mouse.move((b.from.x + b.to.x) / 2, (b.from.y + b.to.y) / 2, { steps: 3 });
  await page.mouse.down({ button: "right" });
  await page.mouse.up({ button: "right" });
  await page.mouse.move(b.to.x, b.to.y, { steps: 3 });
  await page.mouse.up();
  await expectBoxed(page, b.ids);
  expect((await orders(page)).length).toBe(sent);
  // The right button held, the left one pressed and dragged meanwhile: no box, the selection as it was.
  const chosen = await selection(page);
  await page.mouse.move(b.from.x, b.from.y);
  await page.mouse.down({ button: "right" });
  await page.mouse.down();
  await page.mouse.move(b.to.x, b.to.y, { steps: 4 });
  await expect(page.locator(".marquee")).toBeHidden();
  await page.mouse.up();
  await page.mouse.up({ button: "right" });
  await page.waitForTimeout(300);
  expect(await selection(page)).toEqual(chosen);
  expect(await menusKept(page)).toBe(true);
});

test("新手教學用滑鼠：第 1 步寫滾輪；第 5 步寫左鍵拖框、右鍵點；左鍵拖框把兵框起來，右鍵點發亮的地方就過關", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("./?test=1&tps=100");
  await page.getByRole("button", { name: "新手教學" }).click();
  await page.waitForFunction(() => window.__proto?.ready === true && window.__proto.screen === "battle", null, { timeout: 120_000 });
  const state = () => page.evaluate(() => window.__proto?.tutorial() ?? null);
  await expect(page.locator(".tut-card")).toContainText("按住滾輪拖動畫面（或用方向鍵），轉滾輪縮放");
  await expect(page.locator(".tut-card")).toContainText("移動畫面");
  await expect(page.locator(".tut-card")).toContainText("滾輪縮放");
  for (let s = 1; s <= 4; s++) {
    const before = (await state())?.step ?? 0;
    await page.locator(".tut-card").getByRole("button", { name: "跳過這步" }).click();
    await expect.poll(async () => (await state())?.step ?? 0, { timeout: 60_000 }).toBeGreaterThan(before);
  }
  await expect.poll(async () => (await state())?.phase, { timeout: 60_000 }).toBe("5a");
  await expect(page.locator(".tut-card")).toContainText("按住滑鼠左鍵拖出框，把兵框起來。");
  await expect.poll(async () => (await state())?.target ?? null).not.toBeNull();
  const box = (await state())?.target?.box;
  if (box == null) throw new Error("no box");
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
  await page.mouse.move(from[0].x, from[0].y);
  await page.mouse.down();
  await page.mouse.move(from[1].x, from[1].y, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await state())?.phase, { timeout: 30_000 }).toBe("5b");
  await expect(page.locator(".tut-card")).toContainText("用右鍵點發亮的地方：兵就走過去。");
  // Where the spot is now and stays (the camera brings it into reach), as tutorial.spec's tapTarget.
  let last = "";
  await expect.poll(async () => {
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const t = (await state())?.target ?? null;
    const now = JSON.stringify(t === null ? null : [Math.round(t.box.x), Math.round(t.box.y), Math.round(t.box.w), Math.round(t.box.h)]);
    const same = t !== null && now === last;
    last = now;
    if (!same) await page.waitForTimeout(150);
    return same;
  }, { timeout: 30_000 }).toBe(true);
  const spot = (await state())?.target?.box;
  if (spot == null) throw new Error("no spot");
  // 做得好 shows for 1.6 s (DONE_MS): the page itself looks for it, the card's words as it was then.
  await page.evaluate(() => {
    const w = window as unknown as { doneCard?: string };
    const id = window.setInterval(() => {
      const t = window.__proto?.tutorial();
      const card = document.querySelector(".tut-card")?.textContent ?? "";
      if (t?.step !== 5 || !t.done || !card.includes("做得好")) return;
      w.doneCard = card;
      window.clearInterval(id);
    }, 30);
  });
  await page.mouse.click(spot.x + spot.w / 2, spot.y + spot.h / 2, { button: "right" });
  await expect.poll(() => page.evaluate(() => (window as unknown as { doneCard?: string }).doneCard ?? null), { timeout: 60_000 }).toContain("左鍵拉框選兵，右鍵點地面就走過去。");
});
