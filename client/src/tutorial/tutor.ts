// 新手教學 (R25, D-151): the step runner and what it draws over the game, as ui's approved boards
// (war-game-worktrees/ui/design/r25/build/boards/, sizes from design/r25/common/tutorial-page.js):
// - the card under the resource bar, left of the group buttons (390 wide, at most 3 lines): the steps' progress
//   on its top edge, 跳過這步 and ✕; its title line only while 軍團畫面 is open; at the left while a dialog is in
//   the middle; away while the game's own prompt (放建築, 進駐) says what to do;
// - frame A: the rest dimmed, what to press framed, and only that answers a tap (ceo 2026-11-15: drags and pinches
//   anywhere still work; 1a and 5a and the waits let every tap through; a tap kept off flashes the frame);
// - a target off the screen: a gold tag at the edge pointing at it, 帶我去看 on the card.
// It never saves or uploads the game (main.ts) and gives orders only through the player's taps and its
// `tutorial` commands (sim PROTOCOL 3.12).

import type { Game } from "../game/game.ts";
import type { CommandBody, TutorialEvent } from "../sim.ts";
import { TILE_PX } from "../tuning.ts";
import { icon } from "../ui/icons.ts";
import { uiZoom } from "../ui/ui-scale.ts";
import type { TutorHooks } from "./hooks.ts";
import { type Phase, phaseById, type Place, STEPS, type StepCtx, stepOf, type TargetSpec } from "./steps.ts";
import { type Spot, TutorWorld } from "./world.ts";

/** How long a done step stays before the next comes by itself (R25 共用元件: 「一秒多以後自己往下」). */
const DONE_MS = 1600;
/** How often the step is checked between snapshots (the frame drawn each animation frame). */
const CHECK_MS = 100;
/** A tap kept off: the frame flashes this long. */
const FLASH_MS = 600;

export interface TutorHost {
  /** 離開 (confirmed): back to the start screen; nothing kept of the tutorial. */
  leave(): void;
  /** The last card's buttons: 開始第一局, or 回開局畫面. */
  finish(next: "first" | "start"): void;
}

type Box = { x: number; y: number; w: number; h: number };
type Shape = { box: Box; round: boolean };

export interface TutorState {
  step: number;
  phase: string;
  done: boolean;
  finished: boolean;
  place: Place;
  blocked: number;
  sent: string[];
  target: Shape | null;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, parent: HTMLElement, cls = "", text = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls !== "") e.className = cls;
  if (text !== "") e.textContent = text;
  parent.appendChild(e);
  return e;
}

const visible = (e: Element): boolean => {
  if (e.closest("[hidden]") !== null) return false;
  const r = e.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== "hidden";
};

const inside = (b: Box, x: number, y: number, pad = 0): boolean => x >= b.x - pad && x <= b.x + b.w + pad && y >= b.y - pad && y <= b.y + b.h + pad;

export class Tutor implements TutorHooks {
  private readonly game: Game;
  private readonly root: HTMLElement;
  private readonly host: TutorHost;
  private readonly w: TutorWorld;
  private readonly flags = { panned: false, pinched: false, minimap: false };
  private memo: Record<string, number> = {};
  private phase: Phase;
  private step = 1;
  /** The step is done: its card green, the next one after DONE_MS (or 下一步). */
  private doneAt: number | null = null;
  /** The last step done (or skipped at its end): the last card, its two buttons. */
  private finished = false;
  /** The player's commands from this seq on are this phase's. */
  private sentFrom = 0;
  /** `tutorial` commands sent this game (once each but near_home and near_home_clear). */
  private readonly sent: string[] = [];
  private blockedCount = 0;
  private flashUntil = 0;
  private readonly card: HTMLElement;
  private readonly layer: HTMLElement;
  private confirm: HTMLElement | null = null;
  private cardKey = "";
  private target: Shape | null = null;
  private targetLabel: string | null = null;
  private offScreen: { x: number; y: number } | null = null;
  /** The target's place in cells while it is off the screen (帶我去看). */
  private offCell: { x: number; y: number } | null = null;
  /** A step near home just began: the camera goes to its target if that is off the screen (not 8 and 9's, whose tag is the lesson). */
  private focus = false;
  /** Since when the target is where a tap cannot reach it (under the card or a button), and when the player last moved the camera. */
  private unclearSince: number | null = null;
  private lastPan = 0;
  private readonly timer: number;
  private raf = 0;
  private readonly drop: () => void;

  constructor(game: Game, root: HTMLElement, host: TutorHost) {
    this.game = game;
    this.root = root;
    this.host = host;
    this.w = new TutorWorld(game);
    this.layer = el("div", root, "tut-layer");
    this.layer.setAttribute("aria-hidden", "true");
    this.card = el("section", root, "tut-card panel");
    this.card.setAttribute("aria-label", "新手教學");
    const first = phaseById(stepOf(1).first);
    if (first === undefined) throw new Error("no first phase");
    this.phase = first;
    this.enterPhase(first.id);
    game.tutor = this;
    // Taps on the interface outside the frame (its buttons, a dialog's) kept off on their way down.
    const keep = (e: Event) => this.keepOff(e as PointerEvent | MouseEvent);
    for (const t of ["pointerdown", "pointerup", "click"]) document.addEventListener(t, keep, true);
    this.drop = () => {
      for (const t of ["pointerdown", "pointerup", "click"]) document.removeEventListener(t, keep, true);
    };
    // Checked and drawn on a timer too: a busy page may draw no animation frame for seconds (CI's WebKit), and the
    // card, the frame and what a tap may reach must follow the step all the same.
    this.timer = window.setInterval(() => {
      this.check();
      this.draw();
    }, CHECK_MS);
    const frame = () => {
      this.draw();
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  destroy(): void {
    window.clearInterval(this.timer);
    cancelAnimationFrame(this.raf);
    this.drop();
    if (this.game.tutor === this) this.game.tutor = null;
    this.card.remove();
    this.layer.remove();
    this.confirm?.remove();
  }

  // --- what the battlefield asks (TutorHooks) ---------------------------------------------

  tapAllowed(sx: number, sy: number): boolean {
    return this.allowedAt(sx, sy);
  }

  blocked(): void {
    this.blockedCount++;
    this.flashUntil = performance.now() + FLASH_MS;
  }

  panned(): void {
    this.flags.panned = true;
    this.lastPan = performance.now();
  }

  pinched(): void {
    this.flags.pinched = true;
    this.lastPan = performance.now();
  }

  minimapAllowed(): boolean {
    if (!this.blocking()) return true;
    const t = this.phaseTarget();
    return t !== null && "el" in t && t.el !== null && t.el.classList.contains("minimap");
  }

  minimapTapped(): void {
    this.flags.minimap = true;
  }

  snapshot(): void {
    this.check();
  }

  /** The test hook's view of it. */
  state(): TutorState {
    return { step: this.step, phase: this.phase.id, done: this.doneAt !== null, finished: this.finished, place: this.place(), blocked: this.blockedCount, sent: [...this.sent], target: this.target };
  }

  // --- the steps ------------------------------------------------------------------------------

  private ctx(): StepCtx {
    return {
      w: this.w,
      game: this.game,
      flags: this.flags,
      sentSince: () => this.game.sent.filter((c) => c.seq >= this.sentFrom && c.auto !== true) as CommandBody[],
      el: (selector, words) => {
        for (const e of this.root.querySelectorAll<HTMLElement>(selector)) {
          if (!visible(e)) continue;
          if (words !== undefined && !words.test((e.textContent ?? "").trim()) && !words.test(e.getAttribute("aria-label") ?? "")) continue;
          return e;
        }
        return null;
      },
      send: (event) => this.send(event),
      clear: (sx, sy) => this.clearAt(sx, sy),
      memo: this.memo,
    };
  }

  private send(event: TutorialEvent): void {
    const again = event === "near_home" || event === "near_home_clear";
    if (!again && this.sent.includes(event)) return;
    this.sent.push(event);
    this.game.command({ c: "tutorial", event });
  }

  private enterPhase(id: string): void {
    const p = phaseById(id);
    if (p === undefined) return;
    const stepChanged = p.step !== this.phase.step || this.sentFrom === 0;
    this.phase = p;
    this.step = p.step;
    if (stepChanged) {
      this.memo = {};
      this.focus = p.step >= 2 && p.step <= 7;
    }
    if (p.id === "9a" || p.focus === true) this.focus = true;
    this.sentFrom = (this.game.sent.at(-1)?.seq ?? 0) + 1;
    this.cardKey = "";
    p.enter?.(this.ctx());
  }

  private check(): void {
    if (this.finished || this.confirm !== null) return;
    const now = performance.now();
    if (this.doneAt !== null) {
      if (now - this.doneAt >= DONE_MS) this.nextStep();
      return;
    }
    if (this.phase.noBuilding === true && (this.game.view?.selection.building ?? null) !== null) this.game.apply([{ kind: "clear" }]);
    const next = this.phase.next(this.ctx());
    if (next === null) return;
    if (next === "done") this.stepDone();
    else if (next !== this.phase.id) this.enterPhase(next);
  }

  private stepDone(): void {
    // Step 1 opened the minimap to teach it: put away for the rest (a target under it could not be tapped).
    if (this.step === 1) this.game.hud.closeMinimap();
    // Step 6: 軍團畫面 folded, as the board's 6c (the group on the bar), the done card in full over it.
    if (this.step === 6) this.game.hud.foldGroupPanel();
    if (this.step >= STEPS) {
      this.finished = true;
      this.cardKey = "";
      return;
    }
    this.doneAt = performance.now();
    this.cardKey = "";
  }

  private nextStep(): void {
    this.doneAt = null;
    const s = this.step + 1;
    if (s > STEPS) {
      this.finished = true;
      this.cardKey = "";
      return;
    }
    this.enterPhase(stepOf(s).first);
  }

  /** 跳過這步: what the steps after need, then the next step (step 9: the two engines, then at the city; at the city, the end). */
  private skip(): void {
    const c = this.ctx();
    if (this.step === STEPS) {
      if (this.phase.id === "9a" || this.phase.id === "9b") {
        this.send("engines");
        this.enterPhase("9c");
      } else {
        this.finished = true;
        this.cardKey = "";
      }
      return;
    }
    stepOf(this.step).skip?.(c);
    this.doneAt = null;
    this.enterPhase(stepOf(this.step + 1).first);
  }

  /** A point on the battlefield no button, panel or the card covers (a target there can be tapped). */
  private clearAt(sx: number, sy: number): boolean {
    if (sx < 70 || sy < 50 || sx > innerWidth - 70 || sy > innerHeight - 60) return false;
    for (const e of this.root.querySelectorAll("button, .panel, .minimap:not(.closed)")) {
      if (visible(e) && inside(this.boxOf(e), sx, sy, 16)) return false;
    }
    return true;
  }

  // --- taps kept off ----------------------------------------------------------------------------

  private blocking(): boolean {
    return !this.finished && this.doneAt === null && this.phase.block && this.target !== null;
  }

  private phaseTarget(): TargetSpec {
    return this.phase.target(this.ctx());
  }

  /** A tap here does something: no frame, or inside it, or on what the step also lets through. */
  private allowedAt(x: number, y: number): boolean {
    if (!this.blocking() || this.target === null) return true;
    const t = this.target;
    if (t.round) {
      const cx = t.box.x + t.box.w / 2;
      const cy = t.box.y + t.box.h / 2;
      const rx = t.box.w / 2 + 10;
      const ry = t.box.h / 2 + 10;
      if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) return true;
    } else if (inside(t.box, x, y, 6)) return true;
    for (const s of this.phase.extras ?? []) {
      for (const e of this.root.querySelectorAll(s)) {
        if (visible(e) && inside(this.boxOf(e), x, y)) return true;
      }
    }
    return false;
  }

  private keepOff(e: PointerEvent | MouseEvent): void {
    if (!(e.target instanceof Element) || !this.root.contains(e.target)) return;
    // The card, its confirm, the top bar (速度, 暫停, 選單), the minimap (game.minimapTap asks) and ✕ (取消選取: a panel
    // opened by a stray tap never stays over the target) always answer.
    if (e.target.closest(".tut-card, .tut-confirm, .top-right, .minimap, [aria-label='取消選取']") !== null) return;
    if (e.target.closest("button, [role=button], .enter-tag, .enter-chip") === null) return;
    if (this.allowedAt(e.clientX, e.clientY)) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "pointerdown") this.blocked();
  }

  // --- drawing ------------------------------------------------------------------------------------

  private boxOf(e: Element): Box {
    const r = e.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  }

  /** Where the card goes now: as the phase says, else at the left over a dialog, its title line over 軍團畫面. */
  private place(): Place {
    if (this.finished) return this.root.querySelector(".dialog:not([hidden])") !== null ? "side" : "top";
    if (this.doneAt === null) {
      const forced = this.phase.place?.(this.ctx()) ?? null;
      if (forced !== null) return forced;
    }
    if (this.root.querySelector(":scope > .dialog:not([hidden])") !== null) return "side";
    if (this.root.querySelector(".sel-info.legion-pop:not([hidden])") !== null) return "slim";
    return "top";
  }

  private draw(): void {
    const c = this.ctx();
    const place = this.place();
    this.drawCard(c, place);
    this.drawLayer(c);
  }

  private drawCard(c: StepCtx, place: Place): void {
    const done = this.doneAt !== null || this.finished;
    const s = stepOf(this.step);
    const title = done ? s.doneTitle : this.phase.title;
    const body = done ? (typeof s.doneBody === "function" ? s.doneBody() : s.doneBody) : this.phase.body(c);
    const list = done ? null : (this.phase.list?.(c) ?? null);
    const wait = done ? null : (this.phase.wait?.(c) ?? null);
    const go = !done && this.offScreen !== null;
    const key = JSON.stringify([this.step, this.phase.id, done, this.finished, place, title, body, list, wait === null ? null : Math.round(wait * 100), go]);
    if (key === this.cardKey) return;
    this.cardKey = key;
    const card = this.card;
    card.hidden = place === "hidden" && !done;
    card.className = `tut-card panel ${place === "side" ? "side" : place === "slim" ? "slim" : "top"}${done ? " done" : ""}`;
    card.replaceChildren();
    const prog = el("div", card, "tut-prog");
    for (let i = 1; i <= STEPS; i++) el("i", prog, i < this.step || (i === this.step && done) ? "on" : i === this.step ? "now" : "");
    const head = el("div", card, "tut-head");
    el("span", head, "tut-step", place === "side" ? `新手教學 ${this.step}／${STEPS}` : `${this.step}／${STEPS}`);
    const t = el("span", head, "tut-title");
    if (done) {
      const ok = el("span", t, "tut-ok");
      ok.append(icon("check"));
    }
    t.append(title);
    const button = (parent: HTMLElement, label: string, cls: string, act: () => void, aria?: string): HTMLButtonElement => {
      const b = el("button", parent, `b ${cls}`);
      b.type = "button";
      b.append(label);
      if (aria !== undefined) b.setAttribute("aria-label", aria);
      b.addEventListener("click", act);
      return b;
    };
    const finishButtons = (parent: HTMLElement) => {
      button(parent, "開始第一局", "pri", () => this.host.finish("first"));
      button(parent, "回開局畫面", "secondary", () => this.host.finish("start"));
    };
    if (place !== "side") {
      if (!this.finished) {
        if (done) button(head, "下一步", "secondary tut-next", () => this.nextStep());
        else button(head, "跳過這步", "secondary tut-skip", () => this.skip());
        const x = button(head, "", "secondary tut-x", () => this.askLeave(), "離開教學");
        x.append(icon("close"));
      }
      if (place === "slim") return;
    }
    const b = el("div", card, "tut-body");
    b.innerHTML = body;
    if (list !== null) {
      const l = el("div", b, "tut-list");
      for (const [words, ok] of list) el("span", l, ok ? "ok" : "", words);
    }
    if (wait !== null) {
      const bar = el("div", b, "tut-wait");
      el("i", bar).style.width = `${Math.round(Math.min(1, Math.max(0, wait)) * 100)}%`;
    }
    if (go) {
      const g = button(b, "帶我去看", "tut-go", () => this.goSee());
      g.prepend(icon("go"));
    }
    if (place === "side") {
      const col = el("div", card, "tut-btns");
      if (this.finished) finishButtons(col);
      else {
        button(col, "跳過這步", "secondary tut-skip", () => this.skip());
        const x = button(col, "離開教學", "secondary tut-x", () => this.askLeave());
        x.prepend(icon("close"));
      }
    } else if (this.finished) {
      const col = el("div", card, "tut-btns row");
      finishButtons(col);
    }
  }

  /** 帶我去看: the camera to the target. */
  private goSee(): void {
    const at = this.offCell;
    if (at === null) return;
    this.game.camera?.centerOn(at.x * TILE_PX, at.y * TILE_PX);
  }

  private shapeOf(spec: TargetSpec): Shape | null {
    if (spec === null) return null;
    if ("el" in spec) return spec.el === null ? null : { box: this.boxOf(spec.el), round: false };
    if ("units" in spec) {
      const pts = spec.units.map((u) => this.w.spot(u.x, u.y, 0.5)).filter((s): s is Spot => s !== null);
      if (pts.length === 0) return null;
      // Room round them to start a box on open ground.
      const x0 = Math.min(...pts.map((p) => p.cx)) - 44;
      const y0 = Math.min(...pts.map((p) => p.cy)) - 56;
      const x1 = Math.max(...pts.map((p) => p.cx)) + 44;
      const y1 = Math.max(...pts.map((p) => p.cy)) + 30;
      return { box: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, round: false };
    }
    const s = this.w.spot(spec.cell.x, spec.cell.y, spec.cell.r);
    return s === null ? null : { box: { x: s.cx - s.rx, y: s.cy - s.ry, w: 2 * s.rx, h: 2 * s.ry }, round: true };
  }

  private drawLayer(c: StepCtx): void {
    const layer = this.layer;
    const done = this.doneAt !== null || this.finished;
    const spec = done || this.confirm !== null ? null : this.phase.target(c);
    let shape = this.shapeOf(spec);
    const W = innerWidth;
    const H = innerHeight;
    // Off the screen (a place on the battlefield): a tag at the edge instead of a frame, and 帶我去看.
    this.offScreen = null;
    this.offCell = null;
    this.targetLabel = spec !== null && "label" in spec ? (spec.label ?? null) : null;
    if (shape !== null && spec !== null && !("el" in spec)) {
      const cx = shape.box.x + shape.box.w / 2;
      const cy = shape.box.y + shape.box.h / 2;
      if (cx < 0 || cx > W || cy < 0 || cy > H) {
        this.offScreen = { x: cx, y: cy };
        this.offCell = "cell" in spec ? { x: spec.cell.x, y: spec.cell.y } : { x: spec.units.reduce((a, u) => a + u.x, 0) / spec.units.length, y: spec.units.reduce((a, u) => a + u.y, 0) / spec.units.length };
        shape = null;
        if (this.focus) {
          this.focus = false;
          this.goSee();
          return;
        }
      }
    }
    // A target on the battlefield gone under the card or a button (a villager walking): after a moment the camera
    // brings it back where a tap reaches it, unless the player is moving the camera.
    if (shape !== null && spec !== null && !("el" in spec) && this.phase.block && !this.focus) {
      const now = performance.now();
      if (this.clearAt(shape.box.x + shape.box.w / 2, shape.box.y + shape.box.h / 2)) this.unclearSince = null;
      else if (this.unclearSince === null) this.unclearSince = now;
      else if (now - this.unclearSince > 1500 && now - this.lastPan > 2000) {
        this.unclearSince = null;
        this.focus = true;
      }
    }
    if (shape !== null && this.focus && spec !== null && !("el" in spec)) {
      // A step near home began: its target in the middle of the battlefield, a little low (the card is above).
      this.focus = false;
      const cx = shape.box.x + shape.box.w / 2;
      const cy = shape.box.y + shape.box.h / 2;
      const cam = this.game.camera;
      if (cam !== null && (Math.abs(cx - W / 2) > W * 0.25 || cy < H * 0.45 || cy > H * 0.8 || !this.clearAt(cx, cy))) {
        const at = "cell" in spec ? { x: spec.cell.x, y: spec.cell.y } : { x: spec.units.reduce((a, u) => a + u.x, 0) / spec.units.length, y: spec.units.reduce((a, u) => a + u.y, 0) / spec.units.length };
        const w = cam.screenToWorld(W / 2, H / 2 - 30);
        const t = cam.screenToWorld(W / 2, H / 2);
        cam.centerOn(at.x * TILE_PX + (w.x - t.x), at.y * TILE_PX + (w.y - t.y));
        return;
      }
    }
    if (shape !== null) this.focus = false;
    this.target = shape;
    const flash = performance.now() < this.flashUntil;
    const key = JSON.stringify([shape, this.offScreen === null ? null : [Math.round(this.offScreen.x), Math.round(this.offScreen.y)], flash, this.phase.gesture, done, W, H]);
    if (layer.dataset.key === key && this.phase.keep === undefined) return;
    layer.dataset.key = key;
    layer.replaceChildren();
    if (shape !== null) {
      // A: the rest dimmed, a hole for the target and for what must stay readable (the game's prompt, 進駐's tags).
      const holes: Shape[] = [shape];
      for (const s of this.phase.keep ?? []) for (const e of this.root.querySelectorAll(s)) if (visible(e)) holes.push({ box: this.boxOf(e), round: false });
      const NS = "http://www.w3.org/2000/svg";
      const svg = document.createElementNS(NS, "svg");
      svg.setAttribute("class", "tut-dim");
      // Drawn in the screen's points, as big as the interface's own lengths (÷ its zoom, R26-01).
      const z = uiZoom();
      svg.setAttribute("width", `${W / z}`);
      svg.setAttribute("height", `${H / z}`);
      svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
      const id = "tut-mask";
      const defs = document.createElementNS(NS, "defs");
      const mask = document.createElementNS(NS, "mask");
      mask.setAttribute("id", id);
      const all = document.createElementNS(NS, "rect");
      all.setAttribute("width", "100%");
      all.setAttribute("height", "100%");
      all.setAttribute("fill", "#fff");
      mask.append(all);
      for (const h of holes) {
        const pad = 4;
        if (h.round) {
          const e = document.createElementNS(NS, "ellipse");
          e.setAttribute("cx", `${h.box.x + h.box.w / 2}`);
          e.setAttribute("cy", `${h.box.y + h.box.h / 2}`);
          e.setAttribute("rx", `${h.box.w / 2 + pad}`);
          e.setAttribute("ry", `${h.box.h / 2 + pad}`);
          e.setAttribute("fill", "#000");
          mask.append(e);
        } else {
          const r = document.createElementNS(NS, "rect");
          r.setAttribute("x", `${h.box.x - pad}`);
          r.setAttribute("y", `${h.box.y - pad}`);
          r.setAttribute("width", `${h.box.w + 2 * pad}`);
          r.setAttribute("height", `${h.box.h + 2 * pad}`);
          r.setAttribute("rx", "10");
          r.setAttribute("fill", "#000");
          mask.append(r);
        }
      }
      defs.append(mask);
      svg.append(defs);
      const shade = document.createElementNS(NS, "rect");
      shade.setAttribute("width", "100%");
      shade.setAttribute("height", "100%");
      shade.setAttribute("class", "tut-shade");
      shade.setAttribute("mask", `url(#${id})`);
      svg.append(shade);
      layer.append(svg);
      const ring = el("div", layer, `tut-ring${shape.round ? " round" : ""}${flash ? " flash" : ""}`);
      const pad = 4;
      Object.assign(ring.style, { left: `${(shape.box.x - pad) / z}px`, top: `${(shape.box.y - pad) / z}px`, width: `${(shape.box.w + 2 * pad) / z}px`, height: `${(shape.box.h + 2 * pad) / z}px` });
    }
    if (this.offScreen !== null) this.drawEdge(layer, this.offScreen, this.targetLabel ?? "");
    if (!done && this.phase.gesture === "drag-pinch" && !(this.flags.panned && this.flags.pinched)) this.drawHand(layer, "drag-pinch", null);
    if (!done && this.phase.gesture === "press-box" && shape !== null) this.drawHand(layer, "press-box", shape.box);
  }

  /** The gold tag at the edge of the battlefield, pointing at a place off the screen (R25 共用元件). */
  private drawEdge(layer: HTMLElement, at: { x: number; y: number }, label: string): void {
    const W = innerWidth;
    const H = innerHeight;
    const cx = W / 2;
    const cy = H / 2;
    const ang = Math.atan2(at.y - cy, at.x - cx);
    // Kept off the buttons' columns: under the card, left of 編隊, over the bar.
    const m = { l: 150, r: W - 250, t: 170, b: H - 110 };
    const t = Math.min(Math.abs(((Math.cos(ang) < 0 ? m.l : m.r) - cx) / (Math.cos(ang) || 1e-6)), Math.abs(((Math.sin(ang) < 0 ? m.t : m.b) - cy) / (Math.sin(ang) || 1e-6)));
    const x = cx + Math.cos(ang) * t;
    const y = cy + Math.sin(ang) * t;
    const tag = el("div", layer, "tut-edge");
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.style.transform = `rotate(${(ang * 180) / Math.PI}deg)`;
    const p = document.createElementNS(NS, "path");
    p.setAttribute("d", "M3 6l18 6-18 6 4-6z");
    svg.append(p);
    tag.append(svg, label);
    Object.assign(tag.style, { left: `${x / uiZoom() - 60}px`, top: `${y / uiZoom() - 20}px` });
  }

  /** A finger: drag and pinch (step 1), or a long press then a box (step 5). */
  private drawHand(layer: HTMLElement, kind: "drag-pinch" | "press-box", box: Box | null): void {
    const W = innerWidth;
    const H = innerHeight;
    const tip = (x: number, y: number) => `<circle cx="${x}" cy="${y}" r="13" class="tip"/><circle cx="${x}" cy="${y}" r="20" class="tip-ring"/>`;
    const line = (x1: number, y1: number, x2: number, y2: number) => `<path d="M${x1} ${y1}L${x2} ${y2}" class="trail" marker-end="url(#tut-head)"/>`;
    let g = `<defs><marker id="tut-head" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L10 5L0 10z" fill="#fff"/></marker></defs>`;
    if (kind === "drag-pinch") {
      const a = { x: W * 0.22, y: H * 0.62 };
      if (!this.flags.panned) g += line(a.x, a.y, a.x + 90, a.y - 50) + tip(a.x, a.y);
      if (!this.flags.pinched) {
        const p = { x: W * 0.4, y: H * 0.58 };
        const d = 34;
        g += line(p.x - 8, p.y + 8, p.x - d - 26, p.y + d + 6) + line(p.x + 8, p.y - 8, p.x + d + 26, p.y - d - 6);
        g += tip(p.x - 10, p.y + 10) + tip(p.x + 10, p.y - 10);
      }
    } else if (box !== null) {
      g += `<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" class="box"/>`;
      g += line(box.x + 10, box.y + 10, box.x + box.w - 6, box.y + box.h - 6) + tip(box.x, box.y);
      g += `<text x="${box.x + 24}" y="${box.y - 12}" class="say">按住不動一下再拖</text>`;
    }
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "tut-hand");
    svg.setAttribute("width", `${W / uiZoom()}`);
    svg.setAttribute("height", `${H / uiZoom()}`);
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.innerHTML = g;
    layer.append(svg);
  }

  // --- leaving --------------------------------------------------------------------------------------

  /** ✕: 離開新手教學？ (R25 共用元件), nothing kept. */
  private askLeave(): void {
    if (this.confirm !== null) return;
    const wrap = el("div", this.root, "tut-confirm");
    const card = el("div", wrap, "panel dialog-card");
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-label", "離開新手教學？");
    el("h2", card, "", "離開新手教學？");
    const p = el("p", card);
    p.append("教學做到哪裡不會存，下次從第一步開始。", document.createElement("br"), "可以在開局畫面或「設定」再打開。");
    const row = el("div", card, "dialog-buttons");
    const leave = el("button", row, "b secondary", "離開");
    leave.type = "button";
    leave.addEventListener("click", () => this.host.leave());
    const stay = el("button", row, "b pri", "繼續教學");
    stay.type = "button";
    stay.addEventListener("click", () => {
      wrap.remove();
      this.confirm = null;
      this.cardKey = "";
    });
    this.confirm = wrap;
  }
}
