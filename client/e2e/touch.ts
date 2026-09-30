// Touch input for the battlefield canvas. Playwright has no multi-touch or long-press-drag
// API that works in both WebKit and Chromium, so these send the same PointerEvent sequence
// (pointerType "touch") a finger would, into the same recogniser the page uses. Single taps
// can also go through the browser's own touch path with page.touchscreen.tap.

import type { Page } from "@playwright/test";

export interface Pt {
  x: number;
  y: number;
}

async function pointer(page: Page, type: string, id: number, p: Pt): Promise<void> {
  await page.evaluate(
    ({ type, id, x, y }) => {
      const canvas = document.querySelector("#stage canvas") as HTMLCanvasElement;
      canvas.dispatchEvent(
        new PointerEvent(type, { pointerId: id, pointerType: "touch", isPrimary: id === 1, clientX: x, clientY: y, button: 0, buttons: type === "pointerup" ? 0 : 1, bubbles: true, cancelable: true }),
      );
    },
    { type, id, x: p.x, y: p.y },
  );
}

export async function tap(page: Page, p: Pt, holdMs = 40): Promise<void> {
  await pointer(page, "pointerdown", 1, p);
  await page.waitForTimeout(holdMs);
  await pointer(page, "pointerup", 1, p);
}

/** Two quick taps, well inside the 300 ms double-tap window. */
export async function doubleTap(page: Page, p: Pt): Promise<void> {
  await tap(page, p, 20);
  await page.waitForTimeout(30);
  await tap(page, p, 20);
}

/** Finger down, `steps` moves over `ms`, finger up (at speed: the camera flings). */
export async function drag(page: Page, from: Pt, to: Pt, steps = 10, ms = 150): Promise<void> {
  await pointer(page, "pointerdown", 1, from);
  for (let i = 1; i <= steps; i++) {
    await page.waitForTimeout(ms / steps);
    await pointer(page, "pointermove", 1, { x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps });
  }
  await pointer(page, "pointerup", 1, to);
}

/** Hold still past the long press, then (optionally) drag and lift. */
export async function longPress(page: Page, at: Pt, to: Pt | null = null, holdMs = 450): Promise<void> {
  await pointer(page, "pointerdown", 1, at);
  await page.waitForTimeout(holdMs);
  if (to !== null) {
    for (let i = 1; i <= 6; i++) {
      await pointer(page, "pointermove", 1, { x: at.x + ((to.x - at.x) * i) / 6, y: at.y + ((to.y - at.y) * i) / 6 });
      await page.waitForTimeout(20);
    }
  }
  await pointer(page, "pointerup", 1, to ?? at);
}

/** Press and hold without lifting (to look at the hold cue or the box mid-gesture). */
export async function press(page: Page, at: Pt, id = 1): Promise<void> {
  await pointer(page, "pointerdown", id, at);
}

export async function move(page: Page, to: Pt, id = 1): Promise<void> {
  await pointer(page, "pointermove", id, to);
}

export async function lift(page: Page, at: Pt, id = 1): Promise<void> {
  await pointer(page, "pointerup", id, at);
}

/** Two fingers spread from `from` px apart to `to` px apart around the centre. */
export async function pinch(page: Page, c: Pt, from: number, to: number): Promise<void> {
  await pointer(page, "pointerdown", 1, { x: c.x - from / 2, y: c.y });
  await pointer(page, "pointerdown", 2, { x: c.x + from / 2, y: c.y });
  for (let i = 1; i <= 8; i++) {
    const d = from + ((to - from) * i) / 8;
    await pointer(page, "pointermove", 1, { x: c.x - d / 2, y: c.y });
    await pointer(page, "pointermove", 2, { x: c.x + d / 2, y: c.y });
    await page.waitForTimeout(16);
  }
  await pointer(page, "pointerup", 2, { x: c.x + to / 2, y: c.y });
  await pointer(page, "pointerup", 1, { x: c.x - to / 2, y: c.y });
}
