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
  moveIntents,
  type Mode,
  retreatHome,
  tapIntents,
  type WheelItem,
  wheelIntents,
  wheelItems,
} from "../input/intent.ts";
import { attachPointer } from "../input/pointer.ts";
import { enemyTooClose, oneCluster, REFORM_CLEAR_CELLS, reformCell, reformFacing, type Sighting, SIGHTING_TICKS, type Spot } from "./reform.ts";
import { type CheckResult, loadExpected, runCheck } from "../lab/determinism.ts";
import { type Culture, cultureOf } from "../art/spec.ts";
import { DEFAULT_CULTURE } from "../culture.ts";
import { type AstcSample, showAstcSample } from "../lab/astc.ts";
import { type Projection, PROJECTIONS } from "../camera/projection.ts";
import { LabPanel } from "../lab/panel.ts";
import { SPEED_TPS } from "../params.ts";
import { atlasFor } from "../render/atlas.ts";
import type { UnitArt } from "../render/unit-art.ts";
import { WorldRenderer } from "../render/world.ts";
import type { GroundQuality, GroundTextures } from "../render/ground-draw.ts";
import { SAVE_EVERY_TICKS, SCREEN_VERSION, type SavedGame, type ScreenState } from "../save/save.ts";
import { gpu, takeDraws } from "../stage.ts";
import {
  Action,
  AUTO_TRAIN,
  autoBuilders,
  type AiDifficulty,
  BUILDING_STRIDE,
  BuildingField,
  BuildingFlag,
  BuildingType,
  CELL,
  type CommandBody,
  type ContinueFailure,
  type Cost,
  dir16,
  type FromWorker,
  type GameOverReason,
  type MapMode,
  HeaderField as H,
  NEUTRAL,
  NO_OWNER,
  NodeField,
  Order,
  PROTOCOL_VERSION,
  Reject,
  Resource,
  type ScenarioName,
  Stance,
  TOWN_STRIDE,
  TownChoice,
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
import { PendingOrders } from "./pending.ts";
import { Controls, nextSpeed, type SpeedName } from "../ui/controls.ts";
import { Hud, type HudLifecycle } from "../ui/hud/hud.ts";
import { formalUi } from "../ui/formal.ts";
import { type PromptButton, Overlays, REPAIR_LOCKED_TEXT, rejectText, type ToastKind } from "../ui/overlays.ts";
import { Placement, placeReason, towerLandOk } from "../ui/placement.ts";
import { GameView, type TownSpot } from "../view/view.ts";
import { ArmyBook, type ArmyUnit, groupWantMax, isSoldier, mostlyLoose, RECRUIT_MESSAGE_TICKS, redirects, type TownArea } from "./army.ts";
import { MILITIA_WARNING, militiaTownNear } from "./militia.ts";
import { crystalSentText, type Depot, type DepotFarm, type DepotNode, DEPOT_RESOURCES, DEPOT_WORD, depotFor, panelResources, pickToSend, pickToTake, sendTarget, type Worker, workersAt } from "./depot.ts";
import { type DispatchPool, dispatchCount, dispatchPool, NODE_RESOURCE, RESOURCE_WORD, type Villager } from "./dispatch.ts";
import { features, garrisonTypes, holdsOf, outpostSlots } from "./features.ts";
import { Charges } from "./follow.ts";
import { SentStances } from "./stances.ts";
import { type Callable, callFullText, callNoneText, GARRISON_PROMPT, GARRISON_PROMPT_MIXED, GARRISON_WRONG_TARGET, garrisonTap, isHiding, pickToHide } from "./garrison.ts";
import { allIn, orderState } from "./orders.ts";
import { goesOnWalls, heldTown, leaveWalls, WALL_PROMPT, WALL_PROMPT_MIXED, WALL_WRONG_TARGET, wallTap } from "./walls.ts";
import { affords, costText, GovernWaits, shortfall } from "./govern-wait.ts";
import { AutoArmyBook, type ArmyNeed, armyNeed, affordsAbove, type Block, type GroupNeed, missingText, pickTrains, type Site, villagersMissing } from "./auto-army.ts";
import { type Alarm, alarmText, GroupAlarms, groupAdvancing } from "./alarm.ts";
import { isPosted, outpostModeText, POST_PROMPT, POST_PROMPT_MIXED, POST_TYPE, POST_WRONG_TARGET, postTap } from "./outpost.ts";
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
  /** 地圖 (D-074): the fixed map or a new random one. */
  map: MapMode;
  /** Test pages (`?test=1&watch=1`): the computer plays both sides, the page only watches. */
  watch: boolean;
  env: () => Record<string, unknown>;
  /** A fresh simulation Worker for the determinism check, or null (the fake world has none). */
  checkPort: (() => SimPort) | null;
  /** 重來 and 回開局畫面 (the page owns games). */
  life: HudLifecycle;
  /** The game has ended (game_over): the page keeps its record (D-056). */
  ended?: () => void;
  /** Which simulation the page runs (scripts/sim-build.ts), sent in `init` and `continue` (D-083). */
  build: string;
  /**
   * 繼續上一局 (D-083): go on with this saved game instead of starting one (`continue`). The
   * options above are the ones it was started with; `tps` its speed.
   */
  resume?: SavedGame;
  /** 繼續上一局: how far the simulation has run the game again. */
  progress?: (tick: number, toTick: number) => void;
  /** 繼續上一局: the game cannot go on (the Worker has no game). */
  continueFailed?: (reason: ContinueFailure, tick: number) => void;
  /** Every minute of game time (SAVE_EVERY_TICKS): the page keeps the game for 繼續上一局. */
  minute?: () => void;
  /** The units drawn from war-game-ui's atlases (D-085), or none: the shapes. Only the picture: never the simulation. */
  art?: UnitArt | null;
  /** 你的陸 (the computer wears the other; art/spec.ts cultureOf); 東陸 when not given. */
  culture?: Culture;
  /** How the ground lies (a test page's ?view=, D-088); the default when not given. */
  view?: Projection["kind"];
  /** Units behind a castle's wall as their rims only (?ghost=outline, D-089), instead of whole. */
  ghost?: "outline";
  /** 寫實地面 (D-093, ?test=1&ground=real): its textures, and the quality to start with. */
  ground?: GroundTextures | null;
  groundQuality?: GroundQuality;
  /** This build has atlases to choose in the 量測 panel. */
  artAvailable?: boolean;
  /** The 量測 panel's 美術 was changed since this game began: 量測 starts a game of its own. */
  artChanged?: () => boolean;
  /** ASTC 樣本 (D-085): where its pages are, when the build has them. */
  astcSample?: AstcSample;
}

/** export_log's answer: the command log, the hash every HASH_EVERY ticks and the tick it got to (D-083). */
export interface ExportedLog {
  jsonl: string;
  hashes: { tick: number; hash: string }[];
  tick: number;
}

/** Why a 箭樓 preview is red off TowerLand (round 7, D-061). */
export const TOWER_LAND_TEXT = "箭樓要蓋在主城或治理的城鎮附近";
/** With outposts on (D-080), arrow towers may also go by our outposts. */
export const TOWER_LAND_TEXT_OUTPOST = "箭樓要蓋在主城、治理的城鎮或哨所附近";


/** 整理隊形 (D-095): what it faced, on the message bar. */
const REFORM_TEXT: Record<string, string> = {
  enemy: "整理隊形：槍兵在前，面向最近的敵人",
  seen: "整理隊形：槍兵在前，面向剛才看到敵人的地方",
  last: "整理隊形：槍兵在前，面向剛才走的方向",
  city: "整理隊形：槍兵在前，面向敵方主城",
  keep: "整理隊形：槍兵在前，方向不變",
  near: `敵人在 ${REFORM_CLEAR_CELLS} 格內，不整理隊形：整理時不還手，先打完或先移動開`,
};

const MODE_PROMPT: Record<Exclude<Mode, "normal">, string> = {
  // D-094: 攻擊 then a tap; 移動 the old 撤退.
  advance: "點地面或小地圖：攻擊移動，遇到敵人就打；點敵人集中打它",
  retreat: "點地面或小地圖：走過去，路上不還手；點主城回家",
  rally: "點地面設集結點",
  garrison: GARRISON_PROMPT,
  post: POST_PROMPT,
  wall: WALL_PROMPT,
};

/** The sequence number after the log's last (繼續上一局, D-083): the game's commands go on numbered after it. */
export function nextSeq(log: string): number {
  let last = 0;
  for (const m of log.matchAll(/"seq":(\d+)/g)) last = Math.max(last, Number(m[1]));
  return last + 1;
}

/** How the ground is laid on the screen: 方形斜看 since art-v3 is drawn for it (D-088); the diamond (D-085) on test pages only (?view=diamond). */
const PROJECTION_DEFAULT = PROJECTIONS.oblique;

export class Game implements GestureHost {
  view: GameView | null = null;
  /** When the simulation was asked to start and when it answered (performance.now(); D-091's load times). */
  readonly started = { init: Number.NaN, ready: Number.NaN };
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
  private logWaiters: ((log: ExportedLog) => void)[] = [];
  /** 繼續上一局 (D-083): the saved game's screen, put back with the first snapshot once the game is where it was. */
  private restoring: SavedGame | null = null;
  /** The next tick at which the page keeps the game (every minute of game time). */
  private nextSave = SAVE_EVERY_TICKS;
  /** 繼續上一局: the game went on without its screen (a save in another format); the page says so once the battlefield shows. */
  screenLost = false;
  /** 軍團畫面 (D-054): the group shown in place of the selection info, chosen with its button; null for the usual one. */
  groupView: number | null = null;
  /** What was selected before the group button was tapped (改成剛才選的 N 名). */
  private beforeGroup: number[] = [];
  /** What the last ASTC 樣本 showed (D-085; the test hook reads it). */
  lastAstc: string | null = null;
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
    // The fake world trains nothing by itself (mock/): the screen's 自動訓練 only when a test turns it on.
    this.autoArmyOn = !options.fake;
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
        // Measure "every system running" (brief): a perf scenario, in a game of its own; in that
        // game already (and with the same 美術), the game on screen.
        requestMeasure: options.fake
          ? undefined
          : (scenario) => {
              if (scenario === options.scenario && options.artChanged?.() !== true) this.lab.startMeasure(performance.now());
              else options.life.perf(scenario);
            },
        artAvailable: options.artAvailable === true,
        ground:
          (options.ground ?? null) === null
            ? undefined
            : {
                quality: () => (this.renderer?.groundLook.quality as GroundQuality | null | undefined) ?? null,
                setQuality: (q) => this.setGroundQuality(q),
                measure: () => {
                  const r = this.app.renderer;
                  const w = r.canvas.width;
                  const h = r.canvas.height;
                  const m = this.renderer?.measureGround(r, w, h) ?? null;
                  if (m === null) return null;
                  const ms = (v: number) => v.toFixed(2);
                  return `地面（${w}×${h} 像素，每格）：高 ${ms(m.high)} ms、低 ${ms(m.low)} ms、只貼一張圖 ${ms(m.plain)} ms；材質 ${m.mb.toFixed(1)} MB`;
                },
              },
        population: () => {
          const h = this.view?.curr?.snap.header;
          return h === undefined ? null : { population: h[H.population], cap: h[H.populationCap] };
        },
        astcSample:
          options.astcSample === undefined
            ? undefined
            : () => {
                // The interface (DOM, above the battlefield's canvas: the panel, the buttons) steps aside while the sample shows.
                this.hudRoot.style.display = "none";
                void showAstcSample(this.app, options.astcSample as AstcSample, () => (this.hudRoot.style.display = "")).then((r) => {
                  this.lastAstc = r;
                  this.lab.log.add(`ASTC 樣本：${r}`);
                });
              },
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
    this.lab.stopMeasuring();
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
    // A random map with no town explored yet (D-074): the hint all the same, without a town to point at.
    if (home === undefined || (hint === null && !view.randomMap)) return;
    const town = hint?.town ?? null;
    const wasPaused = this.paused;
    this.pause();
    this.hud.openTownHint(
      townHintLines(town, home, hint?.passed ?? false, features(view.rules).plunderOnce),
      town === null ? null : { id: town.id, cx: town.cellX, cy: town.cellY, radius: town.radius },
      () => {
        if (town !== null) this.camera?.centerOn((town.cellX + 0.5) * TILE_PX, (town.cellY + 0.5) * TILE_PX);
      },
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
      if (!isSoldier(t)) continue;
      const p = view.unitPos(o);
      x += p.x;
      y += p.y;
      n++;
    }
    if (n === 0) return;
    cam.zoomAt(0, 0, 0.75);
    cam.centerOn(x / n, y / n);
  }

  /**
   * The message a depot's − or ＋ put up, and for which building: selecting another takes it
   * off the strip, so it does not read as the new building's (ceo 2026-10-07).
   */
  private depotToast: { building: number; text: string } | null = null;

  /** The message of a depot's − or ＋. */
  private depotSay(building: number, text: string, kind?: ToastKind): void {
    this.toast(text, kind);
    this.depotToast = { building, text };
  }

  /** The port, for the test hook (it can feed events to the fake world). */
  get portForTest(): SimPort {
    return this.port;
  }

  /** The last frames: their intervals and how long drawing them took (test pages compare maps, D-074). */
  readonly frameTimes = new FrameTimes(1200);
  /** 進攻到底 (D-080): units the player sent to attack, sent on to their target's spot if the attack ends before they get there. */
  readonly charges = new Charges();
  /** Stances sent that the snapshot does not show yet (D-081), for what 前進 and 撤退 go by. */
  private readonly stances = new SentStances();
  /** 整理隊形 (D-095): where enemies were last seen (cells, by unit id), and the way each soldier was last sent. */
  private readonly sightings = new Map<number, Sighting>();
  private prunedAt = 0;
  private readonly lastSent = new Map<number, Spot>();
  /** 等錢治理 (ceo 2026-10-21): towns whose 治理 waits for its cost, and the reserve raised meanwhile. */
  readonly governWaits = new GovernWaits();
  /**
   * 自動訓練 by the screen (D-098): paused buildings and the villagers' target, the trains sent and
   * not in a snapshot yet, the simulation's own 自動訓練 turned off (when last sent, per building),
   * and what the last decision saw, for the panels. On the fake world only when a test turns it on.
   */
  readonly autoArmy = new AutoArmyBook();
  autoArmyOn = true;
  private autoSent: { seq: number; tick: number; building: number; unit: number }[] = [];
  private readonly autoOff = new Map<number, number>();
  private armyNeedSeen: ArmyNeed = { reason: "none", missing: {}, want: {} };
  private armyBlocked = new Map<number, Block>();
  private villagersSeen = { living: 0, queued: 0, block: null as Block | null };
  /** 自動訓練 stopped by a full population (D-054's message strip), as last seen. */
  autoPopulationFull = false;
  /** Mages a turn-on of their cannon went to (D-095: a save from before, with it turned off). */
  private readonly autocastAsked = new Set<number>();
  /** Orders from the buttons the snapshot does not show yet (a site, the queue, 自動訓練, 搶 or 治理): shown at once (pending.ts). */
  readonly pending = new PendingOrders();
  /** 閃紅提醒 (D-081): each group's base and alarm, and what the group buttons show (updated every snapshot). */
  private readonly alarms = new GroupAlarms();
  private alarmState: (Alarm & { present: number })[] = [0, 1, 2, 3].map(() => ({ advancing: false, base: null, alarm: false, tell: false, present: 0 }));

  /** D-096: openings drawn as broken gates, and units drawn up on a wall in the last frame, for the test hook. */
  get brokenGatesForTest(): number {
    return this.renderer?.brokenGateCount ?? 0;
  }

  get wallLiftedForTest(): number {
    return this.renderer?.wallLifted ?? 0;
  }

  /** Pause marks on buildings (D-098), for the test hook. */
  get pauseMarksForTest(): number {
    return this.renderer?.pauseMarks ?? 0;
  }

  /** Arrows drawn from `shot` events so far (round 7), for the test hook. */
  get shotsForTest(): number {
    return this.renderer?.shotCount ?? 0;
  }

  /** Stones thrown from slings on walls (D-096), for the test hook. */
  get stonesForTest(): number {
    return this.renderer?.stoneCount ?? 0;
  }

  /** Shots that left a gate's tower (D-096 shoot_at_m, its `tower_shot` flash), for the test hook. */
  get towerShotsForTest(): number {
    return this.renderer?.towerShotCount ?? 0;
  }

  /** The units' atlases as drawn (D-085), for the test hook. */
  /** 你的陸 this game was started with (kept with 繼續上一局's save). */
  get culture(): Culture {
    return this.options.culture ?? DEFAULT_CULTURE;
  }

  get artForTest(): { label: string; pages: number; units: number; corpses: number; buildings: number; rubble: number; nodes: number; sling: boolean } | null {
    return this.renderer?.artDrawn ?? null;
  }

  /** Each town's wall as drawn (D-084), for the test hook. */
  get townWallsForTest(): { id: number; x: number; y: number; side: number; visible: boolean }[] {
    return this.renderer?.townWalls ?? [];
  }

  /** The ground's pictures (art-v5, R6-51) as drawn; null before the first snapshot. */
  get terrainForTest(): { pictures: boolean; pieces: number; flat: number; standing: number } | null {
    return this.renderer?.terrainCounts ?? null;
  }

  /** How far up (points on the plane) someone standing in the middle of cell (cx, cy) is drawn: a bridge's deck. */
  liftForTest(cx: number, cy: number): number {
    return this.renderer?.liftAt((cx + 0.5) * TILE_PX, (cy + 0.5) * TILE_PX) ?? 0;
  }

  /** 寫實地面 (D-093): drawn or not, and its quality; null before the first snapshot. */
  get groundForTest(): { real: boolean; quality: string | null } | null {
    return this.renderer?.groundLook ?? null;
  }

  /** 寫實地面's quality (the 量測 panel, the test page). */
  setGroundQuality(q: GroundQuality): void {
    this.renderer?.setGroundQuality(q);
  }

  /** The castles as drawn (D-089), and the units drawn behind their walls, for the test hook. */
  get castleForTest(): { pieces: number; tiles: number; blockTowns: number; misfit: number; ghosts: number; walkable: boolean; gates: Record<string, number> } | null {
    const r = this.renderer;
    return r === null ? null : { ...r.castleCounts, ghosts: r.ghostCount };
  }

  /** Terrain repaints on exploring rock (random map, D-074), for the test hook. */
  get terrainRepaintsForTest(): { count: number; totalMs: number; maxMs: number } | null {
    return this.renderer?.terrainRepaints ?? null;
  }

  /** A line on the strip: an alarm (red), `ok` an order taken (a check, R6-31), `info` (dark). */
  toast(text: string, kind?: ToastKind): void {
    this.overlays.toast(text, kind);
  }

  /** Minimap tap (GDD §10): jump there; in 攻擊／移動／集結點 mode, pick that spot. */
  minimapTap(cx: number, cy: number): void {
    const view = this.view;
    if (view === null) return;
    const wx = (cx + 0.5) * TILE_PX;
    const wy = (cy + 0.5) * TILE_PX;
    if (this.mode === "garrison" || this.mode === "post" || this.mode === "wall") {
      this.toast(this.mode === "post" ? POST_WRONG_TARGET : this.mode === "wall" ? WALL_WRONG_TARGET : GARRISON_WRONG_TARGET);
      return;
    }
    if (this.mode !== "normal") {
      this.apply(tapIntents(view, view.selection, this.mode, wx, wy, 1, this.hitRadius()));
      return;
    }
    this.camera?.centerOn(wx, wy);
  }

  /** Minimap long press with units selected (GDD §10): they move there (D-094: as a tap on the ground). */
  minimapLongPress(cx: number, cy: number): void {
    const view = this.view;
    const units = view?.selection.units ?? [];
    if (view === null || units.length === 0) {
      this.toast("先選部隊，再長按小地圖");
      return;
    }
    this.apply(moveIntents(view, units, cx, cy));
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
      // Watching (test pages): no person plays, the worker shows everything.
      human: this.options.watch ? null : 0,
      ai: [this.options.watch, this.options.enemyAi],
      // One value per player, like `ai`; the person's (player 0) is not used.
      difficulty: ["normal", this.options.difficulty],
      maxTicks: this.options.maxTicks,
      tps: this.options.tps,
      scenario: this.options.scenario,
      // Only a random map says so (D-074): a fixed map's init and log stay as they were.
      ...(this.options.map === "random" ? { map: "random" as const } : {}),
      build: this.options.build,
    };
    this.initSent = init;
    this.started.init = performance.now();
    const resume = this.options.resume;
    if (resume === undefined) {
      this.port.postMessage(init);
      return;
    }
    // 繼續上一局 (D-083): the simulation runs the saved game again up to where it was, then waits.
    this.restoring = resume;
    this.seq = nextSeq(resume.log);
    this.port.postMessage({ type: "continue", protocol: PROTOCOL_VERSION, build: this.options.build, log: resume.log, hashes: resume.hashes, toTick: resume.tick, tps: this.tps });
  }

  /**
   * The simulation's command log (LogHeader, then one command per line), with its hashes and
   * the tick it got to (D-083), or null when it does not answer within `timeoutMs` (D-056).
   * Asked before the Worker is stopped.
   */
  exportLog(timeoutMs = 3000): Promise<ExportedLog | null> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.logWaiters = this.logWaiters.filter((w) => w !== got);
        resolve(null);
      }, timeoutMs);
      const got = (log: ExportedLog) => {
        clearTimeout(timer);
        resolve(log);
      };
      this.logWaiters.push(got);
      this.port.postMessage({ type: "export_log" });
    });
  }

  /** 繼續上一局 (D-083): what the screen keeps beside the simulation, to save with its log. */
  screenState(): ScreenState {
    const cam = this.camera;
    const mid = cam === null ? null : cam.screenToWorld(cam.width / 2, cam.height / 2);
    return {
      army: this.army.save(),
      alarms: this.alarms.save(),
      charges: this.charges.save(),
      camera: cam === null || mid === null ? null : { x: mid.x, y: mid.y, scale: cam.scale },
      speed: this.speed,
      seq: this.seq,
      recruitMessageTick: Number.isFinite(this.recruitMessageTick) ? this.recruitMessageTick : null,
      govern: this.governWaits.save(),
      autoArmy: this.autoArmy.save(),
    };
  }

  /**
   * 繼續上一局: with the first snapshot of the game run again, the screen as it was saved. A
   * save in another format (an update of the screen alone) goes on without it (ceo 2026-10-17).
   */
  private restoreScreen(saved: SavedGame, tick: number): void {
    this.restoring = null;
    this.nextSave = (Math.floor(tick / SAVE_EVERY_TICKS) + 1) * SAVE_EVERY_TICKS;
    if (saved.screenVersion !== SCREEN_VERSION) {
      this.screenLost = true;
      return;
    }
    const s = saved.screen;
    this.army.restore(s.army);
    this.alarms.restore(s.alarms);
    this.charges.restore(s.charges);
    this.recruitMessageTick = s.recruitMessageTick ?? Number.NEGATIVE_INFINITY;
    this.governWaits.restore(s.govern);
    this.autoArmy.restore(s.autoArmy);
    this.seq = Math.max(this.seq, s.seq);
    this.speed = s.speed;
    this.controls.setSpeed(s.speed);
    const cam = this.camera;
    if (cam !== null && s.camera !== null) {
      cam.zoomAt(0, 0, s.camera.scale);
      cam.centerOn(s.camera.x, s.camera.y);
    }
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

  /**
   * An order from the player's own hand. Returns its sequence number, or -1 when nobody it names
   * may take it. `hold`: a retreat whose soldiers hold once there (全軍撤退、退1–退4); any other
   * retreat is 移動 (D-094), whose soldiers stand 積極 there.
   */
  command(given: CommandBody, hold = false): number {
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
    this.acknowledge(cmd, seq);
    this.controls.setWaiting(this.pending.waiting);
    // 堅守 or 取消 (stop and hold): what the next order goes by until the snapshot shows it (D-081).
    if (cmd.c === "stance") this.stances.note(cmd.u, cmd.stance, this.view?.header?.[H.tick] ?? 0);
    if (cmd.c === "move" || cmd.c === "attack" || cmd.c === "retreat") {
      // The player's own 前進, 攻擊 or 撤退 ends a soldier's stay in a garrison (GDD §5).
      const released = this.army.release(cmd.u);
      const view = this.view;
      if (cmd.c === "retreat" && hold) {
        // 撤到就堅守 (D-061: 「撤到之後兵自己回頭打」), for 全軍撤退 and 退1–退4 (D-094 keeps them):
        // a retreating soldier fights no one, and once there, holding, it shoots only what comes
        // in range and does not chase. Those released from a garrison hold already.
        const soldiers = view === null ? [] : cmd.u.filter((id) => !released.includes(id) && isSoldier(view.unitType(id)) && this.stances.of(id, view.unitStance(id)) !== Stance.Hold);
        this.setStance(soldiers, Stance.Hold);
      } else {
        // 攻擊 and 移動 (D-094; 移動 is a retreat: it fights no one on the way): there, those
        // holding go 積極 (D-094: 「站著，敵人靠近就自己打」), as 進攻 always did (D-050).
        // With the stance just sent (取消, 堅守) counted, though the snapshot may not show it yet (D-081).
        const holding = view === null ? [] : cmd.u.filter((id) => !released.includes(id) && isSoldier(view.unitType(id)) && this.stances.of(id, view.unitStance(id)) === Stance.Hold);
        this.setStance([...released, ...holding], Stance.Aggressive);
      }
    }
    // 整理隊形's fallback (D-095): the way each was sent last, from where the lot stood.
    if (cmd.c === "move" || cmd.c === "retreat" || cmd.c === "attack") this.noteSent(cmd);
    // His own order sending a recruit somewhere: 自動補兵 no longer leads it to its group (GDD §10).
    this.army.playerCommand(cmd);
    // 進攻到底 (D-080): another order of his, 堅守 or 躲進去 included, ends it; an attack starts it.
    const named = (cmd as { u?: number | number[] }).u;
    if (named !== undefined && (cmd.c === "stance" || cmd.c === "garrison" || cmd.c === "post" || redirects(cmd))) this.charges.drop(Array.isArray(named) ? named : [named]);
    if (cmd.c === "attack") this.charges.start(cmd.u, cmd.target, this.targetCell(cmd.target), this.view?.header?.[H.tick] ?? 0);
    return seq;
  }

  /**
   * An order from a button shows at once (the user 2026-10-19: 「不然還以為沒按到」; R6-31): what it
   * will do is kept until the snapshot shows it (pending.ts), and a line with a check says what was
   * ordered; while the game is paused, that it starts on 繼續 (the simulation takes the orders in
   * the order sent on its first step after 繼續; their resources are spent then).
   */
  private acknowledge(cmd: CommandBody, seq: number): void {
    const view = this.view;
    if (view === null || seq < 0) return;
    const tick = view.header?.[H.tick] ?? 0;
    const later = this.paused;
    if (later) this.pending.hold(seq, tick);
    switch (cmd.c) {
      case "build": {
        this.pending.add({ k: "build", seq, tick, type: cmd.type, x: cmd.x, y: cmd.y });
        const name = BUILDING_NAME[cmd.type] ?? "建築";
        // With no farmers selected the simulation sends the nearest free ones, by the building's size (D-024).
        const sent = cmd.u.length > 0 ? cmd.u.length : autoBuilders(view.rules.buildings[cmd.type]?.size ?? 2);
        this.toast(later ? `已下令蓋${name}，按繼續後開工` : `已下令蓋${name}，派 ${sent} 名村民`, "ok");
        break;
      }
      case "train": {
        // Its place in the queue: those in it, those sent before, then this one.
        const o = view.buildingRow(cmd.building);
        const queued = o < 0 ? 0 : (view.curr?.snap.buildings[o + BuildingField.queueLength] ?? 0);
        const place = queued + this.pending.trains(cmd.building).length + 1;
        for (let i = 0; i < (cmd.n ?? 1); i++) this.pending.add({ k: "train", seq, tick, building: cmd.building, unit: cmd.type });
        const name = UNIT_NAME[cmd.type] ?? "兵";
        this.toast(later ? `已下令訓練${name}，按繼續後開始` : `已下令訓練${name}（排第 ${place}）`, "ok");
        break;
      }
      case "auto_train": {
        this.pending.add({ k: "auto", seq, tick, building: cmd.building, on: cmd.on });
        const o = view.buildingRow(cmd.building);
        const name = (o < 0 ? undefined : BUILDING_NAME[view.curr?.snap.buildings[o + BuildingField.type] ?? -1]) ?? "建築";
        this.toast(`已${cmd.on ? "恢復" : "暫停"}這座${name}的自動訓練${later ? "，按繼續後生效" : ""}`, "ok");
        break;
      }
      case "town_choice": {
        this.pending.add({ k: "town", seq, tick, town: cmd.town, choice: cmd.choice });
        const plunder = cmd.choice === TownChoice.Plunder;
        this.toast(plunder ? (later ? "已選搶，按繼續後開始搶" : "已選搶，部隊留下搶") : later ? "已選治理，按繼續後開始修繕" : "已選治理，開始修繕", "ok");
        break;
      }
      case "eco_ratio":
        this.pending.add({ k: "eco", seq, tick, food: cmd.food, wood: cmd.wood, gold: cmd.gold, on: cmd.on });
        this.toast(later ? "已改經濟分配，按繼續後生效" : "已改經濟分配", "ok");
        break;
    }
  }

  /** Where a unit or building is (cells, its centre), or null when it is not in the snapshot. */
  private targetCell(id: number): { x: number; y: number } | null {
    const view = this.view;
    const snap = view?.curr?.snap;
    if (view === null || snap === undefined) return null;
    const u = view.unitRow(id);
    if (u >= 0) return { x: snap.units[u + UnitField.x] / CELL, y: snap.units[u + UnitField.y] / CELL };
    const b = view.buildingRow(id);
    if (b < 0) return null;
    return view.footprintCentre(snap.buildings, b);
  }

  /**
   * 進攻到底 (D-080: 「就算有一部分已經到了，後面那些還沒到的也要聚集過來」): every snapshot, the
   * units whose attack ended (their target fell) still far from it go on to where it was. Not
   * those hiding in a building or staying in a town (留守).
   */
  private followCharges(): void {
    const view = this.view;
    const u = view?.curr?.snap.units;
    const tick = view?.header?.[H.tick];
    if (view === null || u === undefined || tick === undefined) return;
    const unit = (id: number) => {
      const o = view.unitRow(id);
      if (o < 0 || isHiding(u[o + UnitField.order]) || isPosted(u[o + UnitField.order]) || this.army.isGarrisoned(id)) return null;
      return { x: u[o + UnitField.x] / CELL, y: u[o + UnitField.y] / CELL, attacking: u[o + UnitField.order] === Order.Attack };
    };
    for (const o of this.charges.update(tick, unit, (id) => this.targetCell(id))) this.autoCommand({ c: "move", u: o.ids, x: o.x, y: o.y });
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
    if (ids.length === 0) return;
    this.autoCommand({ c: "stance", u: ids, stance });
    this.stances.note(ids, stance, this.view?.header?.[H.tick] ?? 0);
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
      // Those hiding in a building (round 7) are out of 全軍, 留守 and 自動補兵's drafts (ceo 2026-10-07);
      // those posted at an outpost (D-080) out of all of it too, hiding asked for or not.
      const order = u[o + UnitField.order];
      if (u[o + UnitField.owner] === view.me && isSoldier(type) && (hiding || !isHiding(order)) && !isPosted(order)) out.push({ id: u[o + UnitField.id], type, x: u[o + UnitField.x], y: u[o + UnitField.y] });
    }
    return out;
  }

  private townArea(town: number): TownArea | null {
    const view = this.view;
    const t = view?.knownTowns.get(town);
    if (view === null || t === undefined) return null;
    // Inside its walls (D-089), as the simulation counts a garrison.
    const c = view.castleOf(t);
    return { ...t, inside: c === null ? null : { x0: t.cellX + c.inside.x0, y0: t.cellY + c.inside.y0, x1: t.cellX + c.inside.x1, y1: t.cellY + c.inside.y1 } };
  }

  /** How many soldiers stay by default: the least a governed town needs (GDD §5: small 1, large 3). */
  garrisonNeeded(town: number): number {
    const view = this.view;
    const t = view?.curr?.snap.towns;
    const o = view?.townRow(town) ?? -1;
    const needed = t !== undefined && o >= 0 ? t[o + TownField.garrisonNeeded] : 0;
    if (needed > 0) return needed;
    return view?.knownTowns.get(town)?.size === TownSize.Large ? 3 : 1;
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

  /**
   * 搶 or 治理, leaving `keep` soldiers behind. If the simulation refuses the choice, they are
   * released again. 治理 without its cost (ceo 2026-10-21): the soldiers stay all the same and the
   * town waits for it (等錢治理); 治理 starts by itself once it is there.
   */
  chooseTown(town: number, choice: TownChoice, keep: number): void {
    const cost = this.governCost(town);
    if (choice === TownChoice.Govern && cost !== null && !affords(cost, this.stock())) {
      this.stationGarrison(town, keep);
      this.startGovernWait(town, cost);
      return;
    }
    // 搶 instead: no more waiting.
    if (choice === TownChoice.Plunder) this.endGovernWait(town);
    const seq = this.command({ c: "town_choice", town, choice });
    this.army.awaitChoice(town, seq, this.stationGarrison(town, keep));
  }

  /** 治理's cost for this town, from the rules (小鎮 木 80、金 80; 大城 木 150、金 150), or null when not known. */
  governCost(town: number): Cost | null {
    const view = this.view;
    const size = view?.knownTowns.get(town)?.size;
    return size === undefined ? null : (view?.rules.towns?.[size]?.governCost ?? null);
  }

  /** What we have now (the resource bar's numbers). */
  stock(): Cost {
    const h = this.view?.header;
    return h === null || h === undefined ? { food: 0, wood: 0, gold: 0, crystal: 0 } : { food: h[H.food], wood: h[H.wood], gold: h[H.gold], crystal: h[H.crystal] };
  }

  /** What is missing for this town's 治理 (0 everywhere when it is there), or null when its cost is not known. */
  governShortfall(town: number): Cost | null {
    const cost = this.governWaits.costOf(town) ?? this.governCost(town);
    return cost === null ? null : shortfall(cost, this.stock());
  }

  /** The reserve the simulation has now (預留, D-054). */
  private reserveInEffect(): Cost {
    const h = this.view?.header;
    return h === null || h === undefined ? { food: 0, wood: 0, gold: 0, crystal: 0 } : { food: h[H.reserveFood], wood: h[H.reserveWood], gold: h[H.reserveGold], crystal: h[H.reserveCrystal] };
  }

  /** The player's own reserve (預留's dialog): while towns wait for 治理, not the raised one in effect. */
  ownReserve(): Cost {
    return this.governWaits.ownReserve(this.reserveInEffect());
  }

  /** The reserve raised while towns wait for 治理 (「木 150、金 150」), or "" while none does. */
  raisedReserveText(): string {
    return this.governWaits.raisedText();
  }

  /** 預留 → 套用: the player's own reserve; while towns wait for 治理, the raise stays on top. */
  setReserve(r: Cost): void {
    this.command({ c: "reserve", ...this.governWaits.setOwn(r) });
  }

  private sendReserve(r: Cost | null): void {
    if (r !== null) this.autoCommand({ c: "reserve", ...r });
  }

  private startGovernWait(town: number, cost: Cost): void {
    this.sendReserve(this.governWaits.start(town, cost, this.reserveInEffect()));
    this.toast(`錢不夠：先留守，還差 ${costText(shortfall(cost, this.stock()))}，夠了自動治理`);
  }

  private endGovernWait(town: number): void {
    this.sendReserve(this.governWaits.end(town));
  }

  // --- 自動訓練 by the screen (D-098) -------------------------------------------------------

  /** The unit types in an own building's queue (up to 7, 4 bits each, head first). */
  private static queueOf(b: Int32Array, o: number): number[] {
    const n = Math.min(b[o + BuildingField.queueLength], 7);
    const packed = b[o + BuildingField.queuePacked];
    return Array.from({ length: n }, (_, i) => (packed >>> (4 * i)) & 15);
  }

  /**
   * Every snapshot while the game runs: the simulation's own 自動訓練 off for each of our
   * buildings (ceo's (B): `auto_train off`, again every 2 s while its flag shows), then the
   * main city's villagers up to the target and the groups' missing soldiers, as `train` orders.
   */
  private tickAutoArmy(): void {
    const view = this.view;
    const snap = view?.curr?.snap;
    const h = view?.header;
    if (view === null || snap === undefined || h === null || h === undefined || this.options.watch || !this.autoArmyOn) return;
    const tick = h[H.tick];
    const b = snap.buildings;
    const u = snap.units;
    // Taken by now (or refused): the queue in the snapshot has it. A train is sent only to an empty
    // queue, so one that shows in its building's queue is taken: counted there, not twice (that made
    // a full population for a snapshot and a false 人口滿了: CI run 39659340330).
    const queuedAt = new Set<number>();
    for (let o = 0; o < b.length; o += BUILDING_STRIDE) if (b[o + BuildingField.owner] === view.me && b[o + BuildingField.queueLength] > 0) queuedAt.add(b[o + BuildingField.id]);
    this.autoSent = this.autoSent.filter((t) => tick <= t.tick + 1 && !queuedAt.has(t.building));
    const queued: Record<number, number> = {};
    const add = (t: number) => {
      queued[t] = (queued[t] ?? 0) + 1;
    };
    const inFlight = (id: number) => this.autoSent.some((t) => t.building === id) || this.pending.trains(id).length > 0;
    const sites: Site[] = [];
    const cities: number[] = [];
    for (let o = 0; o < b.length; o += BUILDING_STRIDE) {
      if (b[o + BuildingField.owner] !== view.me) continue;
      const id = b[o + BuildingField.id];
      const type = b[o + BuildingField.type];
      if ((b[o + BuildingField.flags] & BuildingFlag.AutoTrain) !== 0 && tick - (this.autoOff.get(id) ?? Number.NEGATIVE_INFINITY) >= 40) {
        this.autoOff.set(id, tick);
        this.autoCommand({ c: "auto_train", building: id, on: false });
      }
      for (const t of Game.queueOf(b, o)) add(t);
      for (const t of this.pending.trains(id)) add(t);
      const trains = view.rules.buildings[type]?.trains[0];
      const finished = b[o + BuildingField.progress] >= 1000 && b[o + BuildingField.hp] > 0;
      const free = finished && b[o + BuildingField.queueLength] === 0 && !inFlight(id);
      if (type === BuildingType.MainCity) {
        if (free) cities.push(id);
      } else if (AUTO_TRAIN.buildings.includes(type) && trains !== undefined) {
        sites.push({ id, trains, free: free && !this.autoArmy.paused.has(id) });
      }
    }
    for (const t of this.autoSent) add(t.unit);
    let farmers = 0;
    for (let o = 0; o < u.length; o += UNIT_STRIDE) if (u[o + UnitField.owner] === view.me && u[o + UnitField.type] === UnitType.Farmer) farmers++;
    const queuedAll = Object.values(queued).reduce((n, k) => n + k, 0);
    const budget = {
      have: this.stock(),
      reserve: this.reserveInEffect(),
      room: h[H.populationCap] - h[H.population] - queuedAll,
      mageRoom: h[H.mageCap] - h[H.mages] - (queued[UnitType.Mage] ?? 0),
    };
    const cost = (t: number) => view.rules.units[t]?.cost ?? { food: 0, wood: 0, gold: 0, crystal: 0 };
    const send = (building: number, unit: number) => {
      const seq = this.autoCommand({ c: "train", building, type: unit as UnitType, n: 1 });
      this.autoSent.push({ seq, tick, building, unit });
      const c = cost(unit);
      budget.have = { food: budget.have.food - c.food, wood: budget.have.wood - c.wood, gold: budget.have.gold - c.gold, crystal: budget.have.crystal - c.crystal };
      budget.room--;
    };
    const paused = h[H.paused] === 1;
    // The main city's villagers first (one at a time in each city), then the groups' soldiers.
    const missingVillagers = villagersMissing(this.autoArmy.villagerTarget, farmers, queued[UnitType.Farmer] ?? 0);
    let villagerBlock: Block | null = null;
    if (!this.autoArmy.villagersPaused && missingVillagers > 0) {
      let left = missingVillagers;
      for (const city of cities) {
        if (left <= 0 || paused) break;
        if (budget.room <= 0) villagerBlock = "population";
        else if (!affordsAbove(cost(UnitType.Farmer), budget.have, budget.reserve)) villagerBlock = "money";
        else {
          send(city, UnitType.Farmer);
          left--;
        }
      }
      if (cities.length === 0 && budget.room <= 0) villagerBlock = "population";
    }
    this.villagersSeen = { living: farmers, queued: queued[UnitType.Farmer] ?? 0, block: villagerBlock };
    const groups: GroupNeed[] = this.army.groups.map((g) => {
      const have: Record<number, number> = {};
      for (const id of g.ids) {
        if (view.unitRow(id) < 0) continue;
        const t = view.unitType(id);
        have[t] = (have[t] ?? 0) + 1;
      }
      return { refill: g.refill, want: g.want, have };
    });
    const need = armyNeed(groups, queued);
    const picked = pickTrains(need, paused ? [] : sites, cost, budget);
    for (const t of picked.trains) send(t.building, t.type);
    this.armyNeedSeen = need;
    this.armyBlocked = picked.blocked;
    this.autoPopulationFull = villagerBlock === "population" || [...picked.blocked.values()].includes("population");
  }

  /** 自動訓練 paused for this building (D-098: the screen's own, kept in the save). */
  autoPaused(building: number): boolean {
    return this.autoArmy.paused.has(building);
  }

  toggleAutoPaused(building: number): void {
    const now = this.autoArmy.togglePaused(building);
    const o = this.view?.buildingRow(building) ?? -1;
    const name = (o < 0 ? undefined : BUILDING_NAME[this.view?.curr?.snap.buildings[o + BuildingField.type] ?? -1]) ?? "建築";
    this.toast(`已${now ? "暫停" : "恢復"}這座${name}的自動訓練`, "ok");
  }

  /**
   * What a barracks, range, mage hall or stable of ours does about 自動訓練 (D-098), in the
   * player's words: 「補軍團缺的：槍 3、遠 2」, 「軍團都滿，不訓練」, 「還沒設軍團，不會自動訓練」.
   */
  trainingLine(building: number): string {
    if (this.autoArmy.paused.has(building)) return "自動訓練暫停";
    const need = this.armyNeedSeen;
    if (need.reason === "none") return "還沒設軍團，不會自動訓練";
    if (need.reason === "off") return "軍團都關了自動補兵，不會自動訓練";
    if (need.reason === "full") return "軍團都滿，不訓練";
    const view = this.view;
    const o = view?.buildingRow(building) ?? -1;
    const type = o < 0 ? undefined : view?.curr?.snap.buildings[o + BuildingField.type];
    const trains = type === undefined ? undefined : view?.rules.buildings[type]?.trains[0];
    const block = trains === undefined ? undefined : this.armyBlocked.get(trains);
    const why = block === "population" ? "（人口滿了：蓋民居）" : block === "money" ? "（錢不夠：只用預留以上的）" : block === "mages" ? "（法師已到上限）" : "";
    return `補軍團缺的：${missingText(need.missing)}${why}`;
  }

  /** The main city's villagers (D-098): 「村民 32／40，訓練中」. */
  villagerLine(): string {
    const a = this.autoArmy;
    const v = this.villagersSeen;
    if (a.villagersPaused) return `村民 ${v.living}／${a.villagerTarget}，自動訓練暫停`;
    if (villagersMissing(a.villagerTarget, v.living, v.queued) === 0) return `村民 ${v.living}／${a.villagerTarget}${v.queued > 0 ? "，訓練中" : "，夠了"}`;
    const why = v.block === "population" ? "，人口滿了：蓋民居" : v.block === "money" ? "，錢不夠：只用預留以上的" : "，訓練中";
    return `村民 ${v.living}／${a.villagerTarget}${why}`;
  }

  stepVillagerTarget(by: number): void {
    this.autoArmy.stepTarget(by);
  }

  toggleVillagers(): void {
    this.autoArmy.villagersPaused = !this.autoArmy.villagersPaused;
    this.toast(`已${this.autoArmy.villagersPaused ? "暫停" : "恢復"}主城自動訓練村民`, "ok");
  }

  /** 取消 on the town's panel: no more waiting; the 留守 soldiers stay (the town still waits for a choice). */
  cancelGovernWait(town: number): void {
    if (!this.governWaits.has(town)) return;
    this.endGovernWait(town);
    this.toast("已取消等錢治理，留守的兵照樣守著");
  }

  /**
   * Every snapshot: a waiting town still ours and waiting for a choice gets its 治理 once the cost
   * is there; one where 治理 has started, or no longer ours or waiting, is let go.
   */
  private tickGovernWaits(): void {
    const view = this.view;
    const t = view?.curr?.snap.towns;
    if (view === null || t === undefined || this.governWaits.size === 0) return;
    const tick = view.header?.[H.tick] ?? 0;
    const have = this.stock();
    for (const town of this.governWaits.list()) {
      const o = view.townRow(town);
      if (o < 0) continue;
      const ours = t[o + TownField.owner] === view.me;
      const state = t[o + TownField.state];
      if (ours && state === TownState.AwaitingChoice) {
        if (this.governWaits.due(town, have, tick)) this.governWaits.sent(town, this.autoCommand({ c: "town_choice", town, choice: TownChoice.Govern }));
        continue;
      }
      const started = ours && state === TownState.Repairing && this.governWaits.isSent(town);
      this.endGovernWait(town);
      if (started) this.toast(`開始治理${view.knownTowns.get(town)?.size === TownSize.Large ? "大城" : "小鎮"}`, "ok");
    }
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

  /**
   * 點存放建築派村民 (D-066): our villagers as the depot panel needs them. Those hiding in a
   * building (全體回城) are left out.
   */
  private workers(): Worker[] {
    const view = this.view;
    const u = view?.curr?.snap.units;
    const b = view?.curr?.snap.buildings;
    if (view === null || u === undefined || b === undefined) return [];
    const out: Worker[] = [];
    for (let o = 0; o < u.length; o += UNIT_STRIDE) {
      if (u[o + UnitField.owner] !== view.me || u[o + UnitField.type] !== UnitType.Farmer || u[o + UnitField.action] === Action.Garrisoned) continue;
      const x = u[o + UnitField.x] / CELL;
      const y = u[o + UnitField.y] / CELL;
      const order = u[o + UnitField.order];
      const t = u[o + UnitField.orderTarget];
      let gathers: Resource | null = null;
      let at: { x: number; y: number } | null = null;
      if (order === Order.Gather) {
        // A node, or a farm of ours (ids of nodes and of buildings can be the same number): the one nearer the villager, as villagers() does.
        const row = view.nodes.get(t);
        const bo = view.buildingRow(t);
        const farm = bo >= 0 && b[bo + BuildingField.owner] === view.me && b[bo + BuildingField.type] === BuildingType.Farm;
        const node = row === undefined ? null : { x: row[NodeField.cellX] + 0.5, y: row[NodeField.cellY] + 0.5 };
        const field = farm ? { x: b[bo + BuildingField.cellX] + 1.5, y: b[bo + BuildingField.cellY] + 1.5 } : null;
        const dist = (p: { x: number; y: number } | null) => (p === null ? Infinity : Math.hypot(x - p.x, y - p.y));
        if (row !== undefined && dist(node) <= dist(field)) {
          gathers = NODE_RESOURCE[row[NodeField.kind]] ?? null;
          at = node;
        } else if (farm) {
          gathers = Resource.Food;
          at = field;
        }
      }
      const idle = order === Order.None || (u[o + UnitField.flags] & UnitFlag.IdleFarmer) !== 0;
      const busy = order === Order.Build || order === Order.Repair;
      out.push({ id: u[o + UnitField.id], x, y, gathers, at, idle, busy });
    }
    return out;
  }

  /** Our finished buildings that take food, wood or gold (D-066). */
  private depots(): Depot[] {
    const view = this.view;
    const b = view?.curr?.snap.buildings;
    if (view === null || b === undefined) return [];
    const out: Depot[] = [];
    for (let o = 0; o < b.length; o += BUILDING_STRIDE) {
      if (b[o + BuildingField.owner] !== view.me || b[o + BuildingField.progress] < 1000) continue;
      const info = view.rules.buildings[b[o + BuildingField.type]];
      if (info === undefined || !info.accepts.some((r) => DEPOT_RESOURCES.includes(r))) continue;
      out.push({ id: b[o + BuildingField.id], cx: b[o + BuildingField.cellX], cy: b[o + BuildingField.cellY], size: info.size, accepts: info.accepts });
    }
    return out;
  }

  /** The resources a depot panel shows for this building of ours (none for others, nor for the main city, D-070). */
  depotResources(building: number): Resource[] {
    const view = this.view;
    const d = this.depots().find((v) => v.id === building);
    const o = view?.buildingRow(building) ?? -1;
    const b = view?.curr?.snap.buildings;
    if (view === null || d === undefined || o < 0 || b === undefined) return [];
    return panelResources(b[o + BuildingField.type], d.accepts);
  }

  /** How many of our villagers bring `resource` back to this building (D-066). */
  depotWorkers(building: number, resource: Resource): number {
    return workersAt(this.workers(), this.depots(), building, resource).length;
  }

  /** ＋遠程／＋法師 (D-080): our soldiers on their way to hide in this building, not inside yet. */
  hidingComing(building: number): number {
    const view = this.view;
    const u = view?.curr?.snap.units;
    if (view === null || u === undefined) return 0;
    let n = 0;
    for (let o = 0; o < u.length; o += UNIT_STRIDE) {
      if (u[o + UnitField.owner] === view.me && isHiding(u[o + UnitField.order]) && u[o + UnitField.orderTarget] === building && u[o + UnitField.action] !== Action.Garrisoned) n++;
    }
    return n;
  }

  /**
   * ＋遠程／＋法師 (D-080: 「箭塔應該是可以點擊然後把弓箭手或是法師放進去」): one soldier of this
   * type called in to hide in this building of ours, by the player's own `garrison` order
   * (garrison.ts says whom); on an outpost, ＋槍兵 posts one (`post`). The message says why nobody
   * came when nobody does.
   */
  callToHide(building: number, type: number): void {
    const view = this.view;
    const snap = view?.curr?.snap;
    const o = view?.buildingRow(building) ?? -1;
    if (view === null || snap === undefined || o < 0) return;
    const b = snap.buildings;
    const kind = b[o + BuildingField.type];
    const holds = holdsOf(view.rules, kind);
    const name = BUILDING_NAME[kind] ?? "建築";
    // 哨所 (D-080): spearmen posted there, those on their way included (`posted`).
    const outpost = kind === BuildingType.Outpost;
    const room = outpost ? outpostSlots(view.rules) : holds;
    const taken = outpost ? b[o + BuildingField.posted] : b[o + BuildingField.soldiers] + this.hidingComing(building);
    if (taken >= room) {
      this.depotSay(building, callFullText(name, room));
      return;
    }
    const u = snap.units;
    const units: Callable[] = [];
    for (let p = 0; p < u.length; p += UNIT_STRIDE) {
      if (u[p + UnitField.owner] !== view.me) continue;
      const id = u[p + UnitField.id];
      const order = u[p + UnitField.order];
      units.push({ id, type: u[p + UnitField.type], x: u[p + UnitField.x] / CELL, y: u[p + UnitField.y] / CELL, idle: order === Order.None, hiding: isHiding(order) || isPosted(order), stationed: this.army.isGarrisoned(id) });
    }
    const size = view.rules.buildings[kind]?.size ?? 1;
    const id = pickToHide(units, type, { cx: b[o + BuildingField.cellX], cy: b[o + BuildingField.cellY], size });
    if (id === null) {
      this.depotSay(building, callNoneText(UNIT_NAME[type] ?? "兵"));
      return;
    }
    if (kind === BuildingType.Outpost) {
      this.command({ c: "post", u: [id], building });
      this.depotSay(building, "叫 1 名槍兵來駐守");
      return;
    }
    this.command({ c: "garrison", u: [id], building });
    this.depotSay(building, `叫 1 名${UNIT_NAME[type] ?? "兵"}躲進${name}`);
  }

  /** 哨所 (D-080): how many it takes, how many are posted there (on their way or on guard), and whether it holds. */
  outpostState(building: number): { slots: number; posted: number; hold: boolean; text: string } | null {
    const view = this.view;
    const b = view?.curr?.snap.buildings;
    const o = view?.buildingRow(building) ?? -1;
    if (view === null || b === undefined || o < 0 || b[o + BuildingField.type] !== BuildingType.Outpost) return null;
    const hold = (b[o + BuildingField.flags] & BuildingFlag.Hold) !== 0;
    return { slots: outpostSlots(view.rules), posted: b[o + BuildingField.posted], hold, text: outpostModeText(view.rules, hold) };
  }

  /** ＋ on a depot (D-066): one villager more gathering `resource` for it, as the player's own order. */
  depotSend(building: number, resource: Resource): void {
    const view = this.view;
    const depot = this.depots().find((v) => v.id === building);
    const b = view?.curr?.snap.buildings;
    if (view === null || depot === undefined || b === undefined) return;
    const workers = this.workers();
    const id = pickToSend(workers, depot, resource);
    if (id === null) {
      this.depotSay(building, "沒有可以派的村民");
      return;
    }
    const nodes: DepotNode[] = [...view.nodes.values()].map((r) => ({ id: r[NodeField.id], kind: r[NodeField.kind], cx: r[NodeField.cellX], cy: r[NodeField.cellY], amount: r[NodeField.amount] }));
    const farms: DepotFarm[] = [];
    for (let o = 0; o < b.length; o += BUILDING_STRIDE) {
      if (b[o + BuildingField.owner] !== view.me || b[o + BuildingField.type] !== BuildingType.Farm || b[o + BuildingField.progress] < 1000) continue;
      const cx = b[o + BuildingField.cellX];
      const cy = b[o + BuildingField.cellY];
      const centre = { x: cx + 1.5, y: cy + 1.5 };
      // Worked, or someone on the way to it.
      const taken = workers.some((w) => w.gathers === Resource.Food && w.at !== null && w.at.x === centre.x && w.at.y === centre.y);
      farms.push({ id: b[o + BuildingField.id], cx, cy, size: view.rules.buildings[BuildingType.Farm]?.size ?? 3, taken });
    }
    const to = sendTarget(depot, resource, nodes, farms);
    if ("error" in to) {
      this.depotSay(building, to.error);
      return;
    }
    // A farm is worked with `repair`, a node with `gather` (sim/PROTOCOL.md 3.1); both make the villager the player's own (HandPicked, core #149).
    const cmd: CommandBody = "farm" in to ? { c: "repair", u: [id], building: to.farm } : { c: "gather", u: [id], node: to.node };
    this.apply([{ kind: "command", cmd }]);
    if (resource === Resource.Crystal && "node" in to) {
      // The vein may be nearer the main city: the crystal goes there and the mine's count stays (ceo 2026-10-20).
      const row = view.nodes.get(to.node);
      const goesTo = row === undefined ? null : depotFor({ x: row[NodeField.cellX] + 0.5, y: row[NodeField.cellY] + 0.5 }, resource, this.depots());
      const go = goesTo === null ? -1 : view.buildingRow(goesTo);
      this.depotSay(building, crystalSentText(building, goesTo, go < 0 ? "建築" : (BUILDING_NAME[b[go + BuildingField.type]] ?? "建築")), "ok");
      return;
    }
    this.depotSay(building, `派 1 名村民去${"farm" in to ? "種田" : `採${RESOURCE_WORD[resource] ?? ""}`}`);
  }

  /**
   * － on a depot (D-066): the villager gathering `resource` here farthest from it puts the
   * work down and goes back to the economy ratio (`release`, core #149), not to 待命.
   */
  depotTake(building: number, resource: Resource): void {
    const depot = this.depots().find((v) => v.id === building);
    if (depot === undefined) return;
    const id = pickToTake(this.workers(), this.depots(), depot, resource);
    if (id === null) {
      this.depotSay(building, `這裡沒有村民在採${DEPOT_WORD[resource] ?? ""}`);
      return;
    }
    this.apply([{ kind: "command", cmd: { c: "release", u: [id] } }]);
    this.depotSay(building, `1 名採${DEPOT_WORD[resource] ?? ""}的村民放下工作，交給經濟分配`);
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
    // 哨所 (D-080) and 躲進建築 (D-083): those posted at an outpost, and those hiding in a building
    // or on their way to, leave their groups, as those stationed in a town do. Those who hid are
    // not taken by 自動補兵 again, inside or once out, until the player puts them in a group.
    const u = view.curr?.snap.units;
    if (u === undefined) return;
    const posted: number[] = [];
    const hiding: number[] = [];
    for (let o = 0; o < u.length; o += UNIT_STRIDE) {
      if (u[o + UnitField.owner] !== view.me) continue;
      const order = u[o + UnitField.order];
      if (isPosted(order)) posted.push(u[o + UnitField.id]);
      else if (isHiding(order) && isSoldier(u[o + UnitField.type])) hiding.push(u[o + UnitField.id]);
    }
    this.army.keepOut(hiding);
    if (posted.length + hiding.length === 0) return;
    // Out of the alarm's base too (D-083): only the fallen bring it.
    this.army.leaveGroups([...posted, ...hiding]).forEach((n, i) => {
      if (n > 0) this.alarms.left(i, n);
    });
  }

  // --- 編隊自動補兵 (D-026, GDD §10) ------------------------------------------------------

  /**
   * A soldier of ours was trained: it joins the control group short of its type; with none
   * short, the group with the most soldiers (D-054); with no group at all, it stays where
   * the simulation put it. It sets off for the group at once, if anyone is in it (D-080:
   * otherwise it stays where it stands).
   */
  private enlist(id: number, type: number): void {
    const view = this.view;
    if (view === null) return;
    const typeOf = (m: number): number | null => (view.unitRow(m) >= 0 ? view.unitType(m) : null);
    const short = this.army.enlist(id, type, typeOf);
    const i = short ?? this.army.joinLargest(id, type, typeOf);
    if (i === null) return;
    const others = this.army.groups[i].ids.filter((m) => m !== id && view.unitRow(m) >= 0);
    const tick = view.header?.[H.tick] ?? 0;
    if (tick - this.recruitMessageTick >= RECRUIT_MESSAGE_TICKS) {
      this.recruitMessageTick = tick;
      const going = others.length > 0 ? "，正走過去" : "，在原地待命";
      this.toast(short !== null ? `新的${UNIT_NAME[type] ?? "兵"}補進編隊 ${i + 1}${going}` : `新的${UNIT_NAME[type] ?? "兵"}加入兵最多的編隊 ${i + 1}${going}`);
    }
    // It takes the group's formation (D-027): 散開 when more than half of the others are. New
    // units are 密集, and on their way to the rally point the simulation only sets the flag.
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
    for (const o of this.army.muster(tick, where)) this.autoCommand({ c: "move", u: o.ids, x: o.cellX, y: o.cellY });
  }

  /**
   * 軍團 (D-050): every snapshot, the soldiers in no group and not stationed join the groups
   * short of their type, and set off to them (musterRecruits). Only those standing with no
   * order and not holding: an order of the player's, 堅守 included, is not undone.
   */
  private draftArmy(): void {
    const view = this.view;
    if (view === null) return;
    const idle = (id: number): boolean => view.unitOrder(id) === Order.None && this.stances.of(id, view.unitStance(id)) !== Stance.Hold;
    // Those hiding have left their groups (D-083), which fill up again; they are never drafted
    // themselves, inside (order Garrison, not idle) or once out (ArmyBook.keepOut).
    for (const d of this.army.draft(this.soldiers(true), idle)) {
      const others = this.army.groups[d.group].ids.filter((m) => !d.ids.includes(m) && view.unitRow(m) >= 0);
      // With nobody in the group to join, they are the group where they stand (D-080).
      this.toast(`${d.ids.length} 名沒編隊的兵補進編隊 ${d.group + 1}${others.length > 0 ? "，正走過去" : "，在原地待命"}`);
      // They take the group's formation, as recruits do (D-027).
      if (mostlyLoose(others, (m) => view.unitLoose(m))) this.autoCommand({ c: "formation", u: d.ids, loose: true });
    }
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

  /**
   * 閃紅提醒 and 「退」 (D-081): every snapshot, whether each group advances (alarm.ts
   * groupAdvancing: some soldier of it 進攻中, those hiding in a building and the new soldiers
   * 自動補兵 leads to it left out) and its 現有 (living members, as its button counts them); the
   * strip says it once when one is down to fewer than half.
   */
  private updateGroupAlarms(): void {
    const view = this.view;
    if (view === null) return;
    this.alarmState = this.army.groups.map((g, i) => {
      const alive = g.ids.filter((id) => view.unitRow(id) >= 0);
      const advancing = groupAdvancing(alive, g.recruits, (id) => (isHiding(view.unitOrder(id)) || !isSoldier(view.unitType(id)) ? null : orderState(view, id)));
      const a = this.alarms.update(i, advancing, alive.length);
      if (a.tell && a.base !== null) this.toast(alarmText(i, alive.length, a.base));
      return { ...a, present: alive.length };
    });
  }

  /** Group i's advance and alarm, for its button and its 「退」 (D-081). */
  groupAlarm(i: number): Alarm & { present: number } {
    return this.alarmState[i];
  }

  /**
   * 「退」 beside an advancing group's button (D-081, the user's choice 3b-A): the group, recruits
   * on their way included, retreats to the main city as 退回主城 does; those hiding in a building
   * stay (orders to many leave them, ceo 2026-10-07). What is selected stays selected.
   */
  retreatGroup(i: number): void {
    const view = this.view;
    if (view === null) return;
    const u = this.army.groups[i].ids.filter((id) => view.unitRow(id) >= 0 && !isHiding(view.unitOrder(id)));
    const home = view.homeCell();
    if (u.length === 0) return;
    if (home === null) {
      this.toast("主城不在了，沒有地方可以撤退");
      return;
    }
    this.command({ c: "retreat", u, x: home.x, y: home.y }, true);
    this.toast(`編隊 ${i + 1} 撤回主城`);
  }

  /** The most of one type a group may want: the population's ceiling (D-083), the snapshot's. */
  groupWantMax(): number {
    const view = this.view;
    if (view === null) return 1;
    const ceiling = view.header?.[H.populationCeiling] ?? 0;
    return groupWantMax(view.rules, ceiling > 0 ? ceiling : null);
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
        this.started.ready = performance.now();
        this.view = new GameView(msg.player ?? 0, msg.map, msg.rules);
        // The map as a diamond (D-085; docs/sprite-atlas.md section 1): the camera, taps and boxes, and the drawing.
        const projection = this.options.view === undefined ? PROJECTION_DEFAULT : PROJECTIONS[this.options.view];
        this.view.projection = projection;
        const world = msg.map.size * TILE_PX;
        this.camera = new Camera(world, world, projection);
        this.camera.resize(this.app.screen.width, this.app.screen.height);
        this.camera.zoomAt(0, 0, START_ZOOM);
        const home = msg.map.spawns.find((s) => s.player === this.view?.me);
        if (home !== undefined) this.camera.centerOn((home.cellX + 0.5) * TILE_PX, (home.cellY + 0.5) * TILE_PX);
        const cam = this.camera;
        this.view.onScreen = (wx, wy) => {
          const v = cam.visible();
          return wx >= v.x0 && wx <= v.x1 && wy >= v.y0 && wy <= v.y1;
        };
        const view = this.view;
        const mine = this.culture;
        this.renderer = new WorldRenderer(this.app, view, atlasFor(this.app.renderer), this.options.art ?? null, (owner) => cultureOf(mine, owner, view.me), projection);
        this.renderer.pending = this.pending;
        this.renderer.autoPaused = (id) => this.autoArmy.paused.has(id);
        if (this.options.ghost === "outline") this.renderer.ghostStyle = "outline";
        const ground = this.options.ground ?? null;
        if (ground !== null && !this.renderer.useGround(ground, this.options.groundQuality ?? "high")) console.warn("ground: 寫實地面 needs ui's terrain pictures (art-v5, square on); the flat ground stays");
        const resize = (w: number, h: number) => cam.resize(w, h);
        this.app.renderer.on("resize", resize);
        this.cleanups.push(() => this.app.renderer.off("resize", resize));
        this.lab.log.add(`ready seed ${this.options.seed} ${JSON.stringify(this.options.env())}`);
        // 繼續上一局: the simulation waits where the game was, as when the page comes back from
        // the background (GDD §11): paused until 繼續.
        if (this.restoring !== null) {
          this.paused = true;
          this.controls.setPaused(true);
        }
        break;
      }
      case "snapshot": {
        const view = this.view;
        if (view === null) return;
        const now = performance.now();
        view.push(msg, now);
        this.lab.snapshot(msg.header, now);
        const tick = view.header?.[H.tick] ?? 0;
        if (this.restoring !== null) this.restoreScreen(this.restoring, tick);
        else if (tick >= this.nextSave) {
          this.nextSave = (Math.floor(tick / SAVE_EVERY_TICKS) + 1) * SAVE_EVERY_TICKS;
          this.options.minute?.();
        }
        for (const ev of msg.events) {
          if (ev.k === "rejected") {
            this.pending.refused(ev.seq);
            const cmd = this.sent.find((c) => c.seq === ev.seq);
            // 自動訓練's own train (D-098): forget it; the next snapshot decides again.
            this.autoSent = this.autoSent.filter((t) => t.seq !== ev.seq);
            const waiting = this.governWaits.townOf(ev.seq);
            if (waiting >= 0) {
              // 等錢治理's own 治理: spent the same step (自動訓練), try again; else (taken, lost) stop waiting.
              if (ev.reason === Reject.CannotAfford) this.governWaits.retry(waiting, view.header?.[H.tick] ?? 0);
              else this.endGovernWait(waiting);
              continue;
            }
            if (cmd?.c === "town_choice" && cmd.choice === TownChoice.Govern && cmd.auto !== true && ev.reason === Reject.CannotAfford) {
              // 治理 the screen thought affordable, spent the same step: the soldiers stay, and it waits (ceo 2026-10-21).
              this.army.keepStationed(ev.seq);
              const cost = this.governCost(cmd.town);
              if (cost !== null) this.startGovernWait(cmd.town, cost);
              continue;
            }
            // A refused 搶 or 治理: the soldiers stationed with it go back to 積極 and to 全軍.
            this.setStance(this.army.refused(ev.seq), Stance.Aggressive);
            if (cmd?.auto !== true) this.overlays.toast(rejectText(ev.reason, cmd));
          } else {
            if (ev.k === "unit_trained") this.enlist(ev.id, ev.type);
            if (ev.k === "shot") this.drawShot(ev.building, ev.target, now, ev.n ?? 1);
            this.hud.onEvent(ev);
          }
        }
        this.stances.settle(view.header?.[H.tick] ?? 0, (id) => (view.unitRow(id) >= 0 ? view.unitStance(id) : null));
        this.watchEnemies(view, tick);
        this.cannonsOn(view);
        this.pending.settle(view.header?.[H.tick] ?? 0);
        this.controls.setWaiting(this.pending.waiting);
        this.pruneArmy();
        this.tickGovernWaits();
        this.tickAutoArmy();
        this.draftArmy();
        this.musterRecruits();
        this.followCharges();
        this.updateGroupAlarms();
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
        for (const w of this.logWaiters.splice(0)) w({ jsonl: msg.jsonl, hashes: msg.hashes ?? [], tick: msg.tick ?? this.currentTick() });
        break;
      case "continue_progress":
        this.options.progress?.(msg.tick, msg.toTick);
        break;
      case "continue_failed":
        this.lab.log.add(`continue_failed ${msg.reason} tick ${msg.tick} ${msg.message}`);
        this.restoring = null;
        this.options.continueFailed?.(msg.reason, msg.tick);
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
    this.renderer.paused = this.paused;
    this.renderer.draw(now, cam, this.placement);
    this.hud.frame(now);
    this.frameTimes.add(dt, performance.now() - now);
    // ✓ and ✗ follow the preview on screen while the camera pinches or flings (a few style writes).
    if (this.placement?.phase === "confirm") this.showPlaceButtons();
    const header = view.header;
    this.lab.frame(now, dt, {
      hidden: document.hidden,
      paused: header !== null && header[H.paused] === 1,
      normalSpeed: header === null || header[H.speed] === SPEED_TPS.normal * 100,
      draws: takeDraws(),
      contextLost: gpu.contextLost,
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
    if (this.mode === "post") return this.postAt(w.x, w.y);
    if (this.mode === "wall") return this.wallAt(w.x, w.y);
    this.apply(tapIntents(view, view.selection, this.mode, w.x, w.y, count, this.hitRadius(), UNIT_CORE_HIT_PT / (this.camera?.scale ?? 1)));
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

  /** The known town whose castle (walls and gates included) holds the cell at (wx, wy) world px, or null. */
  private townAtCell(wx: number, wy: number): TownSpot | null {
    const view = this.view;
    if (view === null) return null;
    const cx = Math.floor(wx / TILE_PX);
    const cy = Math.floor(wy / TILE_PX);
    for (const town of view.knownTowns.values()) {
      const box = view.castleBox(town);
      if (box !== null && cx >= box.x0 && cx <= box.x1 && cy >= box.y0 && cy <= box.y1) return town;
    }
    return null;
  }

  /**
   * 牆上 (D-096): our units on a town's wall or on their way up (they hold a place, as the
   * simulation counts them), and its wall cells (walls and corner towers); null for a town not ours
   * (ceo: nothing about others' walls).
   */
  wallCount(town: number): { on: number; capacity: number } | null {
    const view = this.view;
    const spot = view?.knownTowns.get(town);
    const u = view?.curr?.snap.units;
    const t = view?.curr?.snap.towns;
    const o = view?.townRow(town) ?? -1;
    if (view === null || spot === undefined || u === undefined || t === undefined || o < 0) return null;
    if (view.rules.features?.walls !== true || !heldTown(t[o + TownField.owner], t[o + TownField.state], view.me)) return null;
    let on = 0;
    for (let k = 0; k < u.length; k += UNIT_STRIDE) if (u[k + UnitField.owner] === view.me && u[k + UnitField.order] === Order.Wall && u[k + UnitField.orderTarget] === town) on++;
    return { on, capacity: view.castleOf(spot)?.wall.length ?? 0 };
  }

  /** 上城牆 (D-096): the town tapped takes the ranged units and mages selected on its wall, or the player is told why not. */
  private wallAt(wx: number, wy: number): void {
    const view = this.view;
    if (view === null) return;
    const spot = this.townAtCell(wx, wy);
    const o = spot === null ? -1 : view.townRow(spot.id);
    const t = view.curr?.snap.towns;
    const count = spot === null ? null : this.wallCount(spot.id);
    const town = spot === null ? null : { id: spot.id, held: o >= 0 && t !== undefined && heldTown(t[o + TownField.owner], t[o + TownField.state], view.me), onWall: count?.on ?? 0, capacity: count?.capacity ?? 0 };
    const r = wallTap(view.selection.units, town, (id) => goesOnWalls(view.unitType(id)));
    if ("error" in r) {
      this.toast(r.error);
      return;
    }
    this.apply([{ kind: "command", cmd: r.cmd }, { kind: "endMode" }]);
    if (r.cmd.c === "wall") this.toast(`${r.cmd.u.length} 名上城牆`);
  }

  /** 下城牆 (D-096): those selected on a wall (or going up) come down, into the town. */
  leaveWall(): void {
    const view = this.view;
    const u = view?.curr?.snap.units;
    if (view === null || u === undefined) return;
    const rows = view.selection.units
      .map((id) => ({ id, o: view.unitRow(id) }))
      .filter((r) => r.o >= 0)
      .map((r) => ({ id: r.id, order: u[r.o + UnitField.order], town: u[r.o + UnitField.orderTarget] }));
    const cmds = leaveWalls(rows);
    for (const cmd of cmds) this.command(cmd);
    if (cmds.length > 0) this.toast(`${cmds.reduce((n, c) => n + ("u" in c && Array.isArray(c.u) ? c.u.length : 0), 0)} 名下城牆`);
  }

  /** 駐守 (D-080): the outpost tapped takes the spearmen selected, or the player is told why not. */
  private postAt(wx: number, wy: number): void {
    const view = this.view;
    if (view === null) return;
    const pick = view.buildingAt(wx, wy);
    const b = view.curr?.snap.buildings;
    const o = pick === null ? -1 : view.buildingRow(pick.id);
    const target = pick === null || o < 0 || b === undefined ? null : { id: pick.id, owner: pick.owner, type: pick.type, done: b[o + BuildingField.progress] >= 1000 };
    const r = postTap(view.selection.units, target, view.me, (id) => view.unitType(id) === POST_TYPE);
    if ("error" in r) {
      this.toast(r.error);
      return;
    }
    this.apply([{ kind: "command", cmd: r.cmd }, { kind: "endMode" }]);
    if (r.cmd.c === "post") this.toast(`${r.cmd.u.length} 名槍兵去駐守哨所`);
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
    // The box as the screen shows it, on the plane (as a diamond it is no box of cells: D-085).
    const cam = this.camera;
    if (cam === null) return;
    const a = cam.screenToPlane(x0, y0);
    const b = cam.screenToPlane(x1, y1);
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
          // Not once chosen while paused (R6-31: it waits for 繼續).
          // Not while it waits for 治理's cost (等錢治理): its panel has 搶 and 取消.
          if (it.pick.kind === "town" && view.townAwaitsMyChoice(it.pick.id) && this.pending.townChoice(it.pick.id) === null && !this.governWaits.has(it.pick.id)) this.hud.openTownChoice(it.pick.id);
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
    // Another building selected (or none): a depot's message about the one before goes.
    if (this.depotToast !== null && view.selection.building !== this.depotToast.building) {
      this.overlays.clearToast(this.depotToast.text);
      this.depotToast = null;
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

  /** 射箭 (round 7, `shot`): an arrow from the building's centre to the unit it shot at; a town gate's from its tower (D-096 shoot_at_m). */
  private drawShot(building: number, target: number, now: number, n = 1): void {
    const view = this.view;
    const from = this.buildingCentre(building);
    const o = view?.unitRow(target) ?? -1;
    if (view === null || this.renderer === null || from === null || o < 0) return;
    const to = view.unitPos(o);
    const b = view.curr?.snap.buildings;
    const row = view.buildingRow(building);
    const tower = b !== undefined && row >= 0 && b[row + BuildingField.type] === BuildingType.Gate ? this.renderer.gateShootFrom(b[row + BuildingField.cellX], b[row + BuildingField.cellY], to.x, to.y) : null;
    this.renderer.shot(tower?.x ?? from.x, tower?.y ?? from.y, to.x, to.y, now, n, tower?.lift ?? 0);
  }

  private buildingCentre(id: number): { x: number; y: number } | null {
    const view = this.view;
    const o = view?.buildingRow(id) ?? -1;
    const b = view?.curr?.snap.buildings;
    if (view === null || o < 0 || b === undefined) return null;
    const c = view.footprintCentre(b, o);
    return { x: c.x * TILE_PX, y: c.y * TILE_PX };
  }

  /**
   * 整理隊形 (D-095): the soldiers selected re-form where they are, spearmen in front, ranged next,
   * mages last, at their spacing, facing the way reform.ts picks: standing together, the
   * simulation's re-forming in place with that `face`; spread out, a walk of one cell that way
   * (the simulation lays a walk's formation out facing its way), which gathers them; with nothing
   * to face, the re-forming in place without `face`, which keeps the way they face now. Not with
   * an enemy within REFORM_CLEAR_CELLS (reform.ts): a line says why, and nothing is sent.
   */
  reform(): void {
    const view = this.view;
    const u = view?.curr?.snap.units;
    if (view === null || u === undefined) return;
    const soldiers = view.selection.units.filter((id) => isSoldier(view.unitType(id)) && !isHiding(view.unitOrder(id)));
    if (soldiers.length === 0) return;
    const at = soldiers.map((id) => {
      const o = view.unitRow(id);
      return { x: u[o + UnitField.x] / CELL, y: u[o + UnitField.y] / CELL };
    });
    const inSight = this.enemiesInSight(view);
    if (enemyTooClose(at, inSight)) {
      this.toast(REFORM_TEXT.near);
      return;
    }
    const centre = { x: at.reduce((n, p) => n + p.x, 0) / at.length, y: at.reduce((n, p) => n + p.y, 0) / at.length };
    const tick = view.header?.[H.tick] ?? 0;
    const last = soldiers.map((id) => this.lastSent.get(id)).find((d) => d !== undefined) ?? null;
    const { dir, from } = reformFacing(centre, inSight, [...this.sightings.values()], tick, last, this.enemyCity(view));
    // The formation command re-forms them in place at the spacing most of them have (PROTOCOL.md 第三輪): the way they face now, or `face`.
    const loose = soldiers.filter((id) => (u[view.unitRow(id) + UnitField.flags] & UnitFlag.Loose) !== 0).length * 2 > soldiers.length;
    if (dir === null) this.command({ c: "formation", u: soldiers, loose });
    else if (oneCluster(at)) this.command({ c: "formation", u: soldiers, loose, face: dir16(Math.round(dir.x * 1024), Math.round(dir.y * 1024)) });
    else {
      // Spread out (spearmen gone after the enemy): a walk of one cell gathers them into one.
      const c = reformCell(centre, dir);
      this.command({ c: "retreat", u: soldiers, x: c.x, y: c.y });
    }
    this.toast(REFORM_TEXT[from]);
  }

  /** Enemies in sight now (cells): units of the other players and the towns' militia. */
  private enemiesInSight(view: GameView): Spot[] {
    const u = view.curr?.snap.units;
    const out: Spot[] = [];
    if (u === undefined) return out;
    for (let o = 0; o < u.length; o += UNIT_STRIDE) {
      if (u[o + UnitField.owner] === view.me) continue;
      out.push({ x: u[o + UnitField.x] / CELL, y: u[o + UnitField.y] / CELL });
    }
    return out;
  }

  /** The enemy's main city if this side knows where it is (seen, remembered), else null. */
  private enemyCity(view: GameView): Spot | null {
    const b = view.curr?.snap.buildings;
    if (b === undefined) return null;
    for (let o = 0; o < b.length; o += BUILDING_STRIDE) {
      if (b[o + BuildingField.type] !== BuildingType.MainCity || b[o + BuildingField.owner] === view.me) continue;
      const size = view.rules.buildings[BuildingType.MainCity]?.size ?? 4;
      return { x: b[o + BuildingField.cellX] + size / 2, y: b[o + BuildingField.cellY] + size / 2 };
    }
    return null;
  }

  /** Every snapshot: where each enemy in sight stands now; those not seen for a minute dropped. */
  private watchEnemies(view: GameView, tick: number): void {
    const u = view.curr?.snap.units;
    if (u === undefined) return;
    for (let o = 0; o < u.length; o += UNIT_STRIDE) {
      if (u[o + UnitField.owner] === view.me) continue;
      this.sightings.set(u[o + UnitField.id], { x: u[o + UnitField.x] / CELL, y: u[o + UnitField.y] / CELL, tick });
    }
    if (tick - this.prunedAt < 100) return;
    this.prunedAt = tick;
    for (const [id, s] of this.sightings) if (tick - s.tick > SIGHTING_TICKS) this.sightings.delete(id);
  }

  /**
   * D-095 (「拿掉，永遠自動」): a mage of ours with its cannon off (a game saved before, when it could
   * be turned off) gets it on again, once; the log keeps the order, so the replay is the same.
   */
  private cannonsOn(view: GameView): void {
    const u = view.curr?.snap.units;
    if (u === undefined || this.restoring !== null) return;
    const off: number[] = [];
    for (let o = 0; o < u.length; o += UNIT_STRIDE) {
      const id = u[o + UnitField.id];
      if (u[o + UnitField.owner] !== view.me || u[o + UnitField.type] !== UnitType.Mage || (u[o + UnitField.flags] & UnitFlag.Autocast) !== 0 || this.autocastAsked.has(id)) continue;
      off.push(id);
      this.autocastAsked.add(id);
    }
    if (off.length > 0) this.autoCommand({ c: "autocast", u: off, on: true });
  }

  /** The way each was sent (移動, 攻擊), from the middle of those sent. */
  private noteSent(cmd: CommandBody): void {
    const view = this.view;
    const u = view?.curr?.snap.units;
    if (view === null || u === undefined || !("u" in cmd) || !Array.isArray(cmd.u)) return;
    const rows = cmd.u.map((id) => view.unitRow(id)).filter((o) => o >= 0);
    if (rows.length === 0) return;
    const cx = rows.reduce((n, o) => n + u[o + UnitField.x], 0) / rows.length / CELL;
    const cy = rows.reduce((n, o) => n + u[o + UnitField.y], 0) / rows.length / CELL;
    let to: Spot | null = null;
    if (cmd.c === "move" || cmd.c === "retreat") to = { x: cmd.x + 0.5, y: cmd.y + 0.5 };
    else if (cmd.c === "attack") {
      const t = this.targetCell(cmd.target);
      to = t === null ? null : { x: t.x + 0.5, y: t.y + 0.5 };
    }
    if (to === null || (to.x === cx && to.y === cy)) return;
    for (const id of cmd.u) this.lastSent.set(id, { x: to.x - cx, y: to.y - cy });
  }

  /** 移動 in the command area (D-094; D-059's 撤退), with units selected: pick where to, as for 攻擊. */
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
    this.command({ c: "retreat", u, x: home.x, y: home.y }, true);
    this.toast(`全軍 ${u.length} 名退回主城`);
  }

  setMode(mode: Mode): void {
    this.mode = mode;
    if (mode === "normal") {
      this.overlays.hidePrompt();
      return;
    }
    const buttons: PromptButton[] = [];
    // 回主城 (D-059; D-094's name), while there is a main city to go back to.
    const home = this.view?.homeCell() ?? null;
    if (mode === "retreat" && home !== null) {
      buttons.push({ label: "回主城", primary: true, tone: "retreat", onTap: () => this.apply(retreatHome(this.view?.selection ?? { units: [], building: null }, home)) });
    }
    // 取消 while picking where to attack or move to: they stop and hold (D-054).
    const holds = mode === "advance" || mode === "retreat";
    buttons.push({ label: "取消", onTap: () => (holds ? this.cancelToHold() : this.setMode("normal")) });
    const view = this.view;
    // 躲進去 with spearmen in the selection too: only those who can hide go.
    const mixed = mode === "garrison" && view !== null && view.selection.units.some((id) => !garrisonTypes(view.rules).includes(view.unitType(id)));
    // 駐守 with others than spearmen selected: only the spearmen go (D-080).
    const mixedPost = mode === "post" && view !== null && view.selection.units.some((id) => view.unitType(id) !== POST_TYPE);
    // 上城牆 with others than ranged units and mages (D-096): only those go up.
    const mixedWall = mode === "wall" && view !== null && view.selection.units.some((id) => !goesOnWalls(view.unitType(id)));
    this.overlays.showPrompt(mixed ? GARRISON_PROMPT_MIXED : mixedPost ? POST_PROMPT_MIXED : mixedWall ? WALL_PROMPT_MIXED : MODE_PROMPT[mode], buttons);
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
    // D-094: 攻擊、移動 (the old 進攻、撤退); D-095: no cannon or autocast on a mage's.
    const label: Record<WheelItem, string> = {
      advance: allIn(view, view.selection.units, "advance") ? "取消攻擊" : "攻擊",
      retreat: allIn(view, view.selection.units, "retreat") ? "取消移動" : "移動",
      hold: "堅守",
    };
    this.overlays.openWheel(
      x,
      y,
      items.map((id) => ({ id, label: label[id], ...(id === "advance" || id === "retreat" ? { tone: id } : {}) })),
      (id) => {
        // 攻擊 while they attack, 移動 while they move: they stop and hold (D-054).
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
    // 箭樓 (round 7) says where it may go in the same short line (a longer one ran under the group buttons).
    // With outposts on (D-080) the line names them too, as short as before.
    const drag = type !== BuildingType.ArrowTower ? "拖曳預覽到想蓋的位置" : outpostSlots(view.rules) > 0 ? "拖曳箭樓到主城、城鎮或哨所附近" : "拖曳箭樓到主城或治理的城鎮附近";
    // 正式介面 (R6-30, NEW-12): 取消 here too, as 重設 is gone; after letting go, ✓ and ✗ as before.
    const cancel: PromptButton[] = formalUi() ? [{ label: "取消", onTap: () => this.cancelPlacement() }] : [];
    this.overlays.showPrompt(builders.length > 0 ? `${drag}，放開後按 ✓ 或 ✗` : `${drag}，放開後按 ✓ 或 ✗；會派最近的村民去蓋`, cancel);
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
    const landText = outpostSlots(view.rules) > 0 ? TOWER_LAND_TEXT_OUTPOST : TOWER_LAND_TEXT;
    // On a gate's lane, a ford or a bridge, or a castle's wall (D-089, R6-51): those first, the simulation's own reasons.
    const blocked = view.placement === null ? null : placeReason(view.placement, p.info, p.cellX, p.cellY);
    this.overlays.promptWarning(blocked ?? (offTowerLand ? landText : town === null ? null : MILITIA_WARNING));
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
      () => this.cancelPlacement(),
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

  /** ✗ (R6-31, R6-25-11): the preview shrinks and fades, and a line says so (no check: nothing was ordered). */
  private cancelPlacement(): void {
    const p = this.placement;
    if (p === null) return;
    this.renderer?.dropGhost(p.rect(), p.valid, performance.now());
    this.toast(`已取消蓋${BUILDING_NAME[p.info.type] ?? "建築"}`, "info");
    this.endPlacement();
  }

  private endPlacement(): void {
    this.placement = null;
    this.overlays.hidePlace();
    this.overlays.hidePrompt();
  }
}

/** A ring of the last frames' intervals and drawing times (ms). */
export class FrameTimes {
  private readonly gaps: Float64Array;
  private readonly draws: Float64Array;
  private count = 0;

  constructor(size: number) {
    this.gaps = new Float64Array(size);
    this.draws = new Float64Array(size);
  }

  add(gapMs: number, drawMs: number): void {
    const i = this.count % this.gaps.length;
    this.gaps[i] = gapMs;
    this.draws[i] = drawMs;
    this.count++;
  }

  clear(): void {
    this.count = 0;
  }

  /** Median and slowest 5 % of the frames kept (ms), the slowest draw, and fps from the median gap. */
  summary(): { frames: number; gapMedian: number; gapP95: number; fps: number; drawMedian: number; drawP95: number; drawMax: number } {
    const n = Math.min(this.count, this.gaps.length);
    const pick = (a: Float64Array, q: number) => {
      const s = Array.from(a.subarray(0, n)).sort((x, y) => x - y);
      return n === 0 ? 0 : s[Math.min(n - 1, Math.floor(q * n))];
    };
    const gapMedian = pick(this.gaps, 0.5);
    return { frames: n, gapMedian, gapP95: pick(this.gaps, 0.95), fps: gapMedian > 0 ? 1000 / gapMedian : 0, drawMedian: pick(this.draws, 0.5), drawP95: pick(this.draws, 0.95), drawMax: pick(this.draws, 1) };
  }
}
