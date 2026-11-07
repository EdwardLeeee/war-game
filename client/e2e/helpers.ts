import { expect, type Locator, type Page, type TestInfo } from "@playwright/test";
import { tapOn } from "./touch.ts";

/** iPhone 14 Pro Max landscape insets in pt: Dynamic Island side, rounded corner side, home indicator. */
export const IPHONE_SAFE = { top: 0, right: 59, bottom: 21, left: 59 };

/** Full landscape screen, what the page gets with Safari's toolbars collapsed. */
export const FULL_SCREEN = { width: 932, height: 430 };

export interface Box {
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Fails the test on uncaught page errors and console errors. */
export function watchErrors(page: Page): () => void {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });
  return () => expect(errors, "page errors").toEqual([]);
}

export async function injectSafeArea(page: Page, inset = IPHONE_SAFE): Promise<void> {
  await page.evaluate((s) => {
    const r = document.documentElement.style;
    r.setProperty("--safe-t", `${s.top}px`);
    r.setProperty("--safe-r", `${s.right}px`);
    r.setProperty("--safe-b", `${s.bottom}px`);
    r.setProperty("--safe-l", `${s.left}px`);
  }, inset);
}

/** Visible elements matching the selector, with their boxes in CSS px (= pt on iPhone). */
export async function visibleBoxes(page: Page, selector: string): Promise<Box[]> {
  return page.evaluate((sel) => {
    const out: { label: string; x: number; y: number; width: number; height: number }[] = [];
    for (const el of document.querySelectorAll<HTMLElement>(sel)) {
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (r.width === 0 || r.height === 0 || style.visibility === "hidden") continue;
      // A button that is only an icon (正式介面's ✕): its name.
      out.push({ label: (el.textContent ?? el.id).trim() || el.getAttribute("aria-label") || el.id, x: r.x, y: r.y, width: r.width, height: r.height });
    }
    return out;
  }, selector);
}

export const INTERACTIVE = "button, a[href], [role=button], input, select";

export async function shot(page: Page, info: TestInfo, name: string): Promise<void> {
  // Let the canvas draw the latest state first (the battlefield renders on animation frames).
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({ path });
  await info.attach(name, { path, contentType: "image/png" });
}

/**
 * A box on screen around these points, `margin` px wider on every side, for the long press and
 * drag that selects: it starts from a corner on open ground (a long press on a unit opens its
 * wheel, on a resource does nothing) and ends at the opposite one. As a diamond (D-085) the
 * cells' own corners do not make a box around them on screen, so the box is the points'.
 */
export async function openBox(page: Page, points: { x: number; y: number }[], margin: number): Promise<{ from: { x: number; y: number }; to: { x: number; y: number } }> {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const [x0, x1, y0, y1] = [Math.min(...xs) - margin, Math.max(...xs) + margin, Math.min(...ys) - margin, Math.max(...ys) + margin];
  for (const [from, to] of [
    [{ x: x0, y: y1 }, { x: x1, y: y0 }],
    [{ x: x1, y: y1 }, { x: x0, y: y0 }],
    [{ x: x0, y: y0 }, { x: x1, y: y1 }],
    [{ x: x1, y: y0 }, { x: x0, y: y1 }],
  ]) {
    const hit = await page.evaluate(([x, y]) => {
      const g = window.__proto?.game;
      return g == null ? "no hook" : g.pickAt(x, y);
    }, [from.x, from.y] as const);
    if (hit === null) return { from, to };
  }
  throw new Error("no open corner around the points");
}

/**
 * 點編隊按鈕 → 軍團畫面 → 改成剛才選的 N 名: the units selected before become the group, as
 * the long press did before (D-026, D-054). The group stays selected with its panel.
 */
export async function saveGroup(page: Page, button: string): Promise<void> {
  await tapOn(page, button);
  const panel = page.locator(".sel-info");
  await expect(panel.locator(".sel-head")).toContainText(/^編隊 \d/);
  await openPanel(page);
  await panel.getByRole("button", { name: /^改成剛才選的 \d+ 名$/ }).tap();
  // Saved: nothing selected before any more, and the group selected (a message such as 人口滿了 may take the strip).
  await expect(panel.getByRole("button", { name: /^改成剛才選的/ })).toBeHidden();
}

/**
 * 軍團畫面 opened, after a tap on a group button: with soldiers to order (they are selected) the tap
 * folds it, so 展開 comes; with none it stays open (the user 2026-10-31). Read from the selection,
 * not from the panel, which follows at its next update (late on CI's WebKit).
 */
export async function openPanel(page: Page): Promise<void> {
  const panel = page.locator(".sel-info");
  await expect(panel.locator(".sel-head")).toContainText(/^編隊 \d/);
  const selected = await page.evaluate(() => window.__proto?.game?.selection().units.length ?? 0);
  if (selected > 0) await panel.getByRole("button", { name: "展開選取資訊" }).tap();
  await expect(panel.getByRole("button", { name: "收起選取資訊" })).toBeVisible();
}

/**
 * Select these units and wait until the command area is built for them: it is rebuilt on the
 * next interface update (10 a second), and a tap before that reaches the old buttons, which act
 * on the old selection.
 */
export async function selectForCommands(page: Page, ids: number[]): Promise<void> {
  const sorted = [...ids].sort((a, b) => a - b);
  await page.evaluate((u) => window.__proto?.game?.select(u), sorted);
  await expect(page.locator(".cmds")).toHaveAttribute("data-selection", sorted.join(","));
}

/** 全軍, whose label says how many soldiers it selects (全軍 24; ceo 2026-10-03). */
export const armyButton = (page: Page) => page.getByRole("button", { name: /^全軍 \d+$/ });

/** The lab panel opens from the menu: 選單 → 量測與確定性檢查. */
export async function openLab(page: Page): Promise<void> {
  await page.getByRole("button", { name: "選單" }).tap();
  await page.getByRole("button", { name: "量測與確定性檢查" }).tap();
}

/** TownSize.Small and TownState.Ruins (sim/src/protocol.ts). */
const SMALL_TOWN = 0;
const RUINS = 5;

/**
 * 開局提示 (D-044): the town the hint should show, by its rule: the small town nearest our
 * spawn that we can take (not ours, not in ruins); else the nearest small town; the nearest
 * town only on a map without small ones; the lower id on a tie. From whatever towns the map
 * has, so the tests do not depend on their number or ids.
 */
export async function hintTownOf(page: Page): Promise<{ id: number; size: number; cx: number; cy: number }> {
  const me = await page.evaluate(() => window.__proto?.game?.me() ?? 0);
  const home = await page.evaluate(() => window.__proto?.game?.home() ?? null);
  const list = await page.evaluate(() => window.__proto?.game?.towns() ?? []);
  if (home === null || list.length === 0) throw new Error("no spawn or no towns");
  const d = (t: { cx: number; cy: number }) => (t.cx - home.cx) ** 2 + (t.cy - home.cy) ** 2;
  const small = list.filter((t) => t.size === SMALL_TOWN);
  const open = small.filter((t) => t.owner !== me && t.state !== RUINS);
  return [...(open.length > 0 ? open : small.length > 0 ? small : list)].sort((a, b) => d(a) - d(b) || a.id - b.id)[0];
}

export interface Said {
  text: string;
  ok: boolean;
  info: boolean;
  /** On the screen when shown: inside the viewport, not hidden or see-through, on top at its middle. */
  seen: boolean;
  /** The green check of an order taken (R6-31) showing. */
  check: boolean;
}

/**
 * In the page: note the strip's message each time it is shown, with its look and whether it is
 * really seen then. Self-contained (it runs by page.evaluate and by page.addInitScript).
 */
function installToastRecorder(): void {
  const w = window as unknown as { __said?: Said[]; __saidFrom?: number };
  if (w.__said !== undefined) return;
  const said: Said[] = [];
  w.__said = said;
  w.__saidFrom = 0;
  const note = (box: HTMLElement) => {
    if (box.hidden) return;
    const r = box.getBoundingClientRect();
    const cs = getComputedStyle(box);
    // The strip lets taps through (#hud): hit-testable for this one look only (style is not watched).
    const pe = box.style.pointerEvents;
    box.style.pointerEvents = "auto";
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    box.style.pointerEvents = pe;
    const inView = r.width > 0 && r.height > 0 && r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
    const onTop = hit !== null && (hit === box || box.contains(hit));
    const mark = box.querySelector<HTMLElement>(".toast-check");
    said.push({
      text: box.textContent ?? "",
      ok: box.classList.contains("toast-ok"),
      info: box.classList.contains("toast-info"),
      seen: inView && onTop && cs.visibility === "visible" && Number(cs.opacity) > 0.5,
      check: mark !== null && getComputedStyle(mark).display !== "none",
    });
  };
  const watch = (box: HTMLElement) =>
    new MutationObserver(() => note(box)).observe(box, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["hidden", "class"] });
  const found = document.querySelector<HTMLElement>(".toast");
  if (found !== null) {
    watch(found);
    return;
  }
  const look = new MutationObserver(() => {
    const box = document.querySelector<HTMLElement>(".toast");
    if (box === null) return;
    look.disconnect();
    watch(box);
  });
  look.observe(document, { childList: true, subtree: true });
}

/**
 * Every message the strip shows from now on, with its look. The strip shows one at a time for 2.2 s,
 * and the game's own messages (「民居蓋好了」 for a house going up) can take it before a check reads
 * it, sooner or later as the machine runs (paused-orders, assault): such checks read this record.
 */
export async function recordToasts(page: Page): Promise<void> {
  await page.evaluate(installToastRecorder);
}

/** The same record from the start of every page this test opens (before the game says anything). */
export async function watchToasts(page: Page): Promise<void> {
  await page.addInitScript(installToastRecorder);
}

/** Where the record is now: what is said after this counts (expectNotSaid, expectSaid's `from`). */
export async function saidMark(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __said?: Said[] }).__said?.length ?? 0);
}

const saidMatches = (m: Said, text: string | RegExp) => (typeof text === "string" ? m.text.includes(text) : text.test(m.text));

/**
 * The strip said this (containing it, or matching), with its look: the first such after the one the
 * last check found (or after `from`), so a sentence said twice is looked for twice.
 */
export async function expectSaid(page: Page, text: string | RegExp, look: Partial<Said> = {}, opts: { from?: number; timeout?: number } = {}): Promise<void> {
  const find = async () => {
    const r = await page.evaluate(() => {
      const w = window as unknown as { __said?: Said[]; __saidFrom?: number };
      return { said: w.__said ?? [], from: w.__saidFrom ?? 0 };
    });
    const from = opts.from ?? r.from;
    for (let i = from; i < r.said.length; i++) if (saidMatches(r.said[i], text)) return { i, m: r.said[i] };
    return null;
  };
  await expect.poll(find, { message: `the strip said ${String(text)}`, timeout: opts.timeout }).not.toBeNull();
  const got = await find();
  if (got === null) throw new Error(`the strip said ${String(text)}`);
  expect(got.m, `how the strip said ${String(text)}`).toMatchObject(look);
  await page.evaluate((i) => {
    (window as unknown as { __saidFrom?: number }).__saidFrom = i + 1;
  }, got.i);
}

/** The strip has not said this since `from` (call it once what the action did is there to see). */
export async function expectNotSaid(page: Page, text: string | RegExp, from = 0): Promise<void> {
  const said = (await page.evaluate(() => (window as unknown as { __said?: Said[] }).__said ?? [])) as Said[];
  expect(said.slice(from).map((m) => m.text).filter((t) => saidMatches({ text: t, ok: false, info: false, seen: false, check: false }, text)), `the strip did not say ${String(text)}`).toEqual([]);
}

/**
 * 正式介面 on this page now (ui/formal.ts: ?ui=r6, or the default when it is on; the root's data-ui).
 * The tests hold for either interface (PR 5): where the two differ on purpose, they ask this.
 */
export function formalOn(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.dataset.ui === "r6");
}

/**
 * The resource bar in words, whichever interface (ceo 2026-11-06: its name): 正式介面's is the whole
 * line (糧 200　木 200…, its figures shown apart under icons; r6.spec checks they agree); the
 * prototype's is its text, shortened as the screen needs.
 */
export function resText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const bar = document.querySelector(".res-bar");
    if (bar === null) return "";
    return document.documentElement.dataset.ui === "r6" ? (bar.getAttribute("aria-label") ?? "") : (bar.textContent ?? "");
  });
}

/** 攻擊紅、移動藍 (D-080) as each interface paints them: the prototype flat with white words, 正式介面 (A 銅木) in gradients with its ink. */
const TONES = {
  proto: { red: "rgb(217, 58, 48)", blue: "rgb(47, 111, 214)", words: "rgb(255, 255, 255)" },
  formal: { red: "rgb(166, 56, 43)", blue: "rgb(58, 99, 168)", words: "rgb(244, 231, 201)" },
};

/**
 * A button's tone in the interface on screen, by that interface's own colours only (ceo 2026-11-06),
 * whether its words are that interface's for a toned button, and its size.
 */
export function toneOf(b: Locator): Promise<{ tone: "red" | "blue" | "other"; words: boolean; w: number; h: number }> {
  return b.evaluate((e, t) => {
    const formal = document.documentElement.dataset.ui === "r6";
    const s = getComputedStyle(e);
    const k = formal ? t.formal : t.proto;
    const paint = formal ? s.backgroundImage : s.backgroundColor;
    const tone = paint.includes(k.red) ? "red" : paint.includes(k.blue) ? "blue" : "other";
    const r = e.getBoundingClientRect();
    return { tone, words: s.color === k.words, w: r.width, h: r.height };
  }, TONES);
}

/**
 * 留守's controls in 攻下城鎮's dialog for 搶 or 治理: the prototype has one each, 正式介面 one for
 * both (R6-20, the user 2026-10-19: 「留守只需要一個統一的就好」).
 */
export async function keepControls(page: Page, dialog: Locator, which: "搶" | "治理"): Promise<{ count: Locator; less: Locator; more: Locator }> {
  const of = (await formalOn(page)) ? "" : `（${which}）`;
  return {
    count: dialog.getByRole("status", { name: `留守幾名${of}`, exact: true }),
    less: dialog.getByRole("button", { name: `少留守 1 名${of}`, exact: true }),
    more: dialog.getByRole("button", { name: `多留守 1 名${of}`, exact: true }),
  };
}

/**
 * An explanation line as words (射程：…, 剋怕：…): 正式介面 sets the word before 「：」 apart as a tag
 * (panels.ts meaning), so its text reads 「射程打建築…」; this puts the 「：」 back.
 */
export function meaningText(line: Locator): Promise<string> {
  return line.evaluate((e) => {
    const k = e.querySelector(":scope > em.k");
    const all = e.textContent ?? "";
    return k === null ? all : `${k.textContent ?? ""}：${all.slice((k.textContent ?? "").length)}`;
  });
}

/**
 * Nothing selected, nothing being placed: the prototype's 重設 (D-024). 正式介面 has none (D-087), so
 * what a player does there: ✗ on the building's preview, then 取消選取 on the panel.
 */
export async function resetAll(page: Page): Promise<void> {
  if (!(await formalOn(page))) {
    await page.getByRole("button", { name: "重設" }).tap();
    return;
  }
  const cancelPlace = page.getByRole("button", { name: "取消放建築" });
  if (await cancelPlace.isVisible()) await cancelPlace.tap();
  const close = page.locator(".sel-info").getByRole("button", { name: "取消選取" });
  if (await close.isVisible()) await close.tap();
}
