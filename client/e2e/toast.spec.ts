// The message strip really seen (ceo 2026-11-06): the checks elsewhere read what the strip said
// (helpers.ts expectSaid: it shows 2.2 s, a busy page's checks can come later); here, each look
// of it, in the prototype's and in 正式介面 (?ui=r6), was on the screen, on top, not hidden or
// see-through the moment it was shown: an alarm (red), an order taken (dark, the green check:
// R6-31), and the rest (dark, no check).

import { type Page, test } from "@playwright/test";
import { expectSaid, selectForCommands, watchToasts } from "./helpers.ts";
import { tap } from "./touch.ts";

const BARRACKS = 3;

async function tapBuilding(page: Page, id: number): Promise<void> {
  const b = (await page.evaluate(() => window.__proto?.game?.buildings() ?? [])).find((v) => v.id === id);
  if (b === undefined) throw new Error(`no building ${id}`);
  await page.evaluate(([x, y]) => window.__proto?.game?.centerOn(x, y, 1), [b.cx + b.size / 2, b.cy + b.size / 2] as const);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  for (let y = b.cy; y < b.cy + b.size; y++) {
    for (let x = b.cx; x < b.cx + b.size; x++) {
      const at = await page.evaluate(([cx, cy]) => window.__proto?.game?.cellToScreen(cx + 0.5, cy + 0.5) ?? { x: 0, y: 0 }, [x, y] as const);
      if ((await page.evaluate(([sx, sy]) => window.__proto?.game?.pickAt(sx, sy) ?? null, [at.x, at.y] as const)) !== "building") continue;
      await tap(page, at);
      return;
    }
  }
  throw new Error(`no cell of building ${id}`);
}

for (const [ui, name] of [["", "原型"], ["&ui=r6", "正式介面"]] as const) {
  test(`訊息條（${name}）：被攻擊（紅）、下了指令（深色加綠勾）、其他（深色）三種，出現時都真的在畫面上、在最上面、看得到`, async ({ page }) => {
    await watchToasts(page);
    await page.goto(`./?test=1&mock=1&tps=20${ui}`);
    await page.getByRole("button", { name: "開始" }).tap();
    await page.waitForFunction(() => window.__proto?.ready === true);
    await page.waitForFunction(() => (window.__proto?.game?.header().tick ?? 0) > 5);
    const me = await page.evaluate(() => window.__proto?.game?.me() ?? 0);
    const farmers = (await page.evaluate(() => window.__proto?.game?.units() ?? [])).filter((u) => u.owner === me && u.type === 0);
    // An alarm: a mage of ours fallen (said in both; 家裡被攻擊 is 正式介面's only).
    const mage = (await page.evaluate(() => window.__proto?.game?.units() ?? [])).find((u) => u.owner === me && u.type === 3);
    if (mage === undefined) throw new Error("no mage");
    await page.evaluate(([id, owner]) => window.__proto?.game?.inject({ k: "mage_killed", id, owner, killer: 1, crystal: 0 }), [mage.id, me] as const);
    await expectSaid(page, "我方法師陣亡", { seen: true, ok: false, info: false, check: false });
    // An order taken: the barracks' 自動訓練 paused.
    await tapBuilding(page, BARRACKS);
    await page.locator(".cmds").getByRole("button", { name: /^自動訓練/ }).tap();
    await expectSaid(page, "已暫停這座兵營的自動訓練", { seen: true, ok: true, check: true });
    // The rest: a house put away with ✗.
    await page.evaluate(() => window.__proto?.game?.select([]));
    await selectForCommands(page, farmers.map((u) => u.id));
    await page.locator(".cmds").getByRole("button", { name: /^建造/ }).tap();
    await page.locator(".cmds").getByRole("button", { name: /^民居/ }).tap();
    const spot = await page.evaluate(() => window.__proto?.game?.buildSpotNear(1, 20, 78) ?? null);
    if (spot === null) throw new Error("no spot for a house");
    await tap(page, await page.evaluate(([x, y]) => window.__proto?.game?.cellToScreen(x + 0.5, y + 0.5) ?? { x: 0, y: 0 }, [spot.x, spot.y] as const));
    await page.getByRole("button", { name: "取消放建築" }).tap();
    await expectSaid(page, "已取消蓋民居", { seen: true, ok: false, info: true, check: false });
  });
}
