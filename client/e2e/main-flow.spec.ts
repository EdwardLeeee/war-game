// The brief's main flow, on core's real simulation with its `e2e` scenario (plenty of
// resources, two houses and a barracks, a squad of 6 spearmen and 4 ranged ten cells from
// the small town), in WebKit and Chromium at iPhone landscape size with touch:
// 開局（選難度）→ 選農民 → 蓋房子（中間用重設離開放建築）→ 訓練 → 框選 → 改姿態 → 前進 →
// 暫停時下指令 → 攻下城鎮後治理並留守 → 全軍離開、城鎮不叛離 → 編隊缺人後不選農民蓋民居，
// 自動訓練出來的新兵補進來 → 暫停自動訓練 → 軍團畫面 → 散開隊形 → 全軍撤退
// （D-024、D-026、D-027、D-054）.
// Every step goes through the interface the player uses; the test hook only reads state
// and moves the camera. The opponent stands still (?test=1&ai=0, see step 1). As in a real
// game, the barracks trains spearmen on its own (自動訓練, on by default: D-054) until
// step 8d pauses it, so the counts before that say "at least".

import { expect, type Page, test } from "@playwright/test";
import { armyButton, saveGroup, selectForCommands, shot, watchErrors } from "./helpers.ts";
import { doubleTap, longPress, tap, tapOn } from "./touch.ts";

const FARMER = 0;
const SPEARMAN = 1;
const RANGED = 2;
const MAIN_CITY = 0;
const HOUSE = 1;
const BARRACKS = 6;
const SQUAD = { x: 26, y: 40 };

const header = (page: Page) => page.evaluate(() => window.__proto?.game?.header() ?? { tick: -1, paused: false, speed: 0, scenario: -1 });
const units = (page: Page) => page.evaluate(() => window.__proto?.game?.units() ?? []);
const buildings = (page: Page) => page.evaluate(() => window.__proto?.game?.buildings() ?? []);
const towns = (page: Page) => page.evaluate(() => window.__proto?.game?.towns() ?? []);
const placement = (page: Page) => page.evaluate(() => window.__proto?.game?.placement() ?? null);
const sent = (page: Page) => page.evaluate(() => (window.__proto?.game?.sent() ?? []) as Record<string, unknown>[]);
/** The last order the player gave himself (the interface's own orders are marked `auto`). */
const lastSent = async (page: Page) => (await sent(page)).filter((c) => c.auto !== true).at(-1);
const groupInfo = (page: Page) => page.evaluate(() => window.__proto?.game?.groupInfo() ?? []);
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
  await page.getByRole("button", { name: "暫停", exact: true }).tap();
  await expect.poll(async () => (await header(page)).paused).toBe(true);
}

async function resume(page: Page): Promise<void> {
  await page.getByRole("button", { name: "繼續", exact: true }).tap();
  await expect.poll(async () => (await header(page)).paused).toBe(false);
}

test("主要流程：開局（選難度）→ 選農民 → 蓋房子（重設）→ 訓練 → 框選 → 改姿態 → 前進 → 暫停時下指令 → 攻下城鎮後治理並留守 → 全軍離開不叛離 → 不選農民蓋民居、自動訓練的新兵補進編隊 → 暫停自動訓練 → 軍團畫面 → 散開隊形 → 全軍撤退", async ({ page }, info) => {
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
  // At least one more: 自動訓練 queues spearmen of its own too.
  await expect.poll(async () => (await own(page, [SPEARMAN])).length, { timeout: 60_000 }).toBeGreaterThanOrEqual(spearmenBefore + 1);

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
  await saveGroup(page, ".groups > button:nth-child(1)");
  expect((await groups(page))[0], "saved as group 1").toEqual(squadIds);

  // 5b. 堅守（D-050）：選取資訊寫著三顆按鈕的意思；按了停下並改成堅守。下一步點地面就是進攻，改回積極。
  const hold = page.getByRole("button", { name: /^堅守/ });
  const stanceOfSquad = async () => [...new Set((await units(page)).filter((u) => squadIds.includes(u.id)).map((u) => u.stance))];
  const now = page.locator(".sel-info .order-now");
  // Saved, the group's panel shows (D-054); the squad selected as such shows its states.
  await selectForCommands(page, squadIds);
  await expect(now).toHaveText(`目前：待命 ${squadIds.length}`);
  await expect(page.locator(".sel-info")).toContainText("堅守：停在原地，敵人進到射程就打，不追出去");
  await hold.tap();
  await expect.poll(async () => (await sent(page)).slice(-2)).toMatchObject([{ c: "stop", u: squadIds }, { c: "stance", u: squadIds, stance: 1 }]);
  // An order given while paused runs when the game goes on.
  await resume(page);
  await expect.poll(stanceOfSquad).toEqual([1]);
  await expect(now).toHaveText(`目前：堅守 ${squadIds.length}`);
  await expect(hold).toHaveClass(/active/);
  await shot(page, info, "5b-hold");
  await pause(page);

  // 6. 前進（點地面：往小鎮走，路上遇到敵人會打）
  // The small town nearest the squad, whatever towns the map has (D-044 adds one near each
  // main city): not the first one in the list or a fixed id.
  const town = (await towns(page))
    .filter((t) => t.size === 0)
    .sort((a, b) => Math.hypot(a.cx - SQUAD.x, a.cy - SQUAD.y) - Math.hypot(b.cx - SQUAD.x, b.cy - SQUAD.y) || a.id - b.id)[0];
  if (town === undefined) throw new Error("no small town on the map");
  const halfway = await page.evaluate(([x, y]) => window.__proto?.game?.openCellNear(x, y) ?? null, [SQUAD.x, SQUAD.y - 5] as const);
  if (halfway === null) throw new Error("no open cell on the way");
  await tap(page, await toScreen(page, halfway));
  // A tap on the ground is 進攻 (D-050): the 堅守 squad goes 積極 with it.
  await expect
    .poll(async () => (await sent(page)).slice(-2))
    .toMatchObject([{ c: "move", u: squadIds, x: halfway.x, y: halfway.y }, { c: "stance", u: squadIds, stance: 0, auto: true }]);
  await resume(page);
  await expect.poll(stanceOfSquad).toEqual([0]);
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
  await expect.poll(() => lastSent(page)).toMatchObject({ c: "town_choice", town: town.id, choice: 1 });
  // One soldier stays: told to hold, out of control group 1.
  await expect.poll(() => garrison(page, town.id)).toHaveLength(1);
  const [kept] = await garrison(page, town.id);
  // One of ours who took the town: the squad, or a spearman 自動訓練 sent after it (D-054).
  expect((await units(page)).find((u) => u.id === kept)?.owner, "one of ours").toBe(me);
  // (Group 1 is short of him now, and may take a soldier in no group (D-050): look for the stance among what was sent.)
  await expect.poll(async () => (await sent(page)).filter((c) => c.c === "stance" && c.auto === true).at(-1)).toMatchObject({ c: "stance", u: [kept], stance: 1 });
  expect((await groups(page))[0]).not.toContain(kept);
  // Repairing (TownState 3) by us, and the soldier holds.
  await expect.poll(async () => (await towns(page)).find((t) => t.id === town.id)?.state, { timeout: 30_000 }).toBe(3);
  await expect.poll(async () => (await units(page)).find((u) => u.id === kept)?.stance).toBe(1);
  await shot(page, info, "8-governing");

  // 8b. 全軍不帶走留守的兵：全軍 → 前進到遠處 → 部隊都離開城鎮後，駐軍還夠，沒有開始叛離
  await armyButton(page).tap();
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

  // 8c. 編隊缺人後，自動訓練出來的新兵補進來（D-026、D-054）：自動訓練一直開著，沒有人按「訓練槍兵」。
  //     編隊 1 的一名槍兵去留守 → 編隊 1 缺一名槍兵 → 不選農民蓋民居（D-024；人口可能早就滿了，蓋好才有空位）→
  //     兵營自己練出來的槍兵編進編隊 1，馬上自己走到部隊那裡（全軍在 8b 走到了 `away`）。
  //     Who fills the gap first is not fixed: an idle spearman in no group (D-050) or a new one.
  //     The new ones join group 1 either way (the group short of them, or the largest one).
  const g1 = (await groupInfo(page))[0];
  const sp = (await units(page)).find((u) => g1.ids.includes(u.id) && u.type === SPEARMAN)?.id;
  if (sp === undefined) throw new Error("no spearman left in group 1");
  // Walk it into the town by hand, then station it from the town's selection info. Not to
  // `target`: the soldier kept in step 8 (the one nearest the centre) stands there, and a tap
  // on him selects him (run 36820687063). A cell where a tap hits the town's open ground.
  await page.evaluate((u) => window.__proto?.game?.select(u), [sp]);
  await centre(page, { x: town.cx, y: town.cy + 3 }, 0.8);
  let inside: { x: number; y: number } | null = null;
  for (const [dx, dy] of [[2, 0], [-2, 0], [0, 2], [2, 1], [-2, 1], [1, 2], [-1, 2], [2, 2], [-2, 2], [0, -2]]) {
    const cell = await page.evaluate(([x, y]) => window.__proto?.game?.openCellNear(x, y) ?? null, [town.cx + dx, town.cy + dy] as const);
    if (cell === null || Math.hypot(cell.x - town.cx, cell.y - town.cy) > town.radius - 1) continue;
    const p = await toScreen(page, cell);
    if ((await page.evaluate(([x, y]) => window.__proto?.game?.pickAt(x, y) ?? null, [p.x, p.y] as const)) === "town") {
      inside = cell;
      break;
    }
  }
  if (inside === null) throw new Error("no open ground inside the town to walk to");
  const dest = inside;
  await tap(page, await toScreen(page, dest));
  await expect.poll(() => lastSent(page)).toMatchObject({ c: "move", u: [sp], x: dest.x, y: dest.y });
  // Wait until it stands on that cell. Still walking in, it can pass the spot tapped next to
  // pick the town, and that tap selects it instead (stability run 36850843922, WebKit).
  const fromDest = async () => {
    const u = (await units(page)).find((v) => v.id === sp);
    return u === undefined ? 99 : Math.hypot(u.fx - (dest.x + 0.5), u.fy - (dest.y + 0.5));
  };
  await expect.poll(fromDest, { timeout: 60_000 }).toBeLessThan(0.6);
  await page.evaluate(() => window.__proto?.game?.select([]));
  let townSpot: { x: number; y: number } | null = null;
  for (const [dx, dy] of [[0, 0], [1, 1], [-1, 1], [1, -1], [-1, -1], [2, 0], [0, 2], [-2, 0], [0, -2], [2, 2], [-2, -2], [3, 0], [0, 3]]) {
    const p = await toScreen(page, { x: town.cx + 0.5 + dx, y: town.cy + 0.5 + dy });
    if ((await page.evaluate(([x, y]) => window.__proto?.game?.pickAt(x, y) ?? null, [p.x, p.y] as const)) === "town") {
      townSpot = p;
      break;
    }
  }
  if (townSpot === null) throw new Error("no spot that picks the town");
  await tap(page, townSpot);
  // Every spearman there is now: the ones the barracks trains from here on are new.
  const known = (await own(page, [SPEARMAN])).map((u) => u.id);
  await page.locator(".sel-info").getByRole("button", { name: "多留守 1 名" }).tap();
  await expect.poll(() => garrison(page, town.id)).toEqual([kept, sp]);
  await expect.poll(async () => (await groupInfo(page))[0].ids).not.toContain(sp);
  // 不選農民蓋民居：重設 → 建造 → 民居 → ✓，由模擬派最近的農民去蓋. Placed while paused, so
  // nobody walks onto the spot between the preview and ✓.
  await pause(page);
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
  await shot(page, info, "8c-house-without-farmers");
  await page.getByRole("button", { name: "確定蓋在這裡" }).tap();
  await expect.poll(() => lastSent(page)).toMatchObject({ c: "build", u: [], type: HOUSE, x: house2.cellX, y: house2.cellY });
  await resume(page);
  // The simulation sent the nearest farmer: the foundation is there and building has started.
  await expect
    .poll(async () => (await buildings(page)).find((b) => b.owner === me && b.type === HOUSE && b.cx === house2.cellX && b.cy === house2.cellY)?.progress ?? -1, { timeout: 30_000 })
    .toBeGreaterThan(0);
  await expect(page.getByText("附近沒有可以派去蓋的農民")).toBeHidden();
  // A spearman the barracks trained on its own joins group 1.
  const newcomer = async () => {
    const ids = (await groupInfo(page))[0].ids;
    return (await own(page, [SPEARMAN])).map((u) => u.id).find((id) => !known.includes(id) && ids.includes(id)) ?? null;
  };
  await expect.poll(newcomer, { timeout: 90_000 }).not.toBeNull();
  const recruit = await newcomer();
  if (recruit === null) throw new Error("no new spearman in group 1");
  await shot(page, info, "8c-recruit-joined");
  // It sets off at once (D-054: no waiting for company), for where the group stands, by an
  // order the player did not give (with others who joined at the same check, if any).
  const marchOf = async () =>
    (await sent(page)).filter((c) => c.auto === true && c.c === "move" && (c.u as number[]).includes(recruit)).at(-1) as { x: number; y: number } | undefined;
  await expect.poll(marchOf, { timeout: 60_000 }).toBeDefined();
  const march = (await marchOf()) ?? { x: -99, y: -99 };
  expect(Math.hypot(march.x - away.x, march.y - away.y), "toward the group").toBeLessThan(5);
  // And gets there.
  await expect
    .poll(
      async () => {
        const u = (await units(page)).find((v) => v.id === recruit);
        return u === undefined ? 99 : Math.hypot(u.fx - (away.x + 0.5), u.fy - (away.y + 0.5));
      },
      { timeout: 90_000 },
    )
    .toBeLessThan(5);

  // 8d. 暫停自動訓練（D-054）：選兵營 → 「自動訓練　目前：開」→ 送出暫停、兵營的旗標清掉、按鈕寫目前：暫停 →
  //     佇列裡已經在練的那名練完，就不再排新的（後面的步驟要數全部的兵）
  await centre(page, bc);
  await tap(page, await toScreen(page, bc));
  await expect(page.locator(".sel-info")).toContainText("兵營");
  const autoTrain = page.locator(".cmds").getByRole("button", { name: /^自動訓練/ });
  await expect(autoTrain).toHaveText("自動訓練目前：開");
  await autoTrain.tap();
  await expect.poll(() => lastSent(page)).toMatchObject({ c: "auto_train", building: barracks.id, on: false });
  // BuildingFlag.AutoTrain (8) cleared in the simulation.
  await expect.poll(async () => ((await buildings(page)).find((b) => b.id === barracks.id)?.flags ?? 8) & 8).toBe(0);
  await expect(autoTrain).toHaveText("自動訓練目前：暫停");
  await expect(page.locator(".sel-info .sel-status")).toContainText("自動訓練暫停");
  await expect(page.getByRole("button", { name: /^取消訓練第 1 個/ })).toBeHidden({ timeout: 30_000 });
  await shot(page, info, "8d-auto-train-paused");

  // 9. 軍團畫面（D-054）：點編隊 1 → 選取編隊 1，選取資訊換成軍團畫面（三種兵的現有和目標）→ 收起 → 展開
  await pause(page);
  await tapOn(page, ".groups > button:nth-child(1)");
  const panel = page.locator(".sel-info");
  await expect(panel.locator(".sel-head")).toContainText("編隊 1");
  const g1Now = (await groupInfo(page))[0];
  const g1Alive = (await units(page)).filter((u) => g1Now.ids.includes(u.id)).map((u) => u.id);
  await expect.poll(async () => (await selection(page))?.units.slice().sort((a, b) => a - b)).toEqual(g1Alive.slice().sort((a, b) => a - b));
  await expect(panel.getByRole("status", { name: "槍兵要幾名" })).toHaveText(`${g1Now.want[SPEARMAN] ?? 0}`);
  await shot(page, info, "9-group-panel");
  await panel.getByRole("button", { name: "收起選取資訊" }).tap();
  await expect(panel.locator(".group-row").first()).toBeHidden();
  await panel.getByRole("button", { name: "展開選取資訊" }).tap();
  await expect(panel.locator(".group-row").first()).toBeVisible();
  await resume(page);

  // 10. 散開隊形（D-027、D-028）：全軍 → 隊形：散開（按下去就原地重排）→ 前進 → 站好後彼此相隔約 2 格。
  //     Last, so that a wider squad does not change the town steps (a radius-4 town).
  await armyButton(page).tap();
  await expect.poll(async () => (await selection(page))?.units.length ?? 0).toBeGreaterThan(3);
  const troops = (await selection(page))?.units ?? [];
  const formation = page.getByRole("button", { name: /^隊形/ });
  await expect(formation).toHaveText("隊形：密集按一下改成散開");
  await formation.tap();
  await expect.poll(() => lastSent(page)).toMatchObject({ c: "formation", u: troops, loose: true });
  await expect.poll(async () => (await units(page)).filter((u) => troops.includes(u.id)).every((u) => u.loose)).toBe(true);
  await expect(formation).toHaveText("隊形：散開按一下改成密集");
  await expect(page.locator(".sel-info")).toContainText("散開：站位間隔 2 格，站好時一發晶砲只炸得到 1 名");
  // March them together to open ground south of where the squad started; tap where nothing stands.
  await centre(page, { x: SQUAD.x, y: SQUAD.y + 4 }, 0.8);
  let field: { x: number; y: number } | null = null;
  for (const [dx, dy] of [[0, 4], [2, 4], [-2, 4], [0, 6], [3, 3], [-3, 3], [0, 2]]) {
    const cell = await page.evaluate(([x, y]) => window.__proto?.game?.openCellNear(x, y) ?? null, [SQUAD.x + dx, SQUAD.y + dy] as const);
    if (cell === null) continue;
    const p = await toScreen(page, cell);
    if ((await page.evaluate(([x, y]) => window.__proto?.game?.pickAt(x, y) ?? null, [p.x, p.y] as const)) === null) {
      field = cell;
      break;
    }
  }
  if (field === null) throw new Error("no open ground to march to");
  const ground = field;
  await tap(page, await toScreen(page, ground));
  await expect.poll(() => lastSent(page)).toMatchObject({ c: "move", u: troops, x: ground.x, y: ground.y });
  // Wait until every one of them has arrived: no order, and the same positions twice in a row.
  let before = "";
  await expect
    .poll(
      async () => {
        const list = (await units(page)).filter((u) => troops.includes(u.id));
        const now = list.map((u) => `${u.fx.toFixed(2)},${u.fy.toFixed(2)}`).join(";");
        const still = list.length === troops.length && list.every((u) => u.order === 0) && now === before;
        before = now;
        return still;
      },
      { timeout: 90_000, intervals: [500] },
    )
    .toBe(true);
  // Each one's nearest neighbour: about 2 cells in 散開, 1 in 密集. The same test as core's
  // (`loose2` in sim/test/units.test.ts): on average at least 1.5 cells, nobody closer than
  // 1.2. Units stop near their slots, not on them (WebKit run 36882777609: 1.45 to 2.01).
  const arrived = (await units(page)).filter((u) => troops.includes(u.id));
  const nearest = arrived
    .map((a) => Math.min(...arrived.filter((b) => b.id !== a.id).map((b) => Math.hypot(a.fx - b.fx, a.fy - b.fy))))
    .sort((a, b) => a - b);
  const mean = nearest.reduce((sum, d) => sum + d, 0) / nearest.length;
  const shown = `nearest neighbours ${nearest.map((d) => d.toFixed(2)).join(", ")}`;
  await shot(page, info, "10-loose-formation");
  expect(mean, shown).toBeGreaterThanOrEqual(1.5);
  expect(nearest[0], shown).toBeGreaterThanOrEqual(1.2);
  expect(mean, `not scattered: ${shown}`).toBeLessThanOrEqual(2.6);

  // 11. 全軍撤退（使用者 2026-10-01）：什麼都沒選，按一下，所有士兵（留守的不算）退回主城前面
  await page.getByRole("button", { name: "重設" }).tap();
  await expect.poll(() => selection(page)).toEqual({ units: [], building: null });
  await page.getByRole("button", { name: "全軍撤退" }).tap();
  await expect.poll(() => lastSent(page)).toMatchObject({ c: "retreat", u: troops });
  expect(troops, "the garrison stays").not.toContain(kept);
  const back = (await lastSent(page)) as { x: number; y: number };
  const city = (await buildings(page)).find((b) => b.owner === me && b.type === MAIN_CITY);
  if (city === undefined) throw new Error("no main city");
  expect(Math.abs(back.x - (city.cx + city.size / 2)), "in front of the main city").toBeLessThanOrEqual(city.size);
  expect(Math.abs(back.y - (city.cy + city.size / 2)), "in front of the main city").toBeLessThanOrEqual(city.size);
  // On their way: the order is Retreat (2).
  await expect.poll(async () => (await units(page)).filter((u) => troops.includes(u.id)).every((u) => u.order === 2)).toBe(true);
  await shot(page, info, "11-retreat-all");
  check();
});
