// 右鍵框選 (R26, the user 2026-11-18: 「框起來選兵可以用右鍵？」): with a mouse, the right button dragged is a box at
// once (no hold first), let go it selects as the long press's box does; a right click alone does nothing; whichever
// button began goes on (the other is not taken); let go over a panel or outside the window, the box ends as it is;
// the browser's menu stays away. A computer's window (1366 × 768, a mouse, no touch) on the fake world, and 新手教學's
// 第 5 步 with the mouse's words, done with the right button.

import { expect, type Page, test } from "@playwright/test";
import { watchErrors } from "./helpers.ts";

test.use({ viewport: { width: 1366, height: 768 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 });

const selection = (page: Page) => page.evaluate(() => window.__proto?.game?.selection().units ?? []);
const sentCount = (page: Page) => page.evaluate(() => (window.__proto?.game?.sent() ?? []).filter((c) => (c as { auto?: boolean }).auto !== true).length);
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
      const open = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.tagName === "CANVAS" && (window.__proto?.game?.pickAt(x, y) ?? null) === null, [from.x, from.y] as const);
      if (open) return { ids: now.map((u) => u.id).sort((a, b) => a - b), from, to };
    }
  }
  throw new Error("no open corner round the army");
}

/** The box selected them: every spearman in it, and soldiers only (as the long press's box: military first). */
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

/**
 * A left drag with the mouse as one burst of events (a busy machine could hold Playwright's steps past the long press's
 * 350 ms, and the drag would be a box); `chord`: the right button pressed and let go in the middle of it.
 */
async function leftDrag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, chord = false): Promise<void> {
  await page.evaluate(
    ([a, b, withRight]) => {
      const canvas = document.elementFromPoint(a.x, a.y) as Element;
      const fire = (type: string, x: number, y: number, button: number, buttons: number) =>
        canvas.dispatchEvent(new PointerEvent(type, { pointerId: 1, pointerType: "mouse", isPrimary: true, button, buttons, clientX: x, clientY: y, bubbles: true, cancelable: true }));
      fire("pointerdown", a.x, a.y, 0, 1);
      const steps = 8;
      for (let i = 1; i <= steps; i++) {
        const x = a.x + ((b.x - a.x) * i) / steps;
        const y = a.y + ((b.y - a.y) * i) / steps;
        // The right button down at a third of the way, up at two thirds (a chord: no pointerdown of its own).
        const right = withRight && i > steps / 3 && i <= (2 * steps) / 3;
        fire("pointermove", x, y, withRight && (i === Math.floor(steps / 3) + 1 || i === Math.floor((2 * steps) / 3) + 1) ? 2 : -1, right ? 3 : 1);
      }
      fire("pointerup", b.x, b.y, 0, 0);
    },
    [from, to, chord] as const,
  );
}

const menusKept = (page: Page) => page.evaluate(() => (window as unknown as { menus: boolean[] }).menus.every((p) => p));

test("右鍵拖曳就框選，不用先按住等；放開選到框裡的兵（和長按框選選到的一樣）；瀏覽器的右鍵選單不出來", async ({ page }) => {
  const check = watchErrors(page);
  await start(page);
  const { ids, from, to } = await soldiersBox(page);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down({ button: "right" });
  // Straight away (well under the long press's 350 ms): the box is up.
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 2 });
  await expect(page.locator(".marquee")).toBeVisible();
  await page.mouse.move(to.x, to.y, { steps: 2 });
  await page.mouse.up({ button: "right" });
  await expect(page.locator(".marquee")).toBeHidden();
  await expectBoxed(page, ids);
  expect(await menusKept(page), "the browser's menu kept away").toBe(true);
  check();
});

test("右鍵點一下、沒有拖：不做事（選取不變、沒有指令、沒有框）", async ({ page }) => {
  await start(page);
  const { ids, from, to } = await soldiersBox(page);
  // Selected first (the right button's box).
  await page.mouse.move(from.x, from.y);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up({ button: "right" });
  await expectBoxed(page, ids);
  const chosen = await selection(page);
  const sent = await sentCount(page);
  const cam = await camera(page);
  // A right click on open ground.
  await page.mouse.move(from.x, from.y);
  await page.mouse.down({ button: "right" });
  await page.waitForTimeout(500);
  await page.mouse.up({ button: "right" });
  await page.waitForTimeout(300);
  await expect(page.locator(".marquee")).toBeHidden();
  expect(await selection(page)).toEqual(chosen);
  expect(await sentCount(page)).toBe(sent);
  expect(await camera(page)).toEqual(cam);
  expect(await menusKept(page)).toBe(true);
});

test("右鍵框選拖到按鈕上、拖出視窗才放開：框選照樣結束，之後左鍵照常", async ({ page }) => {
  await start(page);
  const { from } = await soldiersBox(page);
  // Over a button (地圖 / the top right) then let go there.
  const over = await page.locator(".top-right button").first().boundingBox();
  if (over === null) throw new Error("no button");
  await page.mouse.move(from.x, from.y);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(over.x + over.width / 2, over.y + over.height / 2, { steps: 6 });
  await expect(page.locator(".marquee")).toBeVisible();
  await page.mouse.up({ button: "right" });
  await expect(page.locator(".marquee")).toBeHidden();
  // Out of the window, let go there.
  await page.mouse.move(from.x, from.y);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(1366 + 40, from.y, { steps: 6 });
  await page.mouse.up({ button: "right" });
  await expect(page.locator(".marquee")).toBeHidden();
  // Nothing left half done: the left button drags the battlefield as ever.
  const cam = await camera(page);
  await page.mouse.move(from.x, from.y);
  await leftDrag(page, from, { x: from.x + 120, y: from.y + 40 });
  await expect.poll(async () => (await camera(page)).x).not.toBe(cam.x);
  await expect(page.locator(".marquee")).toBeHidden();
  expect(await menusKept(page)).toBe(true);
});

test("先開始的為準：左鍵拖畫面時按右鍵不框；右鍵框選時按左鍵不拖畫面", async ({ page }) => {
  await start(page);
  const { from } = await soldiersBox(page);
  const before = await selection(page);
  // Left drag, the right button pressed and let go meanwhile: still the drag, no box.
  let cam = await camera(page);
  await page.mouse.move(from.x, from.y);
  await leftDrag(page, from, { x: from.x + 140, y: from.y + 50 }, true);
  await expect(page.locator(".marquee")).toBeHidden();
  await expect.poll(async () => (await camera(page)).x).not.toBe(cam.x);
  expect(await selection(page)).toEqual(before);
  // The camera back where it was, the box from where it was.
  const back = await soldiersBox(page);
  // Right box, the left button pressed meanwhile: still the box, the battlefield not dragged.
  cam = await camera(page);
  await page.mouse.move(back.from.x, back.from.y);
  await page.mouse.down({ button: "right" });
  await page.mouse.move((back.from.x + back.to.x) / 2, (back.from.y + back.to.y) / 2, { steps: 3 });
  await page.mouse.down();
  await page.mouse.move(back.to.x, back.to.y, { steps: 3 });
  await page.mouse.up();
  await page.mouse.up({ button: "right" });
  await expect(page.locator(".marquee")).toBeHidden();
  expect(await camera(page)).toEqual(cam);
  await expectBoxed(page, back.ids);
});

test("新手教學第 5 步用滑鼠：說明寫右鍵；右鍵拖框把兵框起來就過關", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("./?test=1&tps=100");
  await page.getByRole("button", { name: "新手教學" }).click();
  await page.waitForFunction(() => window.__proto?.ready === true && window.__proto.screen === "battle", null, { timeout: 120_000 });
  const state = () => page.evaluate(() => window.__proto?.tutorial() ?? null);
  for (let s = 1; s <= 4; s++) {
    const before = (await state())?.step ?? 0;
    await page.locator(".tut-card").getByRole("button", { name: "跳過這步" }).click();
    await expect.poll(async () => (await state())?.step ?? 0, { timeout: 60_000 }).toBeGreaterThan(before);
  }
  await expect.poll(async () => (await state())?.phase, { timeout: 60_000 }).toBe("5a");
  await expect(page.locator(".tut-card")).toContainText("按住滑鼠右鍵拖出框，把兵框起來。");
  await expect.poll(async () => (await state())?.target ?? null).not.toBeNull();
  const box = (await state())?.target?.box;
  if (box == null) throw new Error("no box");
  await page.mouse.move(box.x + 6, box.y + 6);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(box.x + box.w - 6, box.y + box.h - 6, { steps: 6 });
  await page.mouse.up({ button: "right" });
  await expect.poll(async () => (await state())?.phase, { timeout: 30_000 }).toBe("5b");
});
