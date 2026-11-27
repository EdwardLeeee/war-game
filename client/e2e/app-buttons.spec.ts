// 按鈕不動，每顆都按 (the user 2026-11-27 on TestFlight: 「你app需要驗證每個按鈕跟加減法，兵按加號減號還是會框框跳動」;
// ceo 2026-11-27): the page that taps every button (lab/stable-buttons.ts, ?test=1&mock=1&stable=1) on the app's screen
// as war-game-mobile measured it in iOS's simulator (0.1.0 (4): 932 × 430, at 3, safe area 0 / 59 / 20 / 59, the same
// either way round, text not scaled by the system's size), in WebKit, by touch, motion not reduced. It says where to tap
// and this taps there, as the app's XCUITest does (mobile/stable-buttons). Every button of every panel once, those
// pressed again and again ten times; any button moved by more than 1 px, a tap that landed elsewhere, a reaction not as
// it should be or an error fails it. The buttons tapped, those not (and why) and those whose reaction is not checked are
// listed (attached, and in the log).
import { writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const SAFE = { top: 0, right: 59, bottom: 20, left: 59 };

test.use({ viewport: { width: 932, height: 430 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });

type Line = { step: number; next: { seq: number; id: string; x: number; y: number; times: number; gap: number } | null; done: boolean; ok: boolean };

test("每顆按鈕都按（app 的畫面）：位置不動、點在它上面、反應對、沒有錯誤", async ({ page }, info) => {
  test.skip(info.project.name !== "webkit", "the app's WebKit; the computer's windows are stable-buttons.spec's");
  test.setTimeout(1_200_000);
  // The safe area as the app has it (WebKit here has none): the page's --safe-* (style.css), as the page loads.
  await page.addInitScript((s) => {
    const put = () => {
      const r = document.documentElement.style;
      r.setProperty("--safe-t", `${s.top}px`);
      r.setProperty("--safe-r", `${s.right}px`);
      r.setProperty("--safe-b", `${s.bottom}px`);
      r.setProperty("--safe-l", `${s.left}px`);
    };
    if (document.documentElement !== null) put();
    document.addEventListener("DOMContentLoaded", put);
  }, SAFE);
  await page.goto("./?test=1&mock=1&stable=1&market=1&tps=20");
  const line = () => page.evaluate(() => (window.__stableButtons?.line ?? null) as unknown);
  for (let guard = 0; guard < 20_000; guard++) {
    const l = (await line()) as Line | null;
    if (l?.done === true) break;
    const next = l?.next ?? null;
    if (next === null) {
      await page.waitForTimeout(50);
      continue;
    }
    for (let i = 0; i < next.times; i++) {
      await page.touchscreen.tap(next.x, next.y);
      if (i < next.times - 1) await page.waitForTimeout(next.gap);
    }
    // Taken: the page clears next once it has them all, then asks for the next tap with a new seq.
    await expect.poll(async () => ((await line()) as Line | null)?.next?.seq ?? -1, { timeout: 70_000 }).not.toBe(next.seq);
  }
  const r = await page.evaluate(() => window.__stableButtons ?? null);
  if (r === null) throw new Error("no results");
  const file = info.outputPath("stable-buttons.json");
  writeFileSync(file, JSON.stringify(r, null, 1));
  await info.attach("stable-buttons.json", { path: file, contentType: "application/json" });
  console.log(`STABLE line ${JSON.stringify(r.line)}`);
  console.log(`STABLE 按過 ${r.pressedList.length}：${r.pressedList.map((p) => `${p.scene}/${p.label}×${p.times}`).join("、")}`);
  console.log(`STABLE 沒按 ${r.notPressed.length}：${r.notPressed.map((p) => `${p.scene}/${p.label}（${p.reason}）`).join("、")}`);
  console.log(`STABLE 沒驗反應 ${r.noReaction.length}：${r.noReaction.map((p) => `${p.scene}/${p.label}（${p.reason}）`).join("、")}`);
  console.log(`STABLE 只驗了有變化 ${r.changedOnly.length}：${r.changedOnly.map((p) => `${p.scene}/${p.label}`).join("、")}`);
  for (const s of r.steps) {
    const judged = s.moved.filter((m) => m.judged);
    if (judged.length > 0 || s.missed.length > 0 || s.reaction === "bad") console.log(`STABLE step ${s.step} ${s.scene}/${s.label}×${s.times}: moved ${judged.map((m) => `${m.key} ${m.kind} ${m.dx},${m.dy}`).join("; ")} missed ${s.missed.join("; ")} gone ${s.gone.length} reaction ${s.reaction} ${s.reactionNote}`);
  }
  expect(r.errors, "no errors").toEqual([]);
  expect(r.steps.flatMap((s) => s.moved.filter((m) => m.judged).map((m) => `${s.scene}/${s.label}: ${m.key} ${m.kind} ${m.dx},${m.dy}`)), "no button moved over 1 px").toEqual([]);
  expect(r.steps.flatMap((s) => s.missed.map((m) => `${s.scene}/${s.label}: ${m}`)), "every tap on its button").toEqual([]);
  expect(r.steps.filter((s) => s.reaction === "bad").map((s) => `${s.scene}/${s.label}: ${s.reactionNote}`), "reactions as they should be").toEqual([]);
  expect((r.line as { ok: boolean }).ok).toBe(true);
});
