// The interface's icons (R6, war-game-ui's mock: design/r6/mock/app.js): 24 × 24 strokes in the
// text's colour, drawn inline so that the theme colours them (ui/r6.css .ic). Original drawings.

const ICON = {
  food: '<path d="M12 21V9"/><path d="M12 9c-3 0-4.5-2-4.5-5 3 0 4.5 2 4.5 5zM12 9c3 0 4.5-2 4.5-5-3 0-4.5 2-4.5 5z"/><path d="M12 14c-3 0-4.5-2-4.5-5 3 0 4.5 2 4.5 5zM12 14c3 0 4.5-2 4.5-5-3 0-4.5 2-4.5 5z"/>',
  wood: '<ellipse cx="9" cy="12" rx="5" ry="6"/><ellipse cx="9" cy="12" rx="2.2" ry="2.8"/><path d="M9 6h8a5 6 0 0 1 0 12H9"/>',
  gold: '<path d="M4 17h16l-3-7H7z"/><path d="M8.5 10l1.5-4h4l1.5 4"/>',
  crystal: '<path d="M12 2l5 6-5 14-5-14z"/><path d="M7 8h10M12 2v20"/>',
  pop: '<circle cx="12" cy="7.5" r="3.5"/><path d="M5 21c0-4 3-7 7-7s7 3 7 7"/>',
  time: '<path d="M7 3h10M7 21h10M8 3c0 5 8 6 8 9s-8 4-8 9M16 3c0 5-8 6-8 9s8 4 8 9"/>',
  speed: '<path d="M5 6l6 6-6 6M12 6l6 6-6 6"/>',
  slow: '<path d="M9 6l6 6-6 6"/>',
  fast: '<path d="M3 6l6 6-6 6M9.5 6l6 6-6 6M16 6l6 6-6 6"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  play: '<path d="M7 4l12 8-12 8z"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  attack: '<path d="M5 19L17 7M14 5l5 0 0 5M5 15l4 4"/>',
  retreat: '<path d="M10 6L4 12l6 6"/><path d="M4 12h11a5 5 0 0 1 5 5v2"/>',
  hold: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1.5"/>',
  home: '<path d="M4 11l8-7 8 7"/><path d="M6 10v10h12V10"/><path d="M10 20v-5h4v5"/>',
  work: '<path d="M14 4l6 6-3 3-6-6z"/><path d="M11 7L3 15v6h6l8-8"/>',
  idle: '<circle cx="12" cy="7" r="3"/><path d="M7 21v-6a5 5 0 0 1 10 0v6"/><path d="M16 4.5l3-1.5M18 8h3"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  army: '<path d="M4 18l4-10 4 6 4-6 4 10z"/>',
  map: '<path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z"/><path d="M9 4v14M15 6v14"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/>',
  // 上城牆／下城牆 (D-096, war-game-ui 2026-10-22): a stretch of wall with merlons, an arrow up onto it or down from it.
  wallUp: '<path d="M4 21v-8h3v3h3.3v-3h3.4v3H17v-3h3v8z"/><path d="M12 10V2M8.5 5.5L12 2l3.5 3.5"/>',
  wallDown: '<path d="M4 21v-8h3v3h3.3v-3h3.4v3H17v-3h3v8z"/><path d="M12 2v8M8.5 6.5L12 10l3.5-3.5"/>',
} as const;

export type IconName = keyof typeof ICON;

/** An icon element, hidden from screen readers (the button's words name it). */
export function icon(name: IconName, cls = ""): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", `ic${cls === "" ? "" : ` ${cls}`}`);
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = ICON[name];
  return svg;
}

/**
 * Fills a button (R6-40): an icon, its words, and under them a small line; `name` its accessible
 * name when the words alone are not it (速度 正常, 全軍 16).
 */
export function dress(b: HTMLButtonElement, o: { ic?: IconName; label?: string; sub?: string; count?: string | number; name?: string }): void {
  b.replaceChildren();
  if (o.ic !== undefined) b.appendChild(icon(o.ic));
  if (o.label !== undefined) {
    const s = document.createElement("span");
    s.className = "lb";
    s.textContent = o.label;
    b.appendChild(s);
  }
  if (o.sub !== undefined) {
    const s = document.createElement("span");
    s.className = "sub";
    s.textContent = o.sub;
    b.appendChild(s);
  }
  if (o.count !== undefined) {
    const s = document.createElement("span");
    s.className = "cnt";
    s.textContent = String(o.count);
    b.appendChild(s);
  }
  if (o.name !== undefined) b.setAttribute("aria-label", o.name);
  else b.removeAttribute("aria-label");
}
