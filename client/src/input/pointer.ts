// Browser pointer events -> gesture recogniser. Also keeps Safari's own gestures off the
// battlefield: Safari ignores user-scalable=no, so page zoom and double-tap zoom are blocked
// here (touch-action: none on the canvas, preventDefault on touch and gesture events), and
// long presses do not select text or show the magnifier (CSS -webkit-touch-callout: none).

import { LONG_PRESS_MS, PRESS_CUE_DELAY_MS } from "../tuning.ts";
import type { GestureRecognizer } from "./gestures.ts";

/**
 * When the finger actually did it: the event's own timestamp, not the moment a busy main
 * thread gets to the handler (a late pointerup would otherwise look like a finger that
 * stopped before lifting, and not fling). Falls back to now if a browser's timestamp is on
 * another clock.
 */
function eventTime(e: Event): number {
  const now = performance.now();
  return Math.abs(now - e.timeStamp) < 5000 ? Math.min(e.timeStamp, now) : now;
}

export function attachPointer(target: HTMLElement, rec: GestureRecognizer, stopFling: () => boolean): () => void {
  const timers = new Set<number>();
  const local = (e: PointerEvent) => {
    const r = target.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const later = (ms: number) => {
    const id = window.setTimeout(() => {
      timers.delete(id);
      rec.update(performance.now());
    }, ms);
    timers.add(id);
  };

  // The mouse button a gesture began with (0 left, 2 right; R26): a second one pressed meanwhile is not taken (the
  // browser sends no pointerdown for it), and letting go of the first ends the gesture though the other is still down.
  let mouseButton: number | null = null;
  // The right button's menu kept away while its box is dragged and as it ends, wherever the pointer is let go.
  let rightUntil = 0;
  const buttonBit = (b: number) => (b === 2 ? 2 : b === 1 ? 4 : 1);

  const down = (e: PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0 && e.button !== 2) return;
    try {
      target.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic events (tests) have no active pointer to capture.
    }
    const p = local(e);
    if (e.pointerType === "mouse") mouseButton = e.button;
    if (e.pointerType === "mouse" && e.button === 2) {
      // 右鍵框選 (R26): a box as soon as it is dragged; no hold, no tap.
      rightUntil = Number.POSITIVE_INFINITY;
      stopFling();
      rec.rightDown(e.pointerId, p.x, p.y, eventTime(e));
      return;
    }
    // A touch that stops a fling only stops it: lifting it is not a tap.
    const wasFlinging = stopFling();
    rec.down(e.pointerId, p.x, p.y, eventTime(e), wasFlinging);
    later(PRESS_CUE_DELAY_MS + 1);
    later(LONG_PRESS_MS + 1);
  };
  const ended = (t: number) => {
    if (mouseButton === 2) rightUntil = t + 500;
    mouseButton = null;
  };
  const move = (e: PointerEvent) => {
    const p = local(e);
    // The button it began with let go while another is held: the end of it (the browser's pointerup waits for all).
    if (e.pointerType === "mouse" && mouseButton !== null && (e.buttons & buttonBit(mouseButton)) === 0) {
      rec.up(e.pointerId, p.x, p.y, eventTime(e));
      ended(performance.now());
      return;
    }
    rec.move(e.pointerId, p.x, p.y, eventTime(e));
  };
  const up = (e: PointerEvent) => {
    const p = local(e);
    rec.up(e.pointerId, p.x, p.y, eventTime(e));
    ended(performance.now());
  };
  const cancel = (e: PointerEvent) => {
    rec.cancel(e.pointerId, eventTime(e));
    ended(performance.now());
  };
  // Let go outside the window, or the capture taken away: a box ends with what it holds, nothing is left half done.
  const lost = (e: PointerEvent) => {
    rec.lost(e.pointerId, eventTime(e));
    ended(performance.now());
  };
  const block = (e: Event) => e.preventDefault();
  const menu = (e: Event) => {
    if (performance.now() < rightUntil) e.preventDefault();
  };

  target.addEventListener("pointerdown", down);
  target.addEventListener("pointermove", move);
  target.addEventListener("pointerup", up);
  target.addEventListener("pointercancel", cancel);
  target.addEventListener("lostpointercapture", lost);
  document.addEventListener("contextmenu", menu);
  target.addEventListener("touchstart", block, { passive: false });
  target.addEventListener("touchmove", block, { passive: false });
  target.addEventListener("contextmenu", block);
  document.addEventListener("gesturestart", block);
  document.addEventListener("gesturechange", block);
  document.addEventListener("dblclick", block);

  return () => {
    for (const t of timers) window.clearTimeout(t);
    target.removeEventListener("pointerdown", down);
    target.removeEventListener("pointermove", move);
    target.removeEventListener("pointerup", up);
    target.removeEventListener("pointercancel", cancel);
    target.removeEventListener("lostpointercapture", lost);
    document.removeEventListener("contextmenu", menu);
    target.removeEventListener("touchstart", block);
    target.removeEventListener("touchmove", block);
    target.removeEventListener("contextmenu", block);
    document.removeEventListener("gesturestart", block);
    document.removeEventListener("gesturechange", block);
    document.removeEventListener("dblclick", block);
  };
}
