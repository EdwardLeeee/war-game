// The brief's main flow, on core's real simulation with its `e2e` scenario (plenty of
// resources, two houses and a barracks, a squad of 6 spearmen and 4 ranged ten cells from
// the small town), in WebKit and Chromium at iPhone landscape size with touch:
// 開局（選難度）→ 選農民 → 蓋房子（中間用重設離開放建築）→ 訓練 → 框選 → 改姿態 → 前進 →
// 暫停時下指令 → 攻下城鎮後治理並留守 → 全軍離開、城鎮不叛離 → 分出 N 名存成編隊 →
// 不選農民蓋民居（D-024、D-026）.
// Every step goes through the interface the player uses; the test hook only reads state
// and moves the camera. The opponent stands still (?test=1&ai=0, see step 1).

import { expect, type Page, test } from "@playwright/test";
import { shot, watchErrors } from "./helpers.ts";
import { doubleTap, longPress, longPressOn, tap } from "./touch.ts";

const FARMER = 0;
const SPEARMAN = 1;
const RANGED = 2;
const HOUSE = 1;
const BARRACKS = 6;
const SQUAD = { x: 26, y: 40 };

const header = (page: Page) => page.evaluate(() => window.__proto?.game?.header() ?? { tick: -1, paused: false, speed: 0, scenario: -1 });
const units = (page: Page) => page.evaluate(() => window.__proto?.game?.units() ?? []);
const buildings = (page: Page) => page.evaluate(() => window.__proto?.game?.buildings() ?? []);
const towns = (page: Page) => page.evaluate(() => window.__proto?.game?.towns() ?? []);
const placement = (page: Page) => page.evaluate(() => window.__proto?.game?.placement() ?? null);
const lastSent = (page: Page) => page.evaluate(() => window.__proto?.game?.sent().at(-1) as Record<string, unknown> | undefined);
const sent = (page: Page) => page.evaluate(() => (window.__proto?.game?.sent() ?? []) as Record<string, unknown>[]);
const groups = (page: Page) => page.evaluate(() => window.__proto?.game?.groups() ?? []);
const garrison = (page: Page, town: number) => page.evaluate((t) => window.__proto?.game?.garrison(t) ?? [], town);
const selection = (page: Page) => page.evaluate(() => window.__proto?.game?.selection());
const mode = (page: Page) => page.evaluate(() => window.__proto?.game?.mode());
const myId = (page: Page) => page.evaluate(() => window.__proto?.game?.me() ?? 0);
const toScreen = (page: Page, c: { x: number; y: number }) => page.evaluate(([x, y]) => window.__proto?.game?.cellToScreen(x, y) ?? { x: 0, y: 0 }, [c.x, c.y] as const);
const centre = (page: Page, c: { x: number; y: number }, scale = 1) => page.evaluate(([x, y, s]) => window.__proto?.game?.centerOn(x, y, s), [c.x, c.y, scale] as const);

async function own(page: Page, types: number[]) {
  const me = await myId(page);
  return (await units(page)).filter((u) => u.owner === me && types.includes(u.type));
}

async function pause(page: Page): Promise<void> {
  await page.getByRole("button", { name: "暫停" }).tap();
  await expect.poll(async () => (await header(page)).paused).toBe(true);
}

async function resume(page: Page): Promise<void> {
  await page.getByRole("button", { name: "繼續" }).tap();
  await expect.poll(async () => (await header(page)).paused).toBe(false);
}

test("主要流程：開局（選難度）→ 選農民 → 蓋房子（重設）→ 訓練 → 框選 → 改姿態 → 前進 → 暫停時下指令 → 攻下城鎮後治理並留守 → 全軍離開不叛離 → 分出 N 名 → 不選農民蓋民居", async ({ page }, info) => {
  test.setTimeout(300_000);
  const check = watchErrors(page);

  // 1. 開局
  // ai=0: the opponent stands still. With the computer playing, whether it reaches the small
  // town first depends on the random seed and on how fast CI runs the steps (run 36758767611:
  // it took the town and our main city fell at 6:22).
  await page.goto("./?test=1&scenario=e2e&tps=100&ai=0");
  // 選難度（D-024）
  const easy = page.getByRole("radiogroup", { name: "難度" }).getByRole("radio", { name: "簡單" });
  await easy.tap();
  await expect(easy).toBeChecked();
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true);
  expect((await header(page)).scenario, "the e2e scenario").toBe(1);
  // The chosen 難度 and no time limit reach the simulation (player 1 does not play here: ai=0).
  expect(await page.evaluate(() => window.__proto?.game?.init())).toMatchObject({ difficulty: ["normal", "easy"], maxTicks: 0, ai: [false, false] });
  await expect(page.locator(".res-bar")).toContainText(/糧 \d{4}/);
  await shot(page, info, "1-start");

  // 2. 選農民（點兩下一名農民 = 畫面內所有農民）
  await pause(page);
  const farmers = (await own(page, [FARMER])).sort((a, b) => a.id - b.id);
  await doubleTap(page, { x: farmers[0].sx, y: farmers[0].sy });
  // Every farmer on screen (some may be off it, gathering).
  await expect.poll(async () => (await selection(page))?.units.length ?? 0).toBeGreaterThan(0);
  const farmerIds = (await selection(page))?.units ?? [];
  expect(farmerIds.every((id) => farmers.some((f) => f.id === id)), "only farmers").toBe(true);

  // 3. 蓋房子（指令區：建造 → 民居 → 點一個能蓋的位置 → ✓）
  // 先用重設按鈕離開放建築（D-024）：開始放民居 → 重設 → 沒有選取、不在放建築 → 再選一次農民。
  await page.getByRole("button", { name: "建造" }).tap();
  await page.getByRole("button", { name: /^民居/ }).tap();
  await expect.poll(() => mode(page)).toBe("place:dragging");
  await page.getByRole("button", { name: "重設" }).tap();
  await expect.poll(() => mode(page)).toBe("normal");
  expect(await placement(page), "no building preview").toBeNull();
  await expect.poll(() => selection(page)).toEqual({ units: [], building: null });
  await doubleTap(page, { x: farmers[0].sx, y: farmers[0].sy });
  await expect.poll(async () => (await selection(page))?.units).toEqual(farmerIds);
  await page.getByRole("button", { name: "建造" }).tap();
  await page.getByRole("button", { name: /^民居/ }).tap();
  let spot: { cellX: number; cellY: number } | null = null;
  for (const [dx, dy] of [[4, -3], [5, -2], [3, -4], [6, -3], [4, -5], [7, -1], [2, -5], [6, 0]]) {
    const cell = await page.evaluate(([x, y]) => window.__proto?.game?.openCellNear(x, y) ?? null, [farmers[0].cx + dx, farmers[0].cy + dy] as const);
    if (cell === null) continue;
    await tap(page, await toScreen(page, cell));
    const p = await placement(page);
    if (p?.valid === true) {
      spot = p;
      break;
    }
  }
  expect(spot, "a green spot for the house").not.toBeNull();
  await shot(page, info, "3-place-house");
  await page.getByRole("button", { name: "確定蓋在這裡" }).tap();
  await expect.poll(() => lastSent(page)).toMatchObject({ c: "build", u: farmerIds, type: HOUSE, x: spot?.cellX, y: spot?.cellY });
  await resume(page);
  const me = await myId(page);
  await expect
    .poll(async () => (await buildings(page)).some((b) => b.owner === me && b.type === HOUSE && b.cx === spot?.cellX && b.cy === spot?.cellY), { timeout: 30_000 })
    .toBe(true);

  // 4. 訓練（點兵營 → 訓練槍兵 → 佇列 → 出生）
  await pause(page);
  const barracks = (await buildings(page)).find((b) => b.owner === me && b.type === BARRACKS);
  if (barracks === undefined) throw new Error("no barracks");
  const bc = { x: barracks.cx + Math.floor(barracks.size / 2), y: barracks.cy + Math.floor(barracks.size / 2) };
  await centre(page, bc);
  await tap(page, await toScreen(page, bc));
  await expect(page.locator(".sel-info")).toContainText("兵營");
  const spearmenBefore = (await own(page, [SPEARMAN])).length;
  await page.getByRole("button", { name: /^訓練槍兵/ }).tap();
  await expect.poll(() => lastSent(page)).toMatchObject({ c: "train", building: barracks.id, type: SPEARMAN, n: 1 });
  // An order given while paused runs on the next tick: the queue shows once the game goes on.
  await resume(page);
  await expect(page.getByRole("button", { name: /取消訓練第 1 個：槍兵/ })).toBeVisible();
  await shot(page, info, "4-train");
  await expect.poll(async () => (await own(page, [SPEARMAN])).length, { timeout: 60_000 }).toBe(spearmenBefore + 1);

  // 5. 框選（長按空地 350 ms 後拖曳，框住在小鎮南邊的部隊）
  await pause(page);
  await centre(page, { x: SQUAD.x, y: SQUAD.y - 1 }, 0.8);
  const squad = (await own(page, [SPEARMAN, RANGED])).filter((u) => Math.abs(u.cx - SQUAD.x) <= 5 && Math.abs(u.cy - SQUAD.y) <= 3);
  expect(squad.length).toBeGreaterThanOrEqual(10);
  const xs = squad.map((u) => u.sx);
  const ys = squad.map((u) => u.sy);
  const [x0, x1, y0, y1] = [Math.min(...xs) - 30, Math.max(...xs) + 30, Math.min(...ys) - 30, Math.max(...ys) + 30];
  // A long press on a resource (the forest north of the squad) does nothing, so start the
  // box from a corner that is open ground and drag to the opposite one.
  let from: { x: number; y: number } | null = null;
  let to: { x: number; y: number } | null = null;
  for (const [a, b] of [
    [{ x: x0, y: y1 }, { x: x1, y: y0 }],
    [{ x: x1, y: y1 }, { x: x0, y: y0 }],
    [{ x: x0, y: y0 }, { x: x1, y: y1 }],
    [{ x: x1, y: y0 }, { x: x0, y: y1 }],
  ]) {
    const hit = await page.evaluate(([x, y]) => {
      const g = window.__proto?.game;
      return g == null ? "no hook" : g.pickAt(x, y);
    }, [a.x, a.y] as const);
    if (hit === null) {
      from = a;
      to = b;
      break;
    }
  }
  if (from === null || to === null) throw new Error("no open corner around the squad");
  // The box takes every own soldier inside it (soldiers before farmers), not only the squad.
  const squadIds = (await units(page))
    .filter((u) => u.owner === me && u.type !== FARMER && u.sx >= x0 && u.sx <= x1 && u.sy >= y0 && u.sy <= y1)
    .map((u) => u.id)
    .sort((a, b) => a - b);
  expect(squad.every((u) => squadIds.includes(u.id)), "the squad is inside the box").toBe(true);
  await longPress(page, from, to);
  await expect.poll(async () => (await selection(page))?.units).toEqual(squadIds);
  await shot(page, info, "5-box");
  // The squad becomes control group 1 (a soldier left as garrison later leaves it).
  await longPressOn(page, ".groups > button:nth-child(1)");
  expect((await groups(page))[0], "saved as group 1").toEqual(squadIds);

  // 5b. 改姿態（D-026）：按鈕寫著現在是積極、按了改成堅守；選取資訊寫出意思。再按一次改回積極。
  const stance = page.getByRole("button", { name: /^姿態/ });
  const stanceOfSquad = async () => [...new Set((await units(page)).filter((u) => squadIds.includes(u.id)).map((u) => u.stance))];
  await expect(stance).toHaveText("姿態：積極按一下改成堅守");
  await expect(page.locator(".sel-info")).toContainText("積極：6 格內有敵人就追上去打，離原位 8 格就回來");
  await expect(page.locator(".sel-info")).toContainText("姿態只管沒有指令、站著待命的時候");
  await stance.tap();
  await expect.poll(() => lastSent(page)).toMatchObject({ c: "stance", u: squadIds, stance: 1 });
  // An order given while paused runs when the game goes on.
  await resume(page);
  await expect.poll(stanceOfSquad).toEqual([1]);
  await expect(stance).toHaveText("姿態：堅守按一下改成積極");
  await expect(page.locator(".sel-info")).toContainText("堅守：站在原地不動，只打走進射程的敵人");
  await shot(page, info, "5b-stance-hold");
  await stance.tap();
  await expect.poll(() => lastSent(page)).toMatchObject({ c: "stance", u: squadIds, stance: 0 });
  await expect.poll(stanceOfSquad).toEqual([0]);
  await pause(page);

  // 6. 前進（點地面：往小鎮走，路上遇到敵人會打）
  const town = (await towns(page)).find((t) => t.size === 0);
  if (town === undefined) throw new Error("no small town on the map");
  const halfway = await page.evaluate(([x, y]) => window.__proto?.game?.openCellNear(x, y) ?? null, [SQUAD.x, SQUAD.y - 5] as const);
  if (halfway === null) throw new Error("no open cell on the way");
  await tap(page, await toScreen(page, halfway));
  await expect.poll(() => lastSent(page)).toMatchObject({ c: "move", u: squadIds, x: halfway.x, y: halfway.y });
  await resume(page);
  const distTo = async (c: { x: number; y: number }) => {
    const list = (await units(page)).filter((u) => squadIds.includes(u.id));
    return list.reduce((s, u) => s + Math.hypot(u.fx - (c.x + 0.5), u.fy - (c.y + 0.5)), 0) / Math.max(1, list.length);
  };
  const startDist = await distTo(halfway);
  // At least 2 cells closer, or arrived: in formation (1 cell apart) the average distance to
  // the point stays around 1.5 cells.
  await expect.poll(() => distTo(halfway), { timeout: 30_000 }).toBeLessThan(Math.max(startDist - 2, 2.5));

  // 7. 暫停時下指令（暫停後模擬停住，對小鎮下前進指令，按繼續後才執行）
  await pause(page);
  const frozen = (await header(page)).tick;
  await centre(page, { x: town.cx, y: town.cy + 3 }, 0.8);
  const target = await page.evaluate(([x, y]) => window.__proto?.game?.openCellNear(x, y) ?? null, [town.cx, town.cy] as const);
  if (target === null) throw new Error("no open cell in the town");
  await tap(page, await toScreen(page, target));
  await expect.poll(() => lastSent(page)).toMatchObject({ u: squadIds });
  await page.waitForTimeout(500);
  expect((await header(page)).tick, "no ticks while paused").toBe(frozen);
  await shot(page, info, "7-order-while-paused");
  await resume(page);

  // 8. 攻下城鎮後治理並留守（民兵全倒、只剩我方軍隊 → 跳出兩個大按鈕，各有「留守 − N + 名」；D-026）
  const choice = page.getByRole("dialog", { name: /搶還是治理/ });
  await expect(choice).toBeVisible({ timeout: 180_000 });
  // 治理 keeps the least a small town needs (1); 搶 keeps nobody.
  await expect(choice.getByRole("status", { name: "留守幾名（治理）" })).toHaveText("1");
  await expect(choice.getByRole("status", { name: "留守幾名（搶）" })).toHaveText("0");
  await shot(page, info, "8-town-choice");
  await choice.getByRole("button", { name: /^治理/ }).tap();
  await expect.poll(async () => (await sent(page)).at(-2)).toMatchObject({ c: "town_choice", town: town.id, choice: 1 });
  // One soldier stays: told to hold, out of control group 1.
  await expect.poll(() => garrison(page, town.id)).toHaveLength(1);
  const [kept] = await garrison(page, town.id);
  expect(squadIds, "one of the squad").toContain(kept);
  await expect.poll(() => lastSent(page)).toMatchObject({ c: "stance", u: [kept], stance: 1, auto: true });
  expect((await groups(page))[0]).not.toContain(kept);
  // Repairing (TownState 3) by us, and the soldier holds.
  await expect.poll(async () => (await towns(page)).find((t) => t.id === town.id)?.state, { timeout: 30_000 }).toBe(3);
  await expect.poll(async () => (await units(page)).find((u) => u.id === kept)?.stance).toBe(1);
  await shot(page, info, "8-governing");

  // 8b. 全軍不帶走留守的兵：全軍 → 前進到遠處 → 部隊都離開城鎮後，駐軍還夠，沒有開始叛離
  await page.getByRole("button", { name: "全軍" }).tap();
  await expect.poll(async () => (await selection(page))?.units.length ?? 0).toBeGreaterThan(0);
  const marching = (await selection(page))?.units ?? [];
  expect(marching, "全軍 leaves the garrison").not.toContain(kept);
  const away = await page.evaluate(([x, y]) => window.__proto?.game?.openCellNear(x, y) ?? null, [SQUAD.x, SQUAD.y] as const);
  if (away === null) throw new Error("no open cell to march to");
  await page.evaluate((u) => window.__proto?.game?.select(u), marching);
  await centre(page, away, 0.8);
  await tap(page, await toScreen(page, away));
  await expect.poll(() => lastSent(page)).toMatchObject({ c: "move", u: marching, x: away.x, y: away.y });
  // Everyone who marched is outside the town's circle.
  await expect
    .poll(
      async () => {
        const list = (await units(page)).filter((u) => marching.includes(u.id));
        return list.every((u) => Math.hypot(u.fx - (town.cx + 0.5), u.fy - (town.cy + 0.5)) > town.radius);
      },
      { timeout: 60_000 },
    )
    .toBe(true);
  const held = (await towns(page)).find((t) => t.id === town.id);
  expect(held?.owner, "still ours").toBe(me);
  expect(held?.garrison, "the garrison stayed").toBeGreaterThanOrEqual(held?.garrisonNeeded ?? 99);
  expect(held?.revoltTimer, "not counting down to a revolt").toBe(0);
  expect(await garrison(page, town.id)).toEqual([kept]);
  await shot(page, info, "8b-army-left-garrison-stays");

  // 9. 分出 N 名存成編隊（D-024）：暫停 → 全軍 → 分出一半 → 長按編隊 2 → 改選其餘
  await pause(page);
  await page.getByRole("button", { name: "全軍" }).tap();
  await expect.poll(async () => (await selection(page))?.units.length ?? 0).toBeGreaterThan(1);
  const army = (await selection(page))?.units ?? [];
  expect(army, "全軍 still leaves the garrison").not.toContain(kept);
  const half = Math.floor(army.length / 2);
  await page.getByRole("button", { name: `分出 ${half} 名` }).tap();
  await expect.poll(async () => (await selection(page))?.units.length).toBe(half);
  const part = (await selection(page))?.units ?? [];
  expect(part.every((id) => army.includes(id)), "split from the army").toBe(true);
  await longPressOn(page, ".groups > button:nth-child(2)");
  expect((await page.evaluate(() => window.__proto?.game?.groups()))?.[1], "saved as group 2").toEqual(part);
  await shot(page, info, "9-split");
  await page.getByRole("button", { name: `改選其餘 ${army.length - half} 名` }).tap();
  await expect.poll(async () => (await selection(page))?.units).toEqual(army.filter((id) => !part.includes(id)));

  // 10. 不選農民蓋民居（D-024）：重設 → 建造 → 民居 → ✓，由模擬派最近的農民去蓋
  await page.getByRole("button", { name: "重設" }).tap();
  await expect.poll(() => selection(page)).toEqual({ units: [], building: null });
  await centre(page, { x: farmers[0].cx, y: farmers[0].cy });
  await page.getByRole("button", { name: "建造" }).tap();
  await page.getByRole("button", { name: /^民居/ }).tap();
  let spot2: { cellX: number; cellY: number } | null = null;
  for (const [dx, dy] of [[-4, 3], [-5, 2], [-3, 4], [0, 5], [5, 4], [4, -3], [5, -2], [3, -4], [6, -3], [4, -5], [7, -1], [2, -5], [6, 0], [-6, -2]]) {
    const cell = await page.evaluate(([x, y]) => window.__proto?.game?.openCellNear(x, y) ?? null, [farmers[0].cx + dx, farmers[0].cy + dy] as const);
    if (cell === null) continue;
    await tap(page, await toScreen(page, cell));
    const p = await placement(page);
    if (p?.valid === true) {
      spot2 = p;
      break;
    }
  }
  if (spot2 === null) throw new Error("no green spot for the second house");
  const house2 = spot2;
  await shot(page, info, "10-house-without-farmers");
  await page.getByRole("button", { name: "確定蓋在這裡" }).tap();
  await expect.poll(() => lastSent(page)).toMatchObject({ c: "build", u: [], type: HOUSE, x: house2.cellX, y: house2.cellY });
  await resume(page);
  // The simulation sent the nearest farmer: the foundation is there and building has started.
  await expect
    .poll(async () => (await buildings(page)).find((b) => b.owner === me && b.type === HOUSE && b.cx === house2.cellX && b.cy === house2.cellY)?.progress ?? -1, { timeout: 30_000 })
    .toBeGreaterThan(0);
  await expect(page.getByText("附近沒有可以派去蓋的農民")).toBeHidden();
  check();
});
