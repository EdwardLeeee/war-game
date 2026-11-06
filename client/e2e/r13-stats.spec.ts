// 局後統計 (R13-02 A 分頁, D-125; R14-09, D-129; b2 2026-11-07): the result screen when the game sends its timeline.
// The fake world ends with a real game's timeline (e2e/fixtures/timeline-seed3.json, scripts/timeline-fixture.ts:
// two computers on the fixed map, 28:45, the main city destroyed), from the winner's side and, swapped, the loser's;
// both interfaces (D-127) and both looks; R6's 814 × 380, and the iPhone's 932 × 430 and 932 × 336 (Safari with its tab
// bar) with its safe area, where the tabs go in a row (measured). The real simulation's timeline after 投降; the old
// table without one.

import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { injectSafeArea } from "./helpers.ts";

const FIX = JSON.parse(readFileSync(new URL("./fixtures/timeline-seed3.json", import.meta.url), "utf8")) as { winner: number; reason: number; ticks: number; timeline: Timeline };
const TABS = ["總覽", "資源", "兵力", "戰鬥", "城鎮", "法師"];

interface Timeline {
  samples: { earned: number[][]; stock: number[][]; units: number[][]; near: number[][] }[];
  towns: number[][];
  deaths: number[][];
  sides: unknown[];
  places: { towns: unknown[]; cities: unknown[] };
}

/** The same game from the other side: players 0 and 1 swapped everywhere. */
function swapped(t: Timeline): Timeline {
  const sw = <T>(a: T[]) => [a[1], a[0]];
  const other = (p: number) => (p === 0 ? 1 : p === 1 ? 0 : p);
  const n = t.places.towns.length;
  return {
    ...t,
    samples: t.samples.map((s) => ({ ...s, earned: sw(s.earned), stock: sw(s.stock), units: sw(s.units), near: s.near.map(([p, a, b]) => [p >= n ? n + other(p - n) : p, b, a]) })),
    towns: t.towns.map(([k, id, st, o]) => [k, id, st, other(o)]),
    deaths: t.deaths.map(([k, o, ty, x, y, by, c]) => [k, other(o), ty, x, y, other(by), c]),
    sides: sw(t.sides),
    places: { ...t.places, cities: sw(t.places.cities) },
  };
}

async function endWith(page: Page, o: { ui?: "r6" | "proto"; theme?: "a" | "b"; size?: { width: number; height: number }; safe?: boolean; lost?: boolean; timeline?: boolean }): Promise<void> {
  if (o.theme === "b") await page.addInitScript(() => localStorage.setItem("war-game.proto.theme", "b"));
  await page.setViewportSize(o.size ?? { width: 814, height: 380 });
  await page.goto(`./?test=1&mock=1&tps=20&ui=${o.ui ?? "r6"}`);
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true);
  if (o.safe === true) await injectSafeArea(page);
  const me = await page.evaluate(() => window.__proto?.game?.me() ?? 0);
  const t = o.timeline === false ? undefined : o.lost === true ? swapped(FIX.timeline) : FIX.timeline;
  await page.evaluate(([w, tl]) => window.__proto?.game?.endGame(w as number, 0, tl as never), [o.lost === true ? 1 - me : me, t] as const);
}

/**
 * What must hold on every tab: the card inside the screen and its safe area; every button at least 44 pt; no words cut;
 * nothing wider than the screen; the chart inside its card, the moments' key under it.
 */
const fits = (page: Page) =>
  page.evaluate(() => {
    const card = document.querySelector<HTMLElement>(".stats-card");
    if (card === null) return { missing: true, inside: false, small: [], cut: [], wide: false, charts: [], tabsIn: false, row: false, taps: [], more: true };
    const c = card.getBoundingClientRect();
    const cs = getComputedStyle(document.documentElement);
    const px = (v: string) => Number.parseFloat(cs.getPropertyValue(v)) || 0;
    const inside = c.left >= px("--safe-l") - 0.5 && c.top >= px("--safe-t") - 0.5 && c.right <= innerWidth - px("--safe-r") + 0.5 && c.bottom <= innerHeight - px("--safe-b") + 0.5;
    const buttons = [...card.querySelectorAll<HTMLElement>("button")].filter((b) => b.getClientRects().length > 0);
    // The layout's size (offset*): a button just tapped is pressed a little smaller for 120 ms (R6-25-01).
    const small = buttons.filter((b) => Math.min(b.offsetWidth, b.offsetHeight) < 44).map((b) => b.textContent);
    const words = [...card.querySelectorAll<HTMLElement>(".st-head *, button, th, td, .st-moments li *, .st-mr *, .st-mkey, .st-legend, .st-foot")];
    const cut = words.filter((e) => e.getClientRects().length > 0 && (e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1) && e.clientWidth > 0).map((e) => e.textContent?.slice(0, 20));
    const page = card.querySelector<HTMLElement>(".st-page");
    const wide = document.documentElement.scrollWidth > innerWidth + 1 || (page !== null && page.scrollWidth > page.clientWidth + 1);
    const charts = [...card.querySelectorAll<SVGElement>(".st-chart > svg")].map((s) => {
      const host = (s.closest(".st-cardin") as HTMLElement).getBoundingClientRect();
      const r = s.getBoundingClientRect();
      const key = card.querySelector(".st-mkey")?.getBoundingClientRect();
      return { inCard: r.bottom <= host.bottom + 1 && r.right <= host.right + 1, keyUnder: key === undefined || key.top >= host.bottom - 1 };
    });
    const tabs = [...card.querySelectorAll<HTMLElement>(".st-tab")].map((b) => b.getBoundingClientRect());
    const tabsIn = tabs.every((r) => r.top >= c.top && r.bottom <= c.bottom && r.left >= c.left && r.right <= c.right);
    // Every button in sight takes a tap at its centre (nothing over it: the ⌄ and its fade).
    const taps = buttons
      .filter((b) => {
        const r = b.getBoundingClientRect();
        const v = (page ?? card).getBoundingClientRect();
        return !(page?.contains(b) ?? false) || (r.top + r.height / 2 > v.top && r.top + r.height / 2 < v.bottom);
      })
      .filter((b) => {
        const r = b.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return hit === null || !(hit === b || b.contains(hit));
      })
      .map((b) => b.textContent || b.getAttribute("aria-label"));
    // The fade and its ⌄ exactly while there is more below.
    const more = page === null ? true : (page.scrollHeight - page.clientHeight - page.scrollTop > 2) === (card.querySelector<HTMLElement>(".st-more")?.hidden === false);
    return { missing: false, inside, small, cut, wide, charts, tabsIn, row: card.classList.contains("tabs-row"), taps, more };
  });

/** Words under the ⌄'s picture: text boxes of the page (HTML and the charts' SVG) that its icon's box meets. */
const overWords = (page: Page) =>
  page.evaluate(() => {
    const ic = document.querySelector(".st-more-btn .ic")?.getBoundingClientRect();
    const body = document.querySelector(".st-page");
    if (ic === undefined || body === null) return ["no ⌄"];
    const meets = (r: DOMRect) => r.width > 0 && Math.min(r.right, ic.right) - Math.max(r.left, ic.left) > 0 && Math.min(r.bottom, ic.bottom) - Math.max(r.top, ic.top) > 0;
    const out: string[] = [];
    const walk = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n !== null; n = walk.nextNode()) {
      if ((n.textContent ?? "").trim() === "" || n.parentElement?.closest(".st-more") != null) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      if ([...range.getClientRects()].some(meets)) out.push(n.textContent ?? "");
    }
    return out;
  });

async function everyTab(page: Page, label: string, row: boolean): Promise<void> {
  for (const t of TABS) {
    await page.getByRole("tab", { name: t }).tap();
    await expect(page.getByRole("tab", { name: t })).toHaveAttribute("aria-selected", "true");
    const f = await fits(page);
    expect(f, `${label} ${t}`).toMatchObject({ missing: false, inside: true, small: [], cut: [], wide: false, tabsIn: true, row, taps: [], more: true });
    for (const c of f.charts) expect(c, `${label} ${t}: the chart in its card, the key under it`).toEqual({ inCard: true, keyUnder: true });
    // A chart a page (城鎮: none in a game where no town changed hands, then it says so).
    if (t !== "總覽" && t !== "法師") await expect(page.locator(".st-page svg[role=img], .st-page > .st-none").first()).toBeVisible();
  }
}

test("局後統計（正式介面 A，814×380，勝）：上方寫勝負、原因、時間、對手的性格和地圖；總覽有關鍵時刻和雙方數字；六頁都放得下", async ({ page }) => {
  test.setTimeout(90_000);
  await endWith(page, {});
  const dialog = page.getByRole("dialog", { name: "勝利" });
  await expect(dialog.locator(".stats-card.panel")).toBeVisible();
  await expect(dialog.locator(".st-head")).toContainText("敵方主城被摧毀");
  await expect(dialog.locator(".st-head")).toContainText("遊戲時間 28:45");
  await expect(dialog.locator(".st-head")).toContainText("對手：電腦・普通・掠奪型　地圖：固定地圖");
  await expect(dialog.getByRole("tab")).toHaveText(TABS);
  // 總覽: the moments (b2's rules on the real game), then the end; the numbers.
  const moments = dialog.locator(".st-moments li");
  await expect(moments).toHaveCount(4);
  await expect(moments.nth(0)).toContainText("15:00第一次進攻敵方 12 名到小鎮・左上 2（敵死 1、我死 2）");
  await expect(moments.nth(2)).toContainText("攻進敵方主城我方 23 名到敵方主城下");
  await expect(moments.nth(3)).toContainText("敵方主城被摧毀我方勝利");
  await expect(dialog.locator(".st-nums tr").filter({ hasText: "損失（含村民）" })).toContainText("121147");
  await everyTab(page, "814×380", false);
  // 資源: 糧 first, 魔晶 at a tap.
  await page.getByRole("tab", { name: "資源" }).tap();
  await expect(dialog.locator(".st-ctl h3")).toHaveText("累計採集：糧");
  await dialog.getByRole("button", { name: "魔晶" }).tap();
  await expect(dialog.locator(".st-ctl h3")).toHaveText("累計採集：魔晶");
  await expect(dialog.getByRole("button", { name: "魔晶" })).toHaveAttribute("aria-pressed", "true");
  await expect(dialog.getByRole("img")).toHaveAttribute("aria-label", "累計採集魔晶：我方 724、敵方 227");
  // 戰鬥: kills counted from who killed (deaths[].by).
  await page.getByRole("tab", { name: "戰鬥" }).tap();
  await expect(dialog.locator(".st-bfhead")).toContainText("我方損失 121");
  await expect(dialog.locator(".st-bfhead")).toContainText("我方擊殺 141");
});

test("局後統計（失敗，同一局從另一邊看）：我方主城被摧毀，主城倒的那段是「敵方攻進主城」，數字對調", async ({ page }) => {
  await endWith(page, { lost: true });
  const dialog = page.getByRole("dialog", { name: "失敗" });
  await expect(dialog.locator(".st-head")).toContainText("我方主城被摧毀");
  await expect(dialog.locator(".st-head")).toContainText("對手：電腦・困難・掠奪型");
  await expect(dialog.locator(".st-moments")).toContainText("敵方攻進主城");
  await expect(dialog.locator(".st-moments li").last()).toContainText("我方主城被摧毀我方落敗");
  await expect(dialog.locator(".st-nums tr").filter({ hasText: "損失（含村民）" })).toContainText("147121");
});

for (const s of [
  { name: "932×430，安全區", size: { width: 932, height: 430 }, row: false },
  { name: "932×336，Safari 有分頁列，安全區", size: { width: 932, height: 336 }, row: true },
]) {
  test(`局後統計（${s.name}）：${s.row ? "左邊放不下，分頁改成上方下面一排" : "分頁在左邊"}；六頁都在安全區裡、按鈕至少 44、字不被切掉、不左右捲`, async ({ page }) => {
    test.setTimeout(90_000);
    await endWith(page, { size: s.size, safe: true });
    await everyTab(page, s.name, s.row);
  });
}

test("局後統計（932×336，安全區）：要捲的頁下面淡出加 ⌄（在右邊留的空白裡，不壓字），點 ⌄ 往下捲，捲到底收起；矮的圖縱軸頂端剛好高過資料", async ({ page }) => {
  test.setTimeout(90_000);
  await endWith(page, { size: { width: 932, height: 336 }, safe: true });
  const body = page.locator(".st-page");
  const down = page.getByRole("button", { name: "往下捲" });
  for (const t of ["總覽", "戰鬥", "城鎮", "法師"]) {
    await page.getByRole("tab", { name: t }).tap();
    expect(await body.evaluate((e) => e.scrollHeight > e.clientHeight + 2), `${t} scrolls here`).toBe(true);
    await expect(page.locator(".st-more"), t).toBeVisible();
    // The ⌄ over no words (b2 2026-11-07: in the middle it sat on the right column's first word).
    expect(await overWords(page), `${t}: the ⌄ over no words`).toEqual([]);
    const before = await body.evaluate((e) => e.scrollTop);
    await down.tap();
    await expect.poll(() => body.evaluate((e) => e.scrollTop), { message: `${t}: the ⌄ scrolls down` }).toBeGreaterThan(before + 20);
    await body.evaluate((e) => {
      e.scrollTop = e.scrollHeight;
    });
    await expect(page.locator(".st-more"), `${t}: none at the end`).toBeHidden();
  }
  // ui 2026-11-07: 6,465 → 0／4,000／8,000 (not 0／5,000／10,000).
  await page.getByRole("tab", { name: "資源" }).tap();
  await expect(page.locator(".st-page svg text[text-anchor=end]")).toHaveText(["0", "4,000", "8,000"]);
});

test("局後統計（B 墨漆金線，814×380）：六頁都放得下", async ({ page }) => {
  test.setTimeout(90_000);
  await endWith(page, { theme: "b" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "b");
  await everyTab(page, "B", false);
});

test("局後統計（原型介面，D-127）：同一頁、原型的顏色；原型標示不壓到上方；重來、回開局畫面照舊", async ({ page }) => {
  test.setTimeout(90_000);
  await endWith(page, { ui: "proto" });
  const dialog = page.getByRole("dialog", { name: "勝利" });
  await expect(dialog.locator(".stats-card")).toBeVisible();
  await expect(dialog.locator(".stats-card.panel")).toHaveCount(0);
  await expect(page.locator("#proto-label")).toBeHidden();
  await everyTab(page, "原型", false);
  await dialog.getByRole("button", { name: "重來" }).tap();
  await expect(dialog).toBeHidden();
  await expect(page.locator("#proto-label")).toBeVisible();
  await endWith(page, { ui: "proto" });
  await page.getByRole("dialog", { name: "勝利" }).getByRole("button", { name: "回開局畫面" }).tap();
  await expect.poll(() => page.evaluate(() => window.__proto?.screen)).toBe("start");
});

test("沒有時間軸（舊版模擬）：照舊是那張表", async ({ page }) => {
  await endWith(page, { timeline: false });
  const dialog = page.getByRole("dialog", { name: "勝利" });
  await expect(dialog.locator("table.stats")).toBeVisible();
  await expect(dialog.locator(".stats-card")).toHaveCount(0);
});

test("真的模擬：投降後是局後統計，用這局的時間軸（我方投降、對手的難度和性格）", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 814, height: 380 });
  await page.goto("./?test=1&ui=r6&scenario=e2e");
  await page.getByRole("button", { name: "開始" }).tap();
  await page.waitForFunction(() => window.__proto?.ready === true, null, { timeout: 90_000 });
  await page.getByRole("button", { name: "選單" }).tap();
  await page.getByRole("button", { name: "投降" }).tap();
  await page.getByRole("dialog").getByRole("button", { name: "投降" }).tap();
  const dialog = page.getByRole("dialog", { name: "失敗" });
  await expect(dialog.locator(".stats-card")).toBeVisible();
  await expect(dialog.locator(".st-head")).toContainText("我方投降");
  await expect(dialog.locator(".st-head")).toContainText(/對手：電腦・(簡單|普通|困難)・(掠奪型|治理型|均衡型)　地圖：固定地圖/);
  await everyTab(page, "真的模擬", false);
});
