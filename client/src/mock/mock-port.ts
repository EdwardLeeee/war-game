// A fake world behind the same Worker messages as sim/src/worker.ts (sim/PROTOCOL.md), so
// the battlefield, gestures and HUD can be built and tested before the real simulation is
// connected. It is NOT the game's rules: units walk in straight lines, nothing fights, and
// every number here is a placeholder. It shows one of everything the screen must draw:
// towns in each state, fog in all three states, a remembered building, a mage calibrating
// with a shield, an enemy cannon warning, trees, gold, berries and a crystal vein.
//
// With `?r7=1` round 7's rules are on (D-061, sim/PROTOCOL.md 3.3): towns plundered once (the
// small neutral town and our governed one, which pays 25% and climbs back), arrow towers on
// TowerLand, ranged units and mages hiding in our main city or an arrow tower, an enemy arrow
// tower with someone inside that shoots (the `shot` event; nothing gets hurt here), and our
// stable training cavalry.

import type { SimPort } from "../game/port.ts";
import {
  Action,
  AUTO_TRAIN,
  BUILDING_STRIDE,
  BuildingField as B,
  BuildingFlag,
  type BuildingInfo,
  BuildingType,
  CELL,
  checkPlacement,
  type CommandBody,
  type Cost,
  FOG_EVERY,
  type FromWorker,
  HEADER_LENGTH,
  HeaderField as H,
  type MapInfo,
  type MapMode,
  NEUTRAL,
  NodeKind,
  Order,
  PlaceBit,
  PROTOCOL_VERSION,
  Reject,
  type Rules,
  rules,
  type SimEvent,
  Stance,
  TOWN_STRIDE,
  TownField as T,
  TownFlag,
  TownSize,
  TownState,
  type ToWorker,
  UNIT_STRIDE,
  UnitField as U,
  UnitFlag,
  UnitType,
  WARNING_STRIDE,
} from "../sim.ts";

const SIZE = 96;
const ME = 0;
const FOE = 1;
const SIGHT = 8;
const HALF = CELL / 2;
/** One cell per second at 20 ticks per second. */
const STEP = Math.floor(CELL / 20);

/** 16 facing directions as integer vectors (x1000), 0 = east, clockwise with y down. */
const DIRS = [
  [1000, 0], [924, 383], [707, 707], [383, 924], [0, 1000], [-383, 924], [-707, 707], [-924, 383],
  [-1000, 0], [-924, -383], [-707, -707], [-383, -924], [0, -1000], [383, -924], [707, -707], [924, -383],
];

const cost = (food: number, wood: number, gold: number, crystal = 0): Cost => ({ food, wood, gold, crystal });

function buildingInfo(type: BuildingType, hp: number, size: number, c: Cost, extra: Partial<BuildingInfo> = {}): BuildingInfo {
  return { type, hp, size, walkable: false, cost: c, buildTicks: 600, sight: 6, populationCap: 0, accepts: [], trains: [], shelter: 0, ...extra };
}

/**
 * The unit table is the simulation's own, so what the interface shows (life, shield, cost)
 * matches the game. The buildings are placeholders sized for this fixed layout.
 */
export const MOCK_RULES: Rules = {
  units: rules().units,
  buildings: [
    buildingInfo(BuildingType.MainCity, 1200, 4, cost(0, 0, 0), { populationCap: 10, accepts: [0, 1, 2, 3], trains: [UnitType.Farmer], shelter: 15, holds: 6 }),
    buildingInfo(BuildingType.House, 300, 2, cost(0, 30, 0), { populationCap: 5, shelter: 5 }),
    buildingInfo(BuildingType.LumberCamp, 300, 2, cost(0, 50, 0), { accepts: [1] }),
    buildingInfo(BuildingType.Mine, 300, 2, cost(0, 50, 0), { accepts: [2, 3] }),
    buildingInfo(BuildingType.Granary, 300, 2, cost(0, 60, 0), { accepts: [0] }),
    buildingInfo(BuildingType.Farm, 100, 3, cost(0, 60, 0), { walkable: true }),
    buildingInfo(BuildingType.Barracks, 600, 3, cost(0, 150, 0), { trains: [UnitType.Spearman] }),
    buildingInfo(BuildingType.Range, 600, 3, cost(0, 150, 0), { trains: [UnitType.Ranged] }),
    buildingInfo(BuildingType.MageHall, 700, 3, cost(0, 200, 150), { trains: [UnitType.Mage] }),
    buildingInfo(BuildingType.TownTower, 800, 2, cost(0, 0, 0)),
    // Round 7 (D-061): shown only while `features.towers` is on.
    buildingInfo(BuildingType.ArrowTower, 500, 2, cost(0, 100, 50), { sight: 8, holds: 3 }),
    buildingInfo(BuildingType.Stable, 500, 3, cost(0, 150, 50), { trains: [UnitType.Cavalry] }),
    // D-080: shown only while `features.outpost` is on.
    buildingInfo(BuildingType.Outpost, 400, 2, cost(0, 50, 0), { sight: 10 }),
    // D-096: one in each opening of a castle (`?walls=1` only); its hit points are the town's (`towns[size].gateHp`).
    buildingInfo(BuildingType.Gate, 2100, 1, cost(0, 0, 0)),
  ],
  // The simulation's damage table, so 兵種相剋 reads what the game plays.
  multipliers: rules().multipliers,
  mageCap: 6,
  maxPopulation: 120,
  queueMax: 5,
  // The castles round the towns (D-089, PROTOCOL.md 3.5), as the simulation sends them; the big
  // city's for its tower one up and left of its centre. The fake world's ground has no walls: only the picture.
  towns: rules().towns,
};

/** `?r7=1`: round 7's switches on, with the simulation's values. */
export const MOCK_RULES_R7: Rules = {
  ...MOCK_RULES,
  // 騎兵繞後 (D-097) on, as in the simulation.
  features: { plunderOnce: true, towers: true, garrison: true, cavalry: true, cavalryFlank: true },
  arrows: rules().arrows,
  garrisonTypes: rules().garrisonTypes,
  towerReach: rules().towerReach,
  towns: rules().towns,
  plunderRecovery: { startPermille: 250, ticks: 12000 },
};

/** `?r7=1&outpost=1`: round 7's and the outpost's switches on (D-080), with the simulation's values. */
export const MOCK_RULES_OUTPOST: Rules = {
  ...MOCK_RULES_R7,
  features: { plunderOnce: true, towers: true, garrison: true, cavalry: true, outpost: true, cavalryFlank: true },
  outpost: rules().outpost,
  towerReach: { ...(rules().towerReach ?? { mainCity: 8, town: 2 }), outpost: rules().towerReach?.outpost ?? 6 },
};

/** `?walls=1`: D-096's gates and walls on (with round 7's), the simulation's values. */
export const MOCK_RULES_WALLS: Rules = {
  ...MOCK_RULES_R7,
  features: { plunderOnce: true, towers: true, garrison: true, cavalry: true, cavalryFlank: true, gates: true, walls: true },
  gate: rules().gate,
  walls: rules().walls,
};

/** Cells from a building's centre within which a soldier on its way slips inside. */
const GARRISON_REACH = 3;
/** The enemy arrow tower and soldiers hiding with us shoot this often, at this many cells. */
const SHOT_TICKS = 30;
const SHOT_CELLS = 7;

interface MUnit {
  id: number;
  owner: number;
  type: UnitType;
  x: number;
  y: number;
  hp: number;
  shield: number;
  facing: number;
  stance: number;
  flags: number;
  target: { x: number; y: number } | null;
  order: number;
  cast: number;
  /** Round 7: the building it hides in (or walks to, order Garrison), else -1. */
  inside: number;
  /** Inside, not drawn (action Garrisoned). */
  hidden: boolean;
  /** D-080: the outpost it stands guard at (or walks to, order Post), else -1. */
  post?: number;
  /** D-096: the town whose wall it stands on (order Wall), and the cell inside it went up from. */
  wall?: { town: number; from: { x: number; y: number } };
  /** `?gallery=1` (D-085): the action it shows (and what it works at), standing where it is. */
  pose?: { action: number; target: number };
  /** The node a `gather` sent it to (its order's target, as the simulation has it); it stays on it. */
  node?: number;
}

interface MBuilding {
  id: number;
  owner: number;
  type: BuildingType;
  cx: number;
  cy: number;
  hp: number;
  progress: number;
  flags: number;
  rallyX: number;
  rallyY: number;
  queue: UnitType[];
  /** Head of the queue, permille done. */
  queueProgress: number;
  /** An enemy building with someone inside (round 7): its Occupied flag while in view. */
  occupied: boolean;
  /** An outpost holding (D-080, `outpost_mode`): its Hold flag. */
  hold?: boolean;
}

/**
 * The gallery (`?gallery=1`, D-085): ours and the enemy's, the militia (neutral) under ours. As a
 * diamond, sim facing 2 faces the camera, 0 is down-right, 14 right, 4 down-left (mirrored).
 */
const GALLERY = [
  { owner: ME, x: 50, y: 80, rows: [UnitType.Farmer, UnitType.Spearman, UnitType.Ranged, UnitType.Mage, UnitType.Cavalry, UnitType.Militia] },
  { owner: FOE, x: 72, y: 84, rows: [UnitType.Farmer, UnitType.Spearman, UnitType.Ranged, UnitType.Mage, UnitType.Cavalry] },
];
interface GalleryColumn {
  action: number;
  facing: number;
  node?: NodeKind;
  role?: "fall" | "hit" | "shatter" | "cast";
}
/** 待機, 走路, 攻擊, 倒下 (gone at GALLERY_FALL_TICK). */
const GALLERY_COLUMNS: GalleryColumn[] = [
  { action: Action.Idle, facing: 2 },
  { action: Action.Move, facing: 0 },
  { action: Action.Attack, facing: 14 },
  { action: Action.Idle, facing: 4, role: "fall" },
];
/** The farmers at work: wood, gold, a field (berries), building. */
const FARMER_COLUMNS: GalleryColumn[] = [
  { action: Action.Gather, facing: 2, node: NodeKind.Tree },
  { action: Action.Gather, facing: 2, node: NodeKind.GoldMine },
  { action: Action.Gather, facing: 2, node: NodeKind.Berries },
  { action: Action.Build, facing: 2 },
];
/** The mages: calibrating the cannon, the shield struck, the shield shattered. */
const MAGE_COLUMNS: GalleryColumn[] = [
  { action: Action.Calibrate, facing: 2, role: "cast" },
  { action: Action.Idle, facing: 2, role: "hit" },
  { action: Action.Idle, facing: 2, role: "shatter" },
];
const GALLERY_FALL_TICK = 20;
const GALLERY_SHATTER_TICK = 30;
const GALLERY_HIT_EVERY = 8;
/** The buildings' gallery: its rows' types, its first cell, its nodes' first row (cells). */
const GALLERY_BUILDINGS = [
  BuildingType.MainCity, BuildingType.House, BuildingType.LumberCamp, BuildingType.Mine, BuildingType.Granary, BuildingType.Farm,
  BuildingType.Barracks, BuildingType.Range, BuildingType.MageHall, BuildingType.Stable, BuildingType.ArrowTower, BuildingType.TownTower,
  // art-v5.1 (war-game-ui 2026-10-22): the outpost's own pictures.
  BuildingType.Outpost,
];
const GALLERY_B = { x: 4, y: 4 };
const GALLERY_NODES_Y = 66;
/** Then it stops: the fallen 0.8 s into their fall (the dust rising), the shattered mage 0.3 s into it, the struck 0.2 s. */
const GALLERY_STOP_TICK = 36;

/** The fake world trains a unit in 3 seconds, so tests do not wait. */
const MOCK_TRAIN_TICKS = 60;

interface MTown {
  id: number;
  size: TownSize;
  cx: number;
  cy: number;
  radius: number;
  state: TownState;
  owner: number;
  timer: number;
  timerTotal: number;
  militia: number;
  /** Round 7: plundered this game. */
  plundered: boolean;
  /** Round 7: governed income, permille of the full amount. */
  income: number;
}

const centre = (c: number): number => c * CELL + HALF;

export class MockPort implements SimPort {
  onmessage: ((e: MessageEvent<FromWorker>) => void) | null = null;
  private tick = 0;
  private tps = 20;
  private paused = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private nextId = 1;
  private readonly terrain = new Uint8Array(SIZE * SIZE);
  private readonly units: MUnit[] = [];
  private readonly buildings: MBuilding[] = [];
  /** 預留 (D-054): what 自動訓練 would leave; the fake world only reports it. */
  private reserve = { ...AUTO_TRAIN.reserve };
  /** What we have (the resource bar); tests set it (等錢治理). */
  private stock: Cost = cost(200, 200, 100, 20);
  /**
   * Tests' little economy (等錢治理), off unless a test turns it on: `income` a second, and
   * 自動訓練 spending `train` (a unit's cost) once a second from what is above the reserve (預留,
   * D-054) only, as the simulation's does; no unit comes of it.
   */
  private economy: { income: Cost; train: Cost } | null = null;
  private readonly towns: MTown[] = [];
  /** [id, kind, cx, cy, amount] */
  private readonly nodes: number[][] = [];
  private readonly fog = new Uint8Array(SIZE * SIZE);
  /** What the screen was last told about each node: explored and visible. */
  private readonly sentNode = new Map<number, string>();
  private events: SimEvent[] = [];
  private warningTicks = 0;
  private ratio = { food: 40, wood: 35, gold: 25, on: true };
  private recall = false;
  private over = false;
  private readonly round7: boolean;
  /** `?outpost=1` (with round 7): outposts on (D-080). */
  private readonly outpost: boolean;
  /** `?mine=1`: two mines of ours, one with a crystal vein beside it (the mine's 晶 row, 2026-10-20). */
  private readonly mine: boolean;
  /** `?walls=1` (D-096): gates in the castles' openings, 上城牆. */
  private readonly walls: boolean;
  private readonly rules: Rules;
  /**
   * The same layout as a random map (D-074, sim/PROTOCOL.md): `ready` tells only our own home,
   * towns come with their rows once explored, and the placement grid marks only explored rocks.
   */
  private readonly randomMap: boolean;
  /** `?gallery=1` (D-085): the units' gallery south-east of our home; `gallery=b`: the buildings' and nodes', on a map of its own. Everything in view. */
  private readonly gallery: "units" | "buildings" | null;
  /** The gallery's units that fall, and its mages struck and shattered (see GALLERY). */
  private readonly galleryRoles = { fall: [] as MUnit[], hit: [] as MUnit[], shatter: [] as MUnit[], fallen: [] as MBuilding[], mined: [] as number[][] };

  /**
   * `round7`: `?r7=1`, round 7's rules on. `map`: `?map=random` plays this layout as a random map.
   * `outpost`: `?outpost=1`, outposts too (D-080). `gallery`: `?gallery=1`, the atlases' gallery too.
   * `mine`: `?mine=1`, two mines of ours, a crystal vein by one.
   */
  constructor(round7 = false, map: MapMode = "fixed", outpost = false, gallery: "units" | "buildings" | null = null, mine = false, walls = false) {
    this.round7 = round7 || outpost || walls;
    this.outpost = outpost;
    this.mine = mine;
    this.walls = walls;
    this.rules = walls ? MOCK_RULES_WALLS : outpost ? MOCK_RULES_OUTPOST : round7 ? MOCK_RULES_R7 : MOCK_RULES;
    this.randomMap = map === "random";
    this.gallery = gallery;
  }

  /** Tests (等錢治理): what we have now. */
  setStock(c: Cost): void {
    this.stock = { ...c };
  }

  /** Tests (等錢治理): the little economy, or off (null). */
  setEconomy(e: { income: Cost; train: Cost } | null): void {
    this.economy = e === null ? null : { income: { ...e.income }, train: { ...e.train } };
  }

  private runEconomy(e: { income: Cost; train: Cost }): void {
    const keys = ["food", "wood", "gold", "crystal"] as const;
    for (const k of keys) this.stock[k] += e.income[k];
    if (keys.every((k) => this.stock[k] - this.reserve[k] >= e.train[k])) for (const k of keys) this.stock[k] -= e.train[k];
  }

  /** Tests: deliver an event with the next snapshot (an attack, a captured town...). */
  inject(ev: SimEvent): void {
    // A capture also leaves the town waiting for 搶 or 治理, as in the simulation.
    if (ev.k === "town_captured") {
      const t = this.towns.find((v) => v.id === ev.town);
      if (t !== undefined) {
        t.state = TownState.AwaitingChoice;
        t.owner = ev.by;
        t.militia = 0;
      }
    }
    // A revolt leaves the town neutral, as in the simulation.
    if (ev.k === "town_revolted") {
      const t = this.towns.find((v) => v.id === ev.town);
      if (t !== undefined) {
        t.state = TownState.Neutral;
        t.owner = NEUTRAL;
        t.timer = t.timerTotal = 0;
      }
    }
    // A plunder done leaves ruins (D-084: those stationed for it go back to 全軍).
    if (ev.k === "town_plundered") {
      const t = this.towns.find((v) => v.id === ev.town);
      if (t !== undefined) {
        t.state = TownState.Ruins;
        t.owner = -1;
        t.plundered = true;
      }
    }
    this.events.push(ev);
  }

  /** Tests: put units of ours on cells (the fake world has no pathfinding worth waiting for). */
  place(ids: number[], cells: { x: number; y: number }[]): void {
    ids.forEach((id, i) => {
      const u = this.units.find((v) => v.id === id && v.owner === ME);
      const c = cells[i % cells.length];
      if (u === undefined || c === undefined) return;
      u.x = centre(c.x);
      u.y = centre(c.y);
      u.target = null;
    });
  }

  private townCost(size: TownSize): Cost {
    return this.rules.towns?.[size]?.governCost ?? cost(0, 0, 0);
  }

  private affords(c: Cost): boolean {
    return this.stock.food >= c.food && this.stock.wood >= c.wood && this.stock.gold >= c.gold && this.stock.crystal >= c.crystal;
  }

  /** Down from a wall (D-096): onto the cell inside it went up from. */
  private offWall(u: MUnit): void {
    if (u.wall === undefined) return;
    u.x = centre(u.wall.from.x);
    u.y = centre(u.wall.from.y);
    u.wall = undefined;
    u.flags &= ~UnitFlag.OnWall;
    if (u.order === Order.Wall) u.order = Order.None;
  }

  /** Tests: these units of ours fall. */
  remove(ids: number[]): void {
    for (let i = this.units.length - 1; i >= 0; i--) if (this.units[i].owner === ME && ids.includes(this.units[i].id)) this.units.splice(i, 1);
    // Buildings too, any owner's (D-084: the big city's tower falls, its wall stays).
    for (let i = this.buildings.length - 1; i >= 0; i--) if (ids.includes(this.buildings[i].id)) this.buildings.splice(i, 1);
  }

  /** The militia on walls (D-096): one of ours within the sling's reach, facing it and throwing (action Attack, no damage here); else standing. */
  private slings(): void {
    const reach = (this.rules.walls?.sling ?? 4 * CELL) + CELL / 2;
    for (const m of this.units) {
      if (m.owner !== NEUTRAL || (m.flags & UnitFlag.OnWall) === 0) continue;
      const near = this.units.filter((u) => u.owner === ME && !u.hidden && (u.x - m.x) ** 2 + (u.y - m.y) ** 2 <= reach * reach).sort((a, b) => (a.x - m.x) ** 2 + (a.y - m.y) ** 2 - ((b.x - m.x) ** 2 + (b.y - m.y) ** 2))[0];
      m.pose = near === undefined ? undefined : { action: Action.Attack, target: -1 };
      if (near !== undefined) m.facing = facing(near.x - m.x, near.y - m.y);
    }
  }

  /** Tests: a building's hit points now (a gate damaged, D-096). */
  damage(id: number, hp: number): void {
    const b = this.buildings.find((v) => v.id === id);
    if (b !== undefined) b.hp = hp;
  }

  postMessage(msg: ToWorker): void {
    switch (msg.type) {
      case "init":
        this.tps = msg.tps;
        this.setup();
        this.emit({ type: "ready", protocol: PROTOCOL_VERSION, player: ME, map: this.mapInfo(), rules: this.rules });
        this.updateFog();
        this.emit(this.snapshot(true));
        this.schedule();
        break;
      case "command":
        this.apply(msg.cmd);
        break;
      case "pause":
        this.paused = true;
        // Like the Worker (sim/src/worker.ts): the header says 暫停 at once, not at the next step.
        this.emit(this.snapshot(false));
        break;
      case "resume":
        this.paused = false;
        break;
      case "speed":
        this.tps = msg.tps;
        break;
      case "determinism":
        this.emit({ type: "error", message: "the fake world has no determinism check" });
        break;
      case "export_log":
        this.emit({ type: "log", jsonl: "" });
        break;
    }
  }

  terminate(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.onmessage = null;
  }

  private emit(data: FromWorker): void {
    this.onmessage?.({ data } as MessageEvent<FromWorker>);
  }

  private schedule(): void {
    this.timer = setTimeout(() => {
      if (!this.paused && !this.over) this.step();
      this.schedule();
    }, 1000 / this.tps);
  }

  // --- the fake world ---------------------------------------------------------------

  private setup(): void {
    if (this.gallery === "buildings") {
      this.setupBuildingsGallery();
      return;
    }
    // Two rock ridges that leave a pass in the middle, mirrored.
    for (let y = 40; y < 56; y++) {
      for (const x of [40, 41, 54, 55]) this.terrain[y * SIZE + x] = 1;
    }
    for (let x = 60; x < 70; x++) this.terrain[70 * SIZE + x] = 1;

    let nodeId = 1;
    const node = (kind: number, cx: number, cy: number, amount: number) => this.nodes.push([nodeId++, kind, cx, cy, amount]);
    for (let y = 56; y < 66; y++) for (let x = 2; x < 9; x++) node(NodeKind.Tree, x, y, 100);
    for (let y = 86; y < 94; y++) for (let x = 26; x < 36; x++) node(NodeKind.Tree, x, y, 100);
    for (let y = 20; y < 30; y++) for (let x = 20; x < 26; x++) node(NodeKind.Tree, x, y, 100);
    for (const [x, y] of [[27, 76], [28, 76], [27, 77], [28, 77]]) node(NodeKind.GoldMine, x, y, 800);
    for (const [x, y] of [[4, 84], [5, 84], [4, 85]]) node(NodeKind.Berries, x, y, 150);
    for (const [x, y] of [[46, 62], [47, 62]]) node(NodeKind.CrystalVein, x, y, 400);
    if (this.mine) {
      // A mine of ours by the gold, a crystal vein beside it; another by the southern trees, no vein near.
      this.building(ME, BuildingType.Mine, 20, 78);
      node(NodeKind.CrystalVein, 23, 79, 150);
      this.building(ME, BuildingType.Mine, 22, 90);
    }

    this.building(ME, BuildingType.MainCity, 8, 80);
    this.building(ME, BuildingType.House, 14, 86);
    // 自動訓練 is on for the player's barracks, as in the simulation (D-054); the fake world keeps the flag but trains nothing by itself.
    this.building(ME, BuildingType.Barracks, 4, 74).flags = BuildingFlag.AutoTrain;
    this.building(ME, BuildingType.Farm, 14, 80);
    this.building(ME, BuildingType.House, 18, 86).progress = 400;
    this.building(FOE, BuildingType.MainCity, 84, 12);
    this.building(FOE, BuildingType.Barracks, 34, 58);
    this.building(FOE, BuildingType.House, 38, 62);
    this.building(NEUTRAL, BuildingType.TownTower, 47, 45);
    // Round 7: an enemy arrow tower in view with someone inside, shooting at our soldiers near it.
    if (this.round7) this.building(FOE, BuildingType.ArrowTower, 26, 63).occupied = true;
    // Round 7: our stable, training on its own like the barracks (D-054).
    if (this.round7) this.building(ME, BuildingType.Stable, 14, 70).flags = BuildingFlag.AutoTrain;
    // D-080: our outpost north of the barracks, and the enemy's, holding, by its barracks.
    if (this.outpost) {
      this.building(ME, BuildingType.Outpost, 12, 66);
      this.building(FOE, BuildingType.Outpost, 31, 61).hold = true;
    }

    const town = (size: TownSize, cx: number, cy: number, state: TownState, owner: number, timer = 0, total = 0, militia = 0) => {
      const t: MTown = { id: this.towns.length, size, cx, cy, radius: size === TownSize.Large ? 6 : 4, state, owner, timer, timerTotal: total, militia, plundered: false, income: 1000 };
      this.towns.push(t);
      return t;
    };
    // Round 7: the small neutral town was plundered before (taken again, only 治理), and our
    // governed town too, so it pays a quarter and climbs back.
    town(TownSize.Small, 30, 66, TownState.Neutral, NEUTRAL, 0, 0, 3).plundered = this.round7;
    const ours = town(TownSize.Small, 18, 62, TownState.Governed, ME);
    if (this.round7) {
      ours.plundered = true;
      ours.income = (this.rules.plunderRecovery as { startPermille: number }).startPermille;
    }
    town(TownSize.Small, 36, 80, TownState.Ruins, -1, 3000, 4800);
    town(TownSize.Large, 48, 48, TownState.Plundering, ME, 300, 500);
    town(TownSize.Small, 38, 56, TownState.Governed, FOE);
    // D-096 (?walls=1): a gate in each opening of every castle but the ruins', its town's holder's
    // (the neutral's for a neutral town), at its town's size's hit points.
    if (this.walls) {
      for (const t of this.towns) {
        if (t.state === TownState.Ruins) continue;
        const info = this.rules.towns?.[t.size];
        for (const opening of info?.castle?.gates ?? []) {
          if (opening.length === 0) continue;
          const g = this.building(t.owner === ME || t.owner === FOE ? t.owner : NEUTRAL, BuildingType.Gate, t.cx + Math.min(...opening.map(([x]) => x)), t.cy + Math.min(...opening.map(([, y]) => y)));
          g.hp = info?.gateHp ?? g.hp;
        }
      }
    }

    const unit = (owner: number, type: UnitType, cx: number, cy: number) => {
      const info = MOCK_RULES.units[type];
      const u: MUnit = {
        id: this.nextId++, owner, type, x: centre(cx), y: centre(cy), hp: info.hp, shield: info.shield,
        // A mage's cannon on, as the simulation trains them (D-026; D-095: always).
        facing: 0, stance: Stance.Aggressive, flags: type === UnitType.Mage ? UnitFlag.Autocast : 0, target: null, order: Order.None, cast: 0, inside: -1, hidden: false,
      };
      this.units.push(u);
      return u;
    };
    for (let i = 0; i < 5; i++) unit(ME, UnitType.Farmer, 13 + i, 78).flags = UnitFlag.IdleFarmer;
    for (let i = 0; i < 6; i++) unit(ME, UnitType.Spearman, 22 + (i % 3), 68 + Math.floor(i / 3));
    for (let i = 0; i < 4; i++) unit(ME, UnitType.Ranged, 21 + (i % 2), 71 + Math.floor(i / 2));
    const calm = unit(ME, UnitType.Mage, 23, 72);
    calm.shield = 40;
    calm.flags = UnitFlag.Autocast;
    const caster = unit(ME, UnitType.Mage, 24, 73);
    caster.cast = 1;
    for (let i = 0; i < 3; i++) unit(FOE, UnitType.Spearman, 28 + i, 70);
    for (let i = 0; i < 2; i++) unit(FOE, UnitType.Ranged, 29 + i, 72).hp = 20;
    unit(FOE, UnitType.Mage, 30, 73);
    for (let i = 0; i < 3; i++) unit(NEUTRAL, UnitType.Militia, 29 + i, 66);
    // D-096 (?walls=1): two more of the neutral town's militia on its north wall, throwing stones
    // at any of ours within its sling's reach (rules.walls.sling); out of 2 cells of its gate.
    if (this.walls) for (const x of [26, 34]) unit(NEUTRAL, UnitType.Militia, x, 61).flags |= UnitFlag.OnWall;
    unit(FOE, UnitType.Spearman, 80, 20);
    if (this.gallery === "units") this.setupGallery(unit);

    // Start with the home area explored, so the three fog states are all on screen.
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) if ((x - 18) ** 2 + (y - 74) ** 2 <= 30 * 30) this.fog[y * SIZE + x] = 1;
    }
  }

  /**
   * The atlases' gallery (D-085, for the pictures the user chooses from): a table of ours and one
   * of the enemy's, a row a unit type (the militia, neutral, under ours), a column an action. As a
   * diamond a row runs along the screen: cell (x + c + 2r, y − c + 2r) is row r, column c.
   */
  private setupGallery(unit: (owner: number, type: UnitType, cx: number, cy: number) => MUnit): void {
    const kind = (k: NodeKind) => this.nodes.find((n) => n[1] === k)?.[0] ?? -1;
    for (const table of GALLERY) {
      table.rows.forEach((type, r) => {
        const owner = type === UnitType.Militia ? NEUTRAL : table.owner;
        const columns = [...GALLERY_COLUMNS, ...(type === UnitType.Farmer ? FARMER_COLUMNS : type === UnitType.Mage ? MAGE_COLUMNS : [])];
        columns.forEach((col, c) => {
          const u = unit(owner, type, table.x + c + 2 * r, table.y - c + 2 * r);
          u.facing = col.facing;
          u.pose = { action: col.action, target: col.node === undefined ? -1 : kind(col.node) };
          if (col.role === "cast") u.cast = 1;
          else if (col.role !== undefined) this.galleryRoles[col.role].push(u);
        });
      });
    }
  }

  /**
   * The buildings' gallery (`?gallery=b`, D-085), alone on the map: ours, a row a building type,
   * a column a state, square on as 方形斜看 shows it (D-088; cell (x + 5c, y + 7r), room above each
   * row for the tall ones): three
   * construction stages, done, damaged, and one destroyed at GALLERY_FALL_TICK (its rubble). The
   * big city's tower (neutral, 東陸 always) last. Our culture is 你的陸 (?culture=w: 西陸).
   * Beside it the nodes: trees of both cultures and their stumps, the mines full, mined and spent,
   * berries and veins full and spent.
   */
  private setupBuildingsGallery(): void {
    const states: { progress: number; hp: number; fall?: boolean }[] = [{ progress: 100, hp: 1 }, { progress: 500, hp: 1 }, { progress: 800, hp: 1 }, { progress: 1000, hp: 1 }, { progress: 1000, hp: 0.4 }, { progress: 1000, hp: 1, fall: true }];
    GALLERY_BUILDINGS.forEach((type, r) => {
      states.forEach((st, c) => {
        // The big city's tower is never built: done, damaged, rubble only.
        if (type === BuildingType.TownTower && st.progress < 1000) return;
        const b = this.building(type === BuildingType.TownTower ? NEUTRAL : ME, type, GALLERY_B.x + 5 * c, GALLERY_B.y + 7 * r);
        b.progress = st.progress;
        b.hp = Math.round(MOCK_RULES.buildings[type].hp * st.hp);
        if (st.fall === true) this.galleryRoles.fallen.push(b);
      });
    });
    let nodeId = 1;
    const node = (kind: number, cx: number, cy: number, amount: number) => {
      const row = [nodeId++, kind, cx, cy, amount];
      this.nodes.push(row);
      return row;
    };
    // A row of trees crossing 6-cell blocks (both cultures, each variant), their stumps under them.
    for (let x = 86; x < 95; x++) {
      node(NodeKind.Tree, x, GALLERY_NODES_Y, 100);
      node(NodeKind.Tree, x, GALLERY_NODES_Y + 3, 0);
    }
    // Mines full, mined (below half at GALLERY_FALL_TICK) and spent; berries and veins full and spent; two variants each.
    for (const [kind, dy] of [[NodeKind.GoldMine, 7], [NodeKind.Berries, 10], [NodeKind.CrystalVein, 13]] as const) {
      for (let v = 0; v < 2; v++) {
        node(kind, 86 + v, GALLERY_NODES_Y + dy, 800);
        if (kind === NodeKind.GoldMine) this.galleryRoles.mined.push(node(kind, 89 + v, GALLERY_NODES_Y + dy, 800));
        node(kind, 92 + v, GALLERY_NODES_Y + dy, 0);
      }
    }
  }

  /** The gallery's moments (ticks): the fallen go, a mage's shield breaks; struck mages every few ticks. */
  private galleryStep(): void {
    const roles = this.galleryRoles;
    if (this.tick === GALLERY_FALL_TICK) for (const b of roles.fallen) this.buildings.splice(this.buildings.indexOf(b), 1);
    // A mine mined below half of what was first seen.
    if (this.tick === GALLERY_FALL_TICK) for (const n of roles.mined) n[4] = 300;
    if (this.tick === GALLERY_FALL_TICK) for (const u of roles.fall) this.units.splice(this.units.indexOf(u), 1);
    if (this.tick === GALLERY_SHATTER_TICK) for (const u of roles.shatter) u.shield = 0;
    if (this.tick % GALLERY_HIT_EVERY === 0) for (const u of roles.hit) u.shield = u.shield > 10 ? u.shield - 5 : MOCK_RULES.units[UnitType.Mage].shield;
  }

  private building(owner: number, type: BuildingType, cx: number, cy: number): MBuilding {
    const b: MBuilding = { id: this.nextId++, owner, type, cx, cy, hp: MOCK_RULES.buildings[type].hp, progress: 1000, flags: 0, rallyX: -1, rallyY: -1, queue: [], queueProgress: 0, occupied: false };
    this.buildings.push(b);
    return b;
  }

  private mapInfo(): MapInfo {
    // Each main city stands on its spawn, as in the simulation (its top-left cell 2 up and left):
    // the camera opens on it.
    const spawns = [
      { player: ME, cellX: 10, cellY: 82 },
      { player: FOE, cellX: 86, cellY: 14 },
    ];
    // A random map tells only our own home: open ground everywhere, no towns (D-074).
    if (this.randomMap) return { seed: 1, size: SIZE, terrain: new Uint8Array(SIZE * SIZE), spawns: spawns.filter((s) => s.player === ME), towns: [], mode: "random" };
    return { seed: 1, size: SIZE, terrain: this.terrain.slice(), spawns, towns: this.towns.map((t) => ({ id: t.id, size: t.size, cellX: t.cx, cellY: t.cy, radius: t.radius })) };
  }

  private step(): void {
    // The gallery stands still at its moment, the same for every picture (no more snapshots: the screen holds the last).
    if (this.gallery && this.tick >= GALLERY_STOP_TICK) return;
    this.tick++;
    if (this.economy !== null && this.tick % 20 === 0) this.runEconomy(this.economy);
    for (const u of this.units) {
      // Round 7: on its way to hide, it slips in once near the building (also when a test put it there).
      if (u.order === Order.Garrison && !u.hidden) {
        const b = this.buildings.find((v) => v.id === u.inside);
        if (b === undefined) {
          u.order = Order.None;
          u.inside = -1;
        } else {
          const s = MOCK_RULES.buildings[b.type].size;
          const dx = u.x - (b.cx * CELL + (s * CELL) / 2);
          const dy = u.y - (b.cy * CELL + (s * CELL) / 2);
          if (dx * dx + dy * dy <= GARRISON_REACH * CELL * GARRISON_REACH * CELL) {
            u.hidden = true;
            u.target = null;
            u.x = b.cx * CELL + (s * CELL) / 2;
            u.y = b.cy * CELL + (s * CELL) / 2;
          }
        }
      }
      if (u.target !== null) {
        const dx = u.target.x - u.x;
        const dy = u.target.y - u.y;
        const d = Math.hypot(dx, dy);
        if (d <= STEP) {
          u.x = u.target.x;
          u.y = u.target.y;
          u.target = null;
          // On guard at an outpost (D-080), hiding or gathering at a node, the order stays.
          const stays = u.order === Order.Garrison || u.order === Order.Post || (u.order === Order.Gather && u.node !== undefined);
          if (!stays) u.order = Order.None;
          if (u.type === UnitType.Farmer && !stays) u.flags |= UnitFlag.IdleFarmer;
        } else {
          u.x += Math.round((dx * STEP) / d);
          u.y += Math.round((dy * STEP) / d);
          u.facing = facing(dx, dy);
        }
      }
      if (u.type === UnitType.Mage && u.cast > 0) u.cast = u.cast >= 30 ? 1 : u.cast + 1;
    }
    for (const b of this.buildings) {
      if (b.progress < 1000) b.progress = Math.min(1000, b.progress + 2);
      if (b.queue.length > 0) {
        b.queueProgress += Math.ceil(1000 / MOCK_TRAIN_TICKS);
        if (b.queueProgress >= 1000) {
          const type = b.queue.shift() as UnitType;
          b.queueProgress = 0;
          const info = MOCK_RULES.units[type];
          const u: MUnit = {
            id: this.nextId++, owner: b.owner, type, x: centre(b.cx - 1), y: centre(b.cy), hp: info.hp, shield: info.shield,
            facing: 0, stance: Stance.Aggressive, flags: type === UnitType.Farmer ? UnitFlag.IdleFarmer : type === UnitType.Mage ? UnitFlag.Autocast : 0, target: null, order: Order.None, cast: 0, inside: -1, hidden: false,
          };
          this.units.push(u);
          this.events.push({ k: "unit_trained", id: u.id, type, building: b.id });
        }
      }
    }
    for (const t of this.towns) if (t.timer > 0) t.timer = t.timer <= 1 ? t.timerTotal : t.timer - 1;
    // Round 7: a plundered town governed again climbs back to its full income.
    const climb = this.rules.plunderRecovery;
    if (climb !== undefined) {
      for (const t of this.towns) if (t.state === TownState.Governed && t.income < 1000 && this.tick % Math.ceil(climb.ticks / (1000 - climb.startPermille)) === 0) t.income++;
    }
    if (this.round7 && this.tick % SHOT_TICKS === 0) this.shoot();
    if (this.walls) this.slings();
    if (this.gallery) this.galleryStep();
    this.warningTicks = this.warningTicks <= 0 ? 60 : this.warningTicks - 1;
    if (this.tick % FOG_EVERY === 0) this.updateFog();
    this.emit(this.snapshot(this.tick % FOG_EVERY === 0));
  }

  /**
   * Round 7's `shot`: the enemy arrow tower at the nearest of our units in reach, and each of our
   * buildings with soldiers inside at the nearest enemy in view. Nobody is hurt in the fake world.
   */
  private shoot(): void {
    for (const b of this.buildings) {
      const s = MOCK_RULES.buildings[b.type].size;
      const bx = b.cx * CELL + (s * CELL) / 2;
      const by = b.cy * CELL + (s * CELL) / 2;
      const mine = b.owner === ME && this.units.some((u) => u.hidden && u.inside === b.id);
      if (!mine && !(b.owner === FOE && b.occupied)) continue;
      const targets = this.units.filter((u) => !u.hidden && (mine ? u.owner === FOE && this.visible(u.x >> 10, u.y >> 10) : u.owner === ME));
      const d = (u: MUnit) => (u.x - bx) * (u.x - bx) + (u.y - by) * (u.y - by);
      const near = targets.filter((u) => d(u) <= SHOT_CELLS * CELL * SHOT_CELLS * CELL).sort((a, c) => d(a) - d(c) || a.id - c.id)[0];
      if (near !== undefined && (mine || this.visible(b.cx, b.cy))) this.events.push({ k: "shot", building: b.id, target: near.id });
    }
  }

  /** Round 7's TowerLand: within `towerReach` of our main city's footprint (Chebyshev) or of a town we govern or repair. */
  private towerLand(cells: Uint8Array): void {
    const reach = this.rules.towerReach;
    if (reach === undefined) return;
    for (const b of this.buildings) {
      if (b.owner !== ME || b.type !== BuildingType.MainCity || b.progress < 1000) continue;
      const s = MOCK_RULES.buildings[b.type].size;
      for (let y = b.cy - reach.mainCity; y < b.cy + s + reach.mainCity; y++) {
        for (let x = b.cx - reach.mainCity; x < b.cx + s + reach.mainCity; x++) if (x >= 0 && y >= 0 && x < SIZE && y < SIZE) cells[y * SIZE + x] |= PlaceBit.TowerLand;
      }
    }
    // D-080: and within `towerReach.outpost` of our finished outposts.
    if (this.outpost && reach.outpost !== undefined) {
      for (const b of this.buildings) {
        if (b.owner !== ME || b.type !== BuildingType.Outpost || b.progress < 1000) continue;
        const s = MOCK_RULES.buildings[b.type].size;
        for (let y = b.cy - reach.outpost; y < b.cy + s + reach.outpost; y++) {
          for (let x = b.cx - reach.outpost; x < b.cx + s + reach.outpost; x++) if (x >= 0 && y >= 0 && x < SIZE && y < SIZE) cells[y * SIZE + x] |= PlaceBit.TowerLand;
        }
      }
    }
    for (const t of this.towns) {
      if (t.owner !== ME || (t.state !== TownState.Governed && t.state !== TownState.Repairing)) continue;
      const r = t.radius + reach.town;
      for (let y = t.cy - r; y <= t.cy + r; y++) {
        for (let x = t.cx - r; x <= t.cx + r; x++) if (x >= 0 && y >= 0 && x < SIZE && y < SIZE && (x - t.cx) ** 2 + (y - t.cy) ** 2 <= r * r) cells[y * SIZE + x] |= PlaceBit.TowerLand;
      }
    }
  }

  private updateFog(): void {
    // The gallery shows everything (the enemy's table too, and where the fallen fall).
    if (this.gallery) {
      this.fog.fill(2);
      return;
    }
    for (let i = 0; i < this.fog.length; i++) if (this.fog[i] === 2) this.fog[i] = 1;
    const see = (cx: number, cy: number) => {
      for (let y = Math.max(0, cy - SIGHT); y <= Math.min(SIZE - 1, cy + SIGHT); y++) {
        for (let x = Math.max(0, cx - SIGHT); x <= Math.min(SIZE - 1, cx + SIGHT); x++) {
          if ((x - cx) ** 2 + (y - cy) ** 2 <= SIGHT * SIGHT) this.fog[y * SIZE + x] = 2;
        }
      }
    };
    for (const u of this.units) if (u.owner === ME) see(u.x >> 10, u.y >> 10);
    for (const b of this.buildings) if (b.owner === ME) see(b.cx + 1, b.cy + 1);
  }

  private visible(cx: number, cy: number): boolean {
    return cx >= 0 && cy >= 0 && cx < SIZE && cy < SIZE && this.fog[cy * SIZE + cx] === 2;
  }

  private placementGrid(): Uint8Array {
    const cells = new Uint8Array(SIZE * SIZE);
    // On a random map only what was explored is known (D-074): rocks, nodes and others' buildings.
    const known = (i: number) => !this.randomMap || this.fog[i] > 0;
    for (let i = 0; i < cells.length; i++) {
      if (this.terrain[i] === 1 && known(i)) cells[i] |= PlaceBit.Blocked;
      if (this.fog[i] === 0) cells[i] |= PlaceBit.Unexplored;
    }
    for (const [, , cx, cy, amount] of this.nodes) if (amount > 0 && known(cy * SIZE + cx)) cells[cy * SIZE + cx] |= PlaceBit.Blocked;
    for (const b of this.buildings) {
      if (this.randomMap && b.owner !== ME && !this.everSeen(b)) continue;
      const s = MOCK_RULES.buildings[b.type].size;
      for (let y = b.cy; y < b.cy + s; y++) for (let x = b.cx; x < b.cx + s; x++) cells[y * SIZE + x] |= PlaceBit.Blocked;
      if (b.owner === ME && (b.type === BuildingType.MainCity || b.type === BuildingType.Granary)) {
        for (let y = b.cy - 5; y < b.cy + s + 5; y++) {
          for (let x = b.cx - 5; x < b.cx + s + 5; x++) if (x >= 0 && y >= 0 && x < SIZE && y < SIZE) cells[y * SIZE + x] |= PlaceBit.FarmLand;
        }
      }
    }
    this.towerLand(cells);
    return cells;
  }

  private snapshot(withFog: boolean): FromWorker {
    const header = new Int32Array(HEADER_LENGTH);
    header[H.tick] = this.tick;
    header[H.paused] = this.paused ? 1 : 0;
    header[H.speed] = this.tps * 100;
    header[H.food] = this.stock.food;
    header[H.wood] = this.stock.wood;
    header[H.gold] = this.stock.gold;
    header[H.crystal] = this.stock.crystal;
    header[H.population] = this.units.filter((u) => u.owner === ME).length;
    header[H.populationCap] = 20;
    header[H.populationCeiling] = MOCK_RULES.maxPopulation;
    header[H.reserveFood] = this.reserve.food;
    header[H.reserveWood] = this.reserve.wood;
    header[H.reserveGold] = this.reserve.gold;
    header[H.reserveCrystal] = this.reserve.crystal;
    header[H.mages] = 2;
    header[H.mageCap] = 6;
    header[H.ratioFood] = this.ratio.food;
    header[H.ratioWood] = this.ratio.wood;
    header[H.ratioGold] = this.ratio.gold;
    header[H.ratioOn] = this.ratio.on ? 1 : 0;
    header[H.recall] = this.recall ? 1 : 0;
    header[H.gameState] = this.over ? 2 : 0;
    header[H.fogTick] = this.tick - (this.tick % FOG_EVERY);

    const seen = this.units.filter((u) => u.owner === ME || (!u.hidden && this.visible(u.x >> 10, u.y >> 10)));
    const units = new Int32Array(seen.length * UNIT_STRIDE);
    seen.forEach((u, i) => {
      const o = i * UNIT_STRIDE;
      units[o + U.id] = u.id;
      units[o + U.owner] = u.owner;
      units[o + U.type] = u.type;
      units[o + U.x] = u.x;
      units[o + U.y] = u.y;
      units[o + U.hp] = u.hp;
      units[o + U.shield] = u.shield;
      units[o + U.action] = u.hidden ? Action.Garrisoned : u.cast > 0 ? Action.Calibrate : (u.pose?.action ?? ((u.flags & UnitFlag.OnWall) !== 0 ? Action.OnWall : u.target !== null ? Action.Move : Action.Idle));
      units[o + U.facing] = u.facing;
      units[o + U.carryKind] = -1;
      units[o + U.order] = u.cast > 0 ? Order.Cast : u.order;
      units[o + U.orderTarget] =
        u.pose !== undefined ? u.pose.target : u.order === Order.Garrison ? u.inside : u.order === Order.Post ? (u.post ?? -1) : u.order === Order.Wall ? (u.wall?.town ?? -1) : u.order === Order.Gather && u.node !== undefined ? u.node : u.target === null ? -1 : (u.target.y >> 10) * SIZE + (u.target.x >> 10);
      units[o + U.stance] = u.stance;
      units[o + U.castProgress] = u.cast;
      units[o + U.flags] = u.flags;
    });

    const shown = this.buildings.filter((b) => b.owner === ME || this.everSeen(b));
    const buildings = new Int32Array(shown.length * BUILDING_STRIDE);
    shown.forEach((b, i) => {
      const o = i * BUILDING_STRIDE;
      buildings[o + B.id] = b.id;
      buildings[o + B.owner] = b.owner;
      buildings[o + B.type] = b.type;
      buildings[o + B.cellX] = b.cx;
      buildings[o + B.cellY] = b.cy;
      buildings[o + B.hp] = b.hp;
      buildings[o + B.progress] = b.progress;
      buildings[o + B.queueLength] = b.owner === ME ? b.queue.length : 0;
      buildings[o + B.queuePacked] = b.owner === ME ? b.queue.reduce<number>((acc, t, i) => acc | (t << (i * 4)), 0) : 0;
      buildings[o + B.queueProgress] = b.owner === ME ? b.queueProgress : 0;
      buildings[o + B.rallyX] = b.rallyX;
      buildings[o + B.rallyY] = b.rallyY;
      // 自動訓練 stopped by a full population (D-054): flagged as the simulation does, though the fake world trains nothing by itself.
      const full = this.units.filter((u) => u.owner === ME).length >= 20 && (b.flags & BuildingFlag.AutoTrain) !== 0 ? BuildingFlag.AutoPopulationFull : 0;
      // Round 7: soldiers hiding inside (ours only); Occupied on every building in view with someone inside.
      const soldiers = b.owner === ME ? this.units.filter((u) => u.hidden && u.inside === b.id).length : 0;
      buildings[o + B.soldiers] = soldiers;
      const occupied = soldiers > 0 || b.occupied ? BuildingFlag.Occupied : 0;
      // D-080: spearmen posted at our outpost, those on their way included; Hold on every outpost in view.
      buildings[o + B.posted] = b.owner === ME && b.type === BuildingType.Outpost ? this.units.filter((u) => u.post === b.id && u.hp > 0).length : 0;
      const hold = b.type === BuildingType.Outpost && b.hold === true ? BuildingFlag.Hold : 0;
      buildings[o + B.flags] = b.owner !== ME && !this.visible(b.cx, b.cy) ? BuildingFlag.Remembered : b.owner === ME ? b.flags | full | occupied | hold : occupied | hold;
    });

    const known = this.towns.filter((t) => this.fog[t.cy * SIZE + t.cx] > 0);
    const towns = new Int32Array(known.length * TOWN_STRIDE);
    known.forEach((t, i) => {
      const o = i * TOWN_STRIDE;
      towns[o + T.id] = t.id;
      towns[o + T.state] = t.state;
      towns[o + T.owner] = t.owner;
      towns[o + T.timer] = t.timer;
      towns[o + T.timerTotal] = t.timerTotal;
      // As in the simulation: the holder's soldiers inside the circle around the town centre.
      const r = t.radius * CELL;
      towns[o + T.garrison] = this.units.filter(
        (u) => u.owner === t.owner && u.type !== UnitType.Farmer && !u.hidden && (u.x - centre(t.cx)) * (u.x - centre(t.cx)) + (u.y - centre(t.cy)) * (u.y - centre(t.cy)) <= r * r,
      ).length;
      towns[o + T.garrisonNeeded] = t.size === TownSize.Large ? 3 : 1;
      towns[o + T.militia] = t.militia;
      towns[o + T.incomePermille] = t.income;
      towns[o + T.flags] = (this.visible(t.cx, t.cy) ? TownFlag.Visible : 0) | (t.plundered ? TownFlag.Plundered : 0);
      // Where and how big (D-074), as the simulation sends on either map.
      towns[o + T.cellX] = t.cx;
      towns[o + T.cellY] = t.cy;
      towns[o + T.size] = t.size;
    });

    const warnings = new Int32Array(this.warningTicks > 30 ? WARNING_STRIDE : 0);
    if (warnings.length > 0) warnings.set([1, FOE, centre(22), centre(71), Math.floor(CELL * 1.5), this.warningTicks - 30]);

    const nodeRows: number[] = [];
    for (const [id, kind, cx, cy, amount] of this.nodes) {
      const explored = this.fog[cy * SIZE + cx] > 0;
      if (!explored) continue;
      const vis = this.visible(cx, cy) ? 1 : 0;
      const key = `${amount}/${vis}`;
      if (this.sentNode.get(id) === key) continue;
      this.sentNode.set(id, key);
      nodeRows.push(id, kind, cx, cy, amount, vis);
    }

    const events = this.events;
    this.events = [];
    return {
      type: "snapshot",
      header,
      units,
      buildings,
      towns,
      warnings,
      nodes: Int32Array.from(nodeRows),
      fog: withFog ? this.fog.slice() : null,
      placement: withFog ? this.placementGrid() : null,
      idleFarmers: Int32Array.from(this.units.filter((u) => u.owner === ME && (u.flags & UnitFlag.IdleFarmer) !== 0).map((u) => u.id)),
      events,
    };
  }

  /** Our n farmers nearest the cell (cx, cy), nearest first, ties to the lower id. */
  private nearestFarmers(cx: number, cy: number, n: number): MUnit[] {
    const d = (u: MUnit) => (u.x / CELL - cx) * (u.x / CELL - cx) + (u.y / CELL - cy) * (u.y / CELL - cy);
    return this.units
      .filter((u) => u.owner === ME && u.type === UnitType.Farmer)
      .sort((a, b) => d(a) - d(b) || a.id - b.id)
      .slice(0, n);
  }

  private everSeen(b: MBuilding): boolean {
    const s = MOCK_RULES.buildings[b.type].size;
    for (let y = b.cy; y < b.cy + s; y++) for (let x = b.cx; x < b.cx + s; x++) if (this.fog[y * SIZE + x] > 0) return true;
    return false;
  }

  private apply(cmd: CommandBody & { seq: number }): void {
    const own = (ids: number[]) => this.units.filter((u) => u.owner === ME && ids.includes(u.id));
    const goTo = (list: MUnit[], cx: number, cy: number, order: number) => {
      list.forEach((u, i) => {
        u.target = { x: centre(cx + (i % 4) - 1), y: centre(cy + Math.floor(i / 4)) };
        u.order = order;
        u.node = undefined;
        u.cast = 0;
        u.flags &= ~UnitFlag.IdleFarmer;
        // Round 7: moving, retreating or attacking brings a hiding soldier out first.
        if (order !== Order.Garrison) {
          u.inside = -1;
          u.hidden = false;
        }
        // D-080: and off his post.
        if (order !== Order.Post) u.post = -1;
        // D-096: and down from a wall, from the cell inside it went up from.
        this.offWall(u);
      });
    };
    const reject = (reason: Reject) => this.events.push({ k: "rejected", seq: cmd.seq, reason });
    switch (cmd.c) {
      case "move":
      case "retreat":
        goTo(own(cmd.u), cmd.x, cmd.y, cmd.c === "move" ? Order.Move : Order.Retreat);
        break;
      case "attack": {
        const u = this.units.find((v) => v.id === cmd.target);
        const b = this.buildings.find((v) => v.id === cmd.target);
        if (u !== undefined) goTo(own(cmd.u), u.x >> 10, u.y >> 10, Order.Attack);
        else if (b !== undefined) goTo(own(cmd.u), b.cx, b.cy, Order.Attack);
        else reject(Reject.InvalidTarget);
        break;
      }
      case "gather": {
        const n = this.nodes.find((v) => v[0] === cmd.node);
        if (n === undefined) reject(Reject.InvalidTarget);
        else {
          const list = own(cmd.u);
          goTo(list, n[2], n[3], Order.Gather);
          for (const u of list) u.node = cmd.node;
        }
        break;
      }
      case "release":
        // Back to the economy ratio (core #149): here, idle where it stands.
        for (const u of own(cmd.u)) {
          u.order = Order.None;
          u.target = null;
          u.node = undefined;
          if (u.type === UnitType.Farmer) u.flags |= UnitFlag.IdleFarmer;
        }
        break;
      case "auto_train": {
        const b = this.buildings.find((v) => v.id === cmd.building && v.owner === ME);
        if (b !== undefined) b.flags = cmd.on ? b.flags | BuildingFlag.AutoTrain : b.flags & ~(BuildingFlag.AutoTrain | BuildingFlag.AutoPopulationFull);
        break;
      }
      case "reserve":
        this.reserve = { food: cmd.food, wood: cmd.wood, gold: cmd.gold, crystal: cmd.crystal };
        break;
      // 上城牆 (D-096, PROTOCOL.md 3.7): our ranged units and mages up on a town we hold, each on the
      // free wall cell nearest it; 下城牆 back to the cell inside they went up from.
      case "wall": {
        const t = this.towns.find((v) => v.id === cmd.town);
        const castle = t === undefined ? undefined : this.rules.towns?.[t.size]?.castle;
        const held = t !== undefined && t.owner === ME && ([TownState.AwaitingChoice, TownState.Plundering, TownState.Repairing, TownState.Governed] as TownState[]).includes(t.state);
        const list = own(cmd.u).filter((u) => u.type === UnitType.Ranged || u.type === UnitType.Mage);
        if (!this.walls) reject(Reject.NotAvailable);
        else if (t === undefined || castle === undefined) reject(Reject.InvalidTarget);
        else if (!held) reject(Reject.TownNotYours);
        else if (list.length === 0) reject(Reject.NotAvailable);
        else {
          const taken = new Set(this.units.filter((u) => u.wall?.town === t.id).map((u) => `${u.x >> 10},${u.y >> 10}`));
          const free = castle.wall.map(([x, y]) => ({ x: t.cx + x, y: t.cy + y })).filter((c) => !taken.has(`${c.x},${c.y}`));
          if (free.length === 0) reject(Reject.NoRoom);
          for (const u of list) {
            if (free.length === 0) break;
            const ux = u.x >> 10;
            const uy = u.y >> 10;
            free.sort((a, b) => (a.x - ux) ** 2 + (a.y - uy) ** 2 - ((b.x - ux) ** 2 + (b.y - uy) ** 2));
            const cell = free.shift() as { x: number; y: number };
            this.offWall(u);
            u.wall = { town: t.id, from: { x: t.cx, y: t.cy } };
            u.x = centre(cell.x);
            u.y = centre(cell.y);
            u.target = null;
            u.order = Order.Wall;
            u.flags |= UnitFlag.OnWall;
          }
        }
        break;
      }
      case "leave_wall":
        for (const u of own(cmd.u)) {
          if (u.wall?.town !== cmd.town) continue;
          this.offWall(u);
          u.order = Order.None;
        }
        break;
      case "stop":
        // Like the simulation: no order left (a retreat or a march ends there). Those hiding stay in.
        for (const u of own(cmd.u)) {
          this.offWall(u);
          if (u.hidden) continue;
          u.target = null;
          u.order = Order.None;
          u.inside = -1;
        }
        break;
      case "garrison": {
        // Round 7 (sim/PROTOCOL.md 3.3), checked in the protocol's order.
        const list = own(cmd.u);
        const b = this.buildings.find((v) => v.id === cmd.building);
        const holds = b === undefined ? 0 : (this.rules.features?.garrison === true ? (MOCK_RULES.buildings[b.type].holds ?? 0) : 0);
        const hides = list.filter((u) => (this.rules.garrisonTypes ?? []).includes(u.type));
        if (list.length === 0) reject(Reject.NotOwner);
        else if (b === undefined || b.owner !== ME || b.progress < 1000 || holds <= 0) reject(Reject.InvalidTarget);
        else if (hides.length === 0) reject(Reject.NotAvailable);
        else {
          const room = holds - this.units.filter((u) => u.inside === b.id && !hides.includes(u)).length;
          if (room <= 0) reject(Reject.NoRoom);
          else {
            const going = hides.sort((a, c) => a.id - c.id).slice(0, room);
            const s = MOCK_RULES.buildings[b.type].size;
            goTo(going, b.cx + Math.floor(s / 2), b.cy + s, Order.Garrison);
            for (const u of going) u.inside = b.id;
          }
        }
        break;
      }
      // D-080 (sim/PROTOCOL.md 3.4), checked in the protocol's order.
      case "post": {
        const list = own(cmd.u);
        const b = this.buildings.find((v) => v.id === cmd.building);
        const spears = list.filter((u) => u.type === UnitType.Spearman);
        if (list.length === 0) reject(Reject.NotOwner);
        else if (!this.outpost || b === undefined || b.owner !== ME || b.type !== BuildingType.Outpost || b.progress < 1000) reject(Reject.InvalidTarget);
        else if (spears.length === 0) reject(Reject.NotAvailable);
        else {
          const slots = this.rules.outpost?.slots ?? 0;
          const room = slots - this.units.filter((u) => u.post === b.id && u.hp > 0 && !spears.includes(u)).length;
          if (room <= 0) reject(Reject.NoRoom);
          else {
            const going = spears.sort((a, c) => a.id - c.id).slice(0, room);
            goTo(going, b.cx - 1, b.cy + 2, Order.Post);
            for (const u of going) u.post = b.id;
          }
        }
        break;
      }
      case "unpost": {
        const b = this.buildings.find((v) => v.id === cmd.building && v.owner === ME);
        const off = this.units.filter((u) => b !== undefined && u.post === b.id);
        if (b === undefined || off.length === 0) reject(Reject.NotAvailable);
        else {
          for (const u of off) {
            u.post = -1;
            u.order = Order.None;
            u.target = null;
          }
        }
        break;
      }
      case "outpost_mode": {
        const b = this.buildings.find((v) => v.id === cmd.building && v.owner === ME && v.type === BuildingType.Outpost);
        if (b === undefined) reject(Reject.InvalidTarget);
        else b.hold = cmd.hold;
        break;
      }
      case "leave": {
        const b = this.buildings.find((v) => v.id === cmd.building && v.owner === ME);
        const out = this.units.filter((u) => b !== undefined && u.hidden && u.inside === b.id && (cmd.u === undefined || cmd.u.includes(u.id)));
        if (b === undefined || out.length === 0) reject(Reject.NotAvailable);
        else {
          const s = MOCK_RULES.buildings[b.type].size;
          out.forEach((u, i) => {
            u.hidden = false;
            u.inside = -1;
            u.order = Order.None;
            u.x = centre(b.cx + (i % (s + 2)) - 1);
            u.y = centre(b.cy + s + Math.floor(i / (s + 2)));
          });
        }
        break;
      }
      case "stance":
        for (const u of own(cmd.u)) u.stance = cmd.stance;
        break;
      case "autocast":
        for (const u of own(cmd.u)) u.flags = cmd.on ? u.flags | UnitFlag.Autocast : u.flags & ~UnitFlag.Autocast;
        break;
      // 隊形 (D-027): only the flag; the fake world does not re-form the troops. `face` (D-095):
      // they turn that way, and one not 0-15 is turned down, as by the simulation.
      case "formation":
        if (cmd.face !== undefined && (!Number.isInteger(cmd.face) || cmd.face < 0 || cmd.face > 15)) {
          reject(Reject.InvalidTarget);
          break;
        }
        for (const u of own(cmd.u)) {
          u.flags = cmd.loose ? u.flags | UnitFlag.Loose : u.flags & ~UnitFlag.Loose;
          if (cmd.face !== undefined) u.facing = cmd.face;
        }
        break;
      case "cast": {
        const mage = own([cmd.u])[0];
        if (mage === undefined || mage.type !== UnitType.Mage) reject(Reject.NotAvailable);
        else {
          mage.target = null;
          mage.cast = 1;
        }
        break;
      }
      case "build": {
        const info = MOCK_RULES.buildings[cmd.type];
        const grid = this.placementGrid();
        if (checkPlacement({ size: SIZE, cells: grid }, info, cmd.x, cmd.y) !== 0) {
          reject(Reject.BadPlacement);
          break;
        }
        // Round 7: arrow towers only while the rule is on, and only on TowerLand.
        if (cmd.type === BuildingType.ArrowTower) {
          let land = this.rules.features?.towers === true;
          for (let y = cmd.y; y < cmd.y + info.size; y++) for (let x = cmd.x; x < cmd.x + info.size; x++) if ((grid[y * SIZE + x] & PlaceBit.TowerLand) === 0) land = false;
          if (!land) {
            reject(Reject.BadPlacement);
            break;
          }
        }
        // No farmers named (D-024): the nearest ones, as the simulation does (sim/PROTOCOL.md 3.1).
        const builders = cmd.u.length > 0 ? own(cmd.u) : this.nearestFarmers(cmd.x + info.size / 2, cmd.y + info.size / 2, info.size >= 3 ? 2 : 1);
        if (builders.length === 0) {
          reject(Reject.NoFarmer);
          break;
        }
        this.building(ME, cmd.type, cmd.x, cmd.y).progress = 0;
        goTo(builders, cmd.x + info.size, cmd.y + info.size, Order.Build);
        break;
      }
      case "rally": {
        const b = this.buildings.find((v) => v.id === cmd.building && v.owner === ME);
        if (b === undefined) reject(Reject.NotOwner);
        else {
          b.rallyX = centre(cmd.x);
          b.rallyY = centre(cmd.y);
        }
        break;
      }
      case "train": {
        const b = this.buildings.find((v) => v.id === cmd.building && v.owner === ME);
        if (b === undefined) reject(Reject.NotOwner);
        else if (!MOCK_RULES.buildings[b.type].trains.includes(cmd.type)) reject(Reject.NotAvailable);
        else if (b.queue.length + cmd.n > MOCK_RULES.queueMax) reject(Reject.QueueFull);
        else for (let i = 0; i < cmd.n; i++) b.queue.push(cmd.type);
        break;
      }
      case "cancel_train": {
        const b = this.buildings.find((v) => v.id === cmd.building && v.owner === ME);
        if (b === undefined || cmd.index >= b.queue.length) reject(Reject.InvalidTarget);
        else {
          b.queue.splice(cmd.index, 1);
          if (cmd.index === 0) b.queueProgress = 0;
        }
        break;
      }
      case "eco_ratio":
        this.ratio = { food: cmd.food, wood: cmd.wood, gold: cmd.gold, on: cmd.on };
        break;
      case "recall":
        this.recall = cmd.on;
        break;
      case "town_choice": {
        const t = this.towns.find((v) => v.id === cmd.town);
        if (t === undefined) reject(Reject.InvalidTarget);
        // Round 7: plundered once already, only 治理.
        else if (cmd.choice === 0 && t.plundered && this.rules.features?.plunderOnce === true) reject(Reject.AlreadyPlundered);
        else if (t.owner !== ME || t.state !== TownState.AwaitingChoice) reject(t.owner !== ME ? Reject.TownNotYours : Reject.TownChoiceMade);
        else if (cmd.choice === 1 && !this.affords(this.townCost(t.size))) reject(Reject.CannotAfford);
        else {
          // 治理 is paid when chosen, as in the simulation.
          if (cmd.choice === 1) for (const k of ["food", "wood", "gold", "crystal"] as const) this.stock[k] -= this.townCost(t.size)[k];
          t.owner = ME;
          t.state = cmd.choice === 0 ? TownState.Plundering : TownState.Repairing;
          if (cmd.choice === 0 && this.round7) t.plundered = true;
          t.timer = t.timerTotal = t.size === TownSize.Large ? 500 : 300;
        }
        break;
      }
      case "repair":
        break;
      case "surrender": {
        this.over = true;
        const zero = { food: 0, wood: 0, gold: 0, crystal: 0 };
        const player = { gathered: { ...zero }, unitsTrained: [0, 0, 0, 0], unitsLost: [0, 0, 0, 0], magesTrained: 0, magesLost: 0, townsPlundered: 0, townsGoverned: 0 };
        this.events.push({ k: "game_over", winner: FOE, reason: 1 });
        this.emit(this.snapshot(false));
        this.emit({ type: "game_over", winner: FOE, reason: 1, stats: { ticks: this.tick, winner: FOE, reason: 1, perPlayer: [player, { ...player }] } });
        break;
      }
      default:
        reject(Reject.NotAvailable);
    }
  }
}

function facing(dx: number, dy: number): number {
  let best = 0;
  let bestDot = -Infinity;
  for (let k = 0; k < DIRS.length; k++) {
    const dot = DIRS[k][0] * dx + DIRS[k][1] * dy;
    if (dot > bestDot) {
      bestDot = dot;
      best = k;
    }
  }
  return best;
}
