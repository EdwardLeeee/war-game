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

  const down = (e: PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    try {
      target.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic events (tests) have no active pointer to capture.
    }
    const p = local(e);
    // A touch that stops a fling only stops it: lifting it is not a tap.
    const wasFlinging = stopFling();
    rec.down(e.pointerId, p.x, p.y, eventTime(e), wasFlinging);
    later(PRESS_CUE_DELAY_MS + 1);
    later(LONG_PRESS_MS + 1);
  };
  const move = (e: PointerEvent) => {
    const p = local(e);
    rec.move(e.pointerId, p.x, p.y, eventTime(e));
  };
  const up = (e: PointerEvent) => {
    const p = local(e);
    rec.up(e.pointerId, p.x, p.y, eventTime(e));
  };
  const cancel = (e: PointerEvent) => rec.cancel(e.pointerId, eventTime(e));
  const block = (e: Event) => e.preventDefault();

  target.addEventListener("pointerdown", down);
  target.addEventListener("pointermove", move);
  target.addEventListener("pointerup", up);
  target.addEventListener("pointercancel", cancel);
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
    target.removeEventListener("touchstart", block);
    target.removeEventListener("touchmove", block);
    target.removeEventListener("contextmenu", block);
    document.removeEventListener("gesturestart", block);
    document.removeEventListener("gesturechange", block);
    document.removeEventListener("dblclick", block);
  };
}
