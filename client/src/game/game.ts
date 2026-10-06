// One game on screen: the simulation port, what the screen knows (view), the camera, the
// PixiJS world, and the gestures that turn into selections and commands. The only way
// anything reaches the simulation is `command()`, which posts a protocol command.

import type { Application } from "pixi.js";
import { Camera } from "../camera/camera.ts";
import { type GestureHost, GestureRecognizer, type LongPressResult } from "../input/gestures.ts";
import {
  boxSelect,
  holdIntents,
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
  Action,
  type AiDifficulty,
  BUILDING_STRIDE,
  BuildingField,
  BuildingType,
  CELL,
  type CommandBody,
  type FromWorker,
  type GameOverReason,
  HeaderField as H,
  NEUTRAL,
  NO_OWNER,
  NodeField,
  Order,
  PROTOCOL_VERSION,
  Resource,
  type ScenarioName,
  Stance,
  TOWN_STRIDE,
  type TownChoice,
  TownField,
  TownSize,
  TownState,
  type ToWorker,
  UNIT_STRIDE,
  UnitField,
  UnitFlag,
  UnitType,
} from "../sim.ts";
import { HIT_RADIUS_PT, START_ZOOM, TILE_PX, UNIT_CORE_HIT_PT } from "../tuning.ts";
import { BUILDING_NAME, NODE_NAME, UNIT_NAME } from "../ui/hud/names.ts";
import { Controls, nextSpeed, type SpeedName } from "../ui/controls.ts";
import { Hud, type HudLifecycle } from "../ui/hud/hud.ts";
import { type PromptButton, Overlays, REPAIR_LOCKED_TEXT, rejectText } from "../ui/overlays.ts";
import { Placement, towerLandOk } from "../ui/placement.ts";
import { GameView } from "../view/view.ts";
import { ArmyBook, type ArmyUnit, isSoldier, mostlyLoose, RECRUIT_MESSAGE_TICKS, type TownArea } from "./army.ts";
import { MILITIA_WARNING, militiaTownNear } from "./militia.ts";
import { type DispatchPool, dispatchCount, dispatchPool, NODE_RESOURCE, RESOURCE_WORD, type Villager } from "./dispatch.ts";
import { features, garrisonTypes, holdsOf } from "./features.ts";
import { GARRISON_PROMPT, GARRISON_PROMPT_MIXED, GARRISON_WRONG_TARGET, garrisonTap, isHiding } from "./garrison.ts";
import { allIn } from "./orders.ts";
import { hintTown, townHintLines } from "./town-hint.ts";
import type { SimPort } from "./port.ts";

type InitMessage = Extract<ToWorker, { type: "init" }>;

export interface GameOptions {
  seed: number;
  scenario: ScenarioName;
  tps: number;
  /** The port is the fake world (mock/), not the simulation. */
  fake: boolean;
  /** The opponent is played by the computer (false only on test pages, `?test=1&ai=0`). */
  enemyAi: boolean;
  /** The computer's 難度 (D-024). */
  difficulty: AiDifficulty;
  /** Time limit in ticks, 0 = none (players' games, D-024). */
  maxTicks: number;
  env: () => Record<string, unknown>;
  /** A fresh simulation Worker for the determinism check, or null (the fake world has none). */
  checkPort: (() => SimPort) | null;
  /** 重來 and 回開局畫面 (the page owns games). */
  life: HudLifecycle;
  /** The game has ended (game_over): the page keeps its record (D-056). */
  ended?: () => void;
}

/** Why a 箭樓 preview is red off TowerLand (round 7, D-061). */
export const TOWER_LAND_TEXT = "箭樓要蓋在主城或治理的城鎮附近";

/** A tap while every soldier selected is retreating moves the retreat (D-061). */
export const RETREAT_RETARGET_TEXT = "改撤到這裡，撤到後原地堅守";

const MODE_PROMPT: Record<Exclude<Mode, "normal">, string> = {
  advance: "點地面或小地圖：整隊前進，遇到敵人一起打",
  retreat: "點地面或小地圖：撤到那裡；點主城回家",
  cast: "點地面選晶砲落點",
  rally: "點地面設集結點",
  garrison: GARRISON_PROMPT,
};

export class Game implements GestureHost {
  view: GameView | null = null;
  camera: Camera | null = null;
  mode: Mode = "normal";
  placement: Placement | null = null;
  /** Commands posted, newest last (the test hook reads them). `auto`: given by the interface, not by the player's hand. */
  readonly sent: (CommandBody & { seq: number; auto?: boolean })[] = [];
  /** Garrisons and control groups (D-026). */
  readonly army = new ArmyBook();
  /** The tick of the last message about a recruit (RECRUIT_MESSAGE_TICKS). */
  private recruitMessageTick = Number.NEGATIVE_INFINITY;
  readonly lab: LabPanel;
  paused = false;
  speed: SpeedName = "normal";
  /** Ticks per second the simulation runs at (the chosen speed, or `?tps=` on test pages). */
  tps: number;
  /** The init message this game started with (the test hook reads it). */
  initSent: InitMessage | null = null;
  /** The last state hash the simulation published (every HASH_EVERY ticks), for checking a replay of the log (D-056). */
  lastHash: { tick: number; hash: string } | null = null;
  /** How the game ended, once it has. */
  over: { winner: number; reason: GameOverReason; ticks: number } | null = null;
  private logWaiters: ((jsonl: string) => void)[] = [];
  /** 軍團畫面 (D-054): the group shown in place of the selection info, chosen with its button; null for the usual one. */
  groupView: number | null = null;
  /** What was selected before the group button was tapped (改成剛才選的 N 名). */
  private beforeGroup: number[] = [];
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

  /**
   * 開局提示 (D-044): where crystal comes from and the small town to take nearest our main city,
   * worked out from the map and what we know of its towns (選單 → 魔晶怎麼拿 opens it in the
   * middle of a game too). The game waits while the player reads, and goes on when it closes.
   */
  showTownHint(): void {
    const view = this.view;
    if (view === null) return;
    const home = view.map.spawns.find((s) => s.player === view.me);
    const hint = home === undefined ? null : hintTown(view.townsNow(), home, view.me);
    if (home === undefined || hint === null) return;
    const town = hint.town;
    const wasPaused = this.paused;
    this.pause();
    this.hud.openTownHint(
      townHintLines(town, home, hint.passed, features(view.rules).plunderOnce),
      { id: town.id, cx: town.cellX, cy: town.cellY, radius: town.radius },
      () => this.camera?.centerOn((town.cellX + 0.5) * TILE_PX, (town.cellY + 0.5) * TILE_PX),
      () => {
        if (!wasPaused) this.resume();
      },
    );
  }

  /** 開局提示's state, for the test hook. */
  townHint(): { town: number; open: boolean; flashing: boolean } | null {
    return this.hud.townHint();
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

  /** Arrows drawn from `shot` events so far (round 7), for the test hook. */
  get shotsForTest(): number {
    return this.renderer?.shotCount ?? 0;
  }

  toast(text: string): void {
    this.overlays.toast(text);
  }

  /** Minimap tap (GDD §10): jump there; in 進攻／撤退／晶砲／集結點 mode, pick that spot. */
  minimapTap(cx: number, cy: number): void {
    const view = this.view;
    if (view === null) return;
    const wx = (cx + 0.5) * TILE_PX;
    const wy = (cy + 0.5) * TILE_PX;
    if (this.mode === "garrison") {
      this.toast(GARRISON_WRONG_TARGET);
      return;
    }
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
    this.apply(this.keepRetreating([{ kind: "command", cmd: { c: "move", u: units, x: cx, y: cy } }]));
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
    const init: InitMessage = {
      type: "init",
      protocol: PROTOCOL_VERSION,
      seed: this.options.seed,
      human: 0,
      ai: [false, this.options.enemyAi],
      // One value per player, like `ai`; the person's (player 0) is not used.
      difficulty: ["normal", this.options.difficulty],
      maxTicks: this.options.maxTicks,
      tps: this.options.tps,
      scenario: this.options.scenario,
    };
    this.initSent = init;
    this.port.postMessage(init);
  }

  /**
   * The simulation's command log (LogHeader, then one command per line), or null when it
   * does not answer within `timeoutMs` (D-056). Asked before the Worker is stopped.
   */
  exportLog(timeoutMs = 3000): Promise<string | null> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.logWaiters = this.logWaiters.filter((w) => w !== got);
        resolve(null);
      }, timeoutMs);
      const got = (jsonl: string) => {
        clearTimeout(timer);
        resolve(jsonl);
      };
      this.logWaiters.push(got);
      this.port.postMessage({ type: "export_log" });
    });
  }

  /** The tick the game has reached (the last snapshot's). */
  currentTick(): number {
    return this.view?.header?.[H.tick] ?? 0;
  }

  /** Resolves once the first snapshot has been drawn. */
  whenReady(): Promise<void> {
    return new Promise((resolve) => {
      if (this.renderer !== null && this.view?.curr !== null) resolve();
      else this.readyWaiters.push(resolve);
    });
  }

  /** An order from the player's own hand. Returns its sequence number, or -1 when nobody it names may take it. */
  command(given: CommandBody): number {
    // 前進、攻擊、撤退 leave those hiding in a building where they are: only the building's
    // 全部出來 lets them out (round 7, ceo 2026-10-07), so tapping a group and ordering it on
    // does not empty the towers.
    let cmd = given;
    if ((cmd.c === "move" || cmd.c === "attack" || cmd.c === "retreat") && this.view !== null) {
      const view = this.view;
      const out = cmd.u.filter((id) => !isHiding(view.unitOrder(id)));
      if (out.length === 0 && cmd.u.length > 0) {
        this.toast("躲著的兵要從建築的「全部出來」叫出來");
        return -1;
      }
      cmd = { ...cmd, u: out };
    }
    const seq = this.post(cmd, false);
    if (cmd.c === "move" || cmd.c === "attack" || cmd.c === "retreat") {
      // The player's own 前進, 攻擊 or 撤退 ends a soldier's stay in a garrison (GDD §5).
      const released = this.army.release(cmd.u);
      const view = this.view;
      if (cmd.c === "retreat") {
        // 撤到就堅守 (D-061: 「撤到之後兵自己回頭打」): a retreating soldier fights no one, and once
        // there, holding, it shoots only what comes in range and does not chase. 進攻 makes it
        // 積極 again (below). Those released from a garrison hold already.
        const soldiers = view === null ? [] : cmd.u.filter((id) => !released.includes(id) && isSoldier(view.unitType(id)) && view.unitStance(id) !== Stance.Hold);
        this.setStance(soldiers, Stance.Hold);
      } else {
        // 前進 and 攻擊 are 進攻 (D-050), with or without the button: those holding go 積極.
        const holding = view === null ? [] : cmd.u.filter((id) => !released.includes(id) && isSoldier(view.unitType(id)) && view.unitStance(id) === Stance.Hold);
        this.setStance([...released, ...holding], Stance.Aggressive);
      }
    }
    // His own order sending a recruit somewhere: 自動補兵 no longer leads it to its group (GDD §10).
    this.army.playerCommand(cmd);
    return seq;
  }

  /** An order the interface gives on its own (a garrison's stance, a recruit's march or formation): a rejection is not shown to the player. */
  autoCommand(cmd: CommandBody): number {
    return this.post(cmd, true);
  }

  private post(cmd: CommandBody, auto: boolean): number {
    const seq = this.seq++;
    const withSeq = { ...cmd, seq };
    this.sent.push(auto ? { ...withSeq, auto } : withSeq);
    if (this.sent.length > 200) this.sent.shift();
    this.port.postMessage({ type: "command", cmd: withSeq });
    return seq;
  }

  private setStance(ids: number[], stance: Stance): void {
    if (ids.length > 0) this.autoCommand({ c: "stance", u: ids, stance });
  }

  // --- garrisons (留守, D-026) ----------------------------------------------------------

  /**
   * Our soldiers with the simulation's own positions, for the garrison rules. Those hiding in a
   * building (round 7) are left out unless `hiding`: they are out of 全軍, 留守 and the drafts.
   */
  private soldiers(hiding = false): ArmyUnit[] {
    const view = this.view;
    const u = view?.curr?.snap.units;
    if (view === null || u === undefined) return [];
    const out: ArmyUnit[] = [];
    for (let o = 0; o < u.length; o += UNIT_STRIDE) {
      const type = u[o + UnitField.type];
      // Those hiding in a building (round 7) are out of 全軍, 留守 and 自動補兵's drafts (ceo 2026-10-07).
      if (u[o + UnitField.owner] === view.me && isSoldier(type) && (hiding || !isHiding(u[o + UnitField.order]))) out.push({ id: u[o + UnitField.id], type, x: u[o + UnitField.x], y: u[o + UnitField.y] });
    }
    return out;
  }

  private townArea(town: number): TownArea | null {
    return this.view?.map.towns.find((t) => t.id === town) ?? null;
  }

  /** How many soldiers stay by default: the least a governed town needs (GDD §5: small 1, large 3). */
  garrisonNeeded(town: number): number {
    const view = this.view;
    const t = view?.curr?.snap.towns;
    const o = view?.townRow(town) ?? -1;
    const needed = t !== undefined && o >= 0 ? t[o + TownField.garrisonNeeded] : 0;
    if (needed > 0) return needed;
    return view?.map.towns.find((v) => v.id === town)?.size === TownSize.Large ? 3 : 1;
  }

  /** Soldiers that could still be stationed in the town right now. */
  garrisonCandidates(town: number): number {
    const area = this.townArea(town);
    return area === null ? 0 : this.army.candidates(this.soldiers(), area).length;
  }

  /**
   * Station up to n more soldiers in the town: they turn to 堅守, leave their control groups
   * and are no longer taken by 全軍. Returns how many were stationed.
   */
  stationGarrison(town: number, n: number): number[] {
    const area = this.townArea(town);
    if (area === null || n <= 0) return [];
    const ids = this.army.station(this.soldiers(), area, n);
    this.setStance(ids, Stance.Hold);
    return ids;
  }

  /** 搶 or 治理, leaving `keep` soldiers behind. If the simulation refuses the choice, they are released again. */
  chooseTown(town: number, choice: TownChoice, keep: number): void {
    const seq = this.command({ c: "town_choice", town, choice });
    this.army.awaitChoice(town, seq, this.stationGarrison(town, keep));
  }

  /** Our villagers, with what each gathers now (派村民, D-061). Those hiding in a building are left out. */
  private villagers(): Villager[] {
    const view = this.view;
    const u = view?.curr?.snap.units;
    const b = view?.curr?.snap.buildings;
    if (view === null || u === undefined || b === undefined) return [];
    const out: Villager[] = [];
    for (let o = 0; o < u.length; o += UNIT_STRIDE) {
      if (u[o + UnitField.owner] !== view.me || u[o + UnitField.type] !== UnitType.Farmer || u[o + UnitField.action] === Action.Garrisoned) continue;
      const x = u[o + UnitField.x] / CELL;
      const y = u[o + UnitField.y] / CELL;
      const order = u[o + UnitField.order];
      const t = u[o + UnitField.orderTarget];
      let gathers: Resource | null = null;
      let node: number | null = null;
      if (order === Order.Gather) {
        // The target is a node, or a farm of ours (ids of nodes and of buildings can be the
        // same number): the one nearer the villager.
        const row = view.nodes.get(t);
        const bo = view.buildingRow(t);
        const farm = bo >= 0 && b[bo + BuildingField.owner] === view.me && b[bo + BuildingField.type] === BuildingType.Farm;
        const toNode = row === undefined ? Infinity : Math.hypot(x - (row[NodeField.cellX] + 0.5), y - (row[NodeField.cellY] + 0.5));
        const toFarm = farm ? Math.hypot(x - (b[bo + BuildingField.cellX] + 1.5), y - (b[bo + BuildingField.cellY] + 1.5)) : Infinity;
        if (row !== undefined && toNode <= toFarm) {
          node = t;
          gathers = NODE_RESOURCE[row[NodeField.kind]] ?? null;
        } else if (farm) {
          gathers = Resource.Food;
        }
      }
      const idle = order === Order.None || (u[o + UnitField.flags] & UnitFlag.IdleFarmer) !== 0;
      out.push({ id: u[o + UnitField.id], x, y, gathers, node, idle });
    }
    return out;
  }

  /** 派村民 (D-061): whom a tap on this node can send, nearest first; null for an unknown node. */
  dispatchPool(nodeId: number): DispatchPool | null {
    const row = this.view?.nodes.get(nodeId);
    if (row === undefined) return null;
    return dispatchPool(this.villagers(), { id: nodeId, kind: row[NodeField.kind], cx: row[NodeField.cellX], cy: row[NodeField.cellY] });
  }

  /** 派村民: a share of them gathers at the node, by the player's own `gather` (the economy ratio leaves them, D-050). */
  dispatch(nodeId: number, share: number): void {
    const row = this.view?.nodes.get(nodeId);
    const pool = this.dispatchPool(nodeId);
    if (row === undefined || pool === null) return;
    const n = dispatchCount(pool.ids.length, share);
    if (n === 0) {
      this.toast("沒有可以派的村民");
      return;
    }
    const u = pool.ids.slice(0, n).sort((a, c) => a - c);
    this.apply([{ kind: "command", cmd: { c: "gather", u, node: nodeId } }]);
    this.toast(`派 ${n} 名村民去採${RESOURCE_WORD[NODE_RESOURCE[row[NodeField.kind]]] ?? ""}`);
  }

  /** 全軍: every soldier of ours that is not stationed in a town. */
  armyIds(): number[] {
    return this.army.army(this.soldiers());
  }

  /** Whether we have soldiers at all (全軍 with everyone stationed says so). */
  hasSoldiers(): boolean {
    return this.soldiers().length > 0;
  }

  /** 留守 +: one more soldier from inside the town. */
  garrisonMore(town: number): void {
    if (this.stationGarrison(town, 1).length === 0) this.toast("城鎮裡沒有其他的兵可以留守");
  }

  /** 留守 −: the last-chosen soldier goes back to 積極 and to 全軍. */
  garrisonLess(town: number): void {
    const area = this.townArea(town);
    if (area === null) return;
    const id = this.army.releaseOne(this.soldiers(), area);
    if (id !== null) this.setStance([id], Stance.Aggressive);
  }

  /** Every snapshot: forget dead soldiers; a town that is no longer ours has no garrison. */
  private pruneArmy(): void {
    const view = this.view;
    const t = view?.curr?.snap.towns;
    if (view === null || t === undefined) return;
    const held = (town: number): boolean => {
      for (let o = 0; o < t.length; o += TOWN_STRIDE) {
        if (t[o + TownField.id] !== town) continue;
        const state = t[o + TownField.state];
        return t[o + TownField.owner] === view.me && state !== TownState.Neutral && state !== TownState.Ruins;
      }
      return false;
    };
    this.setStance(this.army.prune((id) => view.unitRow(id) >= 0, held), Stance.Aggressive);
    this.army.settle((town) => view.townAwaitsMyChoice(town));
  }

  // --- 編隊自動補兵 (D-026, GDD §10) ------------------------------------------------------

  /**
   * A soldier of ours was trained: it joins the control group short of its type; with none
   * short, the group with the most soldiers (D-054); with no group at all, it stays at the
   * rally point. It sets off for the group at once.
   */
  private enlist(id: number, type: number): void {
    const view = this.view;
    if (view === null) return;
    const typeOf = (m: number): number | null => (view.unitRow(m) >= 0 ? view.unitType(m) : null);
    const short = this.army.enlist(id, type, typeOf);
    const i = short ?? this.army.joinLargest(id, type, typeOf);
    if (i === null) return;
    const tick = view.header?.[H.tick] ?? 0;
    if (tick - this.recruitMessageTick >= RECRUIT_MESSAGE_TICKS) {
      this.recruitMessageTick = tick;
      this.toast(short !== null ? `新的${UNIT_NAME[type] ?? "兵"}補進編隊 ${i + 1}，正走過去` : `新的${UNIT_NAME[type] ?? "兵"}加入兵最多的編隊 ${i + 1}，正走過去`);
    }
    // It takes the group's formation (D-027): 散開 when more than half of the others are. New
    // units are 密集, and on their way to the rally point the simulation only sets the flag.
    const others = this.army.groups[i].ids.filter((m) => m !== id && view.unitRow(m) >= 0);
    if (mostlyLoose(others, (m) => view.unitLoose(m))) this.autoCommand({ c: "formation", u: [id], loose: true });
  }

  /** Every snapshot: recruits are sent to where their group stands, and again when it moves on (D-054). */
  private musterRecruits(): void {
    const view = this.view;
    const u = view?.curr?.snap.units;
    const tick = view?.header?.[H.tick];
    if (view === null || u === undefined || tick === undefined) return;
    // Those hiding in a building (round 7) are not where the group stands.
    const where = (id: number): { x: number; y: number } | null => {
      const o = view.unitRow(id);
      return o < 0 || isHiding(u[o + UnitField.order]) ? null : { x: u[o + UnitField.x], y: u[o + UnitField.y] };
    };
    for (const o of this.army.muster(tick, where, this.gatherPoint())) this.autoCommand({ c: "move", u: o.ids, x: o.cellX, y: o.cellY });
  }

  /**
   * 軍團 (D-050): every snapshot, the soldiers in no group and not stationed join the groups
   * short of their type, and set off to them (musterRecruits). Only those standing with no
   * order and not holding: an order of the player's, 堅守 included, is not undone.
   */
  private draftArmy(): void {
    const view = this.view;
    if (view === null) return;
    const idle = (id: number): boolean => view.unitOrder(id) === Order.None && view.unitStance(id) !== Stance.Hold;
    // Those hiding still count in their group (ceo 2026-10-07), so it is not short of them; not
    // idle (order Garrison), they are never drafted themselves.
    for (const d of this.army.draft(this.soldiers(true), idle)) {
      this.toast(`${d.ids.length} 名沒編隊的兵補進編隊 ${d.group + 1}，正走過去`);
      // They take the group's formation, as recruits do (D-027).
      const others = this.army.groups[d.group].ids.filter((m) => !d.ids.includes(m) && view.unitRow(m) >= 0);
      if (mostlyLoose(others, (m) => view.unitLoose(m))) this.autoCommand({ c: "formation", u: d.ids, loose: true });
    }
  }

  /**
   * Where soldiers drafted into a group with nobody in it meet (D-050): the rally point of
   * our barracks, range or mage hall with the lowest id that has one; else the cell in front
   * of the main city (where 撤退 goes). Fixed point.
   */
  private gatherPoint(): { x: number; y: number } | null {
    const view = this.view;
    const b = view?.curr?.snap.buildings;
    if (view === null || b === undefined) return null;
    let best: { id: number; x: number; y: number } | null = null;
    for (let o = 0; o < b.length; o += BUILDING_STRIDE) {
      const type = b[o + BuildingField.type];
      if (b[o + BuildingField.owner] !== view.me || b[o + BuildingField.rallyX] < 0) continue;
      if (type !== BuildingType.Barracks && type !== BuildingType.Range && type !== BuildingType.MageHall) continue;
      const id = b[o + BuildingField.id];
      if (best === null || id < best.id) best = { id, x: b[o + BuildingField.rallyX], y: b[o + BuildingField.rallyY] };
    }
    if (best !== null) return { x: best.x, y: best.y };
    const home = view.homeCell();
    return home === null ? null : { x: home.x * CELL + CELL / 2, y: home.y * CELL + CELL / 2 };
  }

  // --- 軍團設定 (D-050) ------------------------------------------------------------------

  /**
   * 編隊按鈕 (D-054): select the group and show the 軍團畫面 in place of the selection info,
   * even with nobody in it (to set what it wants); a double tap also looks at it. What was
   * selected before is kept for 改成剛才選的 N 名.
   */
  showGroup(i: number, jump: boolean): void {
    const view = this.view;
    if (view === null) return;
    const alive = this.army.groups[i].ids.filter((id) => view.unitRow(id) >= 0);
    const now = view.selection.units;
    const same = now.length === alive.length && now.every((id) => alive.includes(id));
    const before = this.groupView === i ? this.beforeGroup : same ? [] : [...now];
    this.apply([alive.length > 0 ? { kind: "select", units: alive } : { kind: "clear" }]);
    this.groupView = i;
    this.beforeGroup = before;
    if (!jump || alive.length === 0) return;
    let x = 0;
    let y = 0;
    for (const id of alive) {
      const p = view.unitPos(view.unitRow(id));
      x += p.x;
      y += p.y;
    }
    this.camera?.centerOn(x / alive.length, y / alive.length);
  }

  /** How many units 改成剛才選的 N 名 would put in the group shown (the living ones selected before). */
  beforeGroupCount(): number {
    const view = this.view;
    return view === null ? 0 : this.beforeGroup.filter((id) => view.unitRow(id) >= 0).length;
  }

  /** 改成剛才選的 N 名: the units selected before become group i (the long press of D-026), and it is shown with them. */
  saveBeforeIntoGroup(i: number): number {
    const view = this.view;
    if (view === null) return 0;
    const units = this.beforeGroup.filter((id) => view.unitRow(id) >= 0).map((id) => ({ id, type: view.unitType(id) }));
    if (units.length === 0) return 0;
    this.army.saveGroup(i, units);
    this.regroup();
    this.beforeGroup = [];
    this.showGroup(i, false);
    return units.length;
  }

  /** Living soldiers of this type in group i (現有). */
  groupHas(i: number, type: number): number {
    const view = this.view;
    if (view === null) return 0;
    return this.army.groups[i].ids.filter((id) => view.unitRow(id) >= 0 && view.unitType(id) === type).length;
  }

  /** 軍團設定 −／+: group i wants n of this type; the free soldiers come at once, the extra ones leave. */
  setGroupWant(i: number, type: number, n: number): void {
    const view = this.view;
    if (view === null) return;
    this.army.setWant(i, type, n, (id) => (view.unitRow(id) >= 0 ? view.unitType(id) : null));
    this.regroup();
  }

  /** 軍團設定 清空: the group has nobody and wants nobody (its soldiers may join the groups still short). */
  clearGroup(i: number): void {
    this.army.clearGroup(i);
    this.regroup();
  }

  /** After the player changed a group: draft and send at once, without waiting for the next snapshot (the game may be paused). */
  private regroup(): void {
    this.draftArmy();
    this.musterRecruits();
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
            // A refused 搶 or 治理: the soldiers stationed with it go back to 積極 and to 全軍.
            this.setStance(this.army.refused(ev.seq), Stance.Aggressive);
            if (cmd?.auto !== true) this.overlays.toast(rejectText(ev.reason, cmd));
          } else {
            if (ev.k === "unit_trained") this.enlist(ev.id, ev.type);
            if (ev.k === "shot") this.drawShot(ev.building, ev.target, now);
            this.hud.onEvent(ev);
          }
        }
        this.pruneArmy();
        this.draftArmy();
        this.musterRecruits();
        if (this.placement !== null) {
          this.placement.revalidate(view.placement);
          this.warnMilitia();
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
        this.over = { winner: msg.winner, reason: msg.reason, ticks: msg.stats.ticks };
        this.hud.showResult(msg.winner, msg.reason, msg.stats);
        this.options.ended?.();
        break;
      case "hash":
        this.lastHash = { tick: msg.tick, hash: msg.hash };
        break;
      case "log":
        for (const w of this.logWaiters.splice(0)) w(msg.jsonl);
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
      this.warnMilitia();
      this.showPlaceButtons();
      return;
    }
    if (this.mode === "garrison") return this.garrisonAt(w.x, w.y);
    this.apply(this.keepRetreating(tapIntents(view, view.selection, this.mode, w.x, w.y, count, this.hitRadius(), UNIT_CORE_HIT_PT / (this.camera?.scale ?? 1))));
  }

  /** 躲進去 (round 7): the building tapped takes the ranged units and mages selected, or the player is told why not. */
  private garrisonAt(wx: number, wy: number): void {
    const view = this.view;
    if (view === null) return;
    const pick = view.buildingAt(wx, wy);
    const b = view.curr?.snap.buildings;
    const o = pick === null ? -1 : view.buildingRow(pick.id);
    const target = pick === null || o < 0 || b === undefined ? null : { id: pick.id, owner: pick.owner, type: pick.type, done: b[o + BuildingField.progress] >= 1000 };
    const hides = garrisonTypes(view.rules);
    const r = garrisonTap(view.selection.units, target, view.me, (id) => hides.includes(view.unitType(id)), (type) => holdsOf(view.rules, type));
    if ("error" in r) {
      this.toast(r.error);
      return;
    }
    this.apply([{ kind: "command", cmd: r.cmd }, { kind: "endMode" }]);
    if (r.cmd.c === "garrison") this.toast(`${r.cmd.u.length} 名躲進${BUILDING_NAME[target?.type ?? -1] ?? "建築"}`);
  }

  /**
   * 撤退中點地面 (D-061: 「撤退按下去之後，點地面應該是撤退的方向，不是改為進攻」): while every
   * soldier selected is retreating (the button reads 取消撤退), the 前進 a tap on the ground or
   * a long press on the minimap would give is a retreat to that spot instead. With only some of
   * them retreating it stays 前進, as the button shows.
   */
  private keepRetreating(intents: Intent[]): Intent[] {
    const view = this.view;
    if (view === null || this.mode !== "normal" || intents.length !== 1) return intents;
    const [only] = intents;
    if (only.kind !== "command" || only.cmd.c !== "move" || !allIn(view, view.selection.units, "retreat")) return intents;
    this.toast(RETREAT_RETARGET_TEXT);
    return [{ kind: "command", cmd: { c: "retreat", u: only.cmd.u, x: only.cmd.x, y: only.cmd.y } }];
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
      // Selecting anything else closes the 軍團畫面 (showGroup opens it again after its own select).
      if (it.kind === "select" || it.kind === "selectBuilding" || it.kind === "clear" || it.kind === "inspect") {
        this.groupView = null;
        this.beforeGroup = [];
      }
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
          // A town of ours still waiting for 搶 or 治理: the choice again (GDD §10, after 稍後再決定 or 重設).
          if (it.pick.kind === "town" && view.townAwaitsMyChoice(it.pick.id)) this.hud.openTownChoice(it.pick.id);
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
        return `${NODE_NAME[p.type] ?? "資源"}（${res}）剩 ${row?.[NodeField.amount] ?? "?"}：下面可以派村民過來`;
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

  /** 射箭 (round 7, `shot`): an arrow from the building's centre to the unit it shot at. */
  private drawShot(building: number, target: number, now: number): void {
    const view = this.view;
    const from = this.buildingCentre(building);
    const o = view?.unitRow(target) ?? -1;
    if (view === null || this.renderer === null || from === null || o < 0) return;
    const to = view.unitPos(o);
    this.renderer.shot(from.x, from.y, to.x, to.y, now);
  }

  private buildingCentre(id: number): { x: number; y: number } | null {
    const view = this.view;
    const o = view?.buildingRow(id) ?? -1;
    const b = view?.curr?.snap.buildings;
    if (view === null || o < 0 || b === undefined) return null;
    const s = view.rules.buildings[b[o + BuildingField.type]]?.size ?? 1;
    return { x: (b[o + BuildingField.cellX] + s / 2) * TILE_PX, y: (b[o + BuildingField.cellY] + s / 2) * TILE_PX };
  }

  /** 撤退 in the command area, with units selected: pick where to, as for 進攻 (D-059). */
  retreatSelection(): void {
    if ((this.view?.selection.units.length ?? 0) > 0) this.setMode("retreat");
  }

  /**
   * 全軍撤退 (user 2026-10-01): every soldier but the garrisons back to the main city, without
   * selecting them first. What is selected stays selected.
   */
  retreatAll(): void {
    const view = this.view;
    if (view === null) return;
    const u = this.armyIds();
    if (u.length === 0) {
      this.toast("沒有可以撤退的士兵");
      return;
    }
    const home = view.homeCell();
    if (home === null) {
      this.toast("主城不在了，沒有地方可以撤退");
      return;
    }
    this.apply([{ kind: "command", cmd: { c: "retreat", u, x: home.x, y: home.y } }]);
    this.toast(`全軍 ${u.length} 名退回主城`);
  }

  setMode(mode: Mode): void {
    this.mode = mode;
    if (mode === "normal") {
      this.overlays.hidePrompt();
      return;
    }
    const buttons: PromptButton[] = [];
    // 退回主城 (D-059), while there is a main city to go back to.
    const home = this.view?.homeCell() ?? null;
    if (mode === "retreat" && home !== null) {
      buttons.push({ label: "退回主城", primary: true, onTap: () => this.apply(retreatHome(this.view?.selection ?? { units: [], building: null }, home)) });
    }
    // 取消 while picking where to advance or retreat to: they stop and hold (D-054).
    const holds = mode === "advance" || mode === "retreat";
    buttons.push({ label: "取消", onTap: () => (holds ? this.cancelToHold() : this.setMode("normal")) });
    const view = this.view;
    // 躲進去 with spearmen in the selection too: only those who can hide go.
    const mixed = mode === "garrison" && view !== null && view.selection.units.some((id) => !garrisonTypes(view.rules).includes(view.unitType(id)));
    this.overlays.showPrompt(mixed ? GARRISON_PROMPT_MIXED : MODE_PROMPT[mode], buttons);
  }

  /**
   * 取消即堅守 (D-054: 「撤退按鈕應該點第二下就是取消撤退變成原地堅守」「點取消進攻還是會看到
   * 敵人就打不會變成固守」): out of the mode, and the soldiers selected stop where they are and hold.
   */
  cancelToHold(): void {
    const view = this.view;
    this.setMode("normal");
    if (view === null) return;
    const intents = holdIntents(view, view.selection.units);
    if (intents.length === 0) return;
    this.apply(intents);
    this.toast("已停下，改成堅守");
  }

  private openWheel(x: number, y: number, pressedType: number): void {
    const view = this.view;
    if (view === null) return;
    const items = wheelItems(pressedType);
    const mages = view.selection.units.filter((id) => view.unitType(id) === UnitType.Mage);
    const autocastOn = mages.length > 0 && mages.every((id) => view.unitAutocast(id));
    const label: Record<WheelItem, string> = {
      cast: "晶砲",
      autocast: autocastOn ? "自動施放：開" : "自動施放：關",
      advance: allIn(view, view.selection.units, "advance") ? "取消進攻" : "進攻",
      retreat: allIn(view, view.selection.units, "retreat") ? "取消撤退" : "撤退",
      hold: "堅守",
    };
    this.overlays.openWheel(
      x,
      y,
      items.map((id) => ({ id, label: label[id] })),
      (id) => {
        // 進攻 while they advance, 撤退 while they retreat: they stop and hold (D-054).
        if ((id === "advance" || id === "retreat") && allIn(view, view.selection.units, id)) return this.cancelToHold();
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


  /** Start placing a building with the selected farmers (the command area calls this). */
  startPlacement(type: BuildingType): void {
    const view = this.view;
    const cam = this.camera;
    if (view === null || cam === null) return;
    const info = view.rules.buildings[type];
    if (info === undefined) return;
    // The selected farmers build it; with none selected the simulation sends the nearest (D-024).
    const builders = view.selection.units.filter((id) => view.unitType(id) === UnitType.Farmer);
    this.setMode("normal");
    this.placement = new Placement(info, builders);
    const c = cam.screenToWorld(cam.width / 2, cam.height / 2);
    this.placement.moveTo(c.x, c.y, view.placement);
    const tower = type === BuildingType.ArrowTower ? "；箭樓要在主城或治理的城鎮附近" : "";
    this.overlays.showPrompt(builders.length > 0 ? `拖曳預覽到想蓋的位置，放開後按 ✓ 或 ✗${tower}` : `拖曳預覽到想蓋的位置，放開後按 ✓ 或 ✗；會派最近的村民去蓋${tower}`, []);
    this.warnMilitia();
  }

  private moveGhost(x: number, y: number): void {
    const w = this.world(x, y);
    this.placement?.moveTo(w.x, w.y, this.view?.placement ?? null);
    this.warnMilitia();
    this.overlays.hidePlace();
  }

  /** 離民兵太近 (ceo, D-044): a warning under the prompt while militia would reach the farmers building there; ✓ still builds. */
  private warnMilitia(): void {
    const p = this.placement;
    const view = this.view;
    if (p === null || view === null) return;
    const town = militiaTownNear(view.townsNow(), p.cellX, p.cellY, p.info.size);
    p.militia = town?.id ?? null;
    // 箭樓 off TowerLand (round 7): why the spot is red comes first.
    const offTowerLand = view.placement !== null && !towerLandOk(view.placement, p.info, p.cellX, p.cellY);
    this.overlays.promptWarning(offTowerLand ? TOWER_LAND_TEXT : town === null ? null : MILITIA_WARNING);
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
      p.valid,
      () => this.confirmPlacement(),
      () => this.endPlacement(),
      avoid,
    );
  }

  private confirmPlacement(): void {
    const cmd = this.placement?.confirm() ?? null;
    if (cmd === null) {
      this.overlays.toast("這裡不能蓋");
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
