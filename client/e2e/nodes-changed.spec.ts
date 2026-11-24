// 只畫變了的 (the user 2026-11-24 「我用網頁到200兵時畫面會卡卡的」): every tree and mine was drawn again whenever any of
// them changed (the snapshot sends one at each gatherer's trip), every castle whenever the fog came (6 times a second).
// Those changed drawn, the rest left as they were, come to the same pictures as all of them drawn again, while the game
// goes on (core's real simulation, fast).
import { expect, test } from "@playwright/test";
import { watchErrors } from "./helpers.ts";

test("資源點只畫變了的：一邊打一邊比，和全部重畫的樣子（圖、位置、前後、顏色、影子、倒在地上）每一個都一樣；有些真的變了", async ({ page }) => {
  test.setTimeout(120_000);
  const check = watchErrors(page);
  await page.goto("./?test=1&scenario=e2e&tps=400&art=x3");
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true, null, { timeout: 60_000 });
  const first = await page.evaluate(() => window.__proto?.game?.nodeLooks(false) ?? []);
  expect(first.length, "nodes drawn from the atlases").toBeGreaterThan(20);
  // A frame drawn from the latest snapshot, read as drawn bit by bit, then all drawn again and read: in one go, so no
  // snapshot comes between.
  const compare = () =>
    page.evaluate(() => {
      const g = window.__proto?.game;
      g?.drawNow();
      return { parts: g?.nodeLooks(false) ?? [], whole: g?.nodeLooks(true) ?? [], tick: g?.header().tick ?? 0 };
    });
  let last = first;
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(1000);
    const r = await compare();
    expect(r.parts, `tick ${r.tick}`).toEqual(r.whole);
    last = r.whole;
  }
  // The gatherers took from some: those were drawn again (fewer left, or spent and lying on the ground).
  expect(last.filter((l, i) => l !== first[i]).length, "nodes changed while the game went on").toBeGreaterThan(0);
  check();
});

test("城牆只在自己那一塊的霧變了才重畫：一邊打一邊比，和每座城都重畫的樣子每一塊都一樣", async ({ page }) => {
  test.setTimeout(120_000);
  const check = watchErrors(page);
  await page.goto("./?test=1&scenario=e2e&tps=400&art=x3");
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true, null, { timeout: 60_000 });
  await expect.poll(async () => (await page.evaluate(() => window.__proto?.game?.castleLooks(false) ?? [])).length, { timeout: 30_000 }).toBeGreaterThan(0);
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(1000);
    const r = await page.evaluate(() => {
      const g = window.__proto?.game;
      g?.drawNow();
      return { parts: g?.castleLooks(false) ?? [], whole: g?.castleLooks(true) ?? [], tick: g?.header().tick ?? 0 };
    });
    expect(r.parts, `tick ${r.tick}`).toEqual(r.whole);
  }
  check();
});
