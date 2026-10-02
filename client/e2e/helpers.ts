import { expect, type Page, type TestInfo } from "@playwright/test";

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
      out.push({ label: (el.textContent ?? el.id).trim() || el.id, x: r.x, y: r.y, width: r.width, height: r.height });
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

/** The lab panel opens from the menu: 選單 → 量測與確定性檢查. */
export async function openLab(page: Page): Promise<void> {
  await page.getByRole("button", { name: "選單" }).tap();
  await page.getByRole("button", { name: "量測與確定性檢查" }).tap();
}

/** TownSize.Small (sim/src/protocol.ts). */
const SMALL_TOWN = 0;

/**
 * 開局提示 (D-044): the town the hint should show, by its rule: the small town nearest our
 * spawn, the nearest town only on a map without small ones, the lower id on a tie. From
 * whatever towns the map has, so the tests do not depend on their number or ids.
 */
export async function hintTownOf(page: Page): Promise<{ id: number; size: number; cx: number; cy: number }> {
  const home = await page.evaluate(() => window.__proto?.game?.home() ?? null);
  const list = await page.evaluate(() => window.__proto?.game?.towns() ?? []);
  if (home === null || list.length === 0) throw new Error("no spawn or no towns");
  const d = (t: { cx: number; cy: number }) => (t.cx - home.cx) ** 2 + (t.cy - home.cy) ** 2;
  const small = list.filter((t) => t.size === SMALL_TOWN);
  return [...(small.length > 0 ? small : list)].sort((a, b) => d(a) - d(b) || a.id - b.id)[0];
}
