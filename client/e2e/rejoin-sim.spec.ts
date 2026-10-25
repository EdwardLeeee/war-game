// 出城歸隊 on the real simulation (scenario e2e, the enemy's computer off; the user 2026-10-26,
// choosing 自動留最少人數): our squad, group 1, takes the small town and governs it (修繕, it
// needs 1), then stays in it whole (駐軍). 出城歸隊 brings all but 1 back to the group; with them
// marched away, the town still has its 1 and does not count down to revolt. 全部帶走 takes the
// last one too, says the town will revolt, and the simulation counts down.

import { expect, type Page, test } from "@playwright/test";
import { saveGroup, selectForCommands, watchErrors } from "./helpers.ts";
import { tap } from "./touch.ts";

const SMALL = 0;
const GATE = 13;
const FARMER = 0;
const REPAIRING = 3;
const GROUP_1 = ".groups > button:nth-child(1)";

let checkErrors: () => void;

test.beforeEach(({ page }) => {
  checkErrors = watchErrors(page);
});

test.afterEach(() => {
  checkErrors();
});

const me = (page: Page) => page.evaluate(() => window.__proto?.game?.me() ?? 0);
const units = (page: Page) => page.evaluate(() => window.__proto?.game?.units() ?? []);
const towns = (page: Page) => page.evaluate(() => window.__proto?.game?.towns() ?? []);
const buildings = (page: Page) => page.evaluate(() => window.__proto?.game?.buildings() ?? []);
const at = (page: Page, c: { x: number; y: number }) => page.evaluate(([x, y]) => window.__proto?.game?.cellToScreen(x, y) ?? { x: 0, y: 0 }, [c.x, c.y] as const);

test("真模擬：攻下小鎮、治理，整個編隊 1 駐軍；出城歸隊留 1 名，帶走其他的兵城不會叛離；全部帶走就開始倒數叛離", async ({ page }) => {
  test.setTimeout(600_000);
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
  await page.goto("./?test=1&scenario=e2e&ai=0&tps=60");
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true, null, { timeout: 60_000 });
  const m = await me(page);
  const soldiers = (await units(page)).filter((u) => u.owner === m && u.type !== FARMER);
  const ids = soldiers.map((u) => u.id).sort((a, b) => a - b);
  const from = { x: Math.round(soldiers.reduce((s, u) => s + u.cx, 0) / soldiers.length), y: Math.round(soldiers.reduce((s, u) => s + u.cy, 0) / soldiers.length) };
  const town = (await towns(page)).filter((t) => t.size === SMALL).sort((a, b) => Math.hypot(a.cx - from.x, a.cy - from.y) - Math.hypot(b.cx - from.x, b.cy - from.y))[0];
  const gate = (await buildings(page)).filter((b) => b.type === GATE && Math.abs(b.cx - town.cx) <= 8 && Math.abs(b.cy - town.cy) <= 8).sort((a, b) => Math.hypot(a.cx - from.x, a.cy - from.y) - Math.hypot(b.cx - from.x, b.cy - from.y))[0];
  // Group 1, the whole squad.
  await selectForCommands(page, ids);
  await saveGroup(page, GROUP_1);
  // Take the town (攻城打到底 carries the attack through), and govern it.
  await page.evaluate(([u, x, y]) => window.__proto?.game?.send({ c: "move", u, x, y }), [ids, gate.cx, gate.cy] as const);
  await expect(page.getByText(/^攻下小鎮！/)).toBeVisible({ timeout: 240_000 });
  await page.locator(".town-choice").getByRole("button", { name: /^治理/ }).tap();
  await expect.poll(async () => (await towns(page)).find((t) => t.id === town.id)?.state, { timeout: 30_000 }).toBe(REPAIRING);
  // 駐軍: the rest of group 1 too (with those 自動訓練 sent to fill it, if one fell).
  const garrison = () => page.evaluate((t) => window.__proto?.game?.garrison(t) ?? [], town.id);
  const living = async () => {
    const g = (await page.evaluate(() => window.__proto?.game?.groupInfo() ?? []))[0].ids;
    return (await units(page)).filter((u) => g.includes(u.id)).map((u) => u.id);
  };
  await page.evaluate(() => window.__proto?.game?.select([]));
  await page.locator(GROUP_1).tap();
  const panel = page.locator(".sel-info");
  await page.locator(".cmds").getByRole("button", { name: /^駐軍/ }).tap();
  await page.locator(".sel-info").getByRole("button", { name: "收起選取資訊" }).tap();
  await page.evaluate(([x, y]) => window.__proto?.game?.centerOn(x, y, 1), [town.cx, town.cy] as const);
  await tap(page, await at(page, { x: town.cx + 0.5, y: town.cy + 0.5 }));
  await expect.poll(async () => {
    const all = await garrison();
    return (await living()).every((id) => all.includes(id));
  }).toBe(true);
  const alive = await garrison();
  // 出城歸隊: one stays.
  await page.evaluate(() => window.__proto?.game?.select([]));
  await page.locator(GROUP_1).tap();
  await expect(panel.locator(".sel-head")).toContainText(/^編隊 1/);
  // Put away (收起) for 駐軍 above: open it again.
  await panel.getByRole("button", { name: "展開選取資訊" }).tap();
  await panel.getByRole("button", { name: "出城歸隊" }).tap();
  await expect.poll(said).toContain(`${alive.length - 1} 名出城歸隊編隊 1，留 1 名守城`);
  const kept = await garrison();
  expect(kept).toHaveLength(1);
  // The others march off, far from the town: it keeps its 1 and does not count down.
  const out = alive.filter((id) => !kept.includes(id));
  await page.evaluate(([u, x, y]) => window.__proto?.game?.send({ c: "move", u, x, y }), [out, from.x, from.y] as const);
  await expect.poll(async () => (await units(page)).filter((u) => out.includes(u.id)).every((u) => Math.hypot(u.cx - town.cx, u.cy - town.cy) > 8), { timeout: 120_000 }).toBe(true);
  await page.waitForTimeout(3000);
  // (The snapshot's 城裡有 N 名 counts inside the walls only, not the one kept on them; the simulation's
  // manning counts both, sim/src/core/towns.ts.)
  const held = (await towns(page)).find((t) => t.id === town.id);
  expect(held?.state).toBe(REPAIRING);
  expect(held?.revoltTimer, "manned: no revolt").toBe(0);
  // 全部帶走 on the town's panel: the last one out, and the town counts down.
  await page.evaluate(() => window.__proto?.game?.select([]));
  await tap(page, await at(page, { x: town.cx + 0.5, y: town.cy + 0.5 }));
  await expect(panel).toContainText("編隊 1：1 名");
  await panel.getByRole("button", { name: "全部帶走" }).tap();
  await expect.poll(said).toContain("1 名離開這座城。駐軍不足，這座城會叛離");
  await page.evaluate(([u, x, y]) => window.__proto?.game?.send({ c: "move", u, x, y }), [kept, from.x, from.y] as const);
  await expect.poll(async () => (await towns(page)).find((t) => t.id === town.id)?.revoltTimer ?? 0, { timeout: 120_000 }).toBeGreaterThan(0);
});
