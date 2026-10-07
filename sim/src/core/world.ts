// Simulation state. Every entity kind is a table of Int32Array columns kept in id order:
// new ids are appended and removal keeps the order, so "slot 0..count-1" is id order and
// iterating a table is deterministic. Units and buildings share one id sequence; resource
// nodes and towns have their own small, fixed id ranges.

import { BuildingFlag, BuildingType, NEUTRAL, PLAYER_COUNT, TownState, UnitType } from "../protocol.ts";
import { IDENTITY, spawnCentre, stepOrder, xIsCanonY } from "../frame.ts";
import type { GameMap } from "./map.ts";
import { AUTO_TRAIN, BUILDINGS, ECO_DEFAULT, MAX_POPULATION, TOWNS, UNITS } from "./rules.ts";

export const UNIT_COLS = [
  "id", "owner", "type", "x", "y", "hp", "shield", "action", "facing", "carryKind", "carryAmount",
  "order", "orderTarget", "orderX", "orderY", "stance", "castProgress", "castCooldown", "flags",
  "cooldown", "target", "group", "speedCap", "anchorX", "anchorY", "lastHurt", "stuck", "home",
  "vx", "vy",
  // Farmers (economy.ts): task phase, 1 when a Gather order's target is a farm building,
  // the work accumulator, whether this tick's decide put the farmer at its work, and the
  // order recall interrupted (restored when recall ends).
  "task", "onFarm", "acc", "working", "prevOrder", "prevTarget", "prevOnFarm",
  // 1 = the player sent this farmer somewhere (move, retreat, stop, attack): once idle it
  // waits there and automatic work (auto-repair, the economy ratio) leaves it alone, until
  // the player gives it work (gather, build, repair). Recall still takes it (GDD section 4).
  "stay",
  // A build without farmers (round 2): the building the simulation sent this farmer to build,
  // and the gathering it was doing then (node, or farm building with resumeFarm = 1), which it
  // goes back to when that building is done.
  "autoBuild", "resumeTarget", "resumeFarm",
  // Mages (units.ts): the cannon's aim point, the last tick this unit dealt damage (shield
  // regeneration waits for both), and the owner of the last thing that hit it (bounty).
  "castX", "castY", "lastDealt", "hitBy",
  // The squad (operations round, D-050): units that got the same move or attack command share a
  // number above 0 and fight together (units.ts); 0 = none (new units, retreat).
  "squad",
  // What last hurt this unit (HitCause), for statistics only: not in the hash (UNIT_HASH_SKIP).
  "hitCause",
  // The unit that last hit this one, -1 for an arrow (counter-attacks, COUNTER_ATTACK; in the
  // hash only while counter-attacks are on).
  "hitById",
  // The mage a cannon shot sent this soldier after (AVENGE, round 8), -1 none; in the hash only
  // while AVENGE is on.
  "avenge",
] as const;
export type UnitCol = (typeof UNIT_COLS)[number];
/** Unit types counted per player in `trained` and `lost` (UnitType 0..5; the hash leaves out cavalry while CAVALRY is off). */
export const UNIT_KINDS = 6;
/** Unit columns that are statistics only, left out of the hash so a game plays and hashes as without them. */
export const UNIT_HASH_SKIP: ReadonlySet<string> = new Set(["hitCause"]);
/** What last hurt a unit (unit column hitCause; farmers' deaths are counted by it). */
export const HitCause = { None: 0, Militia: 1, Unit: 2, Cannon: 3, Arrow: 4 } as const;
export type HitCause = (typeof HitCause)[keyof typeof HitCause];

export const BUILDING_COLS = [
  "id", "owner", "type", "cellX", "cellY", "hp", "progress", "flags",
  "q0", "q1", "q2", "q3", "q4", "q5", "q6", "queueLength", "queueTicks",
  "rallyX", "rallyY", "garrisoned", "cooldown", "target", "lastHurt", "town",
  // Builder-ticks of construction done, and the hp accumulator of repairs.
  "work", "acc",
  // Soldiers hiding inside (round 7, D-061, GARRISON; in the hash only while it is on).
  "soldiers",
] as const;
export type BuildingCol = (typeof BUILDING_COLS)[number];

/** A growable table of Int32Array columns, compacted in order on removal. */
export class Table<C extends string> {
  readonly names: readonly C[];
  count = 0;
  cap: number;
  col: Record<C, Int32Array>;
  constructor(names: readonly C[], cap = 256) {
    this.names = names;
    this.cap = cap;
    this.col = {} as Record<C, Int32Array>;
    for (const n of names) this.col[n] = new Int32Array(cap);
  }
  /** Appends a zeroed row and returns its slot. */
  add(): number {
    if (this.count === this.cap) {
      this.cap *= 2;
      for (const n of this.names) {
        const a = new Int32Array(this.cap);
        a.set(this.col[n]);
        this.col[n] = a;
      }
    }
    const s = this.count++;
    for (const n of this.names) this.col[n][s] = 0;
    return s;
  }
  /** Removes the rows with dead[slot] = 1, keeping the others in order; calls moved(from, to). */
  compact(dead: Uint8Array, moved: (from: number, to: number) => void): void {
    let w = 0;
    for (let r = 0; r < this.count; r++) {
      if (dead[r] === 1) continue;
      if (w !== r) {
        for (const n of this.names) this.col[n][w] = this.col[n][r];
      }
      moved(r, w);
      w++;
    }
    this.count = w;
  }
}

/** Grid bits: a cell is walkable when none of BLOCK_* is set. */
export const BLOCK_ROCK = 1;
export const BLOCK_NODE = 2;
export const BLOCK_BUILDING = 4;

export class World {
  readonly map: GameMap;
  readonly size: number;
  tick = 0;
  nextId = 0;
  units = new Table(UNIT_COLS, 256);
  buildings = new Table(BUILDING_COLS, 64);
  /** id -> slot in units / buildings, or -1. */
  unitSlot = new Int32Array(1024).fill(-1);
  buildingSlot = new Int32Array(1024).fill(-1);

  // Resource nodes (fixed set; amount 0 = gone).
  nodeKind: Int32Array;
  nodeX: Int32Array;
  nodeY: Int32Array;
  nodeAmount: Int32Array;
  /** Cell -> node id or -1. */
  nodeAt: Int32Array;

  // Towns (fixed set).
  townSize: Int32Array;
  townX: Int32Array;
  townY: Int32Array;
  townRadius: Int32Array;
  townState: Int32Array;
  townOwner: Int32Array;
  townTimer: Int32Array;
  townTimerTotal: Int32Array;
  townRevolt: Int32Array;
  /** 1 while both players have military inside the radius (state frozen). */
  townContested: Int32Array;
  /** Per-minute production accumulators [town * 3 + food|gold|crystal] (towns.ts). */
  townAcc: Int32Array;
  /** The current governing spell of each town: what it cost, what it has paid out. */
  townSpellCost: Int32Array;
  townSpellIncome: Int32Array;
  /**
   * Round 7 (D-061): 1 once a town has been plundered this game (TOWN_ONCE), and the ticks it
   * has been governed since (PLUNDER_RECOVERY). In the hash only while those rules are on.
   */
  townPlundered: Int32Array;
  townRecover: Int32Array;

  /** Resources per player: [player * 4 + Resource]. Neutral has a row too. */
  res = new Int32Array((PLAYER_COUNT + 1) * 4);
  /** BLOCK_* bits per cell. */
  grid: Uint8Array;
  /** Cell -> id of the building whose footprint covers it (farms too), or -1. */
  buildingAt: Int32Array;
  /**
   * Path-cache versions (paths.ts): blockVersion is bumped when cells become blocked (a
   * building placed), openVersion when cells open (a node used up, a building gone), and
   * dropVersion when the set of finished drop-off buildings changes.
   */
  blockVersion = 0;
  openVersion = 0;
  dropVersion = 0;

  // Per player economy settings: ratio in percent [p * 3 + food|wood|gold], on/off, recall.
  ecoRatio = new Int32Array(PLAYER_COUNT * 3);
  ecoOn = new Uint8Array(PLAYER_COUNT);
  recall = new Uint8Array(PLAYER_COUNT);
  // Automatic training (round 6): what it leaves untouched [p * 4 + Resource], and whether a
  // player's new barracks, ranges and mage halls start with it on (from GameConfig.autoTrain).
  // Neither is in the hash: the reserve shows in what gets queued, and the start in the flags.
  reserve = new Int32Array(PLAYER_COUNT * 4);
  autoTrain = new Uint8Array(PLAYER_COUNT);

  // Statistics for game_over (GameStats): [p * 4 + Resource], [p * UNIT_KINDS + UnitType].
  gathered = new Int32Array(PLAYER_COUNT * 4);
  trained = new Int32Array(PLAYER_COUNT * UNIT_KINDS);
  lost = new Int32Array(PLAYER_COUNT * UNIT_KINDS);
  plundered = new Int32Array(PLAYER_COUNT);
  governed = new Int32Array(PLAYER_COUNT);
  /** Crystal cannon shots fired, and units they hit, per player. */
  cannonShots = new Int32Array(PLAYER_COUNT);
  cannonHits = new Int32Array(PLAYER_COUNT);
  /** Units the crystal cannon killed (its hit was the last), per player that fired (round 8; not hashed). */
  cannonKills = new Int32Array(PLAYER_COUNT);
  // Town statistics per player (for weighing plunder against govern): resources taken by
  // plunders; governing chosen, its cost, what governed towns paid out and the ticks they
  // were governed; governing spells that ended (revolt or capture) and those of them whose
  // pay-out had reached their cost. Resources are counted as food + wood + gold + crystal.
  plunderIncome = new Int32Array(PLAYER_COUNT);
  governChosen = new Int32Array(PLAYER_COUNT);
  governCost = new Int32Array(PLAYER_COUNT);
  townIncome = new Int32Array(PLAYER_COUNT);
  governedTicks = new Int32Array(PLAYER_COUNT);
  governEnded = new Int32Array(PLAYER_COUNT);
  governPaidBack = new Int32Array(PLAYER_COUNT);
  /** Tick of the first town capture, or -1. */
  firstCapture = -1;
  /** Who made it (a statistic for comebacks, D-057; not in the hash: firstCapture is). */
  firstCaptureBy = -1;
  /**
   * Statistics, not in the hash (early balance, D-057; from round 4): farmers lost per player
   * by what last hurt them [p * 5 + HitCause], and towns lost to a revolt per player.
   */
  farmerDeaths = new Int32Array(PLAYER_COUNT * 5);
  /** Where farmers died (D-070's measurement; not hashed): owner, cell x, cell y, HitCause, tick, five numbers each. */
  readonly farmerDeathLog: number[] = [];
  revolts = new Int32Array(PLAYER_COUNT);
  /**
   * Per owner (players, then neutral): the flow-field step order and whether to try the y
   * axis first when sliding along a wall, both from the owner's symmetry frame (frame.ts).
   */
  stepOrders: number[][] = [];
  yFirst: boolean[] = [];
  /**
   * Per player, the cell it takes as its own main city's centre (frame.ts spawnCentre): the
   * spawn cell on the fixed map, the same cell of the mirror image on both sides of a random one.
   */
  homes: { cellX: number; cellY: number }[] = [];
  /** Winner once the game is over (-1 = draw), or -2 while running. */
  winner = -2;
  endReason = -1;

  constructor(map: GameMap) {
    this.map = map;
    const n = (this.size = map.size);
    this.grid = new Uint8Array(n * n);
    this.buildingAt = new Int32Array(n * n).fill(-1);
    for (let o = 0; o <= PLAYER_COUNT; o++) {
      const f = map.frames[o] ?? IDENTITY;
      this.stepOrders.push(stepOrder(f));
      this.yFirst.push(xIsCanonY(f));
    }
    for (let p = 0; p < PLAYER_COUNT; p++) {
      const c = spawnCentre(map.frames[p] ?? IDENTITY, map.spawns[p]);
      this.homes.push({ cellX: c.x, cellY: c.y });
    }
    for (let i = 0; i < n * n; i++) if (map.terrain[i] === 1) this.grid[i] = BLOCK_ROCK;
    for (let p = 0; p < PLAYER_COUNT; p++) {
      this.ecoRatio.set([ECO_DEFAULT.food, ECO_DEFAULT.wood, ECO_DEFAULT.gold], p * 3);
      this.ecoOn[p] = 1;
      const r = AUTO_TRAIN.reserve;
      this.reserve.set([r.food, r.wood, r.gold, r.crystal], p * 4);
    }
    const k = map.nodes.length;
    this.nodeKind = new Int32Array(k);
    this.nodeX = new Int32Array(k);
    this.nodeY = new Int32Array(k);
    this.nodeAmount = new Int32Array(k);
    this.nodeAt = new Int32Array(n * n).fill(-1);
    map.nodes.forEach((s, i) => {
      this.nodeKind[i] = s.kind;
      this.nodeX[i] = s.cellX;
      this.nodeY[i] = s.cellY;
      this.nodeAmount[i] = s.amount;
      this.nodeAt[s.cellY * n + s.cellX] = i;
      this.grid[s.cellY * n + s.cellX] |= BLOCK_NODE;
    });
    const t = map.towns.length;
    this.townSize = new Int32Array(t);
    this.townX = new Int32Array(t);
    this.townY = new Int32Array(t);
    this.townRadius = new Int32Array(t);
    this.townState = new Int32Array(t).fill(TownState.Neutral);
    this.townOwner = new Int32Array(t).fill(NEUTRAL);
    this.townTimer = new Int32Array(t);
    this.townTimerTotal = new Int32Array(t);
    this.townRevolt = new Int32Array(t);
    this.townContested = new Int32Array(t);
    this.townAcc = new Int32Array(t * 3);
    this.townSpellCost = new Int32Array(t);
    this.townSpellIncome = new Int32Array(t);
    this.townPlundered = new Int32Array(t);
    this.townRecover = new Int32Array(t);
    map.towns.forEach((s, i) => {
      this.townSize[i] = s.size;
      this.townX[i] = s.cellX;
      this.townY[i] = s.cellY;
      this.townRadius[i] = s.radius;
    });
  }

  private newId(): number {
    const id = this.nextId++;
    if (id >= this.unitSlot.length) {
      const grow = (a: Int32Array) => {
        const b = new Int32Array(a.length * 2).fill(-1);
        b.set(a);
        return b;
      };
      this.unitSlot = grow(this.unitSlot);
      this.buildingSlot = grow(this.buildingSlot);
    }
    return id;
  }

  addUnit(owner: number, type: UnitType, x: number, y: number, hp: number): number {
    const u = this.units;
    const s = u.add();
    const id = this.newId();
    this.unitSlot[id] = s;
    const c = u.col;
    c.id[s] = id;
    c.owner[s] = owner;
    c.type[s] = type;
    c.x[s] = x;
    c.y[s] = y;
    c.hp[s] = hp;
    c.shield[s] = UNITS[type].shield;
    c.carryKind[s] = -1;
    c.orderTarget[s] = -1;
    c.target[s] = -1;
    c.group[s] = -1;
    c.anchorX[s] = x;
    c.anchorY[s] = y;
    c.lastHurt[s] = -100000;
    c.hitCause[s] = HitCause.None;
    c.hitById[s] = -1;
    c.avenge[s] = -1;
    c.home[s] = -1;
    c.prevTarget[s] = -1;
    c.autoBuild[s] = -1;
    c.resumeTarget[s] = -1;
    c.lastDealt[s] = -100000;
    c.hitBy[s] = -1;
    return id;
  }

  addBuilding(owner: number, type: BuildingType, cellX: number, cellY: number, hp: number, progress: number): number {
    const b = this.buildings;
    const s = b.add();
    const id = this.newId();
    this.buildingSlot[id] = s;
    const c = b.col;
    c.id[s] = id;
    c.owner[s] = owner;
    c.type[s] = type;
    c.cellX[s] = cellX;
    c.cellY[s] = cellY;
    c.hp[s] = hp;
    c.progress[s] = progress;
    c.rallyX[s] = -1;
    c.rallyY[s] = -1;
    c.target[s] = -1;
    c.lastHurt[s] = -100000;
    c.town[s] = -1;
    if (owner < PLAYER_COUNT && this.autoTrain[owner] === 1 && AUTO_TRAIN.buildings.includes(type)) c.flags[s] = BuildingFlag.AutoTrain;
    this.setFootprint(id, type, cellX, cellY, true);
    if (progress >= 1000 && BUILDINGS[type].accepts.length > 0) this.dropVersion++;
    return id;
  }

  /**
   * Marks or clears a building's footprint: buildingAt always, the grid's BLOCK_BUILDING
   * bit unless the building is walkable (farms).
   */
  setFootprint(id: number, type: BuildingType, cellX: number, cellY: number, on: boolean): void {
    const info = BUILDINGS[type];
    const n = this.size;
    for (let y = cellY; y < cellY + info.size; y++) {
      for (let x = cellX; x < cellX + info.size; x++) {
        this.buildingAt[y * n + x] = on ? id : -1;
        if (info.walkable) continue;
        if (on) this.grid[y * n + x] |= BLOCK_BUILDING;
        else this.grid[y * n + x] &= ~BLOCK_BUILDING;
      }
    }
    if (info.walkable) return;
    if (on) this.blockVersion++;
    else this.openVersion++;
  }

  unit(id: number): number {
    return id >= 0 && id < this.unitSlot.length ? this.unitSlot[id] : -1;
  }
  building(id: number): number {
    return id >= 0 && id < this.buildingSlot.length ? this.buildingSlot[id] : -1;
  }

  walkable(cellX: number, cellY: number): boolean {
    const n = this.size;
    return cellX >= 0 && cellY >= 0 && cellX < n && cellY < n && this.grid[cellY * n + cellX] === 0;
  }

  get over(): boolean {
    return this.winner !== -2;
  }

  /** Population in use: every living unit the player owns (garrisoned farmers too). */
  population(p: number): number {
    const u = this.units.col;
    let pop = 0;
    for (let s = 0; s < this.units.count; s++) if (u.owner[s] === p) pop += UNITS[u.type[s]].population;
    return pop;
  }

  /** Population cap: finished buildings and governed towns, at most MAX_POPULATION. */
  populationCap(p: number): number {
    const b = this.buildings.col;
    let cap = 0;
    for (let s = 0; s < this.buildings.count; s++) {
      if (b.owner[s] === p && b.progress[s] >= 1000) cap += BUILDINGS[b.type[s]].populationCap;
    }
    for (let t = 0; t < this.townSize.length; t++) {
      if (this.townOwner[t] === p && this.townState[t] === TownState.Governed) cap += TOWNS[this.townSize[t]].populationCap;
    }
    return Math.min(cap, MAX_POPULATION);
  }

  /** The main city of a player, or -1. */
  mainCity(player: number): number {
    const b = this.buildings.col;
    for (let s = 0; s < this.buildings.count; s++) {
      if (b.owner[s] === player && b.type[s] === BuildingType.MainCity) return s;
    }
    return -1;
  }
}

