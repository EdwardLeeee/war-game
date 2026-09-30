// Touch input for the battlefield canvas. Playwright has no multi-touch or long-press-drag
// API that works in both WebKit and Chromium, so these send the PointerEvent sequence
// (pointerType "touch") a finger would, into the same recogniser the page uses. Each
// gesture runs inside the page with in-page timers: one Playwright round trip per event
// was slow and uneven enough on CI to break the 300 ms double tap and the fling
// (run 36670621854). Single taps can also use the browser's own path (page.touchscreen.tap).

import type { Page } from "@playwright/test";

export interface Pt {
  x: number;
  y: number;
}

type Kind = "pointerdown" | "pointermove" | "pointerup";

interface Step {
  type: Kind;
  id: number;
  x: number;
  y: number;
  /** ms to wait before this event. */
  after: number;
}

const step = (type: Kind, p: Pt, after = 0, id = 1): Step => ({ type, id, x: p.x, y: p.y, after });

interface RunResult {
  /** The hold cue appeared at some point between the probed step and the probe's end. */
  cue: boolean;
  /** Camera x right after the last event (the lift), read in the page. */
  cameraX: number;
}

/** Dispatch the steps in the page, optionally watching for the hold cue for some ms after one step. */
async function run(page: Page, steps: Step[], probe: { afterStep: number; wait: number } | null = null): Promise<RunResult> {
  return page.evaluate(
    async ({ steps, probe }) => {
      const canvas = document.querySelector("#stage canvas") as HTMLCanvasElement;
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      let cue = false;
      const cueEl = document.querySelector(".press-cue") as HTMLElement | null;
      // A record whose old value is null means `hidden` was absent, i.e. the cue was showing,
      // even if it was hidden again before this callback ran.
      const watch = new MutationObserver((records) => {
        if (cueEl !== null && (!cueEl.hidden || records.some((r) => r.oldValue === null))) cue = true;
      });
      if (probe !== null && cueEl !== null) watch.observe(cueEl, { attributes: true, attributeFilter: ["hidden"], attributeOldValue: true });
      for (let i = 0; i < steps.length; i++) {
        const s = steps[i];
        if (s.after > 0) await sleep(s.after);
        canvas.dispatchEvent(
          new PointerEvent(s.type, {
            pointerId: s.id,
            pointerType: "touch",
            isPrimary: s.id === 1,
            clientX: s.x,
            clientY: s.y,
            button: 0,
            buttons: s.type === "pointerup" ? 0 : 1,
            bubbles: true,
            cancelable: true,
          }),
        );
        if (probe !== null && probe.afterStep === i) await sleep(probe.wait);
      }
      watch.disconnect();
      return { cue, cameraX: window.__proto?.game?.camera().x ?? 0 };
    },
    { steps, probe },
  );
}

// Taps go down and up in one task, with no timer in between. Right after the page starts,
// a busy main thread can delay in-page timers by hundreds of ms, which turned a 90 ms double
// tap into two single taps (run 36681468292). The 350 ms and 300 ms windows themselves are
// covered by the unit tests; these tests check the wiring.
export async function tap(page: Page, p: Pt): Promise<void> {
  await run(page, [step("pointerdown", p), step("pointerup", p)]);
}

/** Two taps in quick succession. */
export async function doubleTap(page: Page, p: Pt): Promise<void> {
  await run(page, [step("pointerdown", p), step("pointerup", p), step("pointerdown", p), step("pointerup", p)]);
}

/**
 * Finger down, `steps` moves over `ms`, finger up `holdMs` after the last move (0: in the
 * same task, so a busy page cannot make it look like the finger stopped first). Returns the
 * camera x at the lift.
 */
export async function drag(page: Page, from: Pt, to: Pt, steps = 10, ms = 150, holdMs = 0): Promise<number> {
  const list = [step("pointerdown", from)];
  for (let i = 1; i <= steps; i++) {
    list.push(step("pointermove", { x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps }, ms / steps));
  }
  list.push(step("pointerup", to, holdMs));
  return (await run(page, list)).cameraX;
}

/** Hold still past the long press, then (optionally) drag and lift. */
export async function longPress(page: Page, at: Pt, to: Pt | null = null, holdMs = 450): Promise<void> {
  const list = [step("pointerdown", at)];
  const end = to ?? at;
  if (to !== null) {
    for (let i = 1; i <= 6; i++) list.push(step("pointermove", { x: at.x + ((to.x - at.x) * i) / 6, y: at.y + ((to.y - at.y) * i) / 6 }, i === 1 ? holdMs : 20));
    list.push(step("pointerup", end, 20));
  } else {
    list.push(step("pointerup", end, holdMs));
  }
  await run(page, list);
}

/** Put a finger down and report whether the hold cue showed within `probeMs` (finger stays down). */
export async function pressShowsCue(page: Page, at: Pt, probeMs = 200): Promise<boolean> {
  return (await run(page, [step("pointerdown", at)], { afterStep: 0, wait: probeMs })).cue;
}

export async function move(page: Page, to: Pt, id = 1): Promise<void> {
  await run(page, [step("pointermove", to, 0, id)]);
}

export async function lift(page: Page, at: Pt, id = 1): Promise<void> {
  await run(page, [step("pointerup", at, 0, id)]);
}

/** Two fingers spread from `from` px apart to `to` px apart around the centre. */
export async function pinch(page: Page, c: Pt, from: number, to: number): Promise<void> {
  const list = [step("pointerdown", { x: c.x - from / 2, y: c.y }, 0, 1), step("pointerdown", { x: c.x + from / 2, y: c.y }, 10, 2)];
  for (let i = 1; i <= 8; i++) {
    const d = from + ((to - from) * i) / 8;
    list.push(step("pointermove", { x: c.x - d / 2, y: c.y }, 16, 1), step("pointermove", { x: c.x + d / 2, y: c.y }, 0, 2));
  }
  list.push(step("pointerup", { x: c.x + to / 2, y: c.y }, 10, 2), step("pointerup", { x: c.x - to / 2, y: c.y }, 10, 1));
  await run(page, list);
}
