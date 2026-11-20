// 方向鍵和畫面邊緣 (R26 06 B, design/r26/spec.md): with a mouse, the arrow keys and the pointer within EDGE_SCROLL_PX of
// the window's edge move the view, SCROLL_PX_PER_S screen px a second whatever the zoom. Not while the window has no
// focus, the pointer is outside it, or a box is being dragged; the arrows not while typing or in a dialog, nor with
// Ctrl, Alt or ⌘.

import { EDGE_SCROLL_PX, SCROLL_PX_PER_S } from "../tuning.ts";

const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

export class ViewScroll {
  private readonly held = new Set<string>();
  /** The mouse pointer in the window (CSS px), or null: none yet, or it left. */
  pointer: { x: number; y: number } | null = null;

  /** An arrow key down (true: it is one, and taken). */
  keyDown(key: string): boolean {
    if (ARROWS[key] === undefined) return false;
    this.held.add(key);
    return true;
  }

  keyUp(key: string): void {
    this.held.delete(key);
  }

  /** The window lost focus: no key is known to be held any more, and the pointer is not in it. */
  blur(): void {
    this.held.clear();
    this.pointer = null;
  }

  /**
   * Which way the view goes now, in screen px a ms (+x right, +y down; both 0: it stays). The arrows and the edge add
   * up to one direction, no faster than SCROLL_PX_PER_S along each axis.
   */
  velocity(width: number, height: number, focused: boolean, boxing: boolean): { x: number; y: number } {
    if (!focused) return { x: 0, y: 0 };
    let x = 0;
    let y = 0;
    for (const k of this.held) {
      x += ARROWS[k][0];
      y += ARROWS[k][1];
    }
    const p = this.pointer;
    // Outside the window (a drag captured past its edge reports where it went): not at an edge.
    if (p !== null && !boxing && p.x >= 0 && p.y >= 0 && p.x < width && p.y < height) {
      if (p.x < EDGE_SCROLL_PX) x -= 1;
      else if (p.x >= width - EDGE_SCROLL_PX) x += 1;
      if (p.y < EDGE_SCROLL_PX) y -= 1;
      else if (p.y >= height - EDGE_SCROLL_PX) y += 1;
    }
    const v = SCROLL_PX_PER_S / 1000;
    return { x: Math.sign(x) * v, y: Math.sign(y) * v };
  }
}

/** Not while typing in a field, nor in a dialog or a control that takes the arrows itself (介面大小's radios). */
function typing(e: KeyboardEvent): boolean {
  const t = e.target;
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT") return true;
  return t.closest('dialog, [role="dialog"], [role="radiogroup"], [role="slider"], [role="listbox"], [role="menu"]') !== null;
}

/** The window's keys and the mouse pointer into `scroll`, while `on()` (a mouse, a battle): returns the detach. */
export function attachViewScroll(scroll: ViewScroll, on: () => boolean): () => void {
  const down = (e: KeyboardEvent) => {
    if (!on() || typing(e) || e.ctrlKey || e.altKey || e.metaKey) return;
    if (scroll.keyDown(e.key)) e.preventDefault();
  };
  const up = (e: KeyboardEvent) => scroll.keyUp(e.key);
  const move = (e: PointerEvent) => {
    if (e.pointerType === "mouse") scroll.pointer = { x: e.clientX, y: e.clientY };
  };
  // Out of the window (no element it went to): the edge does nothing.
  const out = (e: MouseEvent) => {
    if (e.relatedTarget === null) scroll.pointer = null;
  };
  const blur = () => scroll.blur();
  window.addEventListener("keydown", down);
  window.addEventListener("keyup", up);
  window.addEventListener("pointermove", move, { passive: true });
  window.addEventListener("pointerdown", move, { passive: true });
  document.addEventListener("mouseout", out);
  window.addEventListener("blur", blur);
  return () => {
    window.removeEventListener("keydown", down);
    window.removeEventListener("keyup", up);
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerdown", move);
    document.removeEventListener("mouseout", out);
    window.removeEventListener("blur", blur);
  };
}
