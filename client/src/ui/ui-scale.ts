// 介面放大 (R26-01 B, D-154; design/r26/spec.md 01): on a large window (600 tall or more) the interface (#hud and
// #start, never the battlefield) is drawn bigger with CSS zoom: automatic (the window's height ÷ 633, between 1 and 1.6:
// 1920 × 950 → 1.5, 1366 × 768 → 1.21) or as chosen in 設定 → 介面大小 (100%, 125%, 150%), remembered on this device. A
// phone held sideways (336 tall) is always 1. 正式介面 only.
//
// Inside a zoomed element, CSS lengths are the element's own (multiplied by the zoom on screen) while
// getBoundingClientRect and pointer events are the screen's: what is placed at a point of the battlefield's screen
// (a tag, an arrow, the box, the wheel, ✓ ✗, the tutorial's frame) is placed at that point ÷ uiZoom().

import { formalUi } from "./formal.ts";

export type UiSize = "auto" | 100 | 125 | 150;
export const UI_SIZES: readonly UiSize[] = ["auto", 100, 125, 150];
export const UI_SIZE_LABEL: Record<string, string> = { auto: "自動", 100: "100%", 125: "125%", 150: "150%" };
export const UI_SIZE_KEY = "war-game.ui.size";
/** A computer's window: the interface may be drawn bigger, and 07 局後統計 is laid out for it. */
export const LARGE_WINDOW_HEIGHT = 600;
/** 自動: the height the interface was drawn for (932 × 336's interface on a 633-tall window at 1). */
const AUTO_HEIGHT = 633;
const AUTO_MAX = 1.6;

type Store = Pick<Storage, "getItem" | "setItem">;
const store = (): Store | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

export function largeWindow(height: number = innerHeight): boolean {
  return height >= LARGE_WINDOW_HEIGHT;
}

export function loadUiSize(s: Store | null = store()): UiSize {
  try {
    const v = s?.getItem(UI_SIZE_KEY);
    const known = UI_SIZES.find((c) => String(c) === v);
    if (known !== undefined) return known;
  } catch {
    // Unreadable: 自動.
  }
  return "auto";
}

export function saveUiSize(size: UiSize, s: Store | null = store()): void {
  try {
    s?.setItem(UI_SIZE_KEY, String(size));
  } catch {
    // Not kept: 自動 next time.
  }
}

/** The zoom for a window this tall with this choice (two decimals: 1.5, 1.21). */
export function uiScaleFor(height: number, size: UiSize): number {
  if (!largeWindow(height)) return 1;
  const z = size === "auto" ? Math.min(Math.max(height / AUTO_HEIGHT, 1), AUTO_MAX) : size / 100;
  return Math.round(z * 100) / 100;
}

let zoom = 1;
const listeners = new Set<() => void>();

/** The interface's zoom now: a screen point (the battlefield's, an event's) ÷ this is the interface's own length. */
export function uiZoom(): number {
  return zoom;
}

/** Called when the zoom changes (the minimap draws itself again at its new size). */
export function onUiZoom(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

/** The zoom on #hud and #start for this window and choice; --ui-zoom for the stylesheet's sizes of the window. */
export function applyUiScale(root: HTMLElement = document.documentElement): void {
  const z = formalUi(root) ? uiScaleFor(innerHeight, loadUiSize()) : 1;
  root.classList.toggle("ui-large", formalUi(root) && largeWindow());
  root.style.setProperty("--ui-zoom", String(z));
  for (const id of ["hud", "start"]) {
    const e = document.getElementById(id);
    if (e !== null) e.style.zoom = z === 1 ? "" : String(z);
  }
  if (z === zoom) return;
  zoom = z;
  for (const f of listeners) f();
}

let watching = false;
/** Once a page: the zoom again as the window changes size. */
export function watchUiScale(): void {
  applyUiScale();
  if (watching) return;
  watching = true;
  addEventListener("resize", () => applyUiScale());
}
