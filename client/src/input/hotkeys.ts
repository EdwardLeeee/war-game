// 快捷鍵 (R26 02 B, the user 2026-11-18; design/r26/spec.md section 02; ceo 2026-11-20), with a mouse only: the letters
// press the command area's buttons by where they are (Q W E R the first row, A S D F the second, Z X C V the third: a
// cell with no button, its key does nothing, the others never move up into it), and a few keys the same everywhere
// (1–4 a group, Shift+1–4 the selection made that group, F2 全軍, . the next idle villager, Space 暫停／繼續, Esc 取消,
// Backspace 全軍撤退). A key does what a click on its button could do then. Which key a press is, and which cell a
// button is in: pure, for the unit tests; Game and Hud do what they say.

export type HotKey =
  /** A cell of the command area: its letter. */
  | { kind: "slot"; key: string }
  /** Group `n` (0–3); `save`: the selection made it (Shift, or Ctrl where the browser lets it through). */
  | { kind: "group"; n: number; save: boolean }
  | { kind: "army" }
  | { kind: "idle" }
  | { kind: "pause" }
  | { kind: "escape" }
  | { kind: "retreatAll" };

/**
 * The cells' letters, a row of the keyboard a row of buttons. Five across where the 建造 page has five columns (more
 * than 12 buildings: T, G and B, the next on each row of the keyboard; client's own, ceo 2026-11-20).
 */
export const SLOT_ROWS = ["QWERT", "ASDFG", "ZXCVB"] as const;

/** A key's badge (its name on the button), where it is not the key's own letter. */
export const KEY_NAMES: Readonly<Record<string, string>> = { army: "F2", idle: ".", pause: "Space", escape: "Esc", retreatAll: "Bksp" };

/**
 * Which key a press is, by where the key is on the keyboard (`code`: Shift+1 is "!" as `key`). Held keys do not
 * repeat. With Ctrl, Alt or ⌘ only Ctrl+1–4 (the browser's own: reload, close a tab, stay its); Shift only with 1–4.
 */
export function hotkeyOf(e: Pick<KeyboardEvent, "code" | "shiftKey" | "ctrlKey" | "altKey" | "metaKey" | "repeat">): HotKey | null {
  if (e.repeat) return null;
  const digit = /^Digit([1-4])$/.exec(e.code);
  if (digit !== null) return e.altKey || e.metaKey ? null : { kind: "group", n: Number(digit[1]) - 1, save: e.shiftKey || e.ctrlKey };
  if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return null;
  const letter = /^Key([A-Z])$/.exec(e.code);
  if (letter !== null) return SLOT_ROWS.some((r) => r.includes(letter[1])) ? { kind: "slot", key: letter[1] } : null;
  switch (e.code) {
    case "F2":
      return { kind: "army" };
    case "Period":
      return { kind: "idle" };
    case "Space":
      return { kind: "pause" };
    case "Escape":
      return { kind: "escape" };
    case "Backspace":
      return { kind: "retreatAll" };
    default:
      return null;
  }
}

/** Where keys are not taken: typing (a text field). */
export function typing(target: EventTarget | null): boolean {
  if (typeof Element === "undefined" || !(target instanceof Element)) return false;
  return target.closest("input, textarea, select, [contenteditable=''], [contenteditable='true']") !== null;
}

/**
 * The letter of each button in a grid by the cell it starts in: `cols`, the left edge of each column; `items`, each
 * button's top-left corner (the same units). A row is a top of its own (within 3); a column, the edge nearest. Past
 * the third row or the fifth column, none.
 */
export function cellKeys(cols: readonly number[], items: readonly { x: number; y: number }[]): (string | null)[] {
  const tops: number[] = [];
  for (const y of [...items.map((i) => i.y)].sort((a, b) => a - b)) if (tops.length === 0 || y - tops[tops.length - 1] > 3) tops.push(y);
  return items.map((i) => {
    const row = tops.findIndex((t) => Math.abs(i.y - t) <= 3);
    let col = 0;
    for (let c = 1; c < cols.length; c++) if (Math.abs(i.x - cols[c]) < Math.abs(i.x - cols[col])) col = c;
    return SLOT_ROWS[row]?.[col] ?? null;
  });
}

/**
 * The keys on the page: `act` with each (while `on`, and not typing); a key it took goes no further (Space would
 * scroll, Backspace go back). A button clicked keeps the focus, and Space or Enter would press it again: a key taken
 * takes the focus off it.
 */
export function attachHotkeys(on: () => boolean, act: (k: HotKey) => boolean): () => void {
  if (typeof document === "undefined") return () => {};
  const down = (e: KeyboardEvent) => {
    if (!on() || typing(e.target)) return;
    const k = hotkeyOf(e);
    if (k === null || !act(k)) return;
    e.preventDefault();
    const focus = document.activeElement;
    if (focus instanceof HTMLElement && focus.tagName === "BUTTON") focus.blur();
  };
  document.addEventListener("keydown", down);
  return () => document.removeEventListener("keydown", down);
}
