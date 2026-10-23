// Simulation state. Every entity kind is a table of Int32Array columns kept in id order:
// new ids are appended and removal keeps the order, so "slot 0..count-1" is id order and
// iterating a table is deterministic. Units and buildings share one id sequence; resource
// nodes and towns have their own small, fixed id ranges.

import { Action, BuildingFlag, BuildingType, CELL, CELL_SHIFT, NEUTRAL, Order, PLAYER_COUNT, Terrain, TownState, UnitType, walkableTerrain } from "../protocol.ts";
import { IDENTITY, spawnCentre, stepOrder, xIsCanonY } from "../frame.ts";
import { type Castle, castleOf } from "./castle.ts";
import type { GameMap } from "./map.ts";
import { AUTO_TRAIN, BUILDINGS, ECO_DEFAULT, GATE, MAX_POPULATION, POPULATION_200, TOWNS, UNITS } from "./rules.ts";

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
  // The unit that shot this soldier on a move and that it goes for (FIRE_BACK, D-095), -1 none;
  // in the hash only while FIRE_BACK is on.
  "fireBack",
  // The wall cell it stands on or is going up onto (D-096, WALLS), -1 none; in the hash only while
  // WALLS is on.
  "wall",
  // Ticks this unit stood to let lower ranks pass on its move (MARCH_ORDER, D-095); in the hash
  // only while MARCH_ORDER is on.
  "waited",
  // Giving up a place it does not get to (SLOT_GIVE_UP, D-095): the nearest it came to its place
  // on this move or retreat (fixed point, 0 none yet) and the ticks since it last came nearer; in
  // the hash only while SLOT_GIVE_UP is on.
  "slotBest", "slotIdle",
  // Going for the back row (CAV_FLANK, D-097): the target it rides for (-1 none), the side it
  // goes round the front (1, -1; 0 not chosen yet), the point beside the front it heads for
  // (fixed point, -1 none) and the tick it set off or last landed a hit (not going: the tick it
  // may go again). In the hash only while CAV_FLANK is on.
  "flank", "flankSide", "flankX", "flankY", "flankTick",
] as const;
export type UnitCol = (typeof UNIT_COLS)[number];
/**
 * Unit types counted per player in `trained` and `lost` (UnitType 0..6; the hash leaves out cavalry
 * while CAVALRY is off, and siege engines while SIEGE is off, D-099).
 */
export const UNIT_KINDS = 7;
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
  // An outpost's guards go for this unit or building (D-080, OUTPOST; -1: none): whoever last hit
  // the outpost or one of its guards. In the hash only while OUTPOST is on.
  "provoker",
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
/** A castle wall or corner tower (D-089): terrain, never removed. */
export const BLOCK_WALL = 8;
/**
 * A standing gate closed to someone (D-096): walkable only by the player in World.gateOwner (the
 * town's holder) on that player's own grid (World.passGrid); closed to everyone else.
 */
export const BLOCK_GATE = 16;
/** Openings in every castle's walls (D-096; castle.gates). */
export const GATES = 4;
/** Numbers per stone in World.stones (D-099). */
export const STONE = 7;

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
  /** Each town's castle on this map (D-089): offsets from its centre cell (castle.ts). */
  readonly castles: Castle[] = [];
  /** 1 on the cells of the castles' gates (D-089). */
  gateAt: Uint8Array;
  /** At each gate opening's top-left cell (D-096), its sides in cells (x | y << 8); 0 elsewhere. */
  gateSides: Int32Array;
  /** Every gate cell (D-096), town by town, opening by opening. */
  gateCells: Int32Array;
  /** Per cell, the town whose walls it lies inside (castle.inside), or -1 (D-096: who reaches whom). */
  insideAt: Int32Array;
  /**
   * D-096, the walls soldiers stand on: per wall cell they can go up onto, its town (wallTown), the
   * cell inside the walls next to it they climb from (wallFoot, a side neighbour where there is one),
   * and the unit standing there or on its way up (wallAt, -1 free); -1 for every other cell.
   */
  wallTown: Int32Array;
  wallFoot: Int32Array;
  wallAt: Int32Array;
  /** Each town's wall cells soldiers can stand on, in the castle's wall order (D-096). */
  wallCells: Int32Array[] = [];
  /**
   * On a cell under a standing gate that is closed to someone (BLOCK_GATE, D-096): the player it
   * lets through (the town's holder), or -1 (closed to everyone: a neutral town's).
   */
  gateOwner: Int32Array;
  /**
   * D-096: per town and opening (town * GATES + opening), the ticks left until a governed town
   * rebuilds that broken gate (counting while no enemy stands inside its walls), 0 when not.
   */
  gateRebuild: Int32Array;
  /**
   * D-099 (SIEGE): stones in the air, STONE numbers each in the order thrown: the engine's id, its
   * owner, where it lands (fixed point x, y), the tick it lands, the building it was thrown at (-1: at
   * units) and the damage. In the hash only while SIEGE is on.
   */
  stones: number[] = [];
  /** Gate cells each player may walk that others may not (passClass). */
  private readonly ownGates = new Int32Array(PLAYER_COUNT);
  private readonly passGrids: Uint8Array[] = [];
  private readonly passBlock: number[] = [];
  private readonly passOpen: number[] = [];
  /**
   * Each town's castle cells (D-089): inside the walls and the ring of walls and gates, as cell
   * indices. Seeing any of them is seeing the town (fog.ts): the walls stand 5 cells from a small
   * town's centre, as far as a farmer sees, so its centre is out of sight from outside them.
   */
  castleCells: Int32Array[] = [];
  /**
   * 1 on each gate's lane (ceo 2026-10-20: the gates stay open, so nothing is built there): the gate
   * cells, the cell in front of each and the first cell behind it.
   */
  gateLane: Uint8Array;
  /**
   * Statistics, not in the hash (D-089's measurement): soldiers lost per player within 3 cells of a
   * gate, and inside a castle's walls or within 3 cells outside them; and the cells where they count.
   */
  gateDeaths = new Int32Array(PLAYER_COUNT);
  townDeaths = new Int32Array(PLAYER_COUNT);
  nearGate: Uint8Array;
  nearCastle: Uint8Array;
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
  /**
   * The population cap and ceiling of every player, whatever is built or governed (the perf200
   * and perf360 scenarios, D-083); 0: by the rules. Set once by the scenario, never changes.
   */
  fixedPopulation = 0;
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
  /** The big city's tower's side on this map (GameMap.towerSize); every other building's is in BUILDINGS. */
  readonly towerSize: number;
  /** Winner once the game is over (-1 = draw), or -2 while running. */
  winner = -2;
  endReason = -1;

  constructor(map: GameMap) {
    this.map = map;
    this.towerSize = map.towerSize ?? BUILDINGS[BuildingType.TownTower].size;
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
    for (let i = 0; i < n * n; i++) {
      if (map.terrain[i] === Terrain.Wall) this.grid[i] = BLOCK_WALL;
      // Rock, water and cliffs (R6-51) all stop walking alike.
      else if (!walkableTerrain(map.terrain[i])) this.grid[i] = BLOCK_ROCK;
    }
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
      this.castles.push(castleOf(s.size, map));
    });
    this.gateAt = new Uint8Array(n * n);
    this.gateSides = new Int32Array(n * n);
    this.gateOwner = new Int32Array(n * n).fill(-1);
    this.gateLane = new Uint8Array(n * n);
    this.nearGate = new Uint8Array(n * n);
    this.nearCastle = new Uint8Array(n * n);
    const mark = (a: Uint8Array, x0: number, y0: number, x1: number, y1: number) => {
      for (let y = Math.max(0, y0); y <= Math.min(n - 1, y1); y++) for (let x = Math.max(0, x0); x <= Math.min(n - 1, x1); x++) a[y * n + x] = 1;
    };
    map.towns.forEach((s, i) => {
      const c = this.castles[i];
      for (const [dx, dy] of c.gate) {
        this.gateAt[(s.cellY + dy) * n + s.cellX + dx] = 1;
        mark(this.nearGate, s.cellX + dx - 3, s.cellY + dy - 3, s.cellX + dx + 3, s.cellY + dy + 3);
      }
      for (const [dx, dy] of [...c.gate, ...c.outside, ...c.behind]) this.gateLane[(s.cellY + dy) * n + s.cellX + dx] = 1;
      for (const g of c.gates) {
        const x0 = Math.min(...g.map((k) => k[0]));
        const y0 = Math.min(...g.map((k) => k[1]));
        const sx = Math.max(...g.map((k) => k[0])) - x0 + 1;
        const sy = Math.max(...g.map((k) => k[1])) - y0 + 1;
        this.gateSides[(s.cellY + y0) * n + s.cellX + x0] = sx | (sy << 8);
      }
      mark(this.nearCastle, s.cellX + c.inside.x0 - 4, s.cellY + c.inside.y0 - 4, s.cellX + c.inside.x1 + 4, s.cellY + c.inside.y1 + 4);
      const cells: number[] = [];
      for (let y = Math.max(0, s.cellY + c.inside.y0 - 1); y <= Math.min(n - 1, s.cellY + c.inside.y1 + 1); y++) {
        for (let x = Math.max(0, s.cellX + c.inside.x0 - 1); x <= Math.min(n - 1, s.cellX + c.inside.x1 + 1); x++) cells.push(y * n + x);
      }
      this.castleCells.push(Int32Array.from(cells));
    });
    const gc: number[] = [];
    map.towns.forEach((s, i) => {
      for (const g of this.castles[i].gates) for (const [dx, dy] of g) gc.push((s.cellY + dy) * n + s.cellX + dx);
    });
    this.gateCells = Int32Array.from(gc);
    this.insideAt = new Int32Array(n * n).fill(-1);
    map.towns.forEach((s, i) => {
      const c = this.castles[i].inside;
      for (let y = Math.max(0, s.cellY + c.y0); y <= Math.min(n - 1, s.cellY + c.y1); y++) {
        for (let x = Math.max(0, s.cellX + c.x0); x <= Math.min(n - 1, s.cellX + c.x1); x++) this.insideAt[y * n + x] = i;
      }
    });
    this.wallTown = new Int32Array(n * n).fill(-1);
    this.wallFoot = new Int32Array(n * n).fill(-1);
    this.wallAt = new Int32Array(n * n).fill(-1);
    map.towns.forEach((s, i) => {
      const cells: number[] = [];
      for (const [dx, dy] of this.castles[i].wall) {
        const x = s.cellX + dx;
        const y = s.cellY + dy;
        if (x < 0 || y < 0 || x >= n || y >= n) continue;
        // The cell inside to climb from: a side neighbour, else a corner one (E, S, W, N; then SE, SW, NW, NE).
        let foot = -1;
        for (const [ox, oy] of [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [-1, -1], [1, -1]]) {
          const fx = x + ox;
          const fy = y + oy;
          if (foot >= 0 || fx < 0 || fy < 0 || fx >= n || fy >= n) continue;
          if (this.insideAt[fy * n + fx] === i && (this.grid[fy * n + fx] & BLOCK_WALL) === 0) foot = fy * n + fx;
        }
        if (foot < 0) continue;
        this.wallTown[y * n + x] = i;
        this.wallFoot[y * n + x] = foot;
        cells.push(y * n + x);
      }
      this.wallCells.push(Int32Array.from(cells));
    });
    this.gateRebuild = new Int32Array(t * GATES);
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
    c.fireBack[s] = -1;
    c.wall[s] = -1;
    c.flank[s] = -1;
    c.flankSide[s] = 0;
    c.flankX[s] = -1;
    c.flankY[s] = -1;
    c.flankTick[s] = 0;
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
    c.provoker[s] = -1;
    if (owner < PLAYER_COUNT && this.autoTrain[owner] === 1 && AUTO_TRAIN.buildings.includes(type)) c.flags[s] = BuildingFlag.AutoTrain;
    this.setFootprint(id, type, cellX, cellY, true);
    if (progress >= 1000 && BUILDINGS[type].accepts.length > 0) this.dropVersion++;
    return id;
  }

  /** A building type's side in cells on this map: BUILDINGS, except the big city's tower (towerSize). */
  buildingSize(type: number): number {
    return type === BuildingType.TownTower ? this.towerSize : BUILDINGS[type].size;
  }

  /**
   * A footprint's width in cells (x): its type's size (buildingSize), but a gate's (D-096) is the
   * line of its opening's cells, found by its top-left cell. sideY: its height.
   */
  sideX(type: number, cellX: number, cellY: number): number {
    return type === BuildingType.Gate ? this.gateSides[cellY * this.size + cellX] & 0xff : this.buildingSize(type);
  }
  sideY(type: number, cellX: number, cellY: number): number {
    return type === BuildingType.Gate ? this.gateSides[cellY * this.size + cellX] >> 8 : this.buildingSize(type);
  }
  /** A building's full hp: its type's, but a gate's (D-096) by its town's size (GATE.hp). */
  maxHp(s: number): number {
    const b = this.buildings.col;
    return b.type[s] === BuildingType.Gate ? GATE.hp[this.townSize[b.town[s]]] : BUILDINGS[b.type[s]].hp;
  }

  /** Town t's opening k's top-left cell (D-096). */
  private gateCorner(t: number, k: number): [number, number] {
    const g = this.castles[t].gates[k];
    let x0 = g[0][0];
    let y0 = g[0][1];
    for (const [x, y] of g) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
    }
    return [this.townX[t] + x0, this.townY[t] + y0];
  }

  /** The gate building standing in town t's opening k (D-096), as a slot, or -1 (broken). */
  gateIn(t: number, k: number): number {
    const [x, y] = this.gateCorner(t, k);
    const s = this.building(this.buildingAt[y * this.size + x]);
    return s >= 0 && this.buildings.col.type[s] === BuildingType.Gate ? s : -1;
  }

  /** Builds town t's gate in opening k at full hp (D-096), owned as the town is. */
  addGate(t: number, k: number): void {
    const [x, y] = this.gateCorner(t, k);
    const id = this.addBuilding(NEUTRAL, BuildingType.Gate, x, y, GATE.hp[this.townSize[t]], 1000);
    this.buildings.col.town[this.building(id)] = t;
    this.gateRebuild[t * GATES + k] = 0;
    this.refreshGates(t);
  }

  /**
   * Sets town t's gates' owners and who walks their cells from the town's state (D-096): a
   * standing gate of a town held by p (awaiting the choice, plundering, repairing, governed) is
   * p's and open to p only; of a neutral town NEUTRAL's and closed to everyone; of ruins open to
   * all; a broken one (no gate) open to all. Bumps the path versions when anything changed.
   */
  refreshGates(t: number): void {
    const n = this.size;
    const st = this.townState[t];
    const held = st !== TownState.Neutral && st !== TownState.Ruins ? this.townOwner[t] : -1;
    let changed = false;
    this.castles[t].gates.forEach((g, k) => {
      const s = this.gateIn(t, k);
      if (s >= 0) this.buildings.col.owner[s] = held >= 0 ? held : NEUTRAL;
      const closed = s >= 0 && st !== TownState.Ruins;
      for (const [dx, dy] of g) {
        const c = (this.townY[t] + dy) * n + this.townX[t] + dx;
        const was = this.grid[c];
        const wasOwner = this.gateOwner[c];
        if (closed) this.grid[c] |= BLOCK_GATE;
        else this.grid[c] &= ~BLOCK_GATE;
        this.gateOwner[c] = closed ? held : -1;
        if (this.grid[c] !== was || this.gateOwner[c] !== wasOwner) changed = true;
      }
    });
    if (!changed) return;
    this.ownGates.fill(0);
    for (const c of this.gateCells) if ((this.grid[c] & BLOCK_GATE) !== 0 && this.gateOwner[c] >= 0) this.ownGates[this.gateOwner[c]]++;
    this.blockVersion++;
    this.openVersion++;
  }

  /**
   * Which walkable grid unit owner `owner` walks (D-096): 0 (World.grid, every standing gate closed
   * to someone closed) unless some gate opens to it alone, then owner + 1 (passGrid).
   */
  passClass(owner: number): number {
    return owner >= 0 && owner < PLAYER_COUNT && this.ownGates[owner] > 0 ? owner + 1 : 0;
  }

  /** The grid of pass class cls (passClass): World.grid, or a copy with that player's own gates open. */
  passGrid(cls: number): Uint8Array {
    if (cls === 0) return this.grid;
    let g = this.passGrids[cls];
    if (g === undefined || g.length !== this.grid.length) {
      g = new Uint8Array(this.grid.length);
      this.passGrids[cls] = g;
      this.passBlock[cls] = -1;
    }
    if (this.passBlock[cls] !== this.blockVersion || this.passOpen[cls] !== this.openVersion) {
      g.set(this.grid);
      const p = cls - 1;
      for (const c of this.gateCells) if (this.gateOwner[c] === p) g[c] &= ~BLOCK_GATE;
      this.passBlock[cls] = this.blockVersion;
      this.passOpen[cls] = this.openVersion;
    }
    return g;
  }

  /** Does player p hold town t (D-096: its walls and gates are p's): awaiting the choice, plundering, repairing or governed? */
  heldBy(t: number, p: number): boolean {
    const st = this.townState[t];
    return this.townOwner[t] === p && st !== TownState.Neutral && st !== TownState.Ruins;
  }

  /**
   * Unit slot i comes off the wall it stands on or was going up onto (D-096): down to the cell
   * inside it climbs from, standing there with no order (the next order is the caller's).
   */
  offWall(i: number): void {
    const u = this.units.col;
    const c = u.wall[i];
    if (c < 0) return;
    const n = this.size;
    if (this.wallAt[c] === u.id[i]) this.wallAt[c] = -1;
    // Up on it (standing, shooting or calibrating the cannon): down to the cell inside.
    if ((u.y[i] >> CELL_SHIFT) * n + (u.x[i] >> CELL_SHIFT) === c) {
      const f = this.wallFoot[c];
      u.x[i] = ((f % n) << CELL_SHIFT) + (CELL >> 1);
      u.y[i] = (Math.trunc(f / n) << CELL_SHIFT) + (CELL >> 1);
      u.action[i] = Action.Idle;
    }
    u.wall[i] = -1;
    if (u.order[i] === Order.Wall) {
      u.order[i] = Order.None;
      u.orderTarget[i] = -1;
    }
    u.target[i] = -1;
    u.anchorX[i] = u.x[i];
    u.anchorY[i] = u.y[i];
  }

  /** Building slot s's footprint width and height in cells (sideX, sideY). */
  wide(s: number): number {
    const b = this.buildings.col;
    return this.sideX(b.type[s], b.cellX[s], b.cellY[s]);
  }
  tall(s: number): number {
    const b = this.buildings.col;
    return this.sideY(b.type[s], b.cellX[s], b.cellY[s]);
  }

  /**
   * Marks or clears a building's footprint: buildingAt always, the grid's BLOCK_BUILDING
   * bit unless the building is walkable (farms).
   */
  setFootprint(id: number, type: BuildingType, cellX: number, cellY: number, on: boolean): void {
    const info = BUILDINGS[type];
    const sx = this.sideX(type, cellX, cellY);
    const sy = this.sideY(type, cellX, cellY);
    const n = this.size;
    // A gate's cells are walked as refreshGates says (D-096).
    const gate = type === BuildingType.Gate;
    for (let y = cellY; y < cellY + sy; y++) {
      for (let x = cellX; x < cellX + sx; x++) {
        this.buildingAt[y * n + x] = on ? id : -1;
        if (info.walkable || gate) continue;
        if (on) this.grid[y * n + x] |= BLOCK_BUILDING;
        else this.grid[y * n + x] &= ~BLOCK_BUILDING;
      }
    }
    if (info.walkable || gate) return;
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

  /**
   * Population ceiling: MAX_POPULATION; with POPULATION_200 (D-083), its base plus its town[size]
   * for each town p governs.
   */
  populationCeiling(p: number): number {
    if (this.fixedPopulation > 0) return this.fixedPopulation;
    if (!POPULATION_200.on) return MAX_POPULATION;
    let ceiling = POPULATION_200.base;
    for (let t = 0; t < this.townSize.length; t++) {
      if (this.townOwner[t] === p && this.townState[t] === TownState.Governed) ceiling += POPULATION_200.town[this.townSize[t]];
    }
    return ceiling;
  }

  /** Population cap: finished buildings and governed towns, at most populationCeiling. */
  populationCap(p: number): number {
    if (this.fixedPopulation > 0) return this.fixedPopulation;
    const b = this.buildings.col;
    let cap = 0;
    for (let s = 0; s < this.buildings.count; s++) {
      if (b.owner[s] === p && b.progress[s] >= 1000) cap += BUILDINGS[b.type[s]].populationCap;
    }
    for (let t = 0; t < this.townSize.length; t++) {
      if (this.townOwner[t] === p && this.townState[t] === TownState.Governed) cap += TOWNS[this.townSize[t]].populationCap;
    }
    return Math.min(cap, this.populationCeiling(p));
  }

  /** Is cell (cellX, cellY) inside town t's walls (D-089: the town is what lies inside them)? */
  inTown(t: number, cellX: number, cellY: number): boolean {
    const c = this.castles[t].inside;
    const dx = cellX - this.townX[t];
    const dy = cellY - this.townY[t];
    return dx >= c.x0 && dx <= c.x1 && dy >= c.y0 && dy <= c.y1;
  }

  /** Is cell (cellX, cellY) within `reach` cells (Chebyshev) of what lies inside town t's walls? */
  nearTown(t: number, cellX: number, cellY: number, reach: number): boolean {
    const c = this.castles[t].inside;
    const dx = cellX - this.townX[t];
    const dy = cellY - this.townY[t];
    return dx >= c.x0 - reach && dx <= c.x1 + reach && dy >= c.y0 - reach && dy <= c.y1 + reach;
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

