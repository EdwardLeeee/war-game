// One game on screen: the simulation port, what the screen knows (view), the camera, the
// PixiJS world, and the gestures that turn into selections and commands. The only way
// anything reaches the simulation is `command()`, which posts a protocol command.

import type { Application } from "pixi.js";
import { Camera } from "../camera/camera.ts";
import { type GestureHost, GestureRecognizer, type LongPressResult } from "../input/gestures.ts";
import {
  boxSelect,
  type Intent,
  type Pick,
  longPressKind,
  type Mode,
  retreatHome,
  tapIntents,
  type WheelItem,
  wheelIntents,
  wheelItems,
} from "../input/intent.ts";
import { attachPointer } from "../input/pointer.ts";
import { type CheckResult, loadExpected, runCheck } from "../lab/determinism.ts";
import { LabPanel } from "../lab/panel.ts";
import { SPEED_TPS } from "../params.ts";
import { atlasFor } from "../render/atlas.ts";
import { WorldRenderer } from "../render/world.ts";
import {
  BuildingField,
  type BuildingType,
  type CommandBody,
  type FromWorker,
  HeaderField as H,
  NEUTRAL,
  NO_OWNER,
  NodeField,
  PROTOCOL_VERSION,
  type ScenarioName,
  Stance,
  UNIT_STRIDE,
  UnitField,
  UnitType,
} from "../sim.ts";
import { HIT_RADIUS_PT, START_ZOOM, TILE_PX, UNIT_CORE_HIT_PT } from "../tuning.ts";
import { BUILDING_NAME, NODE_NAME, UNIT_NAME } from "../ui/hud/names.ts";
import { Controls, nextSpeed, type SpeedName } from "../ui/controls.ts";
import { Hud, type HudLifecycle } from "../ui/hud/hud.ts";
import { type PromptButton, Overlays, REPAIR_LOCKED_TEXT, rejectText } from "../ui/overlays.ts";
import { Placement } from "../ui/placement.ts";
import { type SplitUnit, splitPick } from "../input/split.ts";
import { GameView } from "../view/view.ts";
import type { SimPort } from "./port.ts";

export interface GameOptions {
  seed: number;
  scenario: ScenarioName;
  tps: number;
  /** The port is the fake world (mock/), not the simulation. */
  fake: boolean;
  env: () => Record<string, unknown>;
  /** A fresh simulation Worker for the determinism check, or null (the fake world has none). */
  checkPort: (() => SimPort) | null;
  /** 重來 and 回開局畫面 (the page owns games). */
  life: HudLifecycle;
}

const MODE_PROMPT: Record<Exclude<Mode, "normal">, string> = {
  retreat: "點地面或小地圖選撤退位置",
  cast: "點地面選晶砲落點",
  rally: "點地面設集結點",
};

export class Game implements GestureHost {
  view: GameView | null = null;
  camera: Camera | null = null;
  mode: Mode = "normal";
  placement: Placement | null = null;
  /** Commands posted, newest last (the test hook reads them). */
  readonly sent: (CommandBody & { seq: number })[] = [];
  readonly lab: LabPanel;
  paused = false;
  speed: SpeedName = "normal";
  /** Ticks per second the simulation runs at (the chosen speed, or `?tps=` on test pages). */
  tps: number;
  /** The last 分出 N 名: the units split off and the ones left behind (for 改選其餘). */
  lastSplit: { picked: number[]; rest: number[] } | null = null;
  /** The last determinism check's result (the test hook reads it). */
  lastCheck: CheckResult | null = null;
  readonly hud: Hud;
  private readonly controls: Controls;
  private readonly hudRoot: HTMLElement;
  private readonly cleanups: (() => void)[] = [];
  private readonly tick = () => this.frame();
  private readonly app: Application;
  private readonly port: SimPort;
  private readonly overlays: Overlays;
  private readonly options: GameOptions;
  private readonly recognizer: GestureRecognizer;
  private renderer: WorldRenderer | null = null;
  private seq = 1;
  private lastFrame = performance.now();
  private readyWaiters: (() => void)[] = [];

  constructor(app: Application, port: SimPort, hud: HTMLElement, options: GameOptions) {
    this.app = app;
    this.port = port;
    this.options = options;
    this.tps = options.tps;
    this.hudRoot = hud;
    this.overlays = new Overlays(hud);
    this.controls = new Controls(hud, { togglePause: () => (this.paused ? this.resume() : this.pause()), cycleSpeed: () => this.setSpeed(nextSpeed(this.speed)) });
    const checkPort = options.checkPort;
    // The lab opens from the menu (選單 → 量測與確定性檢查).
    this.lab = new LabPanel(
      hud,
      {
        env: options.env,
        check: checkPort === null ? null : () => this.determinism(checkPort),
        fake: () => options.fake,
        // Measure "every system running" (brief): the perf scenario, in a game of its own.
        requestMeasure: options.fake || options.scenario === "perf" ? undefined : () => options.life.perf(),
      },
      null,
    );
    this.hud = new Hud(hud, this, this.controls.bar, options.life);
    this.recognizer = new GestureRecognizer(this);
    port.onmessage = (e) => this.receive(e.data);
    this.cleanups.push(
      attachPointer(app.canvas, this.recognizer, () => {
        const was = this.camera?.flinging ?? false;
        this.camera?.stop();
        return was;
      }),
    );
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const cam = this.camera;
      if (cam === null) return;
      cam.zoomAt(e.offsetX, e.offsetY, cam.scale * Math.exp(-e.deltaY * 0.0015));
    };
    app.canvas.addEventListener("wheel", wheel, { passive: false });
    this.cleanups.push(() => app.canvas.removeEventListener("wheel", wheel));
    app.ticker.add(this.tick);
    // GDD §11 (ceo 2026-09-30): going to the background or turning the phone upright pauses
    // the game; coming back leaves it paused until the player presses 繼續.
    const hidden = () => {
      if (!document.hidden) return;
      this.lab.lab.spoil("量測期間頁面切到背景");
      this.pause();
    };
    document.addEventListener("visibilitychange", hidden);
    this.cleanups.push(() => document.removeEventListener("visibilitychange", hidden));
    const portrait = window.matchMedia("(orientation: portrait)");
    const upright = () => {
      if (portrait.matches) this.pause();
    };
    portrait.addEventListener("change", upright);
    this.cleanups.push(() => portrait.removeEventListener("change", upright));
  }

  /** End this game: stop its Worker and take its drawing, listeners and interface away. */
  destroy(): void {
    this.port.onmessage = null;
    this.port.terminate();
    for (const c of this.cleanups) c();
    this.app.ticker.remove(this.tick);
    this.renderer?.destroy();
    this.renderer = null;
    this.hud.destroy();
    this.hudRoot.replaceChildren();
  }

  /** Point the camera at the fighting: the soldiers on screen or in sight, a little zoomed out (量測 perf). */
  focusBattle(): void {
    const view = this.view;
    const u = view?.curr?.snap.units;
    const cam = this.camera;
    if (view === null || u === undefined || cam === null) return;
    let x = 0;
    let y = 0;
    let n = 0;
    for (let o = 0; o < u.length; o += UNIT_STRIDE) {
      const t = u[o + UnitField.type];
      if (t !== UnitType.Spearman && t !== UnitType.Ranged && t !== UnitType.Mage) continue;
      const p = view.unitPos(o);
      x += p.x;
      y += p.y;
      n++;
    }
    if (n === 0) return;
    cam.zoomAt(0, 0, 0.75);
    cam.centerOn(x / n, y / n);
  }

  /** The port, for the test hook (it can feed events to the fake world). */
  get portForTest(): SimPort {
    return this.port;
  }

  toast(text: string): void {
    this.overlays.toast(text);
  }

  /** Minimap tap (GDD §10): jump there; in 撤退／晶砲／集結點 mode, pick that spot. */
  minimapTap(cx: number, cy: number): void {
    const view = this.view;
    if (view === null) return;
    const wx = (cx + 0.5) * TILE_PX;
    const wy = (cy + 0.5) * TILE_PX;
    if (this.mode !== "normal") {
      this.apply(tapIntents(view, view.selection, this.mode, wx, wy, 1, this.hitRadius()));
      return;
    }
    this.camera?.centerOn(wx, wy);
  }

  /** Minimap long press with units selected (GDD §10): they advance there. */
  minimapLongPress(cx: number, cy: number): void {
    const units = this.view?.selection.units ?? [];
    if (units.length === 0) {
      this.toast("先選部隊，再長按小地圖");
      return;
    }
    this.apply([{ kind: "command", cmd: { c: "move", u: units, x: cx, y: cy } }]);
  }

  pause(): void {
    if (this.paused) return;
    this.paused = true;
    this.port.postMessage({ type: "pause" });
    this.controls.setPaused(true);
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.port.postMessage({ type: "resume" });
    this.controls.setPaused(false);
  }

  setSpeed(s: SpeedName): void {
    this.speed = s;
    this.tps = SPEED_TPS[s];
    this.port.postMessage({ type: "speed", tps: this.tps });
    this.controls.setSpeed(s);
  }

  /** 確定性檢查: a separate Worker replays CI's AI-vs-AI game; every hash is compared. */
  private async determinism(makePort: () => SimPort): Promise<void> {
    const log = (line: string) => this.lab.log.add(line);
    const expected = await loadExpected();
    log(expected === null ? "沒有 CI 對照檔，只列出雜湊" : `對照 CI：${expected.scenario}、種子 ${expected.seed}、最多 ${expected.maxTicks} tick`);
    const r = await runCheck(makePort(), expected, (p) => {
      if (p.tick % 6000 === 0) log(`… tick ${p.tick} ${p.hash}`);
    });
    this.lastCheck = r;
    const verdict = r.same === null ? "沒有對照檔" : r.same ? `✓ 與 CI 相同（比對 ${r.compared} 個）` : `✗ 與 CI 不同（${r.mismatches} 處，第一處在 tick ${r.firstMismatchTick}）`;
    log(`確定性檢查 ${r.ticks} tick、${Math.round(r.totalMs)} ms、最終 ${r.finalHash}：${verdict}`);
    this.lab.showCheck(r);
  }

  start(): void {
    this.port.postMessage({
      type: "init",
      protocol: PROTOCOL_VERSION,
      seed: this.options.seed,
      human: 0,
      ai: [false, true],
      tps: this.options.tps,
      scenario: this.options.scenario,
    });
  }

  /** Resolves once the first snapshot has been drawn. */
  whenReady(): Promise<void> {
    return new Promise((resolve) => {
      if (this.renderer !== null && this.view?.curr !== null) resolve();
      else this.readyWaiters.push(resolve);
    });
  }

  command(cmd: CommandBody): void {
    const withSeq = { ...cmd, seq: this.seq++ };
    this.sent.push(withSeq);
    if (this.sent.length > 200) this.sent.shift();
    this.port.postMessage({ type: "command", cmd: withSeq });
  }

  private receive(msg: FromWorker): void {
    switch (msg.type) {
      case "ready": {
        this.view = new GameView(msg.player ?? 0, msg.map, msg.rules);
        const world = msg.map.size * TILE_PX;
        this.camera = new Camera(world, world);
        this.camera.resize(this.app.screen.width, this.app.screen.height);
        this.camera.zoomAt(0, 0, START_ZOOM);
        const home = msg.map.spawns.find((s) => s.player === this.view?.me);
        if (home !== undefined) this.camera.centerOn((home.cellX + 0.5) * TILE_PX, (home.cellY + 0.5) * TILE_PX);
        const cam = this.camera;
        this.view.onScreen = (wx, wy) => {
          const v = cam.visible();
          return wx >= v.x0 && wx <= v.x1 && wy >= v.y0 && wy <= v.y1;
        };
        this.renderer = new WorldRenderer(this.app, this.view, atlasFor(this.app.renderer));
        const resize = (w: number, h: number) => cam.resize(w, h);
        this.app.renderer.on("resize", resize);
        this.cleanups.push(() => this.app.renderer.off("resize", resize));
        this.lab.log.add(`ready seed ${this.options.seed} ${JSON.stringify(this.options.env())}`);
        break;
      }
      case "snapshot": {
        const view = this.view;
        if (view === null) return;
        const now = performance.now();
        view.push(msg, now);
        this.lab.snapshot(msg.header, now);
        for (const ev of msg.events) {
          if (ev.k === "rejected") {
            const cmd = this.sent.find((c) => c.seq === ev.seq);
            this.overlays.toast(rejectText(ev.reason, cmd));
          } else {
            this.hud.onEvent(ev);
          }
        }
        if (this.placement !== null) {
          this.placement.revalidate(view.placement);
          this.showPlaceButtons();
        }
        break;
      }
      case "error":
        this.lab.log.add(`error ${msg.message}`);
        this.overlays.toast(`模擬回報錯誤：${msg.message}`);
        break;
      case "game_over":
        this.lab.log.add(`game_over winner ${msg.winner} reason ${msg.reason} tick ${msg.stats.ticks}`);
        this.hud.showResult(msg.winner, msg.reason, msg.stats);
        break;
      default:
        break;
    }
  }

  private frame(): void {
    const now = performance.now();
    const dt = now - this.lastFrame;
    this.lastFrame = now;
    this.recognizer.update(now);
    const cam = this.camera;
    const view = this.view;
    if (cam === null || view === null || this.renderer === null) return;
    cam.update(dt);
    this.renderer.draw(now, cam, this.placement);
    this.hud.frame(now);
    // ✓ and ✗ follow the preview on screen while the camera pinches or flings (a few style writes).
    if (this.placement?.phase === "confirm") this.showPlaceButtons();
    const header = view.header;
    this.lab.frame(now, dt, {
      hidden: document.hidden,
      paused: header !== null && header[H.paused] === 1,
      normalSpeed: header === null || header[H.speed] === SPEED_TPS.normal * 100,
    });
    if (view.curr !== null && this.readyWaiters.length > 0) {
      for (const r of this.readyWaiters.splice(0)) r();
    }
  }

  // --- gestures -----------------------------------------------------------------------

  private hitRadius(): number {
    return HIT_RADIUS_PT / (this.camera?.scale ?? 1);
  }

  private world(sx: number, sy: number): { x: number; y: number } {
    return this.camera?.screenToWorld(sx, sy) ?? { x: 0, y: 0 };
  }

  tap(x: number, y: number, count: 1 | 2): void {
    const view = this.view;
    if (view === null) return;
    const w = this.world(x, y);
    if (this.placement !== null) {
      this.placement.moveTo(w.x, w.y, view.placement);
      this.placement.release();
      this.showPlaceButtons();
      return;
    }
    this.apply(tapIntents(view, view.selection, this.mode, w.x, w.y, count, this.hitRadius(), UNIT_CORE_HIT_PT / (this.camera?.scale ?? 1)));
  }

  longPress(x: number, y: number): LongPressResult {
    const view = this.view;
    if (view === null || this.placement !== null) return "none";
    const w = this.world(x, y);
    const kind = longPressKind(view, w.x, w.y, this.hitRadius());
    if (kind === "wheel") {
      const pick = view.pick(w.x, w.y, this.hitRadius());
      if (pick === null) return "none";
      if (!view.selection.units.includes(pick.id)) this.apply([{ kind: "select", units: [pick.id] }]);
      this.openWheel(x, y, pick.type);
    }
    return kind;
  }

  pressCue(x: number, y: number, on: boolean): void {
    this.overlays.showCue(x, y, on);
  }

  panStart(x: number, y: number): void {
    if (this.placement !== null) this.moveGhost(x, y);
  }

  pan(dx: number, dy: number, x: number, y: number): void {
    if (this.placement !== null) this.moveGhost(x, y);
    else this.camera?.panBy(dx, dy);
  }

  panEnd(vx: number, vy: number): void {
    if (this.placement !== null) {
      this.placement.release();
      this.showPlaceButtons();
    } else {
      this.camera?.fling(vx, vy);
    }
  }

  box(x0: number, y0: number, x1: number, y1: number, phase: "start" | "move" | "end" | "cancel"): void {
    if (phase === "cancel") {
      this.overlays.hideBox();
      return;
    }
    this.overlays.showBox(x0, y0, x1, y1);
    if (phase !== "end") return;
    this.overlays.hideBox();
    const view = this.view;
    if (view === null) return;
    const a = this.world(x0, y0);
    const b = this.world(x1, y1);
    this.apply([{ kind: "select", units: boxSelect(view, a.x, a.y, b.x, b.y) }]);
  }

  pinchStart(): void {
    this.camera?.stop();
  }

  pinch(cx: number, cy: number, factor: number, dx: number, dy: number): void {
    const cam = this.camera;
    if (cam === null) return;
    cam.panBy(dx, dy);
    cam.zoomAt(cx, cy, cam.scale * factor);
  }

  pinchEnd(): void {}

  // --- intents, modes, wheel, placement --------------------------------------------

  apply(intents: Intent[]): void {
    const view = this.view;
    if (view === null) return;
    for (const it of intents) {
      switch (it.kind) {
        case "select":
          view.selection = { units: it.units, building: null };
          view.inspected = null;
          break;
        case "selectBuilding":
          view.selection = { units: [], building: it.id };
          view.inspected = null;
          break;
        case "inspect":
          view.inspected = it.pick;
          this.overlays.toast(this.describe(it.pick));
          break;
        case "clear":
          view.selection = { units: [], building: null };
          view.inspected = null;
          break;
        case "command":
          this.command(it.cmd);
          this.markCommand(it.cmd);
          if (it.cmd.c === "repair" && view.buildingRepairLocked(it.cmd.building)) this.overlays.toast(REPAIR_LOCKED_TEXT);
          break;
        case "endMode":
          this.setMode("normal");
          break;
      }
    }
  }

  /** What a tapped thing is, for the message line (nothing of yours was selected). */
  private describe(p: Pick): string {
    const view = this.view;
    if (view === null) return "";
    const whose = p.owner === view.me ? "我方" : p.owner === NEUTRAL ? "中立" : p.owner === NO_OWNER ? "" : "敵方";
    switch (p.kind) {
      case "node": {
        const row = view.nodes.get(p.id);
        const res = ["木", "金", "糧", "魔晶"][p.type] ?? "";
        return `${NODE_NAME[p.type] ?? "資源"}（${res}）剩 ${row?.[NodeField.amount] ?? "?"}：先選農民再點它，就會去採`;
      }
      case "unit":
        return `${whose}${UNIT_NAME[p.type] ?? "單位"}`;
      case "building":
        return `${whose}${BUILDING_NAME[p.type] ?? "建築"}`;
      case "town":
        return `${p.type === 1 ? "大城" : "小鎮"}${whose === "" ? "" : `（${whose}）`}`;
    }
  }

  /** Flash a ring where an order goes, so the player sees it was sent. */
  private markCommand(cmd: CommandBody): void {
    const view = this.view;
    const r = this.renderer;
    if (view === null || r === null) return;
    const now = performance.now();
    const cell = (x: number, y: number) => ({ x: (x + 0.5) * TILE_PX, y: (y + 0.5) * TILE_PX });
    let at: { x: number; y: number } | null = null;
    let color = 0xffffff;
    switch (cmd.c) {
      case "move":
        at = cell(cmd.x, cmd.y);
        break;
      case "retreat":
        at = cell(cmd.x, cmd.y);
        color = 0x9cc4ff;
        break;
      case "rally":
        at = cell(cmd.x, cmd.y);
        color = 0xfff3b0;
        break;
      case "gather": {
        const row = view.nodes.get(cmd.node);
        if (row !== undefined) at = cell(row[NodeField.cellX], row[NodeField.cellY]);
        color = 0xf2c230;
        break;
      }
      case "attack": {
        const o = view.unitRow(cmd.target);
        if (o >= 0) at = view.unitPos(o);
        else at = this.buildingCentre(cmd.target);
        color = 0xff5a4f;
        break;
      }
      case "repair":
        at = this.buildingCentre(cmd.building);
        color = 0x4fd06a;
        break;
      case "cast":
        at = { x: (cmd.fx * TILE_PX) / 1024, y: (cmd.fy * TILE_PX) / 1024 };
        color = 0xff8a2a;
        break;
      default:
        break;
    }
    if (at !== null) r.mark(at.x, at.y, color, now);
  }

  private buildingCentre(id: number): { x: number; y: number } | null {
    const view = this.view;
    const o = view?.buildingRow(id) ?? -1;
    const b = view?.curr?.snap.buildings;
    if (view === null || o < 0 || b === undefined) return null;
    const s = view.rules.buildings[b[o + BuildingField.type]]?.size ?? 1;
    return { x: (b[o + BuildingField.cellX] + s / 2) * TILE_PX, y: (b[o + BuildingField.cellY] + s / 2) * TILE_PX };
  }

  setMode(mode: Mode): void {
    this.mode = mode;
    if (mode === "normal") {
      this.overlays.hidePrompt();
      return;
    }
    const buttons: PromptButton[] = [];
    if (mode === "retreat") {
      buttons.push({ label: "退回主城", primary: true, onTap: () => this.apply(retreatHome(this.view?.selection ?? { units: [], building: null }, this.view?.homeCell() ?? null)) });
    }
    buttons.push({ label: "取消", onTap: () => this.setMode("normal") });
    this.overlays.showPrompt(MODE_PROMPT[mode], buttons);
  }

  private openWheel(x: number, y: number, pressedType: number): void {
    const view = this.view;
    if (view === null) return;
    const items = wheelItems(pressedType);
    const mages = view.selection.units.filter((id) => view.unitType(id) === UnitType.Mage);
    const autocastOn = mages.length > 0 && mages.every((id) => view.unitAutocast(id));
    const anyAggressive = view.selection.units.some((id) => view.unitStance(id) === Stance.Aggressive);
    const label: Record<WheelItem, string> = {
      cast: "晶砲",
      autocast: autocastOn ? "自動施放：開" : "自動施放：關",
      retreat: "撤退",
      stance: anyAggressive ? "改成堅守" : "改成積極",
    };
    this.overlays.openWheel(
      x,
      y,
      items.map((id) => ({ id, label: label[id] })),
      (id) => {
        const r = wheelIntents(view, view.selection, id as WheelItem);
        this.apply(r.intents);
        if (r.mode !== null) this.setMode(r.mode);
      },
    );
  }

  wheelItems(): string[] | null {
    return this.overlays.wheelItems;
  }

  /**
   * 重設 (D-024, GDD §10): back to nothing selected, no mode, no building preview, no skill
   * wheel and no open panel. The result screen stays (it holds 重來), and so does the lab
   * panel while it measures or checks.
   */
  reset(): void {
    this.setMode("normal");
    if (this.placement !== null) this.endPlacement();
    this.overlays.closeWheel();
    this.apply([{ kind: "clear" }]);
    this.hud.closePanels();
    if (!this.lab.busy) this.lab.hide();
  }

  /** 分出 N 名: select n of the selected units (the rule is in input/split.ts) and remember the rest. */
  splitSelection(n: number): void {
    const view = this.view;
    if (view === null) return;
    const units: SplitUnit[] = [];
    for (const id of view.selection.units) {
      const o = view.unitRow(id);
      if (o < 0) continue;
      const p = view.unitPos(o);
      units.push({ id, type: view.unitType(id), x: p.x, y: p.y });
    }
    const picked = splitPick(units, n);
    if (picked.length === 0) return;
    const rest = units.map((u) => u.id).filter((id) => !picked.includes(id));
    this.apply([{ kind: "select", units: picked }]);
    this.lastSplit = { picked, rest };
    this.toast(`分出 ${picked.length} 名：長按右側 1–4 存成編隊`);
  }

  /** 改選其餘 M 名 after 分出 N 名: the units left behind that are still alive. */
  selectRest(): void {
    const view = this.view;
    const split = this.lastSplit;
    if (view === null || split === null) return;
    const rest = split.rest.filter((id) => view.unitRow(id) >= 0);
    this.lastSplit = null;
    if (rest.length === 0) {
      this.toast("其餘的單位都不在了");
      return;
    }
    this.apply([{ kind: "select", units: rest }]);
  }

  /** Start placing a building with the selected farmers (the command area calls this). */
  startPlacement(type: BuildingType): void {
    const view = this.view;
    const cam = this.camera;
    if (view === null || cam === null) return;
    const info = view.rules.buildings[type];
    if (info === undefined) return;
    const builders = view.selection.units.filter((id) => view.unitType(id) === UnitType.Farmer);
    this.setMode("normal");
    this.placement = new Placement(info, builders);
    const c = cam.screenToWorld(cam.width / 2, cam.height / 2);
    this.placement.moveTo(c.x, c.y, view.placement);
    this.overlays.showPrompt("拖曳預覽到想蓋的位置，放開後按 ✓ 或 ✗", []);
  }

  private moveGhost(x: number, y: number): void {
    const w = this.world(x, y);
    this.placement?.moveTo(w.x, w.y, this.view?.placement ?? null);
    this.overlays.hidePlace();
  }

  private showPlaceButtons(): void {
    const p = this.placement;
    const cam = this.camera;
    if (p === null || cam === null || p.phase !== "confirm") return;
    const r = p.rect();
    const tl = cam.worldToScreen(r.x, r.y);
    // Keep ✓ and ✗ off the interface panels (the preview can be dragged under any of them).
    const avoid = [...this.hudRoot.querySelectorAll<HTMLElement>(".top-right, .res-bar, .side-left, .side-right, .minimap, .sel-info, .cmds, .prompt")]
      .filter((e) => !e.hidden && e.offsetParent !== null)
      .map((e) => e.getBoundingClientRect());
    this.overlays.showPlace(
      { x: tl.x, y: tl.y, w: r.w * cam.scale, h: r.h * cam.scale },
      p.valid && p.builders.length > 0,
      () => this.confirmPlacement(),
      () => this.endPlacement(),
      avoid,
    );
  }

  private confirmPlacement(): void {
    const cmd = this.placement?.confirm() ?? null;
    if (cmd === null) {
      this.overlays.toast(this.placement?.builders.length === 0 ? "先選農民再蓋" : "這裡不能蓋");
      return;
    }
    this.command(cmd);
    this.endPlacement();
  }

  private endPlacement(): void {
    this.placement = null;
    this.overlays.hidePlace();
    this.overlays.hidePrompt();
  }
}
