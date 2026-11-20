// 滑鼠說明 (R26 03 A, the user 2026-11-18; design/r26/spec.md section 03), with a mouse only: the pointer still on a
// button for TIP_DELAY_MS, a panel over it says its name, its key, its price and what it does, in words the interface
// has already (the ？ explanation's line, the price on the button; ceo 2026-11-20). From one button to another within
// TIP_AGAIN_MS of the last one going, at once. Gone when the button is pressed, the pointer leaves it, Esc, or the
// button is built again. Over the button, 6 above it, its right edge on the button's, kept 4 inside the window; with
// no room above, under it. It takes no pointer.

import { badgeText } from "./keys.ts";

/** Still this long on a button: its tip (R26 03: 400 ms). */
export const TIP_DELAY_MS = 400;
/** A tip gone less than this before: the next one at once (R26 03: 300 ms). */
export const TIP_AGAIN_MS = 300;
/** Between the tip and its button, and the window's edge kept, in the interface's own lengths (before it is enlarged). */
const GAP = 6;
const EDGE = 4;

/** What a button's tip says: on the button as data-tip-* where it has more than its name (panels.ts). */
export interface TipText {
  name: string;
  key: string;
  cost: string;
  lines: string[];
}

/** Button `b`'s tip, or null when it would say nothing its face does not (no key, price or words). */
export function tipOf(b: HTMLElement): TipText | null {
  // Its words: the label (正式介面's, the prototype's command buttons), else its own text (not the badge's).
  const label = b.querySelector(":scope > .label, :scope > .lb");
  const face = label !== null ? (label.textContent ?? "") : [...b.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent ?? "").join("");
  const name = (b.dataset.tipName ?? face).trim();
  const key = b.dataset.hotkey !== undefined ? badgeText(b.dataset.hotkey) : (b.dataset.tipKey ?? "");
  const cost = b.dataset.tipCost ?? "";
  const lines = (b.dataset.tip ?? "").split("\n").filter((l) => l !== "");
  if (name === "" || (key === "" && cost === "" && lines.length === 0)) return null;
  return { name, key, cost, lines };
}

/** The tip's place on the screen: over the button, its right edge on the button's, in the window; else under it. */
export function tipPlace(button: { left: number; right: number; top: number; bottom: number }, tip: { width: number; height: number }, win: { width: number; height: number }, k = 1): { left: number; top: number } {
  const left = Math.max(EDGE * k, Math.min(button.right - tip.width, win.width - tip.width - EDGE * k));
  const above = button.top - GAP * k - tip.height;
  return { left, top: above >= EDGE * k ? above : button.bottom + GAP * k };
}

export class Tips {
  private readonly el: HTMLElement;
  private readonly root: HTMLElement;
  /** The button under the pointer, its tip shown or waiting. */
  private over: HTMLElement | null = null;
  private shown: HTMLElement | null = null;
  private timer = 0;
  private goneAt = Number.NEGATIVE_INFINITY;
  /** Pressed: no tip again until the pointer leaves it. */
  private pressed: HTMLElement | null = null;
  /** Where the mouse last was (a button built again under it: the new one is looked for there). */
  private at: { x: number; y: number } | null = null;
  private readonly drop: () => void;

  constructor(root: HTMLElement) {
    this.root = root;
    this.el = document.createElement("div");
    this.el.className = "tip panel";
    this.el.setAttribute("role", "tooltip");
    this.el.hidden = true;
    root.appendChild(this.el);
    const move = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      this.at = { x: e.clientX, y: e.clientY };
      this.point(this.buttonAt(e.clientX, e.clientY));
    };
    const down = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      this.pressed = this.over;
      this.hide();
    };
    const out = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || e.relatedTarget !== null) return;
      this.at = null;
      this.point(null);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") this.hide();
    };
    document.addEventListener("pointermove", move, true);
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("pointerout", out, true);
    document.addEventListener("keydown", key, true);
    this.drop = () => {
      document.removeEventListener("pointermove", move, true);
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("pointerout", out, true);
      document.removeEventListener("keydown", key, true);
    };
  }

  destroy(): void {
    window.clearTimeout(this.timer);
    this.drop();
    this.el.remove();
  }

  /**
   * With the interface's updates: the button under the pointer built again (its words may have changed), the tip goes
   * and the one now there is pointed at (shown at once, as from one button to the next).
   */
  update(): void {
    if (this.over === null || this.over.isConnected) return;
    const pressed = this.pressed !== null && !this.pressed.isConnected;
    this.hide();
    this.over = null;
    const b = this.at === null ? null : this.buttonAt(this.at.x, this.at.y);
    // Pressed and built again (攻擊 → 取消攻擊): still pressed, no tip until the pointer leaves.
    if (pressed) this.pressed = b;
    this.point(b);
  }

  /** The button of the interface at a point of the screen (a grey one takes no events of its own); null for none. */
  private buttonAt(x: number, y: number): HTMLElement | null {
    const at = document.elementFromPoint(x, y);
    const b = at instanceof Element ? at.closest<HTMLElement>("button") : null;
    return b !== null && this.root.contains(b) && b.closest(".dialog, .tip") === null ? b : null;
  }

  /** For the test page: the tip shown, its words and where. */
  forTest(): { text: string; x: number; y: number; w: number; h: number; button: string } | null {
    if (this.el.hidden || this.shown === null) return null;
    const r = this.el.getBoundingClientRect();
    return { text: this.el.textContent ?? "", x: r.left, y: r.top, w: r.width, h: r.height, button: this.shown.querySelector(".label, .lb")?.textContent ?? "" };
  }

  private point(b: HTMLElement | null): void {
    if (b === this.over) return;
    if (this.pressed !== null && b !== this.pressed) this.pressed = null;
    this.over = b;
    window.clearTimeout(this.timer);
    if (this.shown !== null) this.hide();
    if (b === null || b === this.pressed) return;
    const soon = performance.now() - this.goneAt < TIP_AGAIN_MS;
    if (soon) this.show(b);
    else this.timer = window.setTimeout(() => this.show(b), TIP_DELAY_MS);
  }

  private show(b: HTMLElement): void {
    if (!b.isConnected || this.over !== b) return;
    const t = tipOf(b);
    if (t === null) return;
    this.el.replaceChildren();
    const head = document.createElement("div");
    head.className = "tip-name";
    head.textContent = t.name;
    if (t.key !== "") {
      const k = document.createElement("span");
      k.className = "tip-key";
      k.textContent = t.key;
      head.appendChild(k);
    }
    this.el.appendChild(head);
    if (t.cost !== "") {
      const c = document.createElement("div");
      c.className = "tip-cost";
      c.textContent = t.cost;
      this.el.appendChild(c);
    }
    for (const line of t.lines) {
      const p = document.createElement("p");
      p.textContent = line;
      this.el.appendChild(p);
    }
    this.el.hidden = false;
    this.shown = b;
    // On the screen, as the interface is drawn (larger on a large window, R26-01): back into its own lengths.
    const box = this.root.getBoundingClientRect();
    const k = this.root.offsetWidth > 0 ? box.width / this.root.offsetWidth : 1;
    const r = this.el.getBoundingClientRect();
    const at = tipPlace(b.getBoundingClientRect(), r, { width: innerWidth, height: innerHeight }, k);
    this.el.style.left = `${(at.left - box.left) / k}px`;
    this.el.style.top = `${(at.top - box.top) / k}px`;
  }

  private hide(): void {
    window.clearTimeout(this.timer);
    if (this.shown === null) return;
    this.el.hidden = true;
    this.shown = null;
    this.goneAt = performance.now();
  }
}
