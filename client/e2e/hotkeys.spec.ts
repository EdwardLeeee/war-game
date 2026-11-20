// 快捷鍵 (R26 02 B, design/r26/spec.md section 02; the user 2026-11-18, ceo 2026-11-20), a computer's window (1920 × 950,
// a mouse, no touch) on the fake world: each key's badge on its button (none on the phone); Q W E R the soldiers' row
// and A S D F 更多's, pressed shut too; Esc a step at a time (the prompt's 取消 while picking: they stop and hold; 更多
// shut; the selection cleared; 選單; 選單 shut); the right button while picking is the place, while placing a
// building 取消; Space 暫停／繼續 even with a button just clicked; F2 全軍, Backspace 全軍撤退, Shift+2 the selection a
// group, 2 that group; with a dialog up only Esc.

import { expect, type Page, test } from "@playwright/test";
import { expectSaid, watchErrors, watchToasts } from "./helpers.ts";

const W = 1920;
const H = 950;
test.use({ viewport: { width: W, height: H }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 });
// Chromium on CI draws 1920 × 950 with the CPU (as mouse.spec).
test.describe.configure({ timeout: 120_000 });

type Order = { c: string; u?: number[]; stance?: number; x?: number; y?: number };
const orders = (page: Page) => page.evaluate(() => (window.__proto?.game?.sent() ?? []).filter((c) => (c as { auto?: boolean }).auto !== true) as Order[]);
const selection = (page: Page) => page.evaluate(() => window.__proto?.game?.selection().units ?? []);
const mode = (page: Page) => page.evaluate(() => window.__proto?.game?.mode());
const paused = (page: Page) => page.evaluate(() => window.__proto?.game?.header().paused ?? false);
const sorted = (ids: readonly number[]) => [...ids].sort((a, b) => a - b);

async function start(page: Page): Promise<void> {
  await watchToasts(page);
  await page.goto("./?test=1&mock=1&tps=20");
  await page.getByRole("button", { name: "開始", exact: true }).click();
  await page.waitForFunction(() => window.__proto?.ready === true && window.__proto.screen === "battle");
  await page.waitForFunction(() => (window.__proto?.game?.header().tick ?? 0) > 5);
}

/** Our soldiers, selected, the camera on them. */
async function army(page: Page): Promise<number[]> {
  const me = await page.evaluate(() => window.__proto?.game?.me() ?? 0);
  const all = (await page.evaluate(() => window.__proto?.game?.units() ?? [])).filter((u) => u.owner === me && [1, 2, 3].includes(u.type));
  expect(all.length, "soldiers of ours").toBeGreaterThan(1);
  const ids = sorted(all.map((u) => u.id));
  await page.evaluate((u) => window.__proto?.game?.select(u), ids);
  const mx = all.reduce((a, u) => a + u.fx, 0) / all.length;
  const my = all.reduce((a, u) => a + u.fy, 0) / all.length;
  await page.evaluate(([x, y]) => window.__proto?.game?.centerOn(x, y, 1), [mx, my] as const);
  await expect(page.locator(".cmds")).toHaveAttribute("data-selection", ids.join(","));
  return ids;
}

/** The badge on the button named `name` in `scope` ("" for none). */
const badge = (page: Page, scope: string, name: RegExp) =>
  page
    .locator(scope)
    .getByRole("button", { name })
    .first()
    .evaluate((b) => b.querySelector(":scope > .hk")?.textContent ?? "");

/** Open ground near the middle of the window: nothing picked there. */
async function ground(page: Page): Promise<{ x: number; y: number }> {
  for (const [dx, dy] of [
    [200, 0],
    [-200, 0],
    [0, 160],
    [0, -160],
    [260, 140],
    [-260, -140],
  ]) {
    const p = { x: W / 2 + dx, y: H / 2 + dy };
    const free = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.tagName === "CANVAS" && (window.__proto?.game?.pickAt(x, y) ?? null) === null, [p.x, p.y] as const);
    if (free) return p;
  }
  throw new Error("no open ground");
}

test("角標：指令那一排 Q W E R（沒有進駐時更多照樣是 R），更多打開時 A S D F；全軍 F2、選單 Esc、全軍撤退 Bksp、暫停 Space；編隊沒有角標", async ({ page }) => {
  const check = watchErrors(page);
  await start(page);
  await army(page);
  const cmds = ".cmds";
  expect(await badge(page, cmds, /^攻擊/)).toBe("Q");
  expect(await badge(page, cmds, /^移動/)).toBe("W");
  expect(await badge(page, cmds, /^更多/)).toBe("R");
  expect(await badge(page, "#hud", /^全軍$|全軍 \d|^全軍：/)).toBe("F2");
  expect(await badge(page, "body", /^選單/)).toBe("Esc");
  expect(await badge(page, "#hud", /^全軍撤退/)).toBe("Bksp");
  expect(await badge(page, "body", /^暫停|^繼續/)).toBe("Space");
  expect(await page.locator(".group-btn .hk").count(), "groups: their number is the key").toBe(0);
  // 更多 shut: its badges with it; open: A S D F (隊形, 堅守, 整理隊形, 停止).
  await expect(page.locator(".cmds-more .hk").first()).toBeHidden();
  await page.keyboard.press("r");
  await expect(page.locator(".cmds-more")).toBeVisible();
  expect(await badge(page, ".cmds-more", /^隊形/)).toBe("A");
  expect(await badge(page, ".cmds-more", /^堅守/)).toBe("S");
  expect(await badge(page, ".cmds-more", /^整理隊形/)).toBe("D");
  expect(await badge(page, ".cmds-more", /^停止/)).toBe("F");
  // A badge is not in the buttons' names.
  await expect(page.locator(".cmds").getByRole("button", { name: "攻擊", exact: false }).first()).not.toHaveAccessibleName(/Q/);
  check();
});

test("按鍵：Q 攻擊選目標、Esc 等於取消（停下堅守）；W 移動後用右鍵點地面＝走過去；更多沒開時按 S＝堅守；Esc 一次一步：更多、取消選取、選單、關選單", async ({ page }) => {
  const check = watchErrors(page);
  await start(page);
  const ids = await army(page);
  // Q: 攻擊, picking where; Esc: the prompt's 取消, they stop and hold (D-054).
  await page.keyboard.press("q");
  await expect.poll(() => mode(page)).toBe("advance");
  let from = (await orders(page)).length;
  await page.keyboard.press("Escape");
  await expect.poll(() => mode(page)).toBe("normal");
  await expect.poll(async () => (await orders(page)).slice(from).map((o) => o.c)).toEqual(["stop", "stance"]);
  expect(sorted(await selection(page))).toEqual(ids);
  // W, then the right button on the ground: that place (not 取消).
  await page.keyboard.press("w");
  await expect.poll(() => mode(page)).toBe("retreat");
  const g = await ground(page);
  from = (await orders(page)).length;
  await page.mouse.click(g.x, g.y, { button: "right" });
  await expect.poll(() => mode(page)).toBe("normal");
  const walk = (await orders(page)).slice(from);
  expect(walk.map((o) => o.c)).toEqual(["retreat"]);
  expect(sorted(walk[0].u ?? [])).toEqual(ids);
  // S with 更多 shut: 堅守 all the same (ceo 2026-11-20), 更多 stays shut.
  from = (await orders(page)).length;
  await page.keyboard.press("s");
  await expect.poll(async () => (await orders(page)).slice(from).map((o) => o.c)).toEqual(["stop", "stance"]);
  await expect(page.locator(".cmds-more")).toBeHidden();
  // Esc a step a press: 更多 shut; the selection cleared; 選單; 選單 shut.
  await page.keyboard.press("r");
  await expect(page.locator(".cmds-more")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".cmds-more")).toBeHidden();
  expect(sorted(await selection(page))).toEqual(ids);
  await page.keyboard.press("Escape");
  await expect.poll(() => selection(page)).toEqual([]);
  await expect(page.getByRole("dialog", { name: "選單" })).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "選單" })).toBeVisible();
  // A dialog up: keys other than Esc do nothing.
  await page.keyboard.press("F2");
  await page.waitForTimeout(200);
  expect(await selection(page)).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "選單" })).toBeHidden();
  check();
});

test("按鍵：Space 暫停、再按繼續（剛點過按鈕也只切一次）；F2 全軍；Shift+2 存成編隊 2、Esc 取消選取後按 2 選回來；Backspace 全軍撤退", async ({ page }) => {
  const check = watchErrors(page);
  await start(page);
  const ids = await army(page);
  // A button just clicked (攻擊) keeps no hold on Space.
  await page.locator(".cmds").getByRole("button", { name: /^攻擊/ }).click();
  await expect.poll(() => mode(page)).toBe("advance");
  await page.keyboard.press("Escape");
  await expect.poll(() => mode(page)).toBe("normal");
  expect(await paused(page)).toBe(false);
  await page.keyboard.press("Space");
  await expect.poll(() => paused(page)).toBe(true);
  expect(await mode(page), "攻擊 not pressed again").toBe("normal");
  await page.keyboard.press("Space");
  await expect.poll(() => paused(page)).toBe(false);
  // F2: 全軍.
  await page.evaluate(() => window.__proto?.game?.select([]));
  await page.keyboard.press("F2");
  await expect.poll(async () => (await selection(page)).length).toBeGreaterThan(0);
  // Shift+2: the two first soldiers made group 2; cleared; 2 selects them again.
  const two = ids.slice(0, 2);
  await page.evaluate((u) => window.__proto?.game?.select(u), two);
  await page.keyboard.press("Shift+Digit2");
  await expectSaid(page, "已存成編隊 2（2 個）");
  await page.evaluate(() => window.__proto?.game?.select([]));
  await page.keyboard.press("Digit2");
  await expect.poll(async () => sorted(await selection(page))).toEqual(two);
  // Backspace: 全軍撤退.
  const from = (await orders(page)).length;
  await page.keyboard.press("Backspace");
  await expect.poll(async () => (await orders(page)).slice(from).some((o) => o.c === "retreat")).toBe(true);
  check();
});

test("建造選單：沒選東西時 Q＝建造，選單照格子 Q W E R…；選一棟開始放；放建築時右鍵＝取消；Esc 從建造選單回上一層", async ({ page }) => {
  const check = watchErrors(page);
  await start(page);
  await page.evaluate(() => window.__proto?.game?.select([]));
  await expect(page.locator(".cmds").getByRole("button", { name: /^建造/ })).toBeVisible();
  expect(await badge(page, ".cmds", /^建造/)).toBe("Q");
  await page.keyboard.press("q");
  await expect(page.locator(".cmds.build-page")).toBeVisible();
  // The page's letters by cell: the first four Q W E R, then A…; 返回 none.
  // Placed with the interface's next update once the page is drawn.
  const read = () =>
    page.locator(".cmds.build-page > button").evaluateAll((bs) => bs.filter((b) => (b as HTMLElement).offsetWidth > 0).map((b) => ({ name: b.querySelector(".label, .lb")?.textContent ?? "", key: b.querySelector(":scope > .hk")?.textContent ?? "", top: Math.round(b.getBoundingClientRect().top) })));
  await expect.poll(async () => (await read()).filter((k) => k.name !== "返回" && k.key === "").length).toBe(0);
  const keys = await read();
  const rows = [...new Set(keys.map((k) => k.top))].sort((a, b) => a - b);
  for (const k of keys) {
    if (k.name === "返回") expect(k.key, "返回: Esc").toBe("");
    else {
      expect(k.key, `${k.name}: a letter`).not.toBe("");
      expect(["QWERT", "ASDFG", "ZXCVB"][rows.indexOf(k.top)], `${k.name}: ${k.key} on its row`).toContain(k.key);
    }
  }
  expect(keys[0].key).toBe("Q");
  // Esc: back to the first page.
  await page.keyboard.press("Escape");
  await expect(page.locator(".cmds.build-page")).toHaveCount(0);
  // Into it again; the first building (Q): placing; the right button: 取消.
  await page.keyboard.press("q");
  await expect(page.locator(".cmds.build-page")).toBeVisible();
  const first = keys.find((k) => k.key === "Q")?.name ?? "";
  await page.keyboard.press("q");
  await expect.poll(() => page.evaluate(() => window.__proto?.game?.placement() !== null)).toBe(true);
  const g = await ground(page);
  await page.mouse.click(g.x, g.y, { button: "right" });
  await expect.poll(() => page.evaluate(() => window.__proto?.game?.placement() ?? null)).toBeNull();
  await expectSaid(page, `已取消蓋${first}`);
  check();
});
