// 哨所 (D-080) on the fake world with its switch on (?test=1&mock=1&r7=1&outpost=1, src/mock/
// mock-port.ts): the build menu offers it; our outpost's panel (駐守 N 名, ＋槍兵, 全部離開, 攻擊／
// 堅守 with what each means); 駐守 from the command area; spearmen posted leave their group and
// 全軍; arrow towers may go by our outpost; the enemy's outpost reads 堅守中. Without the switch
// none of it shows. The simulation's side is core's (#185).

import { expect, type Page, test } from "@playwright/test";
import { armyButton, saveGroup, selectForCommands, shot, visibleBoxes, watchErrors } from "./helpers.ts";
import { tap } from "./touch.ts";

const OUTPOST = { x: 12, y: 66 };
const FOE_OUTPOST = { x: 31, y: 61 };
/** 6 cells off our outpost; beyond the main city's 8 and our governed town's reach: TowerLand only by the outpost. */
const TOWER_BY_OUTPOST = { x: 7, y: 69 };
const GROUP_1 = ".groups > button:nth-child(1)";
const TICKS = { timeout: 30_000 };
const RED = "rgb(217, 58, 48)";

let checkErrors: () => void;

test.beforeEach(({ page }) => {
  checkErrors = watchErrors(page);
});

test.afterEach(() => {
  checkErrors();
});

async function start(page: Page, outpost = true): Promise<void> {
  await page.goto(outpost ? "./?test=1&mock=1&r7=1&outpost=1&tps=20" : "./?test=1&mock=1&r7=1&tps=20");
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true);
  await centre(page, 18, 68);
}

const centre = (page: Page, x: number, y: number, scale = 1) => page.evaluate(([x, y, s]) => window.__proto?.game?.centerOn(x, y, s), [x, y, scale] as const);
const at = (page: Page, c: { x: number; y: number }) => page.evaluate(([x, y]) => window.__proto?.game?.cellToScreen(x, y) ?? { x: 0, y: 0 }, [c.x, c.y] as const);
const sent = (page: Page) => page.evaluate(() => (window.__proto?.game?.sent() ?? []) as Record<string, unknown>[]);
const lastOrder = async (page: Page) => (await sent(page)).filter((c) => c.auto !== true).at(-1);
const units = (page: Page) => page.evaluate(() => window.__proto?.game?.units() ?? []);
const buildings = (page: Page) => page.evaluate(() => window.__proto?.game?.buildings() ?? []);
const mode = (page: Page) => page.evaluate(() => window.__proto?.game?.mode());
const toast = (page: Page, text: string | RegExp) => page.getByRole("status").filter({ hasText: text });
const place = (page: Page, ids: number[], cells: { x: number; y: number }[]) => page.evaluate(([i, c]) => window.__proto?.game?.place(i, c), [ids, cells] as const);

async function ownIds(page: Page, type: number): Promise<number[]> {
  const me = await page.evaluate(() => window.__proto?.game?.me() ?? 0);
  return (await units(page)).filter((u) => u.owner === me && u.type === type).map((u) => u.id).sort((a, b) => a - b);
}

async function ourOutpost(page: Page): Promise<number> {
  const b = (await buildings(page)).find((v) => v.type === 12 && v.owner === 0);
  if (b === undefined) throw new Error("no outpost of ours");
  return b.id;
}

const posted = async (page: Page, id: number) => (await buildings(page)).find((b) => b.id === id)?.posted ?? -1;

async function tapOutpost(page: Page, c: { x: number; y: number }): Promise<void> {
  await centre(page, c.x + 1, c.y + 1);
  await tap(page, await at(page, { x: c.x + 1, y: c.y + 1 }));
}

test("建造選單有哨所（木 50）；蓋好的哨所旁可以蓋箭樓，說明也提到哨所（D-080）", async ({ page }, info) => {
  await start(page);
  await selectForCommands(page, []);
  await page.getByRole("button", { name: "建造" }).tap();
  const outpost = page.getByRole("button", { name: /^哨所/ });
  await expect(outpost).toBeVisible();
  await expect(outpost).toContainText(/木\s*50/);
  await shot(page, info, "outpost-build-menu");
  await page.getByRole("button", { name: /^箭樓/ }).tap();
  await expect(page.getByText(/^拖曳箭樓到主城、城鎮或哨所附近/)).toBeVisible();
  const placement = () => page.evaluate(() => window.__proto?.game?.placement());
  await centre(page, TOWER_BY_OUTPOST.x, TOWER_BY_OUTPOST.y);
  await tap(page, await at(page, TOWER_BY_OUTPOST));
  await expect.poll(placement).toMatchObject({ cellX: TOWER_BY_OUTPOST.x, cellY: TOWER_BY_OUTPOST.y, valid: true });
  await shot(page, info, "outpost-tower-by-outpost");
});

test("自己的哨所：寫駐守幾名、最多幾名；＋槍兵叫站著沒指令、最近的一名；攻擊（紅）和堅守切換，下面寫目前的意思；全部離開（D-080）", async ({ page }, info) => {
  await start(page);
  const id = await ourOutpost(page);
  const spear = await ownIds(page, 1);
  // The nearest standing spearman: put one just by the outpost.
  await place(page, [spear[5]], [{ x: OUTPOST.x + 3, y: OUTPOST.y }]);
  await tapOutpost(page, OUTPOST);
  const panel = page.locator(".sel-info");
  await expect(panel.locator(".sel-head")).toContainText("哨所");
  await expect(panel.locator(".outpost-count")).toHaveText("駐守 0 名槍兵（最多 6 名）");
  const call = panel.getByRole("button", { name: "叫 1 名槍兵來駐守" });
  const off = panel.getByRole("button", { name: "全部離開" });
  const attack = panel.getByRole("button", { name: "攻擊", exact: true });
  const hold = panel.getByRole("button", { name: "堅守", exact: true });
  await expect(call).toHaveText("＋槍兵");
  await expect(off).toBeDisabled();
  await expect(attack).toHaveAttribute("aria-pressed", "true");
  await expect(hold).toHaveAttribute("aria-pressed", "false");
  expect(await attack.evaluate((e) => getComputedStyle(e).backgroundColor)).toBe(RED);
  await expect(panel.locator(".outpost-note")).toHaveText("攻擊：敵兵進到哨所 8 格內就去打，追到 12 格就回來");

  await call.tap();
  await expect.poll(() => lastOrder(page)).toMatchObject({ c: "post", u: [spear[5]], building: id });
  await expect(toast(page, "叫 1 名槍兵來駐守")).toBeVisible();
  await expect.poll(() => posted(page, id), TICKS).toBe(1);
  await expect(panel.locator(".outpost-count")).toHaveText("駐守 1 名槍兵（最多 6 名）");
  await expect(off).toBeEnabled();
  await shot(page, info, "outpost-panel-attack");

  await hold.tap();
  await expect.poll(() => lastOrder(page)).toMatchObject({ c: "outpost_mode", building: id, hold: true });
  await expect(hold).toHaveAttribute("aria-pressed", "true", TICKS);
  await expect(attack).toHaveAttribute("aria-pressed", "false");
  await expect(panel.locator(".outpost-note")).toHaveText("堅守：站在哨所旁不動，只打走到身邊的；哨所或駐守的兵被打，就一起去打，追到 12 格就回來");
  await shot(page, info, "outpost-panel-hold");

  await off.tap();
  await expect.poll(() => lastOrder(page)).toMatchObject({ c: "unpost", building: id });
  await expect.poll(() => posted(page, id), TICKS).toBe(0);
  await expect(off).toBeDisabled();
});

test("駐守：選了槍兵和遠程兵，按駐守只有槍兵去；點錯地方說明要點什麼；駐守的兵離開編隊、不算全軍（D-080）", async ({ page }, info) => {
  await start(page);
  const id = await ourOutpost(page);
  const spear = await ownIds(page, 1);
  const ranged = await ownIds(page, 2);
  await selectForCommands(page, [...spear.slice(0, 2), ranged[0]]);
  await saveGroup(page, GROUP_1);
  const before = Number(/(\d+)/.exec((await armyButton(page).textContent()) ?? "")?.[1] ?? -1);
  await selectForCommands(page, [...spear.slice(0, 2), ranged[0]]);
  const post = page.locator(".cmds").getByRole("button", { name: /^駐守/ });
  await expect(post).toContainText("點哨所");
  await post.tap();
  await expect.poll(() => mode(page)).toBe("post");
  await expect(page.getByText("點自己的哨所：只有槍兵會去駐守")).toBeVisible();
  await expect(page.locator(".cmds").getByRole("button", { name: /^取消\s*駐守/ })).toHaveClass(/active/);
  await shot(page, info, "outpost-post-prompt");
  await tap(page, await at(page, { x: 18, y: 67 }));
  await expect(toast(page, "要點自己蓋好的哨所")).toBeVisible();
  expect(await mode(page)).toBe("post");
  await tapOutpost(page, OUTPOST);
  await expect.poll(() => lastOrder(page)).toMatchObject({ c: "post", u: spear.slice(0, 2), building: id });
  expect(await mode(page)).toBe("normal");
  // Posted (order Post): out of group 1, which fills up again with two free spearmen as for 留守
  // (its message takes the place of 「2 名槍兵去駐守哨所」), and out of 全軍.
  await expect.poll(async () => (await units(page)).filter((u) => spear.slice(0, 2).includes(u.id)).every((u) => u.order === 10)).toBe(true);
  await expect.poll(async () => (await page.evaluate(() => window.__proto?.game?.groups() ?? []))[0].filter((m) => spear.slice(0, 2).includes(m))).toEqual([]);
  await expect.poll(async () => (await page.evaluate(() => window.__proto?.game?.groups() ?? []))[0].length).toBe(3);
  await expect(armyButton(page)).toHaveText(`全軍 ${before - 2}`);
});

test("敵人的哨所：看得到時寫堅守中；沒開哨所的開關時，建造選單沒有哨所、選了槍兵也沒有駐守（D-080）", async ({ page }, info) => {
  await start(page);
  // A spearman of ours beside it, so it is in view (remembered buildings carry no Hold, and say nothing of it).
  await place(page, [(await ownIds(page, 1))[0]], [{ x: FOE_OUTPOST.x - 2, y: FOE_OUTPOST.y + 3 }]);
  await tapOutpost(page, FOE_OUTPOST);
  await expect(page.locator(".sel-info .sel-head")).toContainText("哨所");
  await expect(page.locator(".sel-info .sel-status")).toContainText("堅守中");
  await shot(page, info, "outpost-enemy-hold");
  await start(page, false);
  await selectForCommands(page, await ownIds(page, 1));
  await expect(page.locator(".cmds").getByRole("button", { name: /^駐守/ })).toHaveCount(0);
  await selectForCommands(page, []);
  await page.getByRole("button", { name: "建造" }).tap();
  await expect(page.getByRole("button", { name: /^箭樓/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^哨所/ })).toHaveCount(0);
});

test("版面：建造選單多了哨所、哨所面板、選了槍兵有駐守時，按鈕至少 44 pt、都在畫面裡（814×380）", async ({ page }) => {
  await start(page);
  const fits = async (what: string) => {
    const { width, height } = page.viewportSize() ?? { width: 0, height: 0 };
    for (const b of await visibleBoxes(page, "button")) {
      expect.soft(Math.min(b.width, b.height), `${what}: ${b.label} size`).toBeGreaterThanOrEqual(44);
      expect.soft(b.x + b.width, `${what}: ${b.label} right`).toBeLessThanOrEqual(width);
      expect.soft(b.y + b.height, `${what}: ${b.label} bottom`).toBeLessThanOrEqual(height);
    }
  };
  await selectForCommands(page, []);
  await page.getByRole("button", { name: "建造" }).tap();
  await expect(page.getByRole("button", { name: /^哨所/ })).toBeVisible();
  await fits("build menu");
  await page.getByRole("button", { name: "返回" }).tap();
  await tapOutpost(page, OUTPOST);
  await expect(page.locator(".outpost-note")).toBeVisible();
  await fits("outpost panel");
  await selectForCommands(page, [...(await ownIds(page, 1)), ...(await ownIds(page, 2)), ...(await ownIds(page, 3))]);
  await expect(page.locator(".cmds").getByRole("button", { name: /^駐守/ })).toBeVisible();
  await fits("army with 駐守");
});
