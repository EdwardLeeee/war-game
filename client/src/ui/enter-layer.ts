// 進駐's tags on the battlefield (R13-01 B and B2): over the map, under the interface, drawn only while
// picking where to go in. A tag on each building it can go into, 「進 誰／留 誰」, grey where it cannot;
// laid out by enter-tags.ts when the camera comes to rest, and following its building while it moves
// (rule 6); arrows on the edge of the free area for those off the screen. The tags take no touches: a
// tap reaches the battlefield and Game asks tapAt; only the arrows are buttons.

import type { Camera } from "../camera/camera.ts";
import { around, type Box, edgeArrows, type EdgeArrow, placeTags, tappedItem, type TagItem, type TagPlace } from "./enter-tags.ts";

/** A place to go into, as Game keeps it. */
export interface EnterPlace {
  id: string;
  name: string;
  /** Its ring on the ground (world px), and its middle. */
  corners: { x: number; y: number }[];
  /** The plane's y of its picture's top, null when unknown. */
  top: number | null;
  /** A whole town: what stands in it is tapped before it. */
  big: boolean;
  off: boolean;
  head: string;
  sub: string | null;
  chip: string;
  short: string;
  /** What says the same as this one (rule 4). */
  say: string;
}

interface Shown {
  place: EnterPlace;
  tag: HTMLElement;
  chip: HTMLElement;
  line: SVGLineElement;
  at: TagPlace;
  /** From its ring's middle on the screen when laid out, while the camera moves. */
  dx: number;
  dy: number;
  /** Its ring on the screen now, and whether its middle is on the screen. */
  cx: number;
  cy: number;
  hw: number;
  hh: number;
  top: number;
  on: boolean;
}

/** An arrow's size, points (rule 7: 44 high). */
const ARROW: readonly [number, number] = [104, 44];
/** The camera still this long: lay out again (rule 6). */
const REST_MS = 120;
/** How often the interface's boxes are looked at. */
const BLOCKERS_MS = 250;

const SVG = "http://www.w3.org/2000/svg";

const box = (r: DOMRect): Box => ({ x: r.left, y: r.top, w: r.width, h: r.height });

export class EnterLayer {
  private readonly root: HTMLElement;
  private readonly lines: SVGSVGElement;
  private readonly hud: HTMLElement;
  private readonly onArrow: (id: string) => void;
  private readonly shown = new Map<string, Shown>();
  private arrows: { el: HTMLButtonElement; arrow: EdgeArrow }[] = [];
  private cameraKey = "";
  private movedAt = 0;
  private dirty = true;
  private blockersAt = 0;
  private blockersKey = "";
  private blockers: Box[] = [];
  private frameBox: Box = { x: 0, y: 0, w: 0, h: 0 };
  private free: Box = { x: 0, y: 0, w: 0, h: 0 };

  constructor(hud: HTMLElement, onArrow: (id: string) => void) {
    this.hud = hud;
    this.onArrow = onArrow;
    this.root = document.createElement("div");
    this.root.className = "enter-layer";
    this.root.hidden = true;
    this.lines = document.createElementNS(SVG, "svg");
    this.lines.setAttribute("class", "enter-lines");
    this.root.append(this.lines);
    hud.prepend(this.root);
  }

  /** The places now (it changes when a soldier falls or a place fills up). */
  setPlaces(places: readonly EnterPlace[]): void {
    const seen = new Set(places.map((p) => p.id));
    for (const [id, s] of this.shown) {
      if (seen.has(id)) continue;
      s.tag.remove();
      s.chip.remove();
      s.line.remove();
      this.shown.delete(id);
    }
    for (const place of places) {
      let s = this.shown.get(place.id);
      if (s === undefined) {
        const tag = document.createElement("div");
        const chip = document.createElement("div");
        chip.className = "enter-chip";
        const line = document.createElementNS(SVG, "line");
        this.lines.append(line);
        this.root.append(tag, chip);
        s = { place, tag, chip, line, at: { mode: "ring", box: null, leader: false }, dx: 0, dy: 0, cx: 0, cy: 0, hw: 0, hh: 0, top: 0, on: false };
        this.shown.set(place.id, s);
        this.dirty = true;
      }
      const old = s.place;
      if (old.head !== place.head || old.sub !== place.sub || old.off !== place.off || s.tag.childElementCount === 0) {
        s.tag.className = place.off ? "enter-tag off" : "enter-tag";
        s.tag.replaceChildren();
        const head = document.createElement("b");
        head.textContent = place.head;
        s.tag.append(head);
        if (place.sub !== null) {
          const sub = document.createElement("small");
          sub.textContent = place.sub;
          s.tag.append(sub);
        }
        s.chip.textContent = place.chip;
        this.dirty = true;
      }
      if (old.short !== place.short || old.say !== place.say) this.dirty = true;
      s.place = place;
    }
  }

  open(): void {
    this.root.hidden = false;
    this.dirty = true;
    this.blockersKey = "";
  }

  close(): void {
    this.root.hidden = true;
    this.setPlaces([]);
    for (const a of this.arrows) a.el.remove();
    this.arrows = [];
  }

  /** The interface's boxes (what a tag keeps off), the screen, and the battlefield's free middle. */
  private measure(now: number): void {
    if (now < this.blockersAt) return;
    this.blockersAt = now + BLOCKERS_MS;
    const seen = (selector: string): Box[] => {
      const out: Box[] = [];
      for (const e of this.hud.querySelectorAll<HTMLElement>(selector)) {
        if (e.hidden || e.closest(".enter-layer") !== null) continue;
        const r = e.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) out.push(box(r));
      }
      return out;
    };
    const left = seen(".side-left > *, .minimap:not(.closed)");
    const right = seen(".groups, .army-btn, .top-right");
    const top = seen(".res-bar, .prompt");
    const low = seen(".sel-info, .cmds, .bottom-build");
    this.blockers = [...left, ...right, ...top, ...low, ...seen(".retreat-all-btn, .paused-banner")];
    const hud = this.hud.getBoundingClientRect();
    this.frameBox = { x: hud.left, y: hud.top, w: hud.width, h: hud.height };
    const x = Math.max(hud.left, ...left.filter((b) => b.x < hud.width / 3).map((b) => b.x + b.w)) + 4;
    const end = Math.min(hud.right, ...right.filter((b) => b.y + b.h < hud.height * 0.7).map((b) => b.x)) - 4;
    const y = Math.max(hud.top, ...top.map((b) => b.y + b.h)) + 4;
    const bottom = Math.min(hud.bottom, ...low.map((b) => b.y)) - 4;
    this.free = { x, y, w: Math.max(ARROW[0], end - x), h: Math.max(ARROW[1], bottom - y) };
    const key = JSON.stringify([this.blockers, this.frameBox]);
    if (key !== this.blockersKey) {
      this.blockersKey = key;
      this.dirty = true;
    }
  }

  /** Every frame while picking: the rings on the screen, and the tags where they belong. */
  frame(now: number, camera: Camera, squad: readonly [number, number]): void {
    this.measure(now);
    for (const s of this.shown.values()) {
      const pts = s.place.corners.map((c) => camera.worldToScreen(c.x, c.y));
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      const x0 = Math.min(...xs);
      const x1 = Math.max(...xs);
      const y0 = Math.min(...ys);
      const y1 = Math.max(...ys);
      s.cx = (x0 + x1) / 2;
      s.cy = (y0 + y1) / 2;
      s.hw = (x1 - x0) / 2;
      s.hh = (y1 - y0) / 2;
      s.top = s.place.top === null ? y0 - 24 : (s.place.top - camera.y) * camera.scale;
      const f = this.frameBox;
      s.on = s.cx >= f.x && s.cx <= f.x + f.w && s.cy >= f.y && s.cy <= f.y + f.h;
    }
    const key = `${camera.x}|${camera.y}|${camera.scale}`;
    if (key !== this.cameraKey) {
      this.cameraKey = key;
      this.movedAt = now;
    }
    const resting = now - this.movedAt >= REST_MS;
    if (this.dirty || (resting && this.movedAt !== 0)) {
      this.layout(squad);
      this.movedAt = 0;
      this.dirty = false;
    }
    this.paint();
  }

  private layout(squad: readonly [number, number]): void {
    const items: TagItem[] = [];
    for (const s of this.shown.values()) {
      if (!s.on) {
        s.at = { mode: "ring", box: null, leader: false };
        continue;
      }
      items.push({ id: s.place.id, cx: s.cx, cy: s.cy, hw: s.hw, hh: s.hh, top: s.top, w: s.tag.offsetWidth, h: s.tag.offsetHeight, cw: s.chip.offsetWidth, ch: s.chip.offsetHeight, off: s.place.off, say: s.place.say });
    }
    const places = placeTags(items, this.blockers, this.frameBox, squad);
    for (const [id, at] of places) {
      const s = this.shown.get(id);
      if (s === undefined) continue;
      s.at = at;
      s.dx = at.box === null ? 0 : at.box.x - s.cx;
      s.dy = at.box === null ? 0 : at.box.y - s.cy;
    }
    for (const a of this.arrows) a.el.remove();
    this.arrows = [];
    const far = [...this.shown.values()].filter((s) => !s.on && !s.place.off);
    const taken = [...places.values()].flatMap((p) => (p.box === null ? [] : [p.box]));
    const rings = items.map((i) => around(i.cx, i.cy, i.hw * 2, i.hh * 2));
    const targets = far.map((s) => ({ id: s.place.id, name: s.place.name, x: s.cx, y: s.cy, d: Math.hypot(s.cx - squad[0], s.cy - squad[1]), short: s.place.short }));
    for (const arrow of edgeArrows(targets, this.free, [...this.blockers, ...taken, ...rings], this.frameBox, ARROW)) {
      if (arrow.box !== null) this.arrows.push({ el: this.arrowEl(arrow, arrow.box), arrow });
    }
  }

  private arrowEl(a: EdgeArrow, b: Box): HTMLButtonElement {
    const el = document.createElement("button");
    el.type = "button";
    const right = Math.cos(a.angle) > 0;
    el.className = right ? "enter-arrow right" : "enter-arrow";
    el.setAttribute("aria-label", `鏡頭移到${a.name}`);
    el.style.left = `${b.x - this.frameBox.x}px`;
    el.style.top = `${b.y - this.frameBox.y}px`;
    const dir = document.createElementNS(SVG, "svg");
    dir.setAttribute("class", "dir");
    dir.setAttribute("viewBox", "-8 -8 16 16");
    const path = document.createElementNS(SVG, "path");
    path.setAttribute("d", "M7 0 L-4.5 -5.5 L-2 0 L-4.5 5.5 Z");
    path.setAttribute("transform", `rotate(${((a.angle * 180) / Math.PI).toFixed(0)})`);
    dir.append(path);
    const text = document.createElement("span");
    const name = document.createElement("b");
    name.textContent = a.n > 1 ? `${a.name} ×${a.n}` : a.name;
    const who = document.createElement("small");
    who.textContent = a.short;
    text.append(name, who);
    el.append(dir, text);
    el.addEventListener("click", () => this.onArrow(a.id));
    this.root.append(el);
    return el;
  }

  /** The tags where they go: by their rings, as laid out; line back to the ring where moved away (rule 3). */
  private paint(): void {
    const f = this.frameBox;
    for (const s of this.shown.values()) {
      const at = s.at;
      const x = s.cx + s.dx - f.x;
      const y = s.cy + s.dy - f.y;
      s.tag.classList.toggle("shown", s.on && at.mode === "full");
      s.chip.classList.toggle("shown", s.on && at.mode === "chip");
      if (at.mode !== "ring" && s.on) (at.mode === "full" ? s.tag : s.chip).style.transform = `translate(${x}px, ${y}px)`;
      const leader = s.on && at.mode === "full" && at.leader && at.box !== null;
      s.line.style.display = leader ? "" : "none";
      if (leader && at.box !== null) {
        s.line.setAttribute("x1", `${x + at.box.w / 2}`);
        s.line.setAttribute("y1", `${y + at.box.h / 2}`);
        s.line.setAttribute("x2", `${s.cx - f.x}`);
        s.line.setAttribute("y2", `${s.cy - f.y}`);
      }
    }
  }

  /** The place under a tap at screen (x, y) (rule 1), or null. */
  tapAt(x: number, y: number): string | null {
    const items = [...this.shown.values()]
      .filter((s) => s.on || s.place.big)
      .map((s) => ({ id: s.place.id, box: s.on && s.at.box !== null ? { x: s.cx + s.dx, y: s.cy + s.dy, w: s.at.box.w, h: s.at.box.h } : null, cx: s.cx, cy: s.cy, hw: s.hw, hh: s.hh, big: s.place.big }));
    return tappedItem(items, x, y);
  }

  /** The free middle of the battlefield, where an arrow's building is brought (rule 10). */
  freeMiddle(): { x: number; y: number } {
    return { x: this.free.x + this.free.w / 2, y: this.free.y + this.free.h / 2 };
  }

  /** For the test page. */
  forTest(): { tags: { id: string; name: string; mode: string; head: string; sub: string | null; off: boolean; x: number; y: number; w: number; h: number; leader: boolean }[]; arrows: { id: string; name: string; n: number; short: string; x: number; y: number }[]; blockers: Box[] } {
    const f = this.frameBox;
    return {
      blockers: this.blockers,
      tags: [...this.shown.values()].map((s) => ({
        id: s.place.id,
        name: s.place.name,
        mode: s.on ? s.at.mode : "off-screen",
        head: s.place.head,
        sub: s.place.sub,
        off: s.place.off,
        x: s.on && s.at.box !== null ? s.cx + s.dx : s.cx,
        y: s.on && s.at.box !== null ? s.cy + s.dy : s.cy,
        w: s.at.box?.w ?? 0,
        h: s.at.box?.h ?? 0,
        leader: s.at.leader,
      })),
      arrows: this.arrows.map(({ arrow }) => ({ id: arrow.id, name: arrow.name, n: arrow.n, short: arrow.short, x: (arrow.box?.x ?? 0) - f.x, y: (arrow.box?.y ?? 0) - f.y })),
    };
  }
}
