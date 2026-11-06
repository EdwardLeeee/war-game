// R14-07 牆上換邊 (正式介面's town panel, D-119 A, sim/PROTOCOL.md 4.7 `wallShifts`): under 牆上／城內,
// who walks along the wall and where to (換邊), walking back (走回原位), and for a few seconds after a
// walk to fight is over, how many stand on that stretch (到了). 敵人太多 and 城門破了 wait for core's
// wallHolds (#425). The prototype interface has no such line.

import { expect, type Page, test } from "@playwright/test";
import { tap } from "./touch.ts";

/** Tap a point inside our town a tap takes as the town (not its keep, a soldier or a tree). */
async function openTown(page: Page, town: { cx: number; cy: number }): Promise<void> {
  await page.evaluate(([x, y]) => window.__proto?.game?.centerOn(x, y, 1), [town.cx, town.cy + 3] as const);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const spot = await page.evaluate(([cx, cy]) => {
    const g = window.__proto?.game;
    for (let r = 1; r <= 6; r++)
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          const p = g?.cellToScreen(cx + dx, cy + dy);
          if (p === undefined || p.x < 150 || p.x > 650 || p.y < 60 || p.y > 330) continue;
          if ((g?.pickAt(p.x, p.y) ?? null) === "town") return p;
        }
    return null;
  }, [town.cx, town.cy] as const);
  if (spot === null) throw new Error("no spot on the town");
  await tap(page, spot);
  await expect(page.locator(".sel-info")).toBeVisible();
}

async function fakeTown(page: Page, ui: "r6" | "proto", view = "&view=diamond"): Promise<{ id: number; me: number }> {
  await page.goto(`./?test=1&mock=1&walls=1&keep=1&tps=20&ui=${ui}${view}`);
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true);
  const me = await page.evaluate(() => window.__proto?.game?.me() ?? 0);
  const town = (await page.evaluate(() => window.__proto?.game?.towns() ?? [])).find((t) => t.owner === me && t.size === 0 && t.state === 4);
  if (town === undefined) throw new Error("no town of ours");
  // Not paused: the fake world sends its snapshots (and the rows set) as it runs.
  await openTown(page, town);
  return { id: town.id, me };
}

const rows = (page: Page, list: number[]) => page.evaluate((r) => window.__proto?.game?.wallShifts(r), list);

test("R14-07 換邊（菱形）：照稿的句子，方位照畫面寫（D-132）；同一段同一條路合成一行；走回原位；那段牆外看不到敵人時寫已離開視野", async ({ page }) => {
  const { id, me } = await fakeTown(page, "r6");
  const line = page.getByRole("status", { name: "牆上換邊" });
  await expect(line).toBeHidden();
  // The board's 1 (town, owner, n, from, to, via, foes, home): 4 from 北牆西段 over 東門頂 to 東牆南段, 7 enemies;
  // under the diamond 東 is lower right (D-132).
  await rows(page, [id, me, 4, 1, 5, 2, 7, 0]);
  await expect(line).toHaveText("換邊：4 名走過右下門頂，去打右下牆靠下那段（敵人 7 名，沒超過牆上的 2 倍）");
  // Two rows that read the same (another start, the same way): one line, their soldiers added.
  await rows(page, [id, me, 4, 1, 5, 2, 7, 0, id, me, 2, 2, 5, 2, 7, 0]);
  await expect(line).toHaveText("換邊：6 名走過右下門頂，去打右下牆靠下那段（敵人 7 名，沒超過牆上的 2 倍）");
  // The board's 4: walking back (every row back is one line).
  await rows(page, [id, me, 3, 5, 1, 2, 0, 1, id, me, 1, 4, 2, 2, 0, 1]);
  await expect(line).toHaveText("敵人走了 10 秒：走回原位");
  // Set off while an enemy was seen, it walked out of sight: no 「敵人 0 名」 (ceo 2026-11-06).
  await rows(page, [id, me, 2, 7, 4, 0, 0, 0]);
  await expect(line).toHaveText("換邊：2 名去打右下牆靠右那段（敵人已離開視野）");
  // Two lines at most, the most soldiers first; not the enemy's rows.
  await rows(page, [id, me, 2, 7, 4, 0, 3, 0, id, me, 5, 1, 5, 2, 7, 0, id, me, 1, 10, 11, 0, 3, 0, id, 1 - me, 9, 1, 2, 0, 3, 0]);
  await expect(line.locator("p")).toHaveText(["換邊：5 名走過右下門頂，去打右下牆靠下那段（敵人 7 名，沒超過牆上的 2 倍）", "換邊：2 名去打右下牆靠右那段（敵人 3 名，沒超過牆上的 2 倍）"]);
  await rows(page, []);
  await expect(line).toBeHidden();
});

test("R14-07 換邊（方形斜看）：北在上，東門頂寫右門頂、東牆南段寫右牆靠下那段", async ({ page }) => {
  const { id, me } = await fakeTown(page, "r6", "");
  await rows(page, [id, me, 4, 1, 5, 2, 7, 0]);
  await expect(page.getByRole("status", { name: "牆上換邊" })).toHaveText("換邊：4 名走過右門頂，去打右牆靠下那段（敵人 7 名，沒超過牆上的 2 倍）");
});

test("R14-07 換邊：原型介面的城鎮面板沒有這一行", async ({ page }) => {
  const { id, me } = await fakeTown(page, "proto");
  await rows(page, [id, me, 4, 1, 5, 2, 7, 0]);
  await page.waitForTimeout(500);
  await expect(page.getByRole("status", { name: "牆上換邊" })).toHaveCount(0);
});

test("R14-07 換邊（真的模擬，D-119 的 wallshift 場景）：牆上的兵沿牆走過去時寫換邊，走到了寫幾名一起打", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("./?test=1&scenario=wallshift&ui=r6");
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true, null, { timeout: 90_000 });
  const town = (await page.evaluate(() => window.__proto?.game?.towns() ?? [])).find((t) => t.id === 0);
  if (town === undefined) throw new Error("no town 0");
  await openTown(page, town);
  const line = page.getByRole("status", { name: "牆上換邊" });
  // The screen's directions (D-132): the default view's (north up) or the diamond's.
  const side = "(右上|右下|左下|左上|上|右|下|左)";
  await expect(line).toContainText(new RegExp(`^換邊：\\d+ 名(走過${side}門頂(、${side}門頂)*，)?去打${side}牆靠[上下左右]那段（`), { timeout: 60_000 });
  await expect(line).toContainText(new RegExp(`${side}牆靠[上下左右]那段：\\d+ 名一起打`), { timeout: 60_000 });
});
