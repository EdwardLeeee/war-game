// The interface shell on the fake world (?test=1&mock=1, fixed layout), in WebKit and
// Chromium at iPhone landscape size: the gesture-table rows for the minimap, control groups
// and idle farmers, and every piece of the temporary interface (GDD §10 草稿).

import { expect, type Locator, type Page, test } from "@playwright/test";
import { armyButton, FULL_SCREEN, hintTownOf, INTERACTIVE, IPHONE_SAFE, injectSafeArea, saveGroup, selectForCommands, shot, visibleBoxes, watchErrors } from "./helpers.ts";
import { doubleTap, doubleTapOn, longPress, longPressOn, tap, tapOn } from "./touch.ts";

// Fake-world layout (src/mock/mock-port.ts), in cells.
const SPEAR = { x: 22, y: 68 };
const BARRACKS = { x: 4, y: 74, size: 3 };
const MAIN_CITY = { x: 8, y: 80, size: 4 };
const SIZE = 96;
const GROUP_1 = ".groups > button:nth-child(1)";
const GROUP_2 = ".groups > button:nth-child(2)";

let checkErrors: () => void;

test.beforeEach(async ({ page }) => {
  checkErrors = watchErrors(page);
  await page.goto("./?test=1&mock=1");
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true);
  await centre(page, 22, 71);
});

test.afterEach(() => {
  checkErrors();
});

const centre = (page: Page, x: number, y: number, scale = 1) =>
  page.evaluate(([x, y, s]) => window.__proto?.game?.centerOn(x, y, s), [x, y, scale] as const);
const at = (page: Page, c: { x: number; y: number }) => page.evaluate(([x, y]) => window.__proto?.game?.cellToScreen(x, y) ?? { x: 0, y: 0 }, [c.x, c.y] as const);
const selection = (page: Page) => page.evaluate(() => window.__proto?.game?.selection());
const lastSent = (page: Page) => page.evaluate(() => window.__proto?.game?.sent().at(-1) as Record<string, unknown> | undefined);
const units = (page: Page) => page.evaluate(() => window.__proto?.game?.units() ?? []);
const select = (page: Page, ids: number[]) => page.evaluate((u) => window.__proto?.game?.select(u), ids);
/** The cell at the centre of the screen. */
async function centreCell(page: Page): Promise<{ x: number; y: number }> {
  const cam = await page.evaluate(() => window.__proto?.game?.camera());
  const size = page.viewportSize() ?? { width: 0, height: 0 };
  if (cam === undefined) throw new Error("no camera");
  return { x: (cam.x + size.width / 2 / cam.scale) / 32, y: (cam.y + size.height / 2 / cam.scale) / 32 };
}
const minimapPoint = (c: { x: number; y: number }) => [(c.x + 0.5) / SIZE, (c.y + 0.5) / SIZE] as const;

/** A point inside the small town at (30, 66) where a tap picks the town itself (not a soldier or a tree). */
async function townSpot(page: Page): Promise<{ x: number; y: number }> {
  for (const [dx, dy] of [[0, 0], [1, 1], [-1, 1], [1, -1], [-1, -1], [2, 0], [0, 2], [-2, 0], [0, -2], [2, 2], [-2, -2]]) {
    const p = await at(page, { x: 30.5 + dx, y: 66.5 + dy });
    if ((await page.evaluate(([x, y]) => window.__proto?.game?.pickAt(x, y) ?? null, [p.x, p.y] as const)) === "town") return p;
  }
  throw new Error("no open ground inside the town");
}

const sent = (page: Page) => page.evaluate(() => (window.__proto?.game?.sent() ?? []) as Record<string, unknown>[]);
/** The last order of the player's own hand (撤退 is followed by the interface's 堅守, D-061). */
const lastOrder = async (page: Page) => (await sent(page)).filter((c) => c.auto !== true).at(-1);
const garrison = (page: Page, town: number) => page.evaluate((t) => window.__proto?.game?.garrison(t) ?? [], town);
const place = (page: Page, ids: number[], cells: { x: number; y: number }[]) => page.evaluate(([i, c]) => window.__proto?.game?.place(i, c), [ids, cells] as const);
const toast = (page: Page, text: string | RegExp) => page.getByRole("status").filter({ hasText: text });
/** Whether the message strip is drawn on top at its centre, not behind the selection info or a dialog. */
const toastOnTop = (page: Page) =>
  page.evaluate(() => {
    const t = document.querySelector<HTMLElement>(".toast");
    if (t === null || t.hidden) return false;
    // Taps go through most of the interface: let everything take this one hit test, to find what is drawn on top.
    const all = document.createElement("style");
    all.textContent = "#hud * { pointer-events: auto !important; }";
    document.head.appendChild(all);
    const r = t.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    all.remove();
    return hit !== null && t.contains(hit);
  });
/** How many lines a piece of text takes (the line height is 1.15 times the font size). */
const lines = (l: Locator) => l.evaluate((e) => Math.round(e.getBoundingClientRect().height / (parseFloat(getComputedStyle(e).fontSize) * 1.15)));
const groupInfo = (page: Page) => page.evaluate(() => window.__proto?.game?.groupInfo() ?? []);
const remove = (page: Page, ids: number[]) => page.evaluate((i) => window.__proto?.game?.remove(i), ids);

async function ownIds(page: Page, types: number[]): Promise<number[]> {
  const me = await page.evaluate(() => window.__proto?.game?.me() ?? 0);
  return (await units(page)).filter((u) => u.owner === me && types.includes(u.type)).map((u) => u.id).sort((a, b) => a - b);
}

async function selectSpearmen(page: Page): Promise<number[]> {
  await doubleTap(page, await at(page, SPEAR));
  const ids = await ownIds(page, [1]);
  await expect.poll(() => selection(page)).toEqual({ units: ids, building: null });
  return ids;
}

for (const size of [
  { name: "工具列展開", viewport: null, who: "村民", types: [0] },
  { name: "工具列收合", viewport: FULL_SCREEN, who: "村民", types: [0] },
  // Soldiers add the stance button and its two lines of explanation (D-026); mages add 晶砲 and 自動施放.
  { name: "工具列展開", viewport: null, who: "全軍", types: [1, 2, 3] },
  { name: "工具列收合", viewport: FULL_SCREEN, who: "全軍", types: [1, 2, 3] },
]) {
  test(`介面：按鈕至少 44 pt、在安全區內、彼此不重疊（${size.name}，選了${size.who}）`, async ({ page }, info) => {
    if (size.viewport !== null) await page.setViewportSize(size.viewport);
    await injectSafeArea(page);
    // Units selected, so the command area and the selection info are showing too.
    await select(page, await ownIds(page, size.types));
    await page.waitForTimeout(300);
    const { width, height } = page.viewportSize() ?? { width: 0, height: 0 };
    const buttons = await visibleBoxes(page, INTERACTIVE);
    const panels = await visibleBoxes(page, ".minimap, .res-bar, .sel-info");
    for (const b of buttons) expect.soft(Math.min(b.width, b.height), `${b.label} size`).toBeGreaterThanOrEqual(44);
    const boxes = [...buttons, ...panels.map((p, i) => ({ ...p, label: ["資源列", "小地圖", "選取資訊"][i] ?? p.label }))];
    for (const b of boxes) {
      expect.soft(b.x, `${b.label} left`).toBeGreaterThanOrEqual(IPHONE_SAFE.left);
      expect.soft(b.x + b.width, `${b.label} right`).toBeLessThanOrEqual(width - IPHONE_SAFE.right);
      expect.soft(b.y + b.height, `${b.label} bottom`).toBeLessThanOrEqual(height - IPHONE_SAFE.bottom);
    }
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        const overlap = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 1 && Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 1;
        const nested = (x: typeof a, y: typeof a) => x.x >= y.x && x.y >= y.y && x.x + x.width <= y.x + y.width && x.y + x.height <= y.y + y.height;
        if (overlap && !nested(a, b) && !nested(b, a)) expect.soft(`${a.label} ↔ ${b.label}`, "overlapping").toBe("");
      }
    }
    // The explanation lines use the panel's full width, so they must start below the ✕.
    if (size.who === "全軍") {
      const [close] = await visibleBoxes(page, ".sel-close");
      const [note] = await visibleBoxes(page, ".sel-note");
      expect(note.y, "the stance note starts below the ✕").toBeGreaterThanOrEqual(close.y + close.height);
      const [panel] = await visibleBoxes(page, ".sel-info");
      expect(note.x + note.width, "the stance note stays inside the panel").toBeLessThanOrEqual(panel.x + panel.width);
      // 4 columns: 進攻、撤退、堅守、停止 in the first row, 隊形 and the mages' two in the second (D-050).
      const rows = new Set((await visibleBoxes(page, ".cmds button")).map((b) => Math.round(b.y)));
      expect(rows.size, "two rows of commands").toBe(2);
    }
    // 全軍撤退 (user 2026-10-01) is far from 全軍, so that one is not tapped for the other.
    const [retreatAll] = await visibleBoxes(page, ".retreat-all-btn");
    const [armyBtn] = await visibleBoxes(page, ".army-btn");
    const apart = Math.max(armyBtn.x - (retreatAll.x + retreatAll.width), retreatAll.x - (armyBtn.x + armyBtn.width), armyBtn.y - (retreatAll.y + retreatAll.height), retreatAll.y - (armyBtn.y + armyBtn.height));
    expect(apart, "全軍撤退 far from 全軍").toBeGreaterThan(100);
    await expect(page.locator(".res-bar")).toHaveText(/^糧 200　木 200　金 100　晶 20　人口 \d+\/20　時間 \d+:\d\d$/);
    await shot(page, info, `hud-${size.who}-${width}x${height}`);
  });
}

test("開局提示：開局時說魔晶從城鎮來、最近的城鎮在哪裡；遊戲先暫停，小地圖閃那座城鎮；看那座城鎮會跳過去（D-044）", async ({ page }, info) => {
  await page.goto("./?test=1&mock=1&hint=1");
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true);
  const hint = page.getByRole("dialog", { name: "魔晶從城鎮來" });
  await expect(hint).toBeVisible();
  await expect(hint).toContainText("魔晶主要從城鎮來");
  await expect(hint).toContainText("搶：馬上拿到一筆糧、金和魔晶");
  // The fake world's nearest small town, (18, 62), is ours already: the next one, which we can take.
  await expect(hint).toContainText(/離你的主城最近、可以攻下的小鎮在主城的.{1,2}方，約 \d+ 格/);
  const town = await hintTownOf(page);
  expect(await page.evaluate(() => window.__proto?.game?.townHint())).toEqual({ town: town.id, open: true, flashing: true });
  await expect.poll(() => page.evaluate(() => window.__proto?.game?.header().paused), { message: "the game waits while the hint is open" }).toBe(true);
  await injectSafeArea(page);
  const { width, height } = page.viewportSize() ?? { width: 0, height: 0 };
  for (const b of await visibleBoxes(page, ".town-hint button")) {
    expect(Math.min(b.width, b.height), `${b.label} size`).toBeGreaterThanOrEqual(44);
    expect(b.x, `${b.label} left`).toBeGreaterThanOrEqual(IPHONE_SAFE.left);
    expect(b.x + b.width, `${b.label} right`).toBeLessThanOrEqual(width - IPHONE_SAFE.right);
    expect(b.y + b.height, `${b.label} bottom`).toBeLessThanOrEqual(height - IPHONE_SAFE.bottom);
  }
  await shot(page, info, "town-hint");
  // 看那座城鎮: the hint closes, the game goes on, the camera is on the town, the minimap still flashes it.
  await hint.getByRole("button", { name: "看那座城鎮" }).tap();
  await expect(hint).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.__proto?.game?.header().paused)).toBe(false);
  const c = await centreCell(page);
  expect(Math.hypot(c.x - (town.cx + 0.5), c.y - (town.cy + 0.5)), "the camera is on the town").toBeLessThan(2);
  expect(await page.evaluate(() => window.__proto?.game?.townHint())).toEqual({ town: town.id, open: false, flashing: true });
  await shot(page, info, "town-hint-look");
});

test("開局提示：每局一次；繼續這局不再出現，重來是新的一局會再出現；按知道了，遊戲繼續（D-044）", async ({ page }) => {
  await page.goto("./?test=1&mock=1&hint=1");
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true);
  const hint = page.getByRole("dialog", { name: "魔晶從城鎮來" });
  await hint.getByRole("button", { name: "知道了" }).tap();
  await expect(hint).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.__proto?.game?.header().paused)).toBe(false);
  // 繼續這局: the same game, so no hint.
  await page.getByRole("button", { name: "選單" }).tap();
  await page.getByRole("button", { name: "回開局畫面" }).tap();
  await page.getByRole("button", { name: "繼續這局" }).tap();
  await expect(page.getByRole("button", { name: "繼續", exact: true })).toBeVisible();
  await expect(hint).toBeHidden();
  // 重來: a new game, and the hint again.
  await page.getByRole("button", { name: "選單" }).tap();
  await page.getByRole("button", { name: "回開局畫面" }).tap();
  await page.getByRole("button", { name: "重來" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true);
  await expect(hint).toBeVisible();
});

test("開局提示：按不再提示，記在這台裝置上，重來、重新整理都不再跳；選單的魔晶怎麼拿打得開，在那裡可以改回開局時要提示（D-044）", async ({ page }) => {
  await page.goto("./?test=1&mock=1&hint=1");
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true);
  const hint = page.getByRole("dialog", { name: "魔晶從城鎮來" });
  const stored = () => page.evaluate(() => window.localStorage.getItem("war-game.proto.townHint"));
  await expect(hint).toBeVisible();
  expect(await stored(), "nothing kept before 不再提示").toBeNull();
  await hint.getByRole("button", { name: "不再提示" }).tap();
  await expect(hint).toBeHidden();
  await expect(toast(page, "之後開局不會再提示")).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__proto?.game?.header().paused)).toBe(false);
  expect(await stored()).toBe("off");
  // 重來: a new game, and no hint (the Hud is new, so nothing points at a town).
  await page.getByRole("button", { name: "選單" }).tap();
  await page.getByRole("button", { name: "回開局畫面" }).tap();
  await page.getByRole("button", { name: "重來" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true);
  await page.waitForTimeout(500);
  await expect(hint).toBeHidden();
  expect(await page.evaluate(() => window.__proto?.game?.townHint())).toBeNull();
  // Reloaded: kept on this device.
  await page.goto("./?test=1&mock=1&hint=1");
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true);
  await page.waitForTimeout(500);
  await expect(hint).toBeHidden();
  expect(await page.evaluate(() => window.__proto?.game?.townHint())).toBeNull();
  // 選單 → 魔晶怎麼拿: the same hint, the game waits while it is open.
  await page.getByRole("button", { name: "選單" }).tap();
  await page.getByRole("button", { name: "魔晶怎麼拿" }).tap();
  await expect(hint).toBeVisible();
  await expect(hint).toContainText("魔晶主要從城鎮來");
  const town = await hintTownOf(page);
  expect(await page.evaluate(() => window.__proto?.game?.townHint())).toEqual({ town: town.id, open: true, flashing: true });
  await expect.poll(() => page.evaluate(() => window.__proto?.game?.header().paused), { message: "the game waits while the hint is open" }).toBe(true);
  // Turned off, so its third button turns it back on.
  await expect(hint.getByRole("button", { name: "不再提示" })).toHaveCount(0);
  await hint.getByRole("button", { name: "開局時要提示" }).tap();
  await expect(hint).toBeHidden();
  await expect(toast(page, "之後每一局開局都會提示")).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__proto?.game?.header().paused)).toBe(false);
  expect(await stored()).toBe("on");
  await page.getByRole("button", { name: "選單" }).tap();
  await page.getByRole("button", { name: "回開局畫面" }).tap();
  await page.getByRole("button", { name: "重來" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true);
  await expect(hint).toBeVisible();
});

test("開局提示：按知道了、看那座城鎮不算不再提示，重新整理後還會提示（D-044）", async ({ page }) => {
  await page.goto("./?test=1&mock=1&hint=1");
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true);
  const hint = page.getByRole("dialog", { name: "魔晶從城鎮來" });
  await hint.getByRole("button", { name: "看那座城鎮" }).tap();
  await expect(hint).toBeHidden();
  await page.getByRole("button", { name: "選單" }).tap();
  await page.getByRole("button", { name: "魔晶怎麼拿" }).tap();
  await hint.getByRole("button", { name: "知道了" }).tap();
  await expect(hint).toBeHidden();
  expect(await page.evaluate(() => window.localStorage.getItem("war-game.proto.townHint"))).toBeNull();
  await page.goto("./?test=1&mock=1&hint=1");
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true);
  await expect(hint).toBeVisible();
  await expect(hint.getByRole("button", { name: "不再提示" })).toBeVisible();
});

for (const viewport of [null, FULL_SCREEN]) {
  test(`選單：全部的按鈕不用捲動就看得到，至少 44 pt、在安全區內（${viewport === null ? "工具列展開" : "工具列收合"}）`, async ({ page }, info) => {
    if (viewport !== null) await page.setViewportSize(viewport);
    await injectSafeArea(page);
    await page.getByRole("button", { name: "選單" }).tap();
    const menu = page.getByRole("dialog", { name: "選單" });
    await expect(menu).toBeVisible();
    const card = menu.locator(".dialog-card");
    expect(await card.evaluate((c) => c.scrollHeight - c.clientHeight), "the menu does not scroll").toBeLessThanOrEqual(1);
    const { width, height } = page.viewportSize() ?? { width: 0, height: 0 };
    const boxes = await visibleBoxes(page, ".menu button");
    expect(boxes.map((b) => b.label)).toEqual(["魔晶怎麼拿", "量測與確定性檢查", "重來（開新的一局）", "投降", "回開局畫面", "關閉"]);
    for (const b of boxes) {
      expect(Math.min(b.width, b.height), `${b.label} size`).toBeGreaterThanOrEqual(44);
      expect(b.x, `${b.label} left`).toBeGreaterThanOrEqual(IPHONE_SAFE.left);
      expect(b.x + b.width, `${b.label} right`).toBeLessThanOrEqual(width - IPHONE_SAFE.right);
      expect(b.y, `${b.label} top`).toBeGreaterThanOrEqual(IPHONE_SAFE.top);
      expect(b.y + b.height, `${b.label} bottom`).toBeLessThanOrEqual(height - IPHONE_SAFE.bottom);
    }
    await shot(page, info, `menu-${width}x${height}`);
  });
}

test("離民兵太近：放建築的預覽在還有民兵的中立城鎮 12 格內時，提示列多一行警告，✓ 照樣蓋得下去；遠一點就沒有（ceo，D-044）", async ({ page }, info) => {
  const towns = await page.evaluate(() => window.__proto?.game?.towns() ?? []);
  // The fake world's neutral town (30, 66) still has its militia.
  const held = towns.find((t) => t.cx === 30 && t.cy === 66);
  expect(held).toMatchObject({ state: 0, militia: 3 });
  await centre(page, 24, 72);
  await selectForCommands(page, []);
  await page.getByRole("button", { name: "建造" }).tap();
  await page.getByRole("button", { name: /^民居/ }).tap();
  await expect.poll(() => page.evaluate(() => window.__proto?.game?.mode())).toBe("place:dragging");
  const warning = page.getByText("這裡離城鎮的民兵太近，去蓋的村民會被攻擊");
  const placement = () => page.evaluate(() => window.__proto?.game?.placement());
  // (21, 76): the house's centre is 13.5 cells from the town's.
  await tap(page, await at(page, { x: 21, y: 76 }));
  await expect.poll(placement).toMatchObject({ cellX: 21, cellY: 76, militia: null });
  await expect(warning).toBeHidden();
  // (22, 74): 11.3 cells.
  await tap(page, await at(page, { x: 22, y: 74 }));
  await expect.poll(placement).toMatchObject({ cellX: 22, cellY: 74, militia: held?.id });
  await expect(warning).toBeVisible();
  await expect(page.getByText("拖曳預覽到想蓋的位置")).toBeVisible();
  await shot(page, info, "militia-warning");
  // Only a warning: ✓ builds it.
  await page.getByRole("button", { name: "確定蓋在這裡" }).tap();
  await expect.poll(() => lastSent(page)).toMatchObject({ c: "build", u: [], type: 1, x: 22, y: 74 });
  await expect(warning).toBeHidden();
  // The next placement starts without it.
  await page.getByRole("button", { name: "建造" }).tap();
  await page.getByRole("button", { name: /^民居/ }).tap();
  await tap(page, await at(page, { x: 21, y: 77 }));
  await expect.poll(placement).toMatchObject({ cellX: 21, cellY: 77, militia: null });
  await expect(warning).toBeHidden();
});

test("點小地圖 → 跳到那裡", async ({ page }) => {
  await tapOn(page, ".minimap", ...minimapPoint({ x: 70, y: 30 }));
  const c = await centreCell(page);
  expect(Math.abs(c.x - 70.5)).toBeLessThan(1);
  expect(Math.abs(c.y - 30.5)).toBeLessThan(1);
});

test("已選部隊時長按小地圖 → 部隊前進到那裡", async ({ page }) => {
  const ids = await selectSpearmen(page);
  await longPressOn(page, ".minimap", ...minimapPoint({ x: 50, y: 50 }));
  await expect.poll(() => lastSent(page)).toMatchObject({ c: "move", u: ids, x: 50, y: 50 });
});

test("撤退：和進攻一樣先選位置——點地面或小地圖撤到那裡，點自己的主城或「退回主城」回家；選位置時取消、撤退中再按，都停下改成堅守（D-059、D-054）", async ({ page }, info) => {
  const ids = await selectSpearmen(page);
  const retreat = page.locator(".cmds").getByRole("button", { name: /^(取消)?撤退/ });
  const prompt = page.getByText("點地面或小地圖：撤到那裡；點主城回家");
  const mode = () => page.evaluate(() => window.__proto?.game?.mode());
  /** Stopped and holding (D-054), and the button is 撤退 again. */
  const held = async () => {
    await expect.poll(async () => (await sent(page)).slice(-2)).toMatchObject([{ c: "stop", u: ids }, { c: "stance", u: ids, stance: 1 }]);
    await expect(retreat).toHaveText("撤退點地面");
  };
  await expect(retreat).toHaveText("撤退點地面");
  await retreat.tap();
  await expect.poll(mode).toBe("retreat");
  await expect(prompt).toBeVisible();
  await expect(page.locator(".prompt").getByRole("button", { name: "退回主城", exact: true })).toBeVisible();
  await expect(retreat).toHaveText("取消撤退停下堅守");
  await shot(page, info, "retreat-prompt");
  // The ground: they retreat to the cell tapped (above the middle, clear of the panels).
  await centre(page, 18, 74);
  await tap(page, await at(page, { x: 16, y: 72 }));
  // With 堅守 (D-061): once there they hit only what comes in reach and do not chase.
  await expect.poll(async () => (await sent(page)).slice(-2)).toMatchObject([{ c: "retreat", u: ids, x: 16, y: 72 }, { c: "stance", u: ids, stance: 1, auto: true }]);
  await expect.poll(mode).toBe("normal");
  await expect(prompt).toBeHidden();
  // On their way, a tap on the ground moves the retreat: no 進攻 (D-061). The 撤退 line says so.
  await expect(retreat).toHaveText("取消撤退停下堅守");
  const hint = page.locator(".sel-info .order-hint");
  await expect(hint).toHaveText("撤退中：點地面或小地圖改撤退位置，到了原地堅守");
  const ground = { x: 12, y: 75 };
  const g = await at(page, ground);
  expect(await page.evaluate(([x, y]) => window.__proto?.game?.pickAt(x, y) ?? null, [g.x, g.y] as const), "open ground").toBeNull();
  await tap(page, g);
  await expect.poll(() => lastOrder(page)).toMatchObject({ c: "retreat", u: ids, x: ground.x, y: ground.y });
  expect((await sent(page)).filter((c) => c.c === "move"), "no 前進").toEqual([]);
  await expect(toast(page, "改撤到這裡，撤到後原地堅守")).toBeVisible();
  await shot(page, info, "retreat-retarget");
  // 取消撤退 stops them, holding.
  await retreat.tap();
  await held();
  await expect(hint).toHaveCount(0);
  // The minimap.
  await retreat.tap();
  await tapOn(page, ".minimap", ...minimapPoint({ x: 10, y: 70 }));
  await expect.poll(() => lastOrder(page)).toMatchObject({ c: "retreat", u: ids, x: 10, y: 70 });
  await expect(retreat).toHaveText("取消撤退停下堅守");
  await retreat.tap();
  await held();
  // 退回主城 on the prompt strip: in front of the main city at (8, 80), 4 cells: (12, 79).
  await retreat.tap();
  await page.locator(".prompt").getByRole("button", { name: "退回主城", exact: true }).tap();
  await expect.poll(() => lastOrder(page)).toMatchObject({ c: "retreat", u: ids, x: 12, y: 79 });
  await expect(retreat).toHaveText("取消撤退停下堅守");
  await retreat.tap();
  await held();
  // A tap on the own main city: home as well, not into the building.
  await retreat.tap();
  await centre(page, 10, 82);
  await tap(page, await at(page, { x: 9, y: 81 }));
  await expect.poll(() => lastOrder(page)).toMatchObject({ c: "retreat", u: ids, x: 12, y: 79 });
  await expect(retreat).toHaveText("取消撤退停下堅守");
  await retreat.tap();
  await held();
  // 取消 while the spot is picked: out of it, and they stop and hold.
  await retreat.tap();
  await expect(prompt).toBeVisible();
  await page.locator(".prompt").getByRole("button", { name: "取消" }).tap();
  await expect.poll(mode).toBe("normal");
  await expect(prompt).toBeHidden();
  await held();
});

test("撤退中點地面：只有一部分在撤退時照舊是進攻（和按鈕一樣，D-061）", async ({ page }) => {
  const ids = await selectSpearmen(page);
  const retreat = page.locator(".cmds").getByRole("button", { name: /^(取消)?撤退/ });
  // Half of them retreat (an order of the player's), the others stand.
  const half = ids.slice(0, 3);
  await page.evaluate((u) => window.__proto?.game?.send({ c: "retreat", u, x: 12, y: 79 }), half);
  await expect.poll(async () => (await units(page)).filter((u) => half.includes(u.id)).every((u) => u.order === 2)).toBe(true);
  await selectForCommands(page, ids);
  await expect(retreat).toHaveText("撤退點地面");
  await expect(page.locator(".sel-info .order-hint")).toHaveCount(0);
  const ground = { x: 20, y: 75 };
  const g = await at(page, ground);
  expect(await page.evaluate(([x, y]) => window.__proto?.game?.pickAt(x, y) ?? null, [g.x, g.y] as const), "open ground").toBeNull();
  await tap(page, g);
  await expect.poll(() => lastOrder(page)).toMatchObject({ c: "move", u: ids, x: ground.x, y: ground.y });
});

test("全軍撤退：不用先選兵，所有士兵退回主城，選取不變（使用者 2026-10-01）", async ({ page }, info) => {
  const soldiers = await ownIds(page, [1, 2, 3]);
  await select(page, []);
  const button = page.getByRole("button", { name: "全軍撤退" });
  await shot(page, info, "retreat-all-button");
  await button.tap();
  await expect.poll(() => lastOrder(page)).toMatchObject({ c: "retreat", u: soldiers, x: 12, y: 79 });
  // With 堅守 for those not holding already (D-061).
  await expect.poll(async () => (await units(page)).filter((u) => soldiers.includes(u.id)).every((u) => u.stance === 1)).toBe(true);
  await expect(toast(page, `全軍 ${soldiers.length} 名退回主城`)).toBeVisible();
  expect(await selection(page)).toEqual({ units: [], building: null });
  // With farmers selected, they stay selected and stay home.
  const farmers = await ownIds(page, [0]);
  await select(page, farmers);
  await button.tap();
  await expect.poll(async () => (await sent(page)).filter((c) => c.c === "retreat").length).toBe(2);
  expect((await lastSent(page))?.u).toEqual(soldiers);
  expect((await selection(page))?.units).toEqual(farmers);
});

test("編隊：選了兵再點編隊、按「改成剛才選的 N 名」存起來；點一下選取並打開軍團畫面；點兩下跳過去（D-054）", async ({ page }) => {
  const ids = await selectSpearmen(page);
  await saveGroup(page, GROUP_1);
  expect((await page.evaluate(() => window.__proto?.game?.groups()))?.[0]).toEqual(ids);
  await select(page, []);
  await tapOn(page, GROUP_1);
  await expect.poll(() => selection(page)).toEqual({ units: ids, building: null });
  await centre(page, 70, 30);
  await doubleTapOn(page, GROUP_1);
  const c = await centreCell(page);
  // The spearmen stand at (22–24, 68–69).
  expect(Math.abs(c.x - 23.5)).toBeLessThan(1.5);
  expect(Math.abs(c.y - 69)).toBeLessThan(1.5);
});

test("重設：一按就取消選取、離開撤退／集結點／放建築、回到指令區第一頁、關掉量測面板（D-024）", async ({ page }, info) => {
  const reset = page.getByRole("button", { name: "重設" });
  const mode = () => page.evaluate(() => window.__proto?.game?.mode());
  const nothing = { units: [], building: null };

  // 撤退：選兵 → 撤退（選位置）→ 重設
  await selectSpearmen(page);
  await page.getByRole("button", { name: /^撤退/ }).tap();
  await expect(page.getByText("點地面或小地圖：撤到那裡；點主城回家")).toBeVisible();
  await shot(page, info, "reset-before");
  await reset.tap();
  await expect.poll(mode).toBe("normal");
  await expect(page.getByText("點地面或小地圖：撤到那裡；點主城回家")).toBeHidden();
  await expect.poll(() => selection(page)).toEqual(nothing);
  await expect(page.locator(".sel-info")).toBeHidden();

  // 集結點：選兵營 → 集結點 → 重設
  await centre(page, BARRACKS.x + 1, BARRACKS.y + 1);
  await tap(page, await at(page, { x: BARRACKS.x + 1, y: BARRACKS.y + 1 }));
  await expect(page.locator(".sel-info")).toContainText("兵營");
  await page.getByRole("button", { name: "集結點" }).tap();
  await expect.poll(mode).toBe("rally");
  await reset.tap();
  await expect.poll(mode).toBe("normal");
  await expect.poll(() => selection(page)).toEqual(nothing);

  // 建造子選單：選村民 → 建造 → 重設
  const farmers = await ownIds(page, [0]);
  await selectForCommands(page, farmers);
  await page.getByRole("button", { name: "建造" }).tap();
  await expect(page.getByRole("button", { name: /^民居/ })).toBeVisible();
  await reset.tap();
  await expect(page.getByRole("button", { name: /^民居/ })).toBeHidden();
  await expect.poll(() => selection(page)).toEqual(nothing);

  // 放建築：選村民 → 建造 → 民居 → 重設
  await selectForCommands(page, farmers);
  await page.getByRole("button", { name: "建造" }).tap();
  await page.getByRole("button", { name: /^民居/ }).tap();
  await expect.poll(mode).toBe("place:dragging");
  await reset.tap();
  await expect.poll(mode).toBe("normal");
  expect(await page.evaluate(() => window.__proto?.game?.placement())).toBeNull();
  await expect(page.getByText("拖曳預覽到想蓋的位置，放開後按 ✓ 或 ✗")).toBeHidden();

  // 量測面板（沒在量測時）
  await page.getByRole("button", { name: "選單" }).tap();
  await page.getByRole("button", { name: "量測與確定性檢查" }).tap();
  const lab = page.getByRole("region", { name: "量測與確定性檢查" });
  await expect(lab).toBeVisible();
  await reset.tap();
  await expect(lab).toBeHidden();
});

test("閒置村民：點一下跳到下一個並選取，長按全部選取", async ({ page }) => {
  const idle = await ownIds(page, [0]);
  await expect(page.locator(".idle-btn")).toHaveText(`閒置 ${idle.length}`);
  await tapOn(page, ".idle-btn");
  const one = await selection(page);
  expect(one?.units.length).toBe(1);
  expect(idle).toContain(one?.units[0]);
  await longPressOn(page, ".idle-btn");
  await expect.poll(() => selection(page)).toEqual({ units: idle, building: null });
});

test("全軍：選取所有軍隊；按鈕上寫會選到幾名（ceo 2026-10-03）", async ({ page }) => {
  const army = await ownIds(page, [1, 2, 3]);
  await expect(armyButton(page)).toHaveText(`全軍 ${army.length}`);
  await armyButton(page).tap();
  await expect.poll(() => selection(page)).toEqual({ units: army, building: null });
});

test("遊戲時間：資源列最後一項，開局後會前進，暫停時不動；是遊戲時間，每秒 20 tick（ceo 2026-10-03）", async ({ page }) => {
  const bar = page.locator(".res-bar");
  const seconds = async () => {
    const m = /　時間 (\d+):(\d\d)$/.exec((await bar.textContent()) ?? "");
    return m === null ? -1 : Number(m[1]) * 60 + Number(m[2]);
  };
  await expect(bar).toHaveText(/人口 \d+\/\d+　時間 \d+:\d\d$/);
  const tick = (await page.evaluate(() => window.__proto?.game?.header().tick)) ?? -1;
  expect(Math.abs((await seconds()) - tick / 20), "the simulation's ticks, 20 a second").toBeLessThanOrEqual(1);
  const start = await seconds();
  await expect.poll(seconds, { timeout: 5000 }).toBeGreaterThan(start);
  // 暫停: it stands still.
  await page.getByRole("button", { name: "暫停", exact: true }).tap();
  await expect.poll(() => page.evaluate(() => window.__proto?.game?.header().paused)).toBe(true);
  await page.waitForTimeout(300);
  const paused = await seconds();
  await page.waitForTimeout(1500);
  expect(await seconds(), "paused").toBe(paused);
  await page.getByRole("button", { name: "繼續", exact: true }).tap();
  await expect.poll(seconds, { timeout: 5000 }).toBeGreaterThan(paused);
});

test("遊戲時間：畫面窄到放不下時，只留數字，不換行、不碰到右上的按鈕", async ({ page }, info) => {
  await injectSafeArea(page);
  const bar = page.locator(".res-bar");
  await expect(bar).toHaveText(/　時間 \d+:\d\d$/);
  const [full] = await visibleBoxes(page, ".res-bar");
  const [controls] = await visibleBoxes(page, ".top-right");
  const size = page.viewportSize() ?? { width: 0, height: 0 };
  // Narrow the page until the full line misses its room (the gap before the buttons is 8) by 10 px.
  const room = controls.x - full.x - 8;
  await page.setViewportSize({ width: Math.floor(size.width - (room - (full.width - 10))), height: size.height });
  await expect(bar).toHaveText(/人口 \d+\/20　\d+:\d\d$/);
  const [short] = await visibleBoxes(page, ".res-bar");
  const [after] = await visibleBoxes(page, ".top-right");
  expect(short.height, "one line").toBe(full.height);
  expect(short.x + short.width, "clear of the top-right buttons").toBeLessThanOrEqual(after.x - 8);
  await shot(page, info, "res-bar-narrow");
});

test("全體回城：切換全體回城與回去工作", async ({ page }) => {
  await page.getByRole("button", { name: "全體回城" }).tap();
  await expect.poll(() => lastSent(page)).toMatchObject({ c: "recall", on: true });
  await page.getByRole("button", { name: "回去工作" }).tap();
  await expect.poll(() => lastSent(page)).toMatchObject({ c: "recall", on: false });
  await expect(page.getByRole("button", { name: "全體回城" })).toBeVisible();
});

test("指令區：選村民 → 建造 → 民居 → 放下 → ✓", async ({ page }, info) => {
  await centre(page, 18, 77);
  const farmers = await ownIds(page, [0]);
  await longPress(page, await at(page, { x: 12, y: 77 }), await at(page, { x: 18, y: 79 }));
  await expect.poll(() => selection(page)).toEqual({ units: farmers, building: null });
  await page.getByRole("button", { name: "建造" }).tap();
  await shot(page, info, "build-menu");
  await page.getByRole("button", { name: /^民居/ }).tap();
  await expect.poll(() => page.evaluate(() => window.__proto?.game?.mode())).toBe("place:dragging");
  await tap(page, await at(page, { x: 21, y: 76 }));
  await page.getByRole("button", { name: "確定蓋在這裡" }).tap();
  await expect.poll(() => lastSent(page)).toMatchObject({ c: "build", u: farmers, type: 1, x: 21, y: 76 });
});

test("不選村民也能蓋：什麼都沒選 → 建造 → 民居 → ✓，送出不帶村民的 build；挑不到村民時有提示（D-024）", async ({ page }, info) => {
  await centre(page, 18, 77);
  await selectForCommands(page, []);
  await page.getByRole("button", { name: "建造" }).tap();
  await page.getByRole("button", { name: /^民居/ }).tap();
  await expect.poll(() => page.evaluate(() => window.__proto?.game?.mode())).toBe("place:dragging");
  await expect(page.getByText("會派最近的村民去蓋")).toBeVisible();
  await tap(page, await at(page, { x: 21, y: 76 }));
  await shot(page, info, "build-without-farmers");
  await page.getByRole("button", { name: "確定蓋在這裡" }).tap();
  await expect.poll(() => lastSent(page)).toMatchObject({ c: "build", u: [], type: 1, x: 21, y: 76 });
  // The fake world, like the simulation, sends the nearest farmer: a foundation appears.
  await expect.poll(async () => (await page.evaluate(() => window.__proto?.game?.buildings() ?? [])).some((b) => b.type === 1 && b.cx === 21 && b.cy === 76)).toBe(true);
  // No farmer to send (Reject.NoFarmer = 15).
  const seq = ((await lastSent(page)) as { seq: number }).seq;
  await page.evaluate((s) => window.__proto?.game?.inject({ k: "rejected", seq: s, reason: 15 }), seq);
  await expect(page.getByRole("status").filter({ hasText: "附近沒有可以派去蓋的村民" })).toBeVisible();
});

test("主城的指令區也有建造", async ({ page }) => {
  await centre(page, MAIN_CITY.x + 2, MAIN_CITY.y + 2);
  await tap(page, await at(page, { x: MAIN_CITY.x + 2, y: MAIN_CITY.y + 2 }));
  await expect(page.locator(".sel-info")).toContainText("主城");
  await page.getByRole("button", { name: "建造" }).tap();
  await expect(page.getByRole("button", { name: /^民居/ })).toBeVisible();
  await page.getByRole("button", { name: "返回" }).tap();
  await expect(page.getByRole("button", { name: /^訓練村民/ })).toBeVisible();
});

test("指令區與選取資訊：選兵營 → 訓練槍兵 → 佇列顯示，點它取消", async ({ page }, info) => {
  await centre(page, BARRACKS.x + 1, BARRACKS.y + 1);
  await tap(page, await at(page, { x: BARRACKS.x + 1, y: BARRACKS.y + 1 }));
  await expect(page.locator(".sel-info")).toContainText("兵營");
  await page.getByRole("button", { name: /^訓練槍兵/ }).tap();
  await expect.poll(() => lastSent(page)).toMatchObject({ c: "train", type: 1, n: 1 });
  await page.getByRole("button", { name: /^訓練槍兵/ }).tap();
  const queued = page.getByRole("button", { name: /取消訓練第 2 個/ });
  await expect(queued).toBeVisible();
  await shot(page, info, "train-queue");
  await queued.tap();
  await expect.poll(() => lastSent(page)).toMatchObject({ c: "cancel_train", index: 1 });
});

test("經濟分配：選主城 → 經濟分配 → 金多一點 → 套用", async ({ page }, info) => {
  await centre(page, MAIN_CITY.x + 2, MAIN_CITY.y + 2);
  await tap(page, await at(page, { x: MAIN_CITY.x + 2, y: MAIN_CITY.y + 2 }));
  await injectSafeArea(page);
  await page.getByRole("button", { name: "經濟分配" }).tap();
  const dialog = page.getByRole("dialog", { name: "經濟分配" });
  await expect(dialog).toBeVisible();
  // What the ratio does now (D-050, core #105).
  await expect(dialog).toContainText("自動分配開著時，改比例後，正在採糧、木、金的村民會照新比例重新分配；你親手派去採的不會動。晶脈要自己派。");
  expect(await dialog.locator(".dialog-card").evaluate((c) => c.scrollHeight - c.clientHeight), "no scrolling at 814 × 380").toBeLessThanOrEqual(1);
  await page.getByRole("button", { name: "金多一點" }).tap();
  await expect(page.locator(".ratio-value").nth(2)).toHaveText("30%");
  await shot(page, info, "economy");
  await page.getByRole("button", { name: "套用" }).tap();
  await expect.poll(() => lastSent(page)).toMatchObject({ c: "eco_ratio", food: 35, wood: 35, gold: 30, on: true });
});

test("攻下城鎮：跳出「搶」「治理」兩個大按鈕", async ({ page }, info) => {
  await page.evaluate(() => window.__proto?.game?.inject({ k: "town_captured", town: 0, by: 0 }));
  const dialog = page.getByRole("dialog", { name: /搶還是治理/ });
  await expect(dialog).toBeVisible();
  for (const b of await visibleBoxes(page, ".choice-row button")) expect(b.height).toBeGreaterThanOrEqual(88);
  await shot(page, info, "town-choice");
  await dialog.getByRole("button", { name: /^治理/ }).tap();
  await expect.poll(() => lastSent(page)).toMatchObject({ c: "town_choice", town: 0, choice: 1 });
  await expect(dialog).toBeHidden();
});

test("攻下城鎮：稍後再決定之後，點城鎮會再跳出搶或治理", async ({ page }) => {
  await page.evaluate(() => window.__proto?.game?.inject({ k: "town_captured", town: 0, by: 0 }));
  const dialog = page.getByRole("dialog", { name: /搶還是治理/ });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: /^稍後再決定/ }).tap();
  await expect(dialog).toBeHidden();
  // The small town at (30, 66) is now waiting for the choice; tapping it offers both again.
  await centre(page, 30, 66);
  // TownState.AwaitingChoice = 1.
  await expect.poll(async () => (await page.evaluate(() => window.__proto?.game?.towns() ?? [])).find((t) => t.id === 0)?.state).toBe(1);
  await tap(page, await townSpot(page));
  // The choice comes back (GDD §10): the dialog again, and 搶／治理 in the selection info under it.
  await expect(dialog).toBeVisible();
  await expect(page.locator(".sel-info").getByRole("button", { name: "搶", exact: true })).toBeAttached();
  await dialog.getByRole("button", { name: /^搶/ }).tap();
  await expect.poll(() => lastSent(page)).toMatchObject({ c: "town_choice", town: 0, choice: 0 });
});

test("進攻、撤退、堅守：第一列是這三顆和停止，選取資訊寫目前的狀態和三句說明；全部同一種時那顆亮；進攻中、撤退中再按，或選位置時取消，都停下改成堅守（D-050、D-054）", async ({ page }, info) => {
  const spear = await selectSpearmen(page);
  const panel = page.locator(".sel-info");
  const button = (name: RegExp) => page.locator(".cmds").getByRole("button", { name });
  const advance = button(/^(取消)?進攻/);
  const retreat = button(/^(取消)?撤退/);
  const hold = button(/^堅守/);
  const now = panel.locator(".order-now");
  const holdSent = async (ids: number[], since: number) =>
    expect.poll(async () => (await sent(page)).slice(since)).toMatchObject([{ c: "stop", u: ids }, { c: "stance", u: ids, stance: 1 }]);
  await expect(advance).toHaveText("進攻點地面");
  await expect(retreat).toHaveText("撤退點地面");
  await expect(hold).toHaveText("堅守原地不動");
  for (const line of ["進攻：點地面或小地圖，整隊前進，遇到敵人一起打", "撤退：點地面或小地圖撤到那裡，點主城回家", "堅守：停在原地，敵人進到射程就打，不追出去"]) {
    await expect(panel).toContainText(line);
  }
  // Standing with no order: 待命, nothing lit (D-054).
  await expect(now).toHaveText("目前：待命 6");
  for (const b of [advance, retreat, hold]) await expect(b).not.toHaveClass(/active/);
  const first = (await visibleBoxes(page, ".cmds button")).slice(0, 4);
  expect(first.map((b) => b.label)).toEqual(["進攻點地面", "撤退點地面", "堅守原地不動", "停止"]);
  expect(new Set(first.map((b) => Math.round(b.y))).size, "one row").toBe(1);
  for (const part of await panel.locator(".order-now, .order-meaning").all()) expect(await lines(part), (await part.textContent()) ?? "").toBe(1);
  await shot(page, info, "orders-idle");

  // 堅守: they stop where they are and hold (Stance.Hold = 1), and it lights up.
  let mark = (await sent(page)).length;
  await hold.tap();
  await holdSent(spear, mark);
  await expect(toast(page, "堅守：停在原地，敵人進到射程就打，不追出去")).toBeVisible();
  await expect(now).toHaveText("目前：堅守 6");
  await expect(hold).toHaveClass(/active/);

  // 全軍: 堅守 spearmen, the rest standing, a mage casting (進攻中); none lit.
  await armyButton(page).tap();
  const army = await ownIds(page, [1, 2, 3]);
  await expect.poll(async () => (await selection(page))?.units).toEqual(army);
  await expect(now).toHaveText(`目前：進攻中 1、堅守 6、待命 ${army.length - 7}`);
  for (const b of [advance, retreat, hold]) await expect(b).not.toHaveClass(/active/);
  expect(new Set((await visibleBoxes(page, ".cmds button")).map((b) => Math.round(b.y))).size, "two rows").toBe(2);

  // 進攻: the prompt asks for the place, and the button reads 取消進攻.
  await advance.tap();
  await expect.poll(() => page.evaluate(() => window.__proto?.game?.mode())).toBe("advance");
  await expect(page.getByText("點地面或小地圖：整隊前進，遇到敵人一起打")).toBeVisible();
  await expect(advance).toHaveText("取消進攻停下堅守");
  await expect(advance).toHaveClass(/active/);
  await shot(page, info, "orders-advance-prompt");
  // 取消 in the prompt: out of it, and they stop and hold (D-054).
  mark = (await sent(page)).length;
  await page.locator(".prompt").getByRole("button", { name: "取消" }).tap();
  await holdSent(army, mark);
  expect(await page.evaluate(() => window.__proto?.game?.mode())).toBe("normal");
  await expect(toast(page, "已停下，改成堅守")).toBeVisible();

  // 進攻 again and a tap on open ground: everyone advances, the 堅守 ones go 積極.
  await advance.tap();
  mark = (await sent(page)).length;
  await tap(page, await at(page, { x: 18, y: 67 }));
  await expect.poll(async () => (await sent(page)).slice(mark)).toMatchObject([{ c: "move", u: army, x: 18, y: 67 }, { c: "stance", u: army, stance: 0, auto: true }]);
  expect(await page.evaluate(() => window.__proto?.game?.mode())).toBe("normal");
  // On their way: 進攻中, lit, and a tap on it stops them, holding.
  await expect(now).toHaveText(`目前：進攻中 ${army.length}`);
  await expect(advance).toHaveText("取消進攻停下堅守");
  await expect(advance).toHaveClass(/active/);
  await shot(page, info, "orders-advancing");
  mark = (await sent(page)).length;
  await advance.tap();
  await holdSent(army, mark);
  await expect(now).toHaveText(`目前：堅守 ${army.length}`);

  // A plain tap on the ground is 進攻 too: a 堅守 group told to move goes 積極 with it.
  await selectForCommands(page, spear);
  mark = (await sent(page)).length;
  // Away from where the troops are, so the tap does not land on one of them.
  await tap(page, await at(page, { x: 20, y: 75 }));
  await expect.poll(async () => (await sent(page)).slice(mark)).toMatchObject([{ c: "move", u: spear }, { c: "stance", u: spear, stance: 0, auto: true }]);

  // 撤退: like 進攻, a spot first (D-059); on their way it reads 取消撤退, and a tap stops them, holding.
  await retreat.tap();
  await expect.poll(() => page.evaluate(() => window.__proto?.game?.mode())).toBe("retreat");
  await tap(page, await at(page, { x: 18, y: 67 }));
  await expect.poll(() => lastOrder(page)).toMatchObject({ c: "retreat", u: spear, x: 18, y: 67 });
  await expect(now).toHaveText("目前：撤退中 6");
  await expect(retreat).toHaveText("取消撤退停下堅守");
  await expect(retreat).toHaveClass(/active/);
  mark = (await sent(page)).length;
  await retreat.tap();
  await holdSent(spear, mark);
  await expect(now).toHaveText("目前：堅守 6");

  // Farmers only: neither 進攻 nor 堅守, and no note.
  await select(page, await ownIds(page, [0]));
  await expect(page.getByRole("button", { name: "建造" })).toBeVisible();
  await expect(advance).toBeHidden();
  await expect(hold).toBeHidden();
  await expect(panel.locator(".sel-note")).toHaveCount(0);
});

test("隊形：按鈕寫出現在是密集還是散開、按了會變成哪一種，選取資訊寫出意思；混合時全部改成散開；只選村民時沒有隊形鈕（D-027）", async ({ page }, info) => {
  const spear = await selectSpearmen(page);
  const formation = page.getByRole("button", { name: /^隊形/ });
  const panel = page.locator(".sel-info");
  await expect(formation).toHaveText("隊形：密集按一下改成散開");
  await expect(panel).toContainText("密集：站位間隔 1 格，火力集中");
  await formation.tap();
  await expect.poll(() => lastSent(page)).toMatchObject({ c: "formation", u: spear, loose: true });
  await expect(toast(page, "已改成散開。散開：站位間隔 2 格，站好時一發晶砲只炸得到 1 名")).toBeVisible();
  await expect(formation).toHaveText("隊形：散開按一下改成密集");
  await expect(panel).toContainText("散開：站位間隔 2 格，站好時一發晶砲只炸得到 1 名");
  await expect(panel).toContainText("行軍、追擊、交戰時也盡量保持 2 格；隊伍較寬，過窄路較慢");
  // The formation lines take one line each, and the button's two lines one each.
  for (const part of [".formation-meaning", ".formation-more"]) {
    expect(await lines(panel.locator(part)), `${part} on one line`).toBe(1);
  }
  expect(await lines(formation.locator(".label")), "the label on one line").toBe(1);
  expect(await lines(formation.locator(".sub")), "the line under it on one line").toBe(1);
  await shot(page, info, "formation-loose");

  // 全軍 now mixes 散開 spearmen with 密集 archers and mages: one tap makes them all 散開.
  await armyButton(page).tap();
  const army = await ownIds(page, [1, 2, 3]);
  await expect.poll(async () => (await selection(page))?.units).toEqual(army);
  await expect(formation).toHaveText("隊形：混合按一下全部改成散開");
  await expect(panel).toContainText("隊形：有的密集、有的散開");
  // Soldiers and mages: 進攻、撤退、堅守、停止 in the first row; 隊形, 晶砲 and 自動施放 below (4 columns).
  await shot(page, info, "formation-mixed-4-columns");
  await formation.tap();
  await expect.poll(() => lastSent(page)).toMatchObject({ c: "formation", u: army, loose: true });
  await expect(formation).toHaveText("隊形：散開按一下改成密集");
  await formation.tap();
  await expect.poll(() => lastSent(page)).toMatchObject({ c: "formation", u: army, loose: false });
  await expect(formation).toHaveText("隊形：密集按一下改成散開");

  // 自動施放 fits one column now: the name, and the state under it.
  const autocast = page.getByRole("button", { name: /^自動施放/ });
  await expect(autocast).toHaveText(/^自動施放目前：(開|關)$/);
  expect(await lines(autocast.locator(".label")), "自動施放 on one line").toBe(1);

  // Farmers: no 隊形 button.
  await select(page, await ownIds(page, [0]));
  await expect(page.getByRole("button", { name: "建造" })).toBeVisible();
  await expect(formation).toBeHidden();
  await expect(panel).not.toContainText("隊形");
});

test("隊形：編隊裡超過一半是散開時，補進來的新兵也送散開（D-027）", async ({ page }) => {
  const spear = await selectSpearmen(page);
  await saveGroup(page, GROUP_1);
  await page.getByRole("button", { name: /^隊形/ }).tap();
  await expect.poll(async () => (await units(page)).filter((u) => spear.includes(u.id)).every((u) => u.loose)).toBe(true);
  // One falls; the next spearman from the barracks joins group 1 and is told 散開 by the interface.
  await remove(page, [spear[0]]);
  await centre(page, BARRACKS.x + 1, BARRACKS.y + 1);
  await tap(page, await at(page, { x: BARRACKS.x + 1, y: BARRACKS.y + 1 }));
  await expect(page.locator(".sel-info")).toContainText("兵營");
  await page.getByRole("button", { name: /^訓練槍兵/ }).tap();
  await expect.poll(async () => (await groupInfo(page))[0].recruits.length, { timeout: 15_000 }).toBe(1);
  const [recruit] = (await groupInfo(page))[0].recruits;
  await expect
    .poll(async () => (await sent(page)).find((c) => c.c === "formation" && c.auto === true))
    .toMatchObject({ c: "formation", u: [recruit], loose: true, auto: true });
  await expect.poll(async () => (await units(page)).find((u) => u.id === recruit)?.loose).toBe(true);
});

test("留守：治理預設留最少駐軍數、搶預設 0，用 −／+ 調；留守的兵改成堅守、離開編隊、不跟全軍走（D-026）", async ({ page }, info) => {
  const spear = await ownIds(page, [1]);
  const mage = (await ownIds(page, [3]))[0];
  // Three spearmen and a mage walk into the small town at (30, 66), radius 4. In the order
  // they are chosen to stay: 1, 2 and 3 cells from the centre, and the mage last though it
  // stands on the centre.
  const inside = [spear[2], spear[0], spear[4]];
  await place(page, inside, [{ x: 30, y: 67 }, { x: 32, y: 66 }, { x: 30, y: 69 }]);
  await place(page, [mage], [{ x: 30, y: 66 }]);
  await select(page, spear);
  await saveGroup(page, GROUP_1);
  await select(page, []);
  await page.evaluate(() => window.__proto?.game?.inject({ k: "town_captured", town: 0, by: 0 }));
  const dialog = page.getByRole("dialog", { name: /搶還是治理/ });
  await expect(dialog).toBeVisible();
  const keepGovern = dialog.getByRole("status", { name: "留守幾名（治理）" });
  await expect(keepGovern).toHaveText("1");
  await expect(dialog.getByRole("status", { name: "留守幾名（搶）" })).toHaveText("0");
  for (const b of await visibleBoxes(page, ".keep .step")) expect(Math.min(b.width, b.height), `${b.label} size`).toBeGreaterThanOrEqual(44);
  const more = dialog.getByRole("button", { name: "多留守 1 名（治理）" });
  await more.tap();
  await more.tap();
  await more.tap();
  await expect(keepGovern).toHaveText("4");
  // Only four soldiers are inside the town.
  await more.tap();
  await expect(keepGovern).toHaveText("4");
  await expect(toast(page, "城鎮範圍內只有 4 名兵可以留守")).toBeVisible();
  expect(await toastOnTop(page), "the message is not behind the dialog").toBe(true);
  await dialog.getByRole("button", { name: "少留守 1 名（治理）" }).tap();
  await expect(keepGovern).toHaveText("3");
  await shot(page, info, "town-choice-keep");
  await dialog.getByRole("button", { name: /^治理/ }).tap();
  await expect(dialog).toBeHidden();

  // 治理, then the three nearest soldiers are told to hold (the mage is the last choice).
  await expect.poll(async () => (await sent(page)).at(-2)).toMatchObject({ c: "town_choice", town: 0, choice: 1 });
  await expect.poll(() => lastSent(page)).toMatchObject({ c: "stance", u: inside, stance: 1, auto: true });
  expect(await garrison(page, 0)).toEqual(inside);
  // They left control group 1, and 全軍 does not take them.
  const rest = spear.filter((id) => !inside.includes(id));
  expect((await page.evaluate(() => window.__proto?.game?.groups()))?.[0]).toEqual(rest);
  const army = (await ownIds(page, [1, 2, 3])).filter((id) => !inside.includes(id));
  await expect(armyButton(page), "the garrison left out").toHaveText(`全軍 ${army.length}`);
  await armyButton(page).tap();
  await expect.poll(async () => (await selection(page))?.units).toEqual(army);
  await select(page, []);

  // The town's selection info: both counts, and 留守 − N +.
  await centre(page, 30, 66);
  await expect.poll(async () => (await page.evaluate(() => window.__proto?.game?.towns() ?? [])).find((t) => t.id === 0)?.garrison).toBe(4);
  await tap(page, await townSpot(page));
  const panel = page.locator(".sel-info");
  await expect(panel).toContainText("城裡有 4 名兵（至少要 1 名）");
  const kept = panel.getByRole("status", { name: "留守幾名" });
  await expect(kept).toHaveText("3");
  await shot(page, info, "town-keep");
  await panel.getByRole("button", { name: "多留守 1 名" }).tap();
  await expect(kept).toHaveText("4");
  await expect.poll(() => lastSent(page)).toMatchObject({ c: "stance", u: [mage], stance: 1, auto: true });
  await panel.getByRole("button", { name: "多留守 1 名" }).tap();
  await expect(toast(page, "城鎮裡沒有其他的兵可以留守")).toBeVisible();
  await expect(kept).toHaveText("4");
  // One fewer: the last choice (the mage) goes back to 積極.
  await panel.getByRole("button", { name: "少留守 1 名" }).tap();
  await expect(kept).toHaveText("3");
  await expect.poll(() => lastSent(page)).toMatchObject({ c: "stance", u: [mage], stance: 0, auto: true });

  // The player's own 前進 ends a soldier's stay, and its stance goes back to 積極.
  await select(page, [inside[2]]);
  // Open ground outside the town (5 cells or more from its centre).
  let ground: { x: number; y: number } | null = null;
  for (const [cx, cy] of [[25, 62], [24, 63], [25, 70], [36, 62], [36, 70], [24, 66]]) {
    const cell = await page.evaluate(([x, y]) => window.__proto?.game?.openCellNear(x, y) ?? null, [cx, cy] as const);
    if (cell === null || Math.hypot(cell.x - 30, cell.y - 66) < 5) continue;
    const p = await at(page, { x: cell.x + 0.5, y: cell.y + 0.5 });
    if ((await page.evaluate(([x, y]) => window.__proto?.game?.pickAt(x, y) ?? null, [p.x, p.y] as const)) === null) {
      ground = p;
      break;
    }
  }
  if (ground === null) throw new Error("no open ground outside the town");
  await tap(page, ground);
  await expect.poll(async () => (await sent(page)).at(-2)).toMatchObject({ c: "move", u: [inside[2]] });
  await expect.poll(() => lastSent(page)).toMatchObject({ c: "stance", u: [inside[2]], stance: 0, auto: true });
  expect(await garrison(page, 0)).toEqual([inside[0], inside[1]]);

  // The enemy takes the town: its garrison ends and the survivors go back to 積極.
  await page.evaluate(() => window.__proto?.game?.inject({ k: "town_captured", town: 0, by: 1 }));
  await expect.poll(() => garrison(page, 0)).toEqual([]);
  // (Free again, they are then taken back into group 1, which is short of them (D-050), so look for the stance among what was sent.)
  await expect
    .poll(async () => (await sent(page)).filter((c) => c.c === "stance" && c.auto === true).at(-1))
    .toMatchObject({ c: "stance", u: [inside[0], inside[1]], stance: 0, auto: true });
  await armyButton(page).tap();
  await expect.poll(async () => (await selection(page))?.units).toEqual(await ownIds(page, [1, 2, 3]));
});

test("留守：搶預設不留人；所有的兵都留守時，全軍會說明", async ({ page }) => {
  const army = await ownIds(page, [1, 2, 3]);
  await place(page, army, [{ x: 30, y: 66 }, { x: 31, y: 66 }, { x: 29, y: 66 }, { x: 30, y: 67 }]);
  await page.evaluate(() => window.__proto?.game?.inject({ k: "town_captured", town: 0, by: 0 }));
  const dialog = page.getByRole("dialog", { name: /搶還是治理/ });
  await dialog.getByRole("button", { name: /^搶/ }).tap();
  await expect.poll(() => lastSent(page)).toMatchObject({ c: "town_choice", town: 0, choice: 0 });
  expect(await garrison(page, 0)).toEqual([]);
  // Station everyone from the town's selection info: 全軍 then has nobody to take.
  await centre(page, 30, 66);
  await select(page, []);
  await tap(page, await townSpot(page));
  const panel = page.locator(".sel-info");
  const more = panel.getByRole("button", { name: "多留守 1 名" });
  for (let i = 0; i < army.length; i++) await more.tap();
  await expect(panel.getByRole("status", { name: "留守幾名" })).toHaveText(`${army.length}`);
  expect((await garrison(page, 0)).slice().sort((x, y) => x - y)).toEqual(army);
  await expect(armyButton(page)).toHaveText("全軍 0");
  await armyButton(page).tap();
  await expect(toast(page, "所有的兵都在留守")).toBeVisible();
  await expect.poll(async () => (await selection(page))?.units).toEqual([]);
  // 全軍撤退 leaves the garrisons too: nobody to send, and it says so.
  const before = (await sent(page)).length;
  await page.getByRole("button", { name: "全軍撤退" }).tap();
  await expect(toast(page, "沒有可以撤退的士兵")).toBeVisible();
  expect((await sent(page)).length, "no order").toBe(before);
});

test("編隊自動補兵：缺人時新訓練的兵補進來，按鈕顯示現有／目標；訓練出來就走去會合；可以關掉（D-026、D-054）", async ({ page }, info) => {
  const spear = await selectSpearmen(page);
  await saveGroup(page, GROUP_1);
  const g1 = page.locator(GROUP_1);
  await expect(g1).toHaveText("1·6/6");
  // Three fall: the group keeps what it was saved with.
  await remove(page, spear.slice(0, 3));
  await expect(g1).toHaveText("1·3/6");
  expect((await groupInfo(page))[0]).toMatchObject({ ids: spear.slice(3), want: { 1: 6 }, saved: 6, refill: true });

  // Three spearmen from the barracks: each joins group 1 as it is trained.
  await centre(page, BARRACKS.x + 1, BARRACKS.y + 1);
  await tap(page, await at(page, { x: BARRACKS.x + 1, y: BARRACKS.y + 1 }));
  await expect(page.locator(".sel-info")).toContainText("兵營");
  const train = page.getByRole("button", { name: /^訓練槍兵/ });
  await train.tap();
  await train.tap();
  await train.tap();
  await expect(toast(page, /^新的槍兵補進編隊 1，正走過去$/)).toBeVisible({ timeout: 15_000 });
  await expect(g1).toHaveText("1·6/6", { timeout: 30_000 });
  const recruits = (await ownIds(page, [1])).filter((id) => !spear.includes(id));
  expect(recruits).toHaveLength(3);
  expect((await groupInfo(page))[0].ids).toEqual([...spear.slice(3), ...recruits]);
  await shot(page, info, "group-refill");
  // Each sets off as soon as it is trained (D-054: no waiting for company), for where the group
  // stands (the three survivors are on cells (22–24, 69)), by an order the player did not give.
  const marches = async () => (await sent(page)).filter((c) => c.c === "move" && c.auto === true) as { u: number[]; x: number; y: number }[];
  for (const id of recruits) {
    await expect.poll(async () => (await marches()).some((m) => m.u.includes(id) && m.x === 23 && m.y === 69), `recruit ${id} sent`).toBe(true);
  }

  // The switch is on the group's panel (D-054), shown with its button.
  await tapOn(page, GROUP_1);
  await expect.poll(async () => (await selection(page))?.units).toEqual([...spear.slice(3), ...recruits]);
  const sw = page.locator(".sel-info").getByRole("button", { name: /^自動補兵：/ });
  await expect(sw).toHaveText("自動補兵：開");
  await sw.tap();
  await expect(sw).toHaveText("自動補兵：關");
  await expect(toast(page, "編隊 1 自動補兵：關")).toBeVisible();
  // Off: a fallen soldier is not replaced; the new spearman stays by the barracks.
  await remove(page, [spear[3]]);
  await expect(g1).toHaveText("1·5/6");
  await select(page, []);
  await tap(page, await at(page, { x: BARRACKS.x + 1, y: BARRACKS.y + 1 }));
  await train.tap();
  await expect.poll(async () => (await ownIds(page, [1])).length, { timeout: 15_000 }).toBe(6);
  await page.waitForTimeout(300);
  await expect(g1).toHaveText("1·5/6");

  // A soldier belongs to one group: saving two of group 1 as group 2 takes them out of group 1, whose 原本 shrinks with them.
  await select(page, [spear[4], spear[5]]);
  await saveGroup(page, GROUP_2);
  await expect(page.locator(GROUP_2)).toHaveText("2·2/2");
  await expect(g1).toHaveText("1·3/4");
});

test("軍團畫面：點編隊按鈕就選取並打開；設定每種兵要幾名，沒編隊的兵馬上被拉進來，走去集合；前往中、堅守的兵不拉（D-050、D-054）", async ({ page }, info) => {
  await select(page, []);
  await tapOn(page, GROUP_1);
  const panel = page.locator(".sel-info");
  await expect(panel.locator(".sel-head")).toContainText("編隊 1");
  const want = (name: string) => panel.getByRole("status", { name: `${name}要幾名` });
  const more = (name: string) => panel.getByRole("button", { name: `多要 1 名${name}` });
  const less = (name: string) => panel.getByRole("button", { name: `少要 1 名${name}` });
  for (const name of ["槍兵", "遠程兵", "法師"]) await expect(want(name)).toHaveText("0");
  await expect(panel.locator(".sel-head")).toContainText("還沒有兵");
  await expect(panel.getByRole("button", { name: /^改成剛才選的/ }), "nothing was selected before").toBeHidden();
  const g1 = page.locator(GROUP_1);
  const ranged = await ownIds(page, [2]);
  const spear = await ownIds(page, [1]);

  // Two ranged: the two lowest ids in no group join and, with nobody in the group yet, walk
  // to the gathering point: no rally point is set, so the cell in front of the main city.
  await more("遠程兵").tap();
  await more("遠程兵").tap();
  await expect(want("遠程兵")).toHaveText("2");
  await expect.poll(async () => (await groupInfo(page))[0].ids).toEqual(ranged.slice(0, 2));
  await expect(panel.locator(".group-row").nth(1)).toContainText("現有 2");
  await expect(toast(page, /名沒編隊的兵補進編隊 1，正走過去/)).toBeVisible();
  await expect.poll(async () => (await sent(page)).filter((c) => c.c === "move" && c.auto === true).at(-1)).toMatchObject({ c: "move", u: ranged.slice(0, 2), x: 12, y: 79 });
  await expect(g1).toHaveText("1·2/2");
  await expect(panel.locator(".sel-head")).toContainText("2/2");
  await shot(page, info, "group-panel");

  // Down to 1: the last to join leaves the group.
  await less("遠程兵").tap();
  await expect.poll(async () => (await groupInfo(page))[0].ids).toEqual([ranged[0]]);
  await expect(g1).toHaveText("1·1/1");

  // One ranged on its way somewhere the player sent it, another told to 堅守: neither is taken.
  await select(page, [ranged[2]]);
  await tap(page, await at(page, { x: 12, y: 66 }));
  await expect.poll(() => lastSent(page)).toMatchObject({ c: "move", u: [ranged[2]] });
  await selectForCommands(page, [ranged[3]]);
  await page.getByRole("button", { name: /^堅守/ }).tap();
  await expect.poll(async () => (await units(page)).find((u) => u.id === ranged[3])?.stance).toBe(1);
  await select(page, []);
  await tapOn(page, GROUP_1);
  for (let i = 0; i < 3; i++) await more("遠程兵").tap();
  await expect(want("遠程兵")).toHaveText("4");
  const members = async () => (await groupInfo(page))[0].ids.slice().sort((a, b) => a - b);
  // About 11 cells to walk at 1.5 a second: still on its way.
  expect(await members(), "not while it walks where the player sent it").not.toContain(ranged[2]);
  // Both join once they stand still. The fake world runs on the page's timers: on a slow
  // Chromium runner it walked them 2.7 cells in 12 s (run 37215667850), so wait for the walk.
  await expect.poll(members, { timeout: 60_000 }).toEqual(ranged.slice(0, 3));
  await page.waitForTimeout(500);
  expect(await members(), "the 堅守 one stays where it was told").toEqual(ranged.slice(0, 3));

  // 清空, then 改成剛才選的 N 名: three spearmen selected, then the group button.
  await more("槍兵").tap();
  await expect.poll(async () => (await groupInfo(page))[0].ids).toContain(spear[0]);
  await expect(g1).toHaveText("1·4/5");
  await panel.getByRole("button", { name: "清空" }).tap();
  await expect.poll(async () => (await groupInfo(page))[0]).toMatchObject({ ids: [], want: {}, saved: 0 });
  for (const name of ["槍兵", "遠程兵", "法師"]) await expect(want(name)).toHaveText("0");
  await expect(g1).toHaveText("1");
  await select(page, spear.slice(0, 3));
  await tapOn(page, GROUP_1);
  await expect(panel.getByRole("button", { name: "改成剛才選的 3 名" })).toBeVisible();
  await shot(page, info, "group-panel-from-selection");
  await panel.getByRole("button", { name: "改成剛才選的 3 名" }).tap();
  await expect(toast(page, "已存成編隊 1（3 個）")).toBeVisible();
  expect((await groupInfo(page))[0]).toMatchObject({ ids: spear.slice(0, 3), want: { 1: 3 }, saved: 3 });
  // The group is selected and still shown; another selection closes the panel.
  await expect.poll(async () => (await selection(page))?.units).toEqual(spear.slice(0, 3));
  await expect(panel.locator(".sel-head")).toContainText("編隊 1");
  await select(page, [ranged[3]]);
  await expect(panel.locator(".sel-head")).not.toContainText("編隊");
});

test("新兵補不進任何編隊時，加入兵最多的編隊並走過去，那個編隊多要一名（D-054）", async ({ page }) => {
  const spear = await selectSpearmen(page);
  await saveGroup(page, GROUP_1);
  await select(page, (await ownIds(page, [2])).slice(0, 2));
  await saveGroup(page, GROUP_2);
  // Group 1 (6) is full and has the most: a new spearman joins it, and it wants 7.
  await centre(page, BARRACKS.x + 1, BARRACKS.y + 1);
  await tap(page, await at(page, { x: BARRACKS.x + 1, y: BARRACKS.y + 1 }));
  await page.getByRole("button", { name: /^訓練槍兵/ }).tap();
  await expect(toast(page, /^新的槍兵加入兵最多的編隊 1，正走過去$/)).toBeVisible({ timeout: 15_000 });
  const recruit = (await ownIds(page, [1])).find((id) => !spear.includes(id));
  expect((await groupInfo(page))[0]).toMatchObject({ want: { 1: 7 }, saved: 7 });
  expect((await groupInfo(page))[0].ids).toContain(recruit);
  await expect(page.locator(GROUP_1)).toHaveText("1·7/7");
  await expect.poll(async () => (await sent(page)).filter((c) => c.c === "move" && c.auto === true).at(-1)).toMatchObject({ c: "move", u: [recruit], x: 23, y: 69 });
});

test("收起：選取資訊和軍團畫面可以收起，只剩標題列；換選取時照舊收著，再按展開（D-054）", async ({ page }, info) => {
  await selectSpearmen(page);
  const panel = page.locator(".sel-info");
  const fold = panel.getByRole("button", { name: "收起選取資訊" });
  await expect(panel.locator(".sel-note")).toBeVisible();
  const open = (await visibleBoxes(page, ".sel-info"))[0];
  await fold.tap();
  await expect(panel.getByRole("button", { name: "展開選取資訊" })).toBeVisible();
  await expect(panel.locator(".sel-note")).toBeHidden();
  await expect(panel.locator(".sel-head")).toContainText("已選 6 個單位");
  const folded = (await visibleBoxes(page, ".sel-info"))[0];
  expect(folded.height, "only the title line").toBeLessThan(60);
  expect(folded.height).toBeLessThan(open.height);
  await shot(page, info, "info-folded");
  // Another selection, and the group's panel: still folded.
  await armyButton(page).tap();
  await expect(panel.locator(".sel-head")).toContainText("已選 12 個單位");
  await expect(panel.locator(".sel-note")).toBeHidden();
  await tapOn(page, GROUP_1);
  await expect(panel.locator(".sel-head")).toContainText("編隊 1");
  await expect(panel.locator(".group-row").first()).toBeHidden();
  await panel.getByRole("button", { name: "展開選取資訊" }).tap();
  await expect(panel.locator(".group-row").first()).toBeVisible();
  await expect(panel.getByRole("button", { name: "收起選取資訊" })).toBeVisible();
});

for (const viewport of [null, FULL_SCREEN]) {
  test(`軍團畫面：按鈕至少 44 pt、在安全區內、不和其他按鈕重疊（${viewport === null ? "工具列展開" : "工具列收合"}）`, async ({ page }, info) => {
    if (viewport !== null) await page.setViewportSize(viewport);
    await injectSafeArea(page);
    // Through the hook: a tap right after the resize can land before the camera follows it.
    await select(page, await ownIds(page, [1, 2, 3]));
    await tapOn(page, GROUP_2);
    const panel = page.locator(".sel-info");
    await expect(panel.locator(".sel-head")).toContainText("編隊 2");
    const { width, height } = page.viewportSize() ?? { width: 0, height: 0 };
    const mine = await visibleBoxes(page, ".sel-info button");
    expect(mine.map((b) => b.label)).toEqual(["✕", "收起", "−", "+", "−", "+", "−", "+", "改成剛才選的 12 名", "清空", "自動補兵：開"]);
    const others = await visibleBoxes(page, ".cmds button, .side-left button, .side-right button, .top-right button, .retreat-all-btn, .minimap, .res-bar");
    for (const b of mine) {
      expect(Math.min(b.width, b.height), `${b.label} size`).toBeGreaterThanOrEqual(44);
      expect(b.x, `${b.label} left`).toBeGreaterThanOrEqual(IPHONE_SAFE.left);
      expect(b.x + b.width, `${b.label} right`).toBeLessThanOrEqual(width - IPHONE_SAFE.right);
      expect(b.y, `${b.label} top`).toBeGreaterThanOrEqual(0);
      expect(b.y + b.height, `${b.label} bottom`).toBeLessThanOrEqual(height - IPHONE_SAFE.bottom);
    }
    const [box] = await visibleBoxes(page, ".sel-info");
    for (const o of others) {
      const overlap = Math.min(box.x + box.width, o.x + o.width) - Math.max(box.x, o.x) > 1 && Math.min(box.y + box.height, o.y + o.height) - Math.max(box.y, o.y) > 1;
      expect(overlap, `the panel and ${o.label}`).toBe(false);
    }
    await shot(page, info, `group-panel-${width}x${height}`);
  });
}

test("人口：資源列的人口含訓練中的兵，後面寫訓練中幾名；訓練完括號就不見（D-050）", async ({ page }, info) => {
  const bar = page.locator(".res-bar");
  await expect(bar).toHaveText(/人口 17\/20　時間/);
  await centre(page, BARRACKS.x + 1, BARRACKS.y + 1);
  await tap(page, await at(page, { x: BARRACKS.x + 1, y: BARRACKS.y + 1 }));
  const train = page.getByRole("button", { name: /^訓練槍兵/ });
  await train.tap();
  await train.tap();
  await expect(bar).toHaveText(/人口 19\/20（訓練中 2）　時間 \d+:\d\d$/);
  await shot(page, info, "population-training");
  await expect(bar).toHaveText(/人口 19\/20　時間/, { timeout: 30_000 });
  expect((await ownIds(page, [1])).length).toBe(8);
});

test("自動訓練：兵營預設開著，指令區寫目前：開、選取資訊寫自動訓練中；按了送出暫停，再按又開（D-054）", async ({ page }, info) => {
  await centre(page, BARRACKS.x + 1, BARRACKS.y + 1);
  await tap(page, await at(page, { x: BARRACKS.x + 1, y: BARRACKS.y + 1 }));
  const panel = page.locator(".sel-info");
  await expect(panel).toContainText("兵營");
  const auto = page.locator(".cmds").getByRole("button", { name: /^自動訓練/ });
  await expect(auto).toHaveText("自動訓練目前：開");
  await expect(auto).toHaveClass(/active/);
  await expect(panel.locator(".sel-status")).toContainText("自動訓練中");
  await shot(page, info, "auto-train-panel");
  const barracks = (await page.evaluate(() => window.__proto?.game?.selection()))?.building;
  await auto.tap();
  await expect.poll(() => lastSent(page)).toMatchObject({ c: "auto_train", building: barracks, on: false });
  await expect(auto).toHaveText("自動訓練目前：暫停");
  await expect(panel.locator(".sel-status")).toContainText("自動訓練暫停");
  await auto.tap();
  await expect.poll(() => lastSent(page)).toMatchObject({ c: "auto_train", building: barracks, on: true });
  await expect(auto).toHaveText("自動訓練目前：開");
});

test("人口滿了：自動訓練停下來時，訊息列提示一次，兵營寫人口滿了（D-054）", async ({ page }) => {
  await centre(page, BARRACKS.x + 1, BARRACKS.y + 1);
  await tap(page, await at(page, { x: BARRACKS.x + 1, y: BARRACKS.y + 1 }));
  const train = page.getByRole("button", { name: /^訓練槍兵/ });
  // 17 now, 20 at most: three more fill it.
  for (let i = 0; i < 3; i++) await train.tap();
  await expect(toast(page, "人口滿了，自動訓練停下來：蓋民居")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".sel-info .sel-status")).toContainText("人口滿了，蓋民居");
});

test("預留：選主城 → 預留 → 對話框寫現在的預留額（預設木 150、金 100、晶 15），−／+ 後套用送出 reserve；預設鈕回到預設（D-054）", async ({ page }, info) => {
  await centre(page, MAIN_CITY.x + 2, MAIN_CITY.y + 2);
  await tap(page, await at(page, { x: MAIN_CITY.x + 2, y: MAIN_CITY.y + 2 }));
  await injectSafeArea(page);
  await page.locator(".cmds").getByRole("button", { name: /^預留/ }).tap();
  const dialog = page.getByRole("dialog", { name: "預留" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("自動訓練只用超過這些的資源；預設留的夠蓋法術營、放 3 發晶砲。");
  const value = (name: string) => dialog.getByRole("status", { name: `${name}預留` });
  await expect(value("糧")).toHaveText("0");
  await expect(value("木")).toHaveText("150");
  await expect(value("金")).toHaveText("100");
  await expect(value("晶")).toHaveText("15");
  expect(await dialog.locator(".dialog-card").evaluate((c) => c.scrollHeight - c.clientHeight), "no scrolling").toBeLessThanOrEqual(1);
  await shot(page, info, "reserve-dialog");
  await dialog.getByRole("button", { name: "木少留 10" }).tap();
  await dialog.getByRole("button", { name: "晶多留 5" }).tap();
  await dialog.getByRole("button", { name: "糧少留 10" }).tap();
  await expect(value("木")).toHaveText("140");
  await expect(value("晶")).toHaveText("20");
  await expect(value("糧")).toHaveText("0", { timeout: 1000 });
  await dialog.getByRole("button", { name: "套用" }).tap();
  await expect.poll(() => lastSent(page)).toMatchObject({ c: "reserve", food: 0, wood: 140, gold: 100, crystal: 20 });
  // Open again: what the simulation reports now; 預設 puts the defaults back.
  await page.locator(".cmds").getByRole("button", { name: /^預留/ }).tap();
  await expect(value("木")).toHaveText("140");
  await dialog.getByRole("button", { name: "預設" }).tap();
  await expect(value("木")).toHaveText("150");
  await expect(value("晶")).toHaveText("15");
  await dialog.getByRole("button", { name: "取消" }).tap();
  await expect(dialog).toBeHidden();
});

test("被攻擊：小地圖閃、畫面邊緣出現箭頭，點箭頭跳過去", async ({ page }, info) => {
  await page.evaluate(() => window.__proto?.game?.inject({ k: "attacked", x: 80 * 1024 + 512, y: 20 * 1024 + 512, target: 1 }));
  const arrow = page.getByRole("button", { name: "有東西被攻擊：點一下跳過去" });
  await expect(arrow).toBeVisible();
  await shot(page, info, "attack-arrow");
  await arrow.tap();
  const c = await centreCell(page);
  expect(Math.abs(c.x - 80.5)).toBeLessThan(1);
  expect(Math.abs(c.y - 20.5)).toBeLessThan(1);
});

test("選單 → 投降 → 勝負畫面 → 重來開新局", async ({ page }, info) => {
  await page.getByRole("button", { name: "選單" }).tap();
  await page.getByRole("button", { name: "投降" }).tap();
  await page.getByRole("dialog").getByRole("button", { name: "投降" }).tap();
  const result = page.getByRole("dialog", { name: "失敗" });
  await expect(result).toBeVisible();
  await expect(result).toContainText("投降");
  await shot(page, info, "result");
  await result.getByRole("button", { name: "重來" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true);
  await expect(page.getByRole("dialog")).toBeHidden();
  expect((await page.evaluate(() => window.__proto?.game?.header()))?.tick ?? 999).toBeLessThan(200);
});

test("選單 → 回開局畫面 → 繼續這局（維持暫停）／重來", async ({ page }) => {
  await page.getByRole("button", { name: "選單" }).tap();
  await page.getByRole("button", { name: "回開局畫面" }).tap();
  await expect(page.getByRole("button", { name: "繼續這局" })).toBeVisible();
  await page.getByRole("button", { name: "繼續這局" }).tap();
  await expect(page.getByRole("button", { name: "繼續", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "選單" }).tap();
  await page.getByRole("button", { name: "回開局畫面" }).tap();
  await page.getByRole("button", { name: "重來" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true);
  await expect(page.getByRole("button", { name: "暫停", exact: true })).toBeVisible();
});

test("村民（D-061）：介面上找不到「農民」——戰場、選了村民、主城、經濟分配、選單", async ({ page }) => {
  const noOldWord = async (where: string) => expect(await page.evaluate(() => document.body.innerText), where).not.toContain("農民");
  await noOldWord("戰場");
  await selectForCommands(page, await ownIds(page, [0]));
  await expect(page.locator(".sel-info")).toContainText("村民");
  await noOldWord("選了村民");
  await centre(page, MAIN_CITY.x + 2, MAIN_CITY.y + 2);
  await tap(page, await at(page, { x: MAIN_CITY.x + 2, y: MAIN_CITY.y + 2 }));
  await expect(page.locator(".sel-info")).toContainText("主城");
  await expect(page.getByRole("button", { name: /^訓練村民/ })).toBeVisible();
  await noOldWord("主城");
  await page.getByRole("button", { name: "經濟分配" }).tap();
  await expect(page.getByRole("dialog", { name: "經濟分配" })).toContainText("村民");
  await noOldWord("經濟分配");
  await page.getByRole("dialog", { name: "經濟分配" }).getByRole("button", { name: "取消" }).tap();
  await page.getByRole("button", { name: "選單" }).tap();
  await noOldWord("選單");
});
