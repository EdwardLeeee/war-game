// 駐軍 (the user 2026-10-25: 「我是指說軍團選項，可以駐軍在都市裡面」; ceo's spec) on the fake world with
// walls (?walls=1): a group's soldiers, from 軍團畫面, are sent to stay in a town we hold: 駐軍, then a
// tap on the town. A town not ours says why. They walk in (移動), become its 留守 (still the group's,
// the user 2026-10-26; 全軍 without them, 堅守), and the ranged go up on its walls once in. The pictures for the user.

import { expect, type Page, test } from "@playwright/test";
import { armyButton, saveGroup, selectForCommands, shot, watchErrors } from "./helpers.ts";
import { tap } from "./touch.ts";

const RANGED = 2;
const SPEARMAN = 1;
const WALL_ORDER = 11;
const RETREAT = 2;
const HOLD = 1;
// Fake-world layout (src/mock/mock-port.ts) with walls: our small town and a neutral one.
const OUR_TOWN = { id: 1, x: 18, y: 62 };
const NEUTRAL_TOWN = { id: 0, x: 30, y: 66 };
const GROUP_1 = ".groups > button:nth-child(1)";

const units = (page: Page) => page.evaluate(() => window.__proto?.game?.units() ?? []);
const sent = (page: Page) => page.evaluate(() => (window.__proto?.game?.sent() ?? []) as Record<string, unknown>[]);
const at = (page: Page, c: { x: number; y: number }) => page.evaluate(([x, y]) => window.__proto?.game?.cellToScreen(x, y) ?? { x: 0, y: 0 }, [c.x, c.y] as const);
const centre = (page: Page, x: number, y: number, scale = 1) => page.evaluate(([cx, cy, s]) => window.__proto?.game?.centerOn(cx, cy, s), [x, y, scale] as const);
const toast = (page: Page, text: string | RegExp) => page.getByRole("status").filter({ hasText: text });

async function ownIds(page: Page, type: number, n: number): Promise<number[]> {
  const me = await page.evaluate(() => window.__proto?.game?.me() ?? 0);
  return (await units(page)).filter((u) => u.owner === me && u.type === type).map((u) => u.id).sort((a, b) => a - b).slice(0, n);
}

test("駐軍：從軍團畫面選整個軍團，按駐軍、點自己的城，兵走進去留守（還算原本的編隊、全軍不含、堅守），遠程兵上城牆；點別人的城說原因", async ({ page }, info) => {
  // CI's Chromium runs the fake world at a few steps a second: the walk in takes a while.
  test.setTimeout(240_000);
  const check = watchErrors(page);
  // The strip's messages as they come: the group's 自動補兵 says its own right after 駐軍's.
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { __toasts: string[] }).__toasts = seen;
    new MutationObserver(() => {
      for (const t of document.querySelectorAll(".toast")) {
        const text = t.textContent ?? "";
        if (text !== "" && seen.at(-1) !== text) seen.push(text);
      }
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });
  const said = () => page.evaluate(() => (window as unknown as { __toasts: string[] }).__toasts.join("｜"));
  await page.goto("./?test=1&mock=1&walls=1&tps=20");
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true, null, { timeout: 60_000 });
  const ids = [...(await ownIds(page, SPEARMAN, 3)), ...(await ownIds(page, RANGED, 2))].sort((a, b) => a - b);
  const ranged = (await ownIds(page, RANGED, 2)).sort((a, b) => a - b);
  // Just south of our town, a short walk in.
  await page.evaluate((i) => window.__proto?.game?.place(i, [16, 17, 18, 19, 20].map((x) => ({ x, y: 71 }))), ids);
  // Group 1 of these five; 全軍 counts them.
  await centre(page, 24, 66);
  await selectForCommands(page, ids);
  await saveGroup(page, GROUP_1);
  const army = await armyButton(page).textContent();
  // 軍團畫面 (a tap on the group button): its soldiers selected, 駐軍 beside it.
  await page.evaluate(() => window.__proto?.game?.select([]));
  await page.locator(GROUP_1).tap();
  await expect(page.locator(".sel-info .sel-head")).toContainText(/^編隊 1/);
  const button = page.locator(".cmds").getByRole("button", { name: /^駐軍/ });
  await expect(button).toHaveText("駐軍點自己的城");
  await shot(page, info, "station-1-button-in-group-screen");
  await button.tap();
  await expect(page.getByText("點自己持有的城鎮：選的兵走進去留守")).toBeVisible();
  await expect(page.locator(".cmds").getByRole("button", { name: /^取消/ })).toBeVisible();
  await shot(page, info, "station-2-pick-a-town");
  // 軍團畫面 folded by the tap on the group (the user 2026-10-31): the map under it is free.
  await expect(page.locator(".sel-info").getByRole("button", { name: "展開選取資訊" })).toBeVisible();
  await expect(page.getByText("點自己持有的城鎮：選的兵走進去留守")).toBeVisible();
  // Not ours: why.
  await tap(page, await at(page, { x: NEUTRAL_TOWN.x + 0.5, y: NEUTRAL_TOWN.y + 2.5 }));
  await expect(toast(page, "不是你攻下的城鎮")).toBeVisible();
  // Ours: in they go, its 留守.
  await tap(page, await at(page, { x: OUR_TOWN.x + 0.5, y: OUR_TOWN.y + 0.5 }));
  await expect.poll(said).toContain("5 名駐軍在小鎮：留守、堅守，不跟全軍走");
  const walk = (await sent(page)).filter((c) => c.auto !== true && c.c === "retreat").at(-1);
  expect(walk).toMatchObject({ u: ids, x: OUR_TOWN.x, y: OUR_TOWN.y });
  expect(await page.evaluate((t) => window.__proto?.game?.garrison(t) ?? [], OUR_TOWN.id)).toEqual(ids);
  // Still group 1's (the user 2026-10-26), 駐5 on its button: nobody pulled in to replace them.
  expect([...(await page.evaluate(() => window.__proto?.game?.groups() ?? []))[0]].sort((a, b) => a - b)).toEqual(ids);
  await expect(page.locator(GROUP_1)).toContainText("駐5");
  await expect(armyButton(page)).not.toHaveText(army ?? "");
  await expect.poll(async () => (await units(page)).filter((u) => ids.includes(u.id)).every((u) => u.stance === HOLD), { timeout: 60_000 }).toBe(true);
  // Once in: the ranged up on its walls (an order of the screen's), the spearmen inside.
  await expect.poll(async () => (await units(page)).filter((u) => ranged.includes(u.id) && u.order === WALL_ORDER).length, { timeout: 120_000 }).toBe(2);
  // Each sent up as it arrives (one order or more), to this town.
  const up = (await sent(page)).filter((c) => c.auto === true && c.c === "wall");
  expect(up.every((c) => c.town === OUR_TOWN.id)).toBe(true);
  expect(up.flatMap((c) => c.u as number[]).sort((a, b) => a - b)).toEqual(ranged);
  expect((await units(page)).filter((u) => ids.includes(u.id) && !ranged.includes(u.id)).every((u) => u.order !== WALL_ORDER && u.order !== RETREAT)).toBe(true);
  await centre(page, OUR_TOWN.x, OUR_TOWN.y, 1.3);
  await page.locator(".sel-info").getByRole("button", { name: "取消選取" }).tap().catch(() => undefined);
  await shot(page, info, "station-3-in-the-town");
  check();
});
