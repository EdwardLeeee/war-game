// The interface shell on the fake world (?test=1&mock=1, fixed layout), in WebKit and
// Chromium at iPhone landscape size: the gesture-table rows for the minimap, control groups
// and idle farmers, and every piece of the temporary interface (GDD §10 草稿).

import { expect, type Page, test } from "@playwright/test";
import { FULL_SCREEN, INTERACTIVE, IPHONE_SAFE, injectSafeArea, shot, visibleBoxes, watchErrors } from "./helpers.ts";
import { doubleTap, doubleTapOn, longPress, longPressOn, tap, tapOn } from "./touch.ts";

// Fake-world layout (src/mock/mock-port.ts), in cells.
const SPEAR = { x: 22, y: 68 };
const BARRACKS = { x: 4, y: 74, size: 3 };
const MAIN_CITY = { x: 8, y: 80, size: 4 };
const SIZE = 96;
const GROUP_1 = ".groups > button:nth-child(1)";

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
  { name: "工具列展開", viewport: null },
  { name: "工具列收合", viewport: FULL_SCREEN },
]) {
  test(`介面：按鈕至少 44 pt、在安全區內、彼此不重疊（${size.name}）`, async ({ page }, info) => {
    if (size.viewport !== null) await page.setViewportSize(size.viewport);
    await injectSafeArea(page);
    // Farmers selected, so the command area and the selection info are showing too.
    await select(page, await ownIds(page, [0]));
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
    await expect(page.locator(".res-bar")).toHaveText(/糧 200　木 200　金 100　晶 20　人口 \d+\/20/);
    await shot(page, info, `hud-${width}x${height}`);
  });
}

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

test("撤退：按指令區的撤退，再點小地圖選位置；再按一次撤退就取消", async ({ page }) => {
  const ids = await selectSpearmen(page);
  await page.getByRole("button", { name: "撤退", exact: true }).tap();
  await expect(page.getByText("點地面或小地圖選撤退位置")).toBeVisible();
  await tapOn(page, ".minimap", ...minimapPoint({ x: 10, y: 80 }));
  await expect.poll(() => lastSent(page)).toMatchObject({ c: "retreat", u: ids, x: 10, y: 80 });
  await page.getByRole("button", { name: "撤退", exact: true }).tap();
  await expect(page.getByRole("button", { name: "取消撤退" })).toBeVisible();
  await page.getByRole("button", { name: "取消撤退" }).tap();
  await expect(page.getByText("點地面或小地圖選撤退位置")).toBeHidden();
});

test("編隊：長按存成編隊、點一下選取、點兩下跳過去", async ({ page }) => {
  const ids = await selectSpearmen(page);
  await longPressOn(page, GROUP_1);
  await expect(page.getByRole("status").filter({ hasText: "已存成編隊 1（6 個）" })).toBeVisible();
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

  // 撤退：選兵 → 撤退 → 重設
  await selectSpearmen(page);
  await page.getByRole("button", { name: "撤退", exact: true }).tap();
  await expect(page.getByText("點地面或小地圖選撤退位置")).toBeVisible();
  await shot(page, info, "reset-before");
  await reset.tap();
  await expect.poll(mode).toBe("normal");
  await expect(page.getByText("點地面或小地圖選撤退位置")).toBeHidden();
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

  // 建造子選單：選農民 → 建造 → 重設
  const farmers = await ownIds(page, [0]);
  await select(page, farmers);
  await page.getByRole("button", { name: "建造" }).tap();
  await expect(page.getByRole("button", { name: /^民居/ })).toBeVisible();
  await reset.tap();
  await expect(page.getByRole("button", { name: /^民居/ })).toBeHidden();
  await expect.poll(() => selection(page)).toEqual(nothing);

  // 放建築：選農民 → 建造 → 民居 → 重設
  await select(page, farmers);
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

test("分出 N 名：− N + 或直接輸入，分出來的變成新的選取，可以存成編隊，再改選其餘（D-024）", async ({ page }, info) => {
  const ids = await selectSpearmen(page);
  const go = page.getByRole("button", { name: /^分出 \d+ 名$/ });
  // 6 名：預設分出一半（3 名），範圍 1–5。
  await expect(go).toHaveAccessibleName("分出 3 名");
  await page.getByRole("button", { name: "多分出 1 名" }).tap();
  await expect(go).toHaveAccessibleName("分出 4 名");
  await page.getByRole("button", { name: "少分出 1 名" }).tap();
  await expect(go).toHaveAccessibleName("分出 3 名");
  const box = page.getByRole("spinbutton", { name: "分出幾名" });
  await box.fill("2");
  await expect(go).toHaveAccessibleName("分出 2 名");
  await shot(page, info, "split-row");
  await go.tap();
  await expect.poll(async () => (await selection(page))?.units.length).toBe(2);
  const picked = (await selection(page))?.units ?? [];
  expect(picked.every((id) => ids.includes(id))).toBe(true);
  // Saved as a control group.
  await longPressOn(page, GROUP_1);
  expect((await page.evaluate(() => window.__proto?.game?.groups()))?.[0]).toEqual(picked);
  // The other 4, in one tap.
  await page.getByRole("button", { name: "改選其餘 4 名" }).tap();
  await expect.poll(async () => (await selection(page))?.units).toEqual(ids.filter((id) => !picked.includes(id)));
  // The panel redraws on the next interface update (10 a second): wait for it before typing,
  // or the digits go into the old box (run 36758767611, WebKit).
  await expect(page.locator(".sel-info")).toContainText("已選 4 個單位");
  await expect(go).toHaveAccessibleName("分出 2 名");
  // Typed numbers are kept in range: 99 → 3 (the most for 4 units).
  await box.fill("99");
  await box.blur();
  await expect(box).toHaveValue("3");
  await expect(go).toHaveAccessibleName("分出 3 名");
});

test("閒置農民：點一下跳到下一個並選取，長按全部選取", async ({ page }) => {
  const idle = await ownIds(page, [0]);
  await expect(page.locator(".idle-btn")).toHaveText(`閒置 ${idle.length}`);
  await tapOn(page, ".idle-btn");
  const one = await selection(page);
  expect(one?.units.length).toBe(1);
  expect(idle).toContain(one?.units[0]);
  await longPressOn(page, ".idle-btn");
  await expect.poll(() => selection(page)).toEqual({ units: idle, building: null });
});

test("全軍：選取所有軍隊", async ({ page }) => {
  await page.getByRole("button", { name: "全軍" }).tap();
  await expect.poll(() => selection(page)).toEqual({ units: await ownIds(page, [1, 2, 3]), building: null });
});

test("全體回城：切換全體回城與回去工作", async ({ page }) => {
  await page.getByRole("button", { name: "全體回城" }).tap();
  await expect.poll(() => lastSent(page)).toMatchObject({ c: "recall", on: true });
  await page.getByRole("button", { name: "回去工作" }).tap();
  await expect.poll(() => lastSent(page)).toMatchObject({ c: "recall", on: false });
  await expect(page.getByRole("button", { name: "全體回城" })).toBeVisible();
});

test("指令區：選農民 → 建造 → 民居 → 放下 → ✓", async ({ page }, info) => {
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

test("不選農民也能蓋：什麼都沒選 → 建造 → 民居 → ✓，送出不帶農民的 build；挑不到農民時有提示（D-024）", async ({ page }, info) => {
  await centre(page, 18, 77);
  await select(page, []);
  await page.getByRole("button", { name: "建造" }).tap();
  await page.getByRole("button", { name: /^民居/ }).tap();
  await expect.poll(() => page.evaluate(() => window.__proto?.game?.mode())).toBe("place:dragging");
  await expect(page.getByText("會派最近的農民去蓋")).toBeVisible();
  await tap(page, await at(page, { x: 21, y: 76 }));
  await shot(page, info, "build-without-farmers");
  await page.getByRole("button", { name: "確定蓋在這裡" }).tap();
  await expect.poll(() => lastSent(page)).toMatchObject({ c: "build", u: [], type: 1, x: 21, y: 76 });
  // The fake world, like the simulation, sends the nearest farmer: a foundation appears.
  await expect.poll(async () => (await page.evaluate(() => window.__proto?.game?.buildings() ?? [])).some((b) => b.type === 1 && b.cx === 21 && b.cy === 76)).toBe(true);
  // No farmer to send (Reject.NoFarmer = 15).
  const seq = ((await lastSent(page)) as { seq: number }).seq;
  await page.evaluate((s) => window.__proto?.game?.inject({ k: "rejected", seq: s, reason: 15 }), seq);
  await expect(page.getByRole("status").filter({ hasText: "附近沒有可以派去蓋的農民" })).toBeVisible();
});

test("主城的指令區也有建造", async ({ page }) => {
  await centre(page, MAIN_CITY.x + 2, MAIN_CITY.y + 2);
  await tap(page, await at(page, { x: MAIN_CITY.x + 2, y: MAIN_CITY.y + 2 }));
  await expect(page.locator(".sel-info")).toContainText("主城");
  await page.getByRole("button", { name: "建造" }).tap();
  await expect(page.getByRole("button", { name: /^民居/ })).toBeVisible();
  await page.getByRole("button", { name: "返回" }).tap();
  await expect(page.getByRole("button", { name: /^訓練農民/ })).toBeVisible();
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
  await page.getByRole("button", { name: "經濟分配" }).tap();
  await expect(page.getByRole("dialog", { name: "經濟分配" })).toBeVisible();
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
  // A point inside the town where a tap picks the town itself (not a militia man or a tree).
  let spot: { x: number; y: number } | null = null;
  for (const [dx, dy] of [[0, 0], [1, 1], [-1, 1], [1, -1], [-1, -1], [2, 0], [0, 2], [-2, 0], [0, -2]]) {
    const p = await at(page, { x: 30.5 + dx, y: 66.5 + dy });
    if ((await page.evaluate(([x, y]) => window.__proto?.game?.pickAt(x, y) ?? null, [p.x, p.y] as const)) === "town") {
      spot = p;
      break;
    }
  }
  if (spot === null) throw new Error("no open ground inside the town");
  await tap(page, spot);
  // The choice comes back (GDD §10): the dialog again, and 搶／治理 in the selection info under it.
  await expect(dialog).toBeVisible();
  await expect(page.locator(".sel-info").getByRole("button", { name: "搶", exact: true })).toBeAttached();
  await dialog.getByRole("button", { name: /^搶/ }).tap();
  await expect.poll(() => lastSent(page)).toMatchObject({ c: "town_choice", town: 0, choice: 0 });
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
  await expect(page.getByRole("button", { name: "繼續" })).toBeVisible();
  await page.getByRole("button", { name: "選單" }).tap();
  await page.getByRole("button", { name: "回開局畫面" }).tap();
  await page.getByRole("button", { name: "重來" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true);
  await expect(page.getByRole("button", { name: "暫停" })).toBeVisible();
});
