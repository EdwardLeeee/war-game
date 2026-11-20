// Gesture recogniser for the battlefield (GDD §10). A pure state machine: it is fed pointer
// positions with timestamps and reports gestures to a host, so it runs under a fake clock in
// the unit tests. The DOM wiring is in input/pointer.ts.
//
// One finger:
//   - moves more than TAP_SLOP_PX before LONG_PRESS_MS  -> pan (with fling on release)
//   - held within TAP_SLOP_PX for LONG_PRESS_MS          -> host.longPress decides: box select
//     (empty ground), skill wheel (own unit) or nothing
//   - lifted before that without moving                  -> tap (count 2 if it follows a tap
//     within DOUBLE_TAP_MS and DOUBLE_TAP_SLOP_PX; the first tap is reported at once)
//   The times are the events' own: a page busy past LONG_PRESS_MS (a long frame) may start a box or
//   the wheel before it reads a lift that came sooner; that lift then undoes it and taps. So does a
//   long press that did nothing (ignored: a building, an enemy under the finger).
// The mouse (R26 06 B, the user 2026-11-18; a finger as above, whatever the device):
//   - left button: dragged past TAP_SLOP_PX it is a box at once, no hold first (it selects as the long press's does);
//     let go without that, a click (host.click, count 2 for a double click as for a tap): it selects, it orders nothing;
//   - right button: let go without a drag past TAP_SLOP_PX, an order (host.order); dragged, nothing;
//   - middle button (the wheel held): moves the view 1 to 1 (host.drag), and flings as a finger does.
//   The button pressed first is the gesture's; another pressed meanwhile is not taken (pointer.ts).
// Two fingers: pinch zoom with two-finger pan, from any state; a box in progress is cancelled.
// After a pinch the remaining finger does nothing until every finger is up.

import { DOUBLE_TAP_MS, DOUBLE_TAP_SLOP_PX, INERTIA_SAMPLE_MS, LONG_PRESS_MS, PRESS_CUE_DELAY_MS, TAP_SLOP_PX } from "../tuning.ts";

/**
 * What a long press became. none: the host did something with it itself (the minimap's move, 閒置's), so lifting the
 * finger is no tap. ignored: nothing happened (a building or an enemy under the finger), so a lift that came before
 * LONG_PRESS_MS by the events' own times (a busy page read it late) is still the tap it was.
 */
export type LongPressResult = "box" | "wheel" | "none" | "ignored";
export type BoxPhase = "start" | "move" | "end" | "cancel";

export interface GestureHost {
  tap(x: number, y: number, count: 1 | 2): void;
  /** The mouse's left button clicked (no drag): select, or pick the place being chosen. */
  click(x: number, y: number, count: 1 | 2): void;
  /** The mouse's right button clicked (no drag): an order for what is selected. */
  order(x: number, y: number): void;
  /** The mouse's middle button dragged by (dx, dy): the view moves, whatever else is going on. */
  drag(dx: number, dy: number): void;
  /** The middle button let go; velocity in px per ms as panEnd's. */
  dragEnd(vx: number, vy: number): void;
  /** The finger has been still for LONG_PRESS_MS at (x, y): what should this press become? */
  longPress(x: number, y: number): LongPressResult;
  /** Show or hide the hold cue at (x, y) while a press may still become a long press. */
  pressCue(x: number, y: number, on: boolean): void;
  panStart(x: number, y: number): void;
  /** Finger moved by (dx, dy) and is now at (x, y). */
  pan(dx: number, dy: number, x: number, y: number): void;
  /** Finger lifted; velocity in px per ms over the last INERTIA_SAMPLE_MS. */
  panEnd(vx: number, vy: number): void;
  /** Box from where the long press started to where the finger is. */
  box(x0: number, y0: number, x1: number, y1: number, phase: BoxPhase): void;
  /** Close the wheel a long press opened (it was a tap after all: the finger was up in time). */
  closeWheel?(): void;
  pinchStart(): void;
  /** Zoom by factor about (cx, cy), and pan by the midpoint's movement (dx, dy). */
  pinch(cx: number, cy: number, factor: number, dx: number, dy: number): void;
  pinchEnd(): void;
}

export type GestureState = "idle" | "press" | "held" | "pan" | "box" | "wheel" | "pinch" | "drain" | "left" | "right" | "middle";

interface Finger {
  x: number;
  y: number;
  startX: number;
  startY: number;
  startT: number;
}

export class GestureRecognizer {
  state: GestureState = "idle";
  private readonly host: GestureHost;
  private readonly fingers = new Map<number, Finger>();
  private primary = -1;
  private cue: { x: number; y: number } | null = null;
  /** This press may not become a tap (it stopped a fling). */
  private noTap = false;
  /** The long press did nothing (ignored): an early lift taps. */
  private heldIgnored = false;
  /** The box is the mouse's (no long press to undo: an early lift is no tap). */
  private mouseBox = false;
  /** The right button was dragged past TAP_SLOP_PX: no order when it is let go. */
  private rightDragged = false;
  private samples: { x: number; y: number; t: number }[] = [];
  private lastTap: { x: number; y: number; t: number } | null = null;
  private pinchDist = 1;
  private pinchMid = { x: 0, y: 0 };

  constructor(host: GestureHost) {
    this.host = host;
  }

  get pointerCount(): number {
    return this.fingers.size;
  }

  /** A finger touches down. noTap: the press stopped a fling, so lifting it is not a tap. */
  down(id: number, x: number, y: number, t: number, noTap = false): void {
    if (this.fingers.has(id)) return;
    this.fingers.set(id, { x, y, startX: x, startY: y, startT: t });
    if (this.fingers.size === 1 && (this.state === "idle" || this.state === "drain")) {
      this.state = "press";
      this.primary = id;
      this.noTap = noTap;
      this.samples = [{ x, y, t }];
      return;
    }
    if (this.fingers.size === 2 && this.state !== "wheel") {
      this.endSingle();
      this.startPinch();
    }
    // A third finger, or a second one while the wheel is open, is ignored.
  }

  /** A mouse button down (pointer.ts; 0 left, 1 middle, 2 right): not while another gesture goes on. */
  mouseDown(id: number, button: number, x: number, y: number, t: number): void {
    if (this.fingers.size > 0 || (this.state !== "idle" && this.state !== "drain")) return;
    if (button !== 0 && button !== 1 && button !== 2) return;
    this.fingers.set(id, { x, y, startX: x, startY: y, startT: t });
    this.state = button === 0 ? "left" : button === 1 ? "middle" : "right";
    this.primary = id;
    this.rightDragged = false;
    this.samples = [{ x, y, t }];
  }

  /** The pointer's capture lost (the window left, a browser's gesture): a box ends as it is, anything else stops. */
  lost(id: number, t: number): void {
    const f = this.fingers.get(id);
    if (f === undefined) return;
    this.lift(id, f.x, f.y, t, this.state !== "box");
  }

  move(id: number, x: number, y: number, t: number): void {
    const f = this.fingers.get(id);
    if (f === undefined) return;
    const dx = x - f.x;
    const dy = y - f.y;
    f.x = x;
    f.y = y;
    switch (this.state) {
      case "left":
        if (id === this.primary && Math.hypot(x - f.startX, y - f.startY) > TAP_SLOP_PX) {
          this.state = "box";
          this.mouseBox = true;
          this.host.box(f.startX, f.startY, x, y, "start");
        }
        return;
      case "right":
        if (id === this.primary && Math.hypot(x - f.startX, y - f.startY) > TAP_SLOP_PX) this.rightDragged = true;
        return;
      case "middle":
        if (id !== this.primary) return;
        this.host.drag(dx, dy);
        this.sample(x, y, t);
        return;
      case "press":
        if (id !== this.primary) return;
        if (Math.hypot(x - f.startX, y - f.startY) > TAP_SLOP_PX) {
          this.hideCue();
          this.state = "pan";
          this.host.panStart(f.startX, f.startY);
          this.host.pan(x - f.startX, y - f.startY, x, y);
          this.sample(x, y, t);
        }
        return;
      case "pan":
        if (id !== this.primary) return;
        this.host.pan(dx, dy, x, y);
        this.sample(x, y, t);
        return;
      case "box":
        if (id === this.primary) this.host.box(f.startX, f.startY, x, y, "move");
        return;
      case "pinch":
        this.updatePinch();
        return;
      default:
        return;
    }
  }

  up(id: number, x: number, y: number, t: number): void {
    this.lift(id, x, y, t, false);
  }

  /** The browser took the pointer away (pointercancel): like lifting it, but never a tap or a box. */
  cancel(id: number, t: number): void {
    const f = this.fingers.get(id);
    if (f === undefined) return;
    this.lift(id, f.x, f.y, t, true);
  }

  /** Called every frame and from a timer: turns a still press into a long press. */
  update(t: number): void {
    if (this.state !== "press") return;
    const f = this.fingers.get(this.primary);
    if (f === undefined) return;
    const held = t - f.startT;
    if (held >= LONG_PRESS_MS) {
      this.hideCue();
      const kind = this.host.longPress(f.startX, f.startY);
      if (kind === "box") {
        this.state = "box";
        this.host.box(f.startX, f.startY, f.x, f.y, "start");
      } else {
        this.state = kind === "wheel" ? "wheel" : "held";
        this.heldIgnored = kind === "ignored";
      }
    } else if (held >= PRESS_CUE_DELAY_MS && this.cue === null) {
      this.cue = { x: f.startX, y: f.startY };
      this.host.pressCue(f.startX, f.startY, true);
    }
  }

  private lift(id: number, x: number, y: number, t: number, cancelled: boolean): void {
    const f = this.fingers.get(id);
    if (f === undefined) return;
    f.x = x;
    f.y = y;
    this.fingers.delete(id);
    // Up, by the events' own times, before the press was long (the page was late to read it: a
    // frame or the timer ran first, ceo 2026-11-06): the box or the wheel it began is undone, and it
    // taps; so does a long press that did nothing (ignored). Not one the host acted on itself (none:
    // the minimap's move, 閒置's): a tap on top would do a second thing.
    const early = !cancelled && t - f.startT < LONG_PRESS_MS && Math.hypot(x - f.startX, y - f.startY) <= TAP_SLOP_PX;
    if (early && !this.mouseBox && (this.state === "box" || this.state === "wheel" || (this.state === "held" && this.heldIgnored))) {
      if (this.state === "box") this.host.box(f.startX, f.startY, x, y, "cancel");
      if (this.state === "wheel") this.host.closeWheel?.();
      this.state = "press";
    }
    switch (this.state) {
      case "press":
        this.hideCue();
        if (!cancelled && !this.noTap) this.tap(f.startX, f.startY, t);
        break;
      case "pan": {
        const v = cancelled ? { vx: 0, vy: 0 } : this.velocity(t);
        this.host.panEnd(v.vx, v.vy);
        break;
      }
      case "box":
        this.host.box(f.startX, f.startY, x, y, cancelled ? "cancel" : "end");
        break;
      case "left":
        if (!cancelled) this.click(f.startX, f.startY, t);
        break;
      case "right":
        if (!cancelled && !this.rightDragged) this.host.order(f.startX, f.startY);
        break;
      case "middle": {
        const v = cancelled ? { vx: 0, vy: 0 } : this.velocity(t);
        this.host.dragEnd(v.vx, v.vy);
        break;
      }
      case "pinch":
        this.host.pinchEnd();
        this.state = "drain";
        break;
      default:
        break;
    }
    if (this.state !== "drain" || this.fingers.size === 0) this.state = this.fingers.size === 0 ? "idle" : "drain";
    if (this.fingers.size === 0) {
      this.primary = -1;
      this.mouseBox = false;
    }
  }

  private tap(x: number, y: number, t: number): void {
    this.host.tap(x, y, this.count(x, y, t));
  }

  /** The left button's click: a double click as a double tap is. */
  private click(x: number, y: number, t: number): void {
    this.host.click(x, y, this.count(x, y, t));
  }

  /** 2 when it follows a tap or click within DOUBLE_TAP_MS and DOUBLE_TAP_SLOP_PX (the first was reported at once). */
  private count(x: number, y: number, t: number): 1 | 2 {
    const last = this.lastTap;
    if (last !== null && t - last.t <= DOUBLE_TAP_MS && Math.hypot(x - last.x, y - last.y) <= DOUBLE_TAP_SLOP_PX) {
      this.lastTap = null;
      return 2;
    }
    this.lastTap = { x, y, t };
    return 1;
  }

  /** Leave whatever the first finger was doing, because a second finger arrived. */
  private endSingle(): void {
    const f = this.fingers.get(this.primary);
    switch (this.state) {
      case "press":
      case "held":
        this.hideCue();
        break;
      case "pan":
        this.host.panEnd(0, 0);
        break;
      case "box":
        if (f !== undefined) this.host.box(f.startX, f.startY, f.x, f.y, "cancel");
        break;
      default:
        break;
    }
    this.lastTap = null;
  }

  private startPinch(): void {
    this.state = "pinch";
    const [a, b] = [...this.fingers.values()];
    this.pinchDist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    this.pinchMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    this.host.pinchStart();
  }

  private updatePinch(): void {
    if (this.fingers.size < 2) return;
    const [a, b] = [...this.fingers.values()];
    const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    this.host.pinch(mid.x, mid.y, dist / this.pinchDist, mid.x - this.pinchMid.x, mid.y - this.pinchMid.y);
    this.pinchDist = dist;
    this.pinchMid = mid;
  }

  private hideCue(): void {
    if (this.cue === null) return;
    this.host.pressCue(this.cue.x, this.cue.y, false);
    this.cue = null;
  }

  private sample(x: number, y: number, t: number): void {
    this.samples.push({ x, y, t });
    while (this.samples.length > 2 && t - this.samples[0].t > INERTIA_SAMPLE_MS * 4) this.samples.shift();
  }

  /**
   * Velocity over the last INERTIA_SAMPLE_MS of movement, measured back from the last move
   * (not from the lift, so sparse move events on a busy device still fling). A finger that
   * stopped for INERTIA_SAMPLE_MS before lifting flings nothing.
   */
  private velocity(t: number): { vx: number; vy: number } {
    const last = this.samples[this.samples.length - 1];
    if (last === undefined || t - last.t > INERTIA_SAMPLE_MS) return { vx: 0, vy: 0 };
    let recent = this.samples.filter((s) => last.t - s.t <= INERTIA_SAMPLE_MS);
    if (recent.length < 2) recent = this.samples.slice(-2);
    if (recent.length < 2) return { vx: 0, vy: 0 };
    const first = recent[0];
    const dt = last.t - first.t;
    if (dt <= 0) return { vx: 0, vy: 0 };
    return { vx: (last.x - first.x) / dt, vy: (last.y - first.y) / dt };
  }
}
