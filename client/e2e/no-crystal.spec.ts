// 沒有魔晶（D-135, the user 2026-11-08: 「魔晶感覺很雞肋都用不到 好像可以拿掉」; rules.features.noCrystal): the screen shows
// 魔晶 nowhere. The prototype's resource bar 糧、木、金 only (its one-letter 晶 is not 魔晶, so it is looked at by itself);
// 開局提示 「城鎮給什麼」 and no line for it in 選單 (ui's R15-06, the user's approval 2026-11-08), 預留 three rows, 自動晶砲 without a cost, 搶 「糧和金」, the messages without
// crystal. 晶砲 keeps its name: only 「魔晶」 is looked for. The fake world plays without crystal as the simulation does.

import { expect, type Page, test } from "@playwright/test";
import { expectSaid, recordToasts, watchErrors } from "./helpers.ts";

const resBar = (page: Page) => page.evaluate(() => document.querySelector(".res-bar")?.textContent ?? "");
const noCrystalOnScreen = async (page: Page, where: string) => expect(await page.evaluate(() => document.body.innerText), where).not.toContain("魔晶");

test("沒有魔晶（假世界，原型介面）：資源列只有糧、木、金；開局提示、預留、法師說明、攻下城鎮、搶完、擊殺法師的訊息都沒有魔晶", async ({ page }) => {
  test.setTimeout(120_000);
  const check = watchErrors(page);
  await page.goto("./?test=1&mock=1&ui=proto&hint=1");
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true);
  await recordToasts(page);
  expect((await page.evaluate(() => window.__proto?.game?.features() ?? {})).noCrystal).toBe(true);
  // 開局提示: 「城鎮給什麼」.
  const hint = page.getByRole("dialog", { name: "城鎮給什麼" });
  await expect(hint).toContainText("帶兵打倒城裡的民兵，就能選「搶」或「治理」。");
  await expect(hint).toContainText(/搶：馬上拿到一大筆糧和金（小鎮各 \d+、大城各 \d+）/);
  await noCrystalOnScreen(page, "開局提示");
  await hint.getByRole("button", { name: "知道了" }).tap();
  await expect(hint).toBeHidden();
  await expect.poll(() => resBar(page)).toMatch(/^糧 \d+　木 \d+　金 \d+　人口 /);
  expect(await resBar(page)).not.toContain("晶");
  await noCrystalOnScreen(page, "at the start");

  // 選單: no line for the hint (R15-06).
  await page.getByRole("button", { name: "選單" }).tap();
  await expect(page.getByRole("dialog", { name: "選單" })).toBeVisible();
  await expect(page.getByRole("button", { name: /怎麼拿/ })).toHaveCount(0);
  await noCrystalOnScreen(page, "選單");
  await page.getByRole("button", { name: "關閉" }).tap();

  // 預留: 糧、木、金.
  const me = await page.evaluate(() => window.__proto?.game?.me() ?? 0);
  const city = (await page.evaluate(() => window.__proto?.game?.buildings() ?? [])).find((b) => b.owner === me && b.type === 0);
  if (city === undefined) throw new Error("no main city");
  await page.evaluate(([x, y]) => window.__proto?.game?.centerOn(x, y, 1), [city.cx + 2, city.cy + 2] as const);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const at = await page.evaluate(([x, y]) => window.__proto?.game?.cellToScreen(x, y) ?? { x: 0, y: 0 }, [city.cx + 2, city.cy + 2] as const);
  await page.touchscreen.tap(at.x, at.y);
  await page.locator(".cmds").getByRole("button", { name: /^預留/ }).tap();
  const reserve = page.getByRole("dialog", { name: "預留" });
  await expect(reserve.locator(".ratio-name")).toHaveText(["糧", "木", "金"]);
  await expect(reserve).not.toContainText("晶");
  await expect(reserve).toContainText(/要存錢蓋法術營（木 \d+、金 (\d+)），把金調到 \1。/);
  await reserve.getByRole("button", { name: "取消" }).tap();

  // A mage: 自動晶砲 without a cost.
  const mage = (await page.evaluate(() => window.__proto?.game?.units() ?? [])).find((u) => u.owner === me && u.type === 3);
  if (mage === undefined) throw new Error("no mage");
  await page.evaluate((id) => window.__proto?.game?.select([id]), mage.id);
  await expect(page.locator(".cannon-meaning")).toContainText("自動晶砲：冷卻");
  await noCrystalOnScreen(page, "法師的說明");
  await page.evaluate(() => window.__proto?.game?.select([]));

  // A town taken: 搶 gives 糧和金.
  await page.evaluate((by) => window.__proto?.game?.inject({ k: "town_captured", town: 0, by }), me);
  const choice = page.getByRole("dialog", { name: /^攻下/ });
  await expect(choice).toContainText("拿一大筆糧和金");
  await noCrystalOnScreen(page, "攻下城鎮");
  await choice.getByRole("button", { name: /稍後再決定/ }).tap();
  await expect(choice).toBeHidden();

  // The messages: 搶完了 and 擊殺敵方法師, no crystal.
  await page.evaluate((by) => window.__proto?.game?.inject({ k: "town_plundered", town: 0, by, food: 300, gold: 300, crystal: 0 }), me);
  await expectSaid(page, "搶完了：糧 300、金 300");
  const foe = (await page.evaluate(() => window.__proto?.game?.units() ?? [])).find((u) => u.owner !== me && u.type === 3);
  await page.evaluate(([id, owner]) => window.__proto?.game?.inject({ k: "mage_killed", id, owner, killer: 0, crystal: 0 }), [foe?.id ?? 999, 1 - me] as const);
  await expectSaid(page, "擊殺敵方法師");
  const said = await page.evaluate(() => (window as unknown as { __said?: { text: string }[] }).__said?.map((s) => s.text) ?? []);
  expect(said.filter((t) => t.includes("魔晶"))).toEqual([]);
  check();
});

test("沒有魔晶（真的模擬）：規則送 noCrystal，資源列只有糧、木、金", async ({ page }) => {
  test.setTimeout(120_000);
  const check = watchErrors(page);
  await page.goto("./?test=1&scenario=e2e&ai=0&ui=proto");
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true, null, { timeout: 90_000 });
  expect((await page.evaluate(() => window.__proto?.game?.features() ?? {})).noCrystal).toBe(true);
  await expect.poll(() => resBar(page)).toMatch(/^糧 \d+　木 \d+　金 \d+　人口 /);
  expect(await resBar(page)).not.toContain("晶");
  await noCrystalOnScreen(page, "the real game's screen");
  check();
});
