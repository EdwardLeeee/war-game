// Tap, double tap and long press on an interface element (編隊 1–4, 閒置村民, the minimap),
// with the same recogniser and timings as the battlefield (input/gestures.ts): a long press
// is 350 ms still, a double tap is two taps within 300 ms, and the first tap acts at once.
// Keyboard and assistive-technology activation (a click with no pointer before it) is a tap.

import { LONG_PRESS_MS } from "../tuning.ts";
import { GestureRecognizer } from "./gestures.ts";

export interface PressHandlers {
  /** (x, y) are relative to the element. */
  tap?(count: 1 | 2, x: number, y: number): void;
  longPress?(x: number, y: number): void;
}

export function pressable(el: HTMLElement, h: PressHandlers): () => void {
  let pointerUsed = false;
  const rec = new GestureRecognizer({
    tap: (x, y, count) => h.tap?.(count, x, y),
    longPress: (x, y) => {
      h.longPress?.(x, y);
      return "none";
    },
    pressCue: () => {},
    panStart: () => {},
    pan: () => {},
    panEnd: () => {},
    box: () => {},
    pinchStart: () => {},
    pinch: () => {},
    pinchEnd: () => {},
  });
  // Relative to the content box (inside any border), which is what the element draws in.
  const local = (e: PointerEvent) => {
    const r = el.getBoundingClientRect();
    return { x: e.clientX - r.left - el.clientLeft, y: e.clientY - r.top - el.clientTop };
  };
  const time = (e: Event) => {
    const now = performance.now();
    return Math.abs(now - e.timeStamp) < 5000 ? Math.min(e.timeStamp, now) : now;
  };
  let timer = 0;
  const down = (e: PointerEvent) => {
    pointerUsed = true;
    const p = local(e);
    rec.down(e.pointerId, p.x, p.y, time(e));
    window.clearTimeout(timer);
    timer = window.setTimeout(() => rec.update(performance.now()), LONG_PRESS_MS + 1);
  };
  const move = (e: PointerEvent) => {
    const p = local(e);
    rec.move(e.pointerId, p.x, p.y, time(e));
  };
  const up = (e: PointerEvent) => {
    const p = local(e);
    rec.up(e.pointerId, p.x, p.y, time(e));
  };
  const cancel = (e: PointerEvent) => rec.cancel(e.pointerId, time(e));
  const click = (e: MouseEvent) => {
    // Pointer input was already handled; a click without it is a keyboard or VoiceOver activation.
    if (!pointerUsed || e.detail === 0) h.tap?.(1, 0, 0);
    pointerUsed = false;
  };
  const block = (e: Event) => e.preventDefault();
  el.style.touchAction = "none";
  el.addEventListener("pointerdown", down);
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", cancel);
  el.addEventListener("click", click);
  el.addEventListener("contextmenu", block);
  return () => {
    window.clearTimeout(timer);
    el.removeEventListener("pointerdown", down);
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerup", up);
    el.removeEventListener("pointercancel", cancel);
    el.removeEventListener("click", click);
    el.removeEventListener("contextmenu", block);
  };
}
