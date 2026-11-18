// What the player presses with (R26): the last press on the page, a mouse or a finger (a laptop with a touch screen
// goes by whichever was used last); before any, whether the device has a fine pointer that hovers (a mouse).

let last: string | null = null;
if (typeof document !== "undefined") {
  document.addEventListener("pointerdown", (e) => (last = e.pointerType), { capture: true, passive: true });
}

/** The player uses a mouse: 新手教學's 第 5 步 says the right button instead of the long press. */
export function usesMouse(): boolean {
  if (last !== null) return last === "mouse";
  return typeof matchMedia === "function" && matchMedia("(hover: hover) and (pointer: fine)").matches;
}
