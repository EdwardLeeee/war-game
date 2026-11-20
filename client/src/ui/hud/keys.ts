// 快捷鍵 on the interface (R26 02 B, design/r26/spec.md section 02), with a mouse only: each button's key in its top
// right corner (the badge, `.hk`: 15 × 15, gold on dark, the key's name; past one letter a smaller font), a letter by
// the cell a button is drawn in, and a key's button pressed as a click on it would (a click where it is, so that
// 新手教學's dim keeps it off as it does a click: tutor.ts keepOff).

import { cellKeys, KEY_NAMES } from "../../input/hotkeys.ts";

/** A mouse (the R26 rules apply with one: design/r26/spec.md section 0). */
export const MOUSE_QUERY = "(hover: hover) and (pointer: fine)";

export function hasMouse(): boolean {
  return typeof matchMedia === "function" && matchMedia(MOUSE_QUERY).matches;
}

/** Button `b` takes the key whose badge is `name` (a letter, or KEY_NAMES' kind: "army", "pause"…). */
export function keyOn(b: HTMLElement, name: string, fixed = false): void {
  b.dataset.hotkey = name;
  if (fixed) b.dataset.hotkeyFixed = "";
}

/** The text on a key's badge. */
export const badgeText = (key: string): string => KEY_NAMES[key] ?? key;

/**
 * Every button with a key under `root` wears its badge (and none without a mouse). Run with the interface's
 * updates: a button dressed again (its count, 暫停／繼續) has lost its badge, and gets it back.
 */
export function paintBadges(root: ParentNode, on: boolean): void {
  for (const b of root.querySelectorAll<HTMLElement>("[data-hotkey]")) {
    const text = badgeText(b.dataset.hotkey ?? "");
    let hk = b.querySelector<HTMLElement>(":scope > .hk");
    if (!on) {
      hk?.remove();
      continue;
    }
    if (hk === null) {
      hk = document.createElement("span");
      hk.className = "hk";
      hk.setAttribute("aria-hidden", "true");
      b.appendChild(hk);
      if (getComputedStyle(b).position === "static") b.style.position = "relative";
    }
    if (hk.textContent !== text) {
      hk.textContent = text;
      hk.classList.toggle("wide", text.length > 1);
    }
    // A button with a count in its top right corner (閒置's, 地圖's): the key in the top left, off the count (R26-02
    // B's board had it over 閒置's count).
    const count = b.querySelector(":scope > .badge") !== null;
    if (hk.classList.contains("left") !== count) hk.classList.toggle("left", count);
    // A letter that would cover the button's words or icon in its corner (自動訓練, 法術營…): over the corner, as the
    // longer ones always are (ceo 2026-11-20: a badge never over the words). Looked at again when the words change.
    const fit = `${b.textContent ?? ""}|${innerWidth}x${innerHeight}`;
    if (text.length === 1 && hk.dataset.fit !== fit && b.getBoundingClientRect().width > 0) {
      hk.dataset.fit = fit;
      const out = coversFace(b, hk);
      if (hk.classList.contains("out") !== out) hk.classList.toggle("out", out);
    }
  }
  if (!on) return;
  // Taken off a button since (the letters placed again): its badge too.
  for (const hk of root.querySelectorAll<HTMLElement>(":not([data-hotkey]) > .hk")) hk.remove();
}

/**
 * Whether badge `hk`, in its corner inside button `b` (2 in from the top and the side, as R26-02 B's board), would
 * cover the button's words (each line's own box, not its span's) or its icon.
 */
function coversFace(b: HTMLElement, hk: HTMLElement): boolean {
  const br = b.getBoundingClientRect();
  const k = b.offsetWidth > 0 ? br.width / b.offsetWidth : 1;
  const r = hk.getBoundingClientRect();
  const s = getComputedStyle(b);
  const left = hk.classList.contains("left");
  const x = left ? br.left + ((parseFloat(s.borderLeftWidth) || 0) + 2) * k : br.right - ((parseFloat(s.borderRightWidth) || 0) + 2) * k - r.width;
  const y = br.top + ((parseFloat(s.borderTopWidth) || 0) + 2) * k;
  const over = (g: DOMRect) => g.width > 0 && g.left < x + r.width && x < g.right && g.top < y + r.height && y < g.bottom;
  const walker = document.createTreeWalker(b, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
    if (hk.contains(n) || (n.textContent ?? "").trim() === "") continue;
    const range = document.createRange();
    range.selectNodeContents(n);
    if ([...range.getClientRects()].some(over)) return true;
  }
  return [...b.querySelectorAll(".ic, svg")].some((ic) => !hk.contains(ic) && over(ic.getBoundingClientRect()));
}

/** The left edges of a grid's columns on the screen (its tracks and gap, drawn as large as the interface is). */
function columns(grid: HTMLElement): number[] {
  const r = grid.getBoundingClientRect();
  const k = grid.offsetWidth > 0 ? r.width / grid.offsetWidth : 1;
  const s = getComputedStyle(grid);
  const tracks = s.gridTemplateColumns
    .split(" ")
    .map((t) => parseFloat(t))
    .filter((t) => Number.isFinite(t));
  const gap = parseFloat(s.columnGap) || 0;
  let x = r.left + ((parseFloat(s.borderLeftWidth) || 0) + (parseFloat(s.paddingLeft) || 0)) * k;
  const out: number[] = [];
  for (const t of tracks) {
    out.push(x);
    x += (t + gap) * k;
  }
  return out;
}

/**
 * The letters of a grid's buttons (its own, not a row that names them: data-hotkey-fixed) by the cell each starts in;
 * `skip`, a button that takes none (返回: Esc). False while the grid is not drawn (no room measured): again later.
 */
export function placeCellKeys(grid: HTMLElement, skip: (b: HTMLButtonElement) => boolean): boolean {
  const all = [...grid.querySelectorAll<HTMLButtonElement>(":scope > button")];
  if (all.some((b) => b.dataset.hotkeyFixed !== undefined)) return true;
  if (grid.getBoundingClientRect().width === 0) return false;
  const shown = all.filter((b) => !b.hidden && b.getBoundingClientRect().width > 0 && !skip(b));
  const cols = columns(grid);
  const keys = cols.length > 0 ? cellKeys(cols, shown.map((b) => b.getBoundingClientRect()).map((r) => ({ x: r.left, y: r.top }))) : shown.map(() => null);
  for (const b of all) delete b.dataset.hotkey;
  shown.forEach((b, i) => {
    const key = keys[i];
    if (key !== null && key !== undefined) b.dataset.hotkey = key;
  });
  return true;
}

/** Drawn and there to be clicked: shown, not grey. */
export function reachable(b: HTMLElement | null): b is HTMLElement {
  if (b === null || !b.isConnected || (b as HTMLButtonElement).disabled) return false;
  const r = b.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(b).visibility !== "hidden";
}

/**
 * Button `b` pressed by its key: a click on it where `at` is drawn (`b` itself, or the button that shows it: 更多 for
 * its row), as a mouse's would be (新手教學's dim may keep it off: false, and the dim flashes). `detail` 0: a press
 * not of a pointer (pressable.ts takes it as one tap).
 */
export function pressByKey(b: HTMLElement, at: HTMLElement = b, blocked: () => void = () => {}): boolean {
  if (!reachable(at) || (b as HTMLButtonElement).disabled) return false;
  const r = at.getBoundingClientRect();
  const click = new MouseEvent("click", { bubbles: true, cancelable: true, view: window, detail: 0, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 });
  if (b.dispatchEvent(click)) return true;
  blocked();
  return false;
}
