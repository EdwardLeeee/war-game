// 按下 (R6-25-01): a button looks pressed while a finger is on it, and for 120 ms after it lifts;
// sliding off and lifting there is no tap (the browser's own click rule). On every .b of the page,
// by delegation, so buttons built later are covered. Only the look: no preventDefault, the click
// is the browser's.

const RELEASE_MS = 120;

export function watchPresses(root: Document = document): void {
  const timers = new WeakMap<Element, ReturnType<typeof setTimeout>>();
  const target = (e: Event): HTMLElement | null => (e.target instanceof Element ? (e.target.closest(".b") as HTMLElement | null) : null);
  root.addEventListener("pointerdown", (e) => {
    const b = target(e);
    if (b === null || (b as HTMLButtonElement).disabled) return;
    const t = timers.get(b);
    if (t !== undefined) clearTimeout(t);
    b.classList.add("is-pressed");
  });
  const release = (e: Event) => {
    const b = target(e);
    if (b === null || !b.classList.contains("is-pressed")) return;
    // Leaving one of its own parts (its icon, its words) is not leaving the button.
    if (e.type === "pointerleave" && e.target !== b) return;
    timers.set(
      b,
      setTimeout(() => b.classList.remove("is-pressed"), RELEASE_MS),
    );
  };
  for (const type of ["pointerup", "pointercancel", "pointerleave"]) root.addEventListener(type, release, true);
}
