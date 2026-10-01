// A fake world behind the same Worker messages as sim/src/worker.ts (sim/PROTOCOL.md), so
// the battlefield, gestures and HUD can be built and tested before the real simulation is
// connected. It is NOT the game's rules: units walk in straight lines, nothing fights, and
// every number here is a placeholder. It shows one of everything the screen must draw:
// towns in each state, fog in all three states, a remembered building, a mage calibrating
// with a shield, an enemy cannon warning, trees, gold, berries and a crystal vein.

import type { SimPort } from "../game/port.ts";
import {
  Action,
  BUILDING_STRIDE,
  BuildingField as B,
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
  NEUTRAL,
  NodeKind,
  Order,
  PlaceBit,
  PROTOCOL_VERSION,
  Reject,
  type Rules,
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
  type UnitInfo,
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

function unitInfo(type: UnitType, hp: number, shield: number, attack: number, range: number, c: Cost): UnitInfo {
  return { type, hp, shield, attack, range: range * CELL, speed: STEP, sight: SIGHT, cooldown: 20, cost: c, trainTicks: 360, population: 1 };
}

function buildingInfo(type: BuildingType, hp: number, size: number, c: Cost, extra: Partial<BuildingInfo> = {}): BuildingInfo {
  return { type, hp, size, walkable: false, cost: c, buildTicks: 600, sight: 6, populationCap: 0, accepts: [], trains: [], shelter: 0, ...extra };
}

/** Placeholder tables (GDD appendix A where it has a number). The real ones come from sim/. */
export const MOCK_RULES: Rules = {
  units: [
    unitInfo(UnitType.Farmer, 25, 0, 3, 1, cost(50, 0, 0)),
    unitInfo(UnitType.Spearman, 60, 0, 6, 1, cost(40, 20, 0)),
    unitInfo(UnitType.Ranged, 35, 0, 5, 5, cost(0, 40, 30)),
    unitInfo(UnitType.Mage, 30, 60, 4, 5, cost(0, 0, 90, 50)),
    unitInfo(UnitType.Militia, 40, 0, 4, 1, cost(0, 0, 0)),
  ],
  buildings: [
    buildingInfo(BuildingType.MainCity, 1200, 4, cost(0, 0, 0), { populationCap: 10, accepts: [0, 1, 2, 3], trains: [UnitType.Farmer], shelter: 15 }),
    buildingInfo(BuildingType.House, 300, 2, cost(0, 30, 0), { populationCap: 5, shelter: 5 }),
    buildingInfo(BuildingType.LumberCamp, 300, 2, cost(0, 50, 0), { accepts: [1] }),
    buildingInfo(BuildingType.Mine, 300, 2, cost(0, 50, 0), { accepts: [2, 3] }),
    buildingInfo(BuildingType.Granary, 300, 2, cost(0, 60, 0), { accepts: [0] }),
    buildingInfo(BuildingType.Farm, 100, 3, cost(0, 60, 0), { walkable: true }),
    buildingInfo(BuildingType.Barracks, 600, 3, cost(0, 150, 0), { trains: [UnitType.Spearman] }),
    buildingInfo(BuildingType.Range, 600, 3, cost(0, 150, 0), { trains: [UnitType.Ranged] }),
    buildingInfo(BuildingType.MageHall, 700, 3, cost(0, 200, 150), { trains: [UnitType.Mage] }),
    buildingInfo(BuildingType.TownTower, 800, 2, cost(0, 0, 0)),
  ],
  multipliers: [],
  mageCap: 6,
  maxPopulation: 120,
  queueMax: 5,
};

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
}

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

  /** Tests: these units of ours fall. */
  remove(ids: number[]): void {
    for (let i = this.units.length - 1; i >= 0; i--) if (this.units[i].owner === ME && ids.includes(this.units[i].id)) this.units.splice(i, 1);
  }

  postMessage(msg: ToWorker): void {
    switch (msg.type) {
      case "init":
        this.tps = msg.tps;
        this.setup();
        this.emit({ type: "ready", protocol: PROTOCOL_VERSION, player: ME, map: this.mapInfo(), rules: MOCK_RULES });
        this.updateFog();
        this.emit(this.snapshot(true));
        this.schedule();
        break;
      case "command":
        this.apply(msg.cmd);
        break;
      case "pause":
        this.paused = true;
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

    this.building(ME, BuildingType.MainCity, 8, 80);
    this.building(ME, BuildingType.House, 14, 86);
    this.building(ME, BuildingType.Barracks, 4, 74);
    this.building(ME, BuildingType.Farm, 14, 80);
    this.building(ME, BuildingType.House, 18, 86).progress = 400;
    this.building(FOE, BuildingType.MainCity, 84, 12);
    this.building(FOE, BuildingType.Barracks, 34, 58);
    this.building(FOE, BuildingType.House, 38, 62);
    this.building(NEUTRAL, BuildingType.TownTower, 47, 45);

    const town = (size: TownSize, cx: number, cy: number, state: TownState, owner: number, timer = 0, total = 0, militia = 0) =>
      this.towns.push({ id: this.towns.length, size, cx, cy, radius: size === TownSize.Large ? 6 : 4, state, owner, timer, timerTotal: total, militia });
    town(TownSize.Small, 30, 66, TownState.Neutral, NEUTRAL, 0, 0, 3);
    town(TownSize.Small, 18, 62, TownState.Governed, ME);
    town(TownSize.Small, 36, 80, TownState.Ruins, -1, 3000, 4800);
    town(TownSize.Large, 48, 48, TownState.Plundering, ME, 300, 500);
    town(TownSize.Small, 38, 56, TownState.Governed, FOE);

    const unit = (owner: number, type: UnitType, cx: number, cy: number) => {
      const info = MOCK_RULES.units[type];
      const u: MUnit = {
        id: this.nextId++, owner, type, x: centre(cx), y: centre(cy), hp: info.hp, shield: info.shield,
        facing: 0, stance: Stance.Aggressive, flags: 0, target: null, order: Order.None, cast: 0,
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
    unit(FOE, UnitType.Spearman, 80, 20);

    // Start with the home area explored, so the three fog states are all on screen.
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) if ((x - 18) ** 2 + (y - 74) ** 2 <= 30 * 30) this.fog[y * SIZE + x] = 1;
    }
  }

  private building(owner: number, type: BuildingType, cx: number, cy: number): MBuilding {
    const b: MBuilding = { id: this.nextId++, owner, type, cx, cy, hp: MOCK_RULES.buildings[type].hp, progress: 1000, flags: 0, rallyX: -1, rallyY: -1, queue: [], queueProgress: 0 };
    this.buildings.push(b);
    return b;
  }

  private mapInfo(): MapInfo {
    return {
      seed: 1,
      size: SIZE,
      terrain: this.terrain.slice(),
      spawns: [
        { player: ME, cellX: 16, cellY: 76 },
        { player: FOE, cellX: 86, cellY: 14 },
      ],
      towns: this.towns.map((t) => ({ id: t.id, size: t.size, cellX: t.cx, cellY: t.cy, radius: t.radius })),
    };
  }

  private step(): void {
    this.tick++;
    for (const u of this.units) {
      if (u.target !== null) {
        const dx = u.target.x - u.x;
        const dy = u.target.y - u.y;
        const d = Math.hypot(dx, dy);
        if (d <= STEP) {
          u.x = u.target.x;
          u.y = u.target.y;
          u.target = null;
          u.order = Order.None;
          if (u.type === UnitType.Farmer) u.flags |= UnitFlag.IdleFarmer;
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
            facing: 0, stance: Stance.Aggressive, flags: type === UnitType.Farmer ? UnitFlag.IdleFarmer : 0, target: null, order: Order.None, cast: 0,
          };
          this.units.push(u);
          this.events.push({ k: "unit_trained", id: u.id, type, building: b.id });
        }
      }
    }
    for (const t of this.towns) if (t.timer > 0) t.timer = t.timer <= 1 ? t.timerTotal : t.timer - 1;
    this.warningTicks = this.warningTicks <= 0 ? 60 : this.warningTicks - 1;
    if (this.tick % FOG_EVERY === 0) this.updateFog();
    this.emit(this.snapshot(this.tick % FOG_EVERY === 0));
  }

  private updateFog(): void {
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
    for (let i = 0; i < cells.length; i++) {
      if (this.terrain[i] === 1) cells[i] |= PlaceBit.Blocked;
      if (this.fog[i] === 0) cells[i] |= PlaceBit.Unexplored;
    }
    for (const [, , cx, cy, amount] of this.nodes) if (amount > 0) cells[cy * SIZE + cx] |= PlaceBit.Blocked;
    for (const b of this.buildings) {
      const s = MOCK_RULES.buildings[b.type].size;
      for (let y = b.cy; y < b.cy + s; y++) for (let x = b.cx; x < b.cx + s; x++) cells[y * SIZE + x] |= PlaceBit.Blocked;
      if (b.owner === ME && (b.type === BuildingType.MainCity || b.type === BuildingType.Granary)) {
        for (let y = b.cy - 5; y < b.cy + s + 5; y++) {
          for (let x = b.cx - 5; x < b.cx + s + 5; x++) if (x >= 0 && y >= 0 && x < SIZE && y < SIZE) cells[y * SIZE + x] |= PlaceBit.FarmLand;
        }
      }
    }
    return cells;
  }

  private snapshot(withFog: boolean): FromWorker {
    const header = new Int32Array(HEADER_LENGTH);
    header[H.tick] = this.tick;
    header[H.paused] = this.paused ? 1 : 0;
    header[H.speed] = this.tps * 100;
    header[H.food] = 200;
    header[H.wood] = 200;
    header[H.gold] = 100;
    header[H.crystal] = 20;
    header[H.population] = this.units.filter((u) => u.owner === ME).length;
    header[H.populationCap] = 20;
    header[H.mages] = 2;
    header[H.mageCap] = 6;
    header[H.ratioFood] = this.ratio.food;
    header[H.ratioWood] = this.ratio.wood;
    header[H.ratioGold] = this.ratio.gold;
    header[H.ratioOn] = this.ratio.on ? 1 : 0;
    header[H.recall] = this.recall ? 1 : 0;
    header[H.gameState] = this.over ? 2 : 0;
    header[H.fogTick] = this.tick - (this.tick % FOG_EVERY);

    const seen = this.units.filter((u) => u.owner === ME || this.visible(u.x >> 10, u.y >> 10));
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
      units[o + U.action] = u.cast > 0 ? Action.Calibrate : u.target !== null ? Action.Move : Action.Idle;
      units[o + U.facing] = u.facing;
      units[o + U.carryKind] = -1;
      units[o + U.order] = u.cast > 0 ? Order.Cast : u.order;
      units[o + U.orderTarget] = u.target === null ? -1 : (u.target.y >> 10) * SIZE + (u.target.x >> 10);
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
      buildings[o + B.flags] = b.owner !== ME && !this.visible(b.cx, b.cy) ? 1 : 0;
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
        (u) => u.owner === t.owner && u.type !== UnitType.Farmer && (u.x - centre(t.cx)) * (u.x - centre(t.cx)) + (u.y - centre(t.cy)) * (u.y - centre(t.cy)) <= r * r,
      ).length;
      towns[o + T.garrisonNeeded] = t.size === TownSize.Large ? 3 : 1;
      towns[o + T.militia] = t.militia;
      towns[o + T.flags] = this.visible(t.cx, t.cy) ? TownFlag.Visible : 0;
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
        u.cast = 0;
        u.flags &= ~UnitFlag.IdleFarmer;
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
        else goTo(own(cmd.u), n[2], n[3], Order.Gather);
        break;
      }
      case "stop":
        for (const u of own(cmd.u)) u.target = null;
        break;
      case "stance":
        for (const u of own(cmd.u)) u.stance = cmd.stance;
        break;
      case "autocast":
        for (const u of own(cmd.u)) u.flags = cmd.on ? u.flags | UnitFlag.Autocast : u.flags & ~UnitFlag.Autocast;
        break;
      // 隊形 (D-027): only the flag; the fake world does not re-form the troops.
      case "formation":
        for (const u of own(cmd.u)) u.flags = cmd.loose ? u.flags | UnitFlag.Loose : u.flags & ~UnitFlag.Loose;
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
        if (checkPlacement({ size: SIZE, cells: this.placementGrid() }, info, cmd.x, cmd.y) !== 0) {
          reject(Reject.BadPlacement);
          break;
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
        else {
          t.owner = ME;
          t.state = cmd.choice === 0 ? TownState.Plundering : TownState.Repairing;
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
