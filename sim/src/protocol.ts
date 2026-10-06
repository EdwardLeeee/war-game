// The contract between the simulation (sim/, war-game-core) and the screen (client/,
// war-game-client). PROTOCOL.md explains every item in prose; this file is what the
// client imports, so a mismatch fails to compile.
//
// Rules for changing it: bump PROTOCOL_VERSION for any change the client must follow,
// tell war-game-ceo, who tells war-game-client. Fields marked "from PR-n" are defined
// now and hold 0 / -1 until that PR fills them; filling them is not a format change.
//
// Only erasable TypeScript (no enum / namespace / parameter properties): Node runs the
// sim's sources directly with type stripping, as the engine spike did.

export const PROTOCOL_VERSION = 1;

// --- time and space -----------------------------------------------------------------

export const TICKS_PER_SECOND = 20;
/** Fixed-point units per map cell. Positions in snapshots are in these units. */
export const CELL = 1024;
export const CELL_SHIFT = 10;
/** Facing: 16 directions, k * 22.5 degrees, 0 = +x (east), clockwise because y points down. */
export const DIRECTIONS = 16;
/** A state hash is published every HASH_EVERY ticks (and at tick 0). */
export const HASH_EVERY = 100;
/** Fog of war is recomputed, and sent, every FOG_EVERY ticks. */
export const FOG_EVERY = 5;
/**
 * The time limit of AI-vs-AI games, determinism checks and headless runs (30 minutes): a game
 * that reaches its limit without a winner is a draw. A game's limit is set when it starts
 * (`maxTicks` in `init` and in the log header); 0 means none, the default when a person plays.
 */
export const MAX_TICKS = 36000;
/** Snapshot header carries the summed step time of the last STEP_BATCH ticks. */
export const STEP_BATCH = 20;

// --- players ------------------------------------------------------------------------

/** Players 0 and 1; NEUTRAL owns town militia and town towers. */
export const PLAYER_COUNT = 2;
export const NEUTRAL = 2;
/** Owner value for "nobody" (e.g. a neutral town with no militia left). */
export const NO_OWNER = -1;

/**
 * How the simple AI plays. "normal" is the AI of the first play test; "easy" only holds itself
 * back (fewer farmers and buildings, later and smaller attacks) and gets nothing extra (GDD 13);
 * "hard" decides better and gets nothing extra either (D-052, D-055).
 */
export const AI_DIFFICULTIES = ["easy", "normal", "hard"] as const;
export type AiDifficulty = (typeof AI_DIFFICULTIES)[number];

// --- enumerations (const objects; the type is the union of the values) ---------------

export const UnitType = {
  Farmer: 0,
  Spearman: 1,
  Ranged: 2,
  Mage: 3,
  /** Neutral town guard; never trained by players. */
  Militia: 4,
  /** Heavy cavalry, trained at a stable (round 7, D-061; while `Rules.features.cavalry`). */
  Cavalry: 5,
} as const;
export type UnitType = (typeof UnitType)[keyof typeof UnitType];

export const BuildingType = {
  MainCity: 0,
  House: 1,
  LumberCamp: 2,
  Mine: 3,
  Granary: 4,
  Farm: 5,
  Barracks: 6,
  Range: 7,
  MageHall: 8,
  /** The big city's neutral arrow tower; never built by players. */
  TownTower: 9,
  /**
   * A player's arrow tower (round 7, D-061; while `Rules.features.towers`): shoots by itself,
   * ranged units and mages can hide in it and shoot from inside. Not the big city's TownTower.
   */
  ArrowTower: 10,
  /** Trains cavalry (round 7, D-061; while `Rules.features.cavalry`). */
  Stable: 11,
} as const;
export type BuildingType = (typeof BuildingType)[keyof typeof BuildingType];

export const Resource = { Food: 0, Wood: 1, Gold: 2, Crystal: 3 } as const;
export type Resource = (typeof Resource)[keyof typeof Resource];

export const NodeKind = {
  /** One tree per cell; blocks movement until chopped out. */
  Tree: 0,
  GoldMine: 1,
  Berries: 2,
  /** Crystal vein: farmers go only when sent by hand (never by the economy ratio). */
  CrystalVein: 3,
} as const;
export type NodeKind = (typeof NodeKind)[keyof typeof NodeKind];

export const Terrain = { Open: 0, Blocked: 1 } as const;
export type Terrain = (typeof Terrain)[keyof typeof Terrain];

export const TownSize = { Small: 0, Large: 1 } as const;
export type TownSize = (typeof TownSize)[keyof typeof TownSize];

export const TownState = {
  /** Held by militia (or empty after they fell, until someone captures it). */
  Neutral: 0,
  /** Captured; the owner has not chosen plunder or govern yet. */
  AwaitingChoice: 1,
  Plundering: 2,
  /** Governing chosen, being repaired; produces nothing yet. */
  Repairing: 3,
  Governed: 4,
  /** After a plunder; turns neutral again (half militia) when the timer ends. */
  Ruins: 5,
} as const;
export type TownState = (typeof TownState)[keyof typeof TownState];

export const TownChoice = { Plunder: 0, Govern: 1 } as const;
export type TownChoice = (typeof TownChoice)[keyof typeof TownChoice];

export const Stance = { Aggressive: 0, Hold: 1 } as const;
export type Stance = (typeof Stance)[keyof typeof Stance];

/** What a unit is doing, for animation. */
export const Action = {
  Idle: 0,
  Move: 1,
  Attack: 2,
  Gather: 3,
  Build: 4,
  Repair: 5,
  /** Mage standing still while the crystal cannon calibrates. */
  Calibrate: 6,
  /** Hidden inside a building (recall); not drawn. */
  Garrisoned: 7,
} as const;
export type Action = (typeof Action)[keyof typeof Action];

/** The order a unit is carrying out. */
export const Order = {
  None: 0,
  /** Attack-move: go there, fight what is met on the way. */
  Move: 1,
  /** Go there, ignore enemies. */
  Retreat: 2,
  Attack: 3,
  Gather: 4,
  Build: 5,
  Repair: 6,
  Recall: 7,
  Cast: 8,
  /**
   * A soldier going to hide in a building, or hiding in it (action Garrisoned); orderTarget is
   * the building's id (round 7, D-061, `garrison`). Farmers hiding keep Recall.
   */
  Garrison: 9,
} as const;
export type Order = (typeof Order)[keyof typeof Order];

export const GameState = { Running: 0, Won: 1, Lost: 2, Draw: 3 } as const;
export type GameState = (typeof GameState)[keyof typeof GameState];

export const GameOverReason = {
  MainCityDestroyed: 0,
  Surrender: 1,
  /** The game's time limit (maxTicks) reached. */
  TimeLimit: 2,
} as const;
export type GameOverReason = (typeof GameOverReason)[keyof typeof GameOverReason];

export const Fog = { Unexplored: 0, Explored: 1, Visible: 2 } as const;
export type Fog = (typeof Fog)[keyof typeof Fog];

export const Reject = {
  NotOwner: 1,
  InvalidTarget: 2,
  CannotAfford: 3,
  PopulationCap: 4,
  MageCap: 5,
  NoCrystal: 6,
  Cooldown: 7,
  BadPlacement: 8,
  QueueFull: 9,
  /** This building does not train that unit, or the unit cannot do that. */
  NotAvailable: 10,
  TownNotYours: 11,
  TownChoiceMade: 12,
  GameOver: 13,
  OutOfRange: 14,
  /** A `build` without farmers: no farmer the simulation may send (round 2 of the prototype). */
  NoFarmer: 15,
  /** `town_choice` plunder on a town already plundered this game (round 7, D-061). */
  AlreadyPlundered: 16,
  /** `garrison` into a building with no room left, counting the soldiers on their way (round 7). */
  NoRoom: 17,
} as const;
export type Reject = (typeof Reject)[keyof typeof Reject];

// --- snapshot tables: Int32Array rows of a fixed stride --------------------------------

/** Units the player can see (own: all). Positions are fixed point. */
export const UnitField = {
  id: 0,
  owner: 1,
  type: 2,
  x: 3,
  y: 4,
  hp: 5,
  /** Mage shield points left (from PR-4); 0 for other units. */
  shield: 6,
  action: 7,
  facing: 8,
  /** Resource being carried, or -1 (from PR-3). */
  carryKind: 9,
  carryAmount: 10,
  order: 11,
  /** Unit or building id, node id, or -1; for Move/Retreat the target cell index (y * size + x). */
  orderTarget: 12,
  stance: 13,
  /** Ticks calibrated so far while casting (from PR-4); 0 otherwise. */
  castProgress: 14,
  /** Bit flags, see UnitFlag. */
  flags: 15,
  /** Mage: ticks until the crystal cannon can fire again (from PR-4); 0 otherwise. */
  castCooldown: 16,
  reserved17: 17,
  reserved18: 18,
  reserved19: 19,
} as const;
export const UNIT_STRIDE = 20;
export const UnitFlag = {
  /** Mage autocast on (from PR-4); a trained mage starts with it on (round 3, D-026). */
  Autocast: 1,
  /** Farmer with nothing to do (from PR-3). */
  IdleFarmer: 2,
  /** Took damage in the last 60 ticks. */
  UnderAttack: 4,
  /**
   * Loose formation (round 3 of the prototype, D-027): set by the `formation` command, which
   * also re-forms the units named in it (PROTOCOL.md 3). A group forms up two cells apart
   * instead of one when more than half of it has this flag, so one crystal cannon shot hits
   * fewer of them.
   */
  Loose: 8,
  /**
   * Farmer sent to a resource by hand with the `gather` command (operations round, D-050): the
   * economy ratio does not move it. Cleared by any other command to it, and when it has nothing
   * left to gather there (it goes idle).
   */
  HandPicked: 16,
} as const;

/** Buildings: own, visible enemy/neutral ones, and remembered enemy ones (flag Remembered). */
export const BuildingField = {
  id: 0,
  owner: 1,
  type: 2,
  /** Top-left cell of the footprint. */
  cellX: 3,
  cellY: 4,
  hp: 5,
  /** Construction progress in permille; 1000 = finished. */
  progress: 6,
  /** Training queue length (own buildings, from PR-3). */
  queueLength: 7,
  /** Up to 7 queued unit types, 4 bits each, head in the lowest bits (own, from PR-3). */
  queuePacked: 8,
  /** Head of the queue, permille done (own, from PR-3). */
  queueProgress: 9,
  /** Rally point in fixed point, or -1 (own, from PR-3). */
  rallyX: 10,
  rallyY: 11,
  /** Farmers hidden inside (recall, from PR-3). Own buildings only; 0 for others. */
  garrisoned: 12,
  /** Bit flags, see BuildingFlag. */
  flags: 13,
  /**
   * Soldiers hidden inside (round 7, D-061, `garrison`). Own buildings only; for other
   * players' buildings 0, and only BuildingFlag.Occupied says someone is in.
   */
  soldiers: 14,
  reserved15: 15,
} as const;
export const BUILDING_STRIDE = 16;
export const BuildingFlag = {
  /** Not visible now: this row is the player's memory of the last sighting (hp as last seen). */
  Remembered: 1,
  UnderAttack: 2,
  /** Own main city, damaged and hit in the last 10 s: repairs wait until the lock ends (repair is still accepted). */
  RepairLocked: 4,
  /** Own barracks, range or mage hall training on its own (`auto_train`, round 6, D-054). */
  AutoTrain: 8,
  /** Own, with AutoTrain: its queue is empty and nothing is queued because the population is full. */
  AutoPopulationFull: 16,
  /**
   * Someone (farmers or soldiers) hides inside (round 7, D-061). Set on every building in
   * view, own or not; never on a remembered one. How many and who: own buildings only.
   */
  Occupied: 32,
} as const;

/** Resource nodes: sent as changes only (see Snapshot.nodes). */
export const NodeField = {
  id: 0,
  kind: 1,
  cellX: 2,
  cellY: 3,
  /** Amount left; as last seen when not visible. 0 = depleted (a tree cell becomes open). */
  amount: 4,
  /** 1 while the node's cell is visible, else 0. */
  visible: 5,
} as const;
export const NODE_STRIDE = 6;

/** Towns the player has explored, as last seen. */
export const TownField = {
  id: 0,
  state: 1,
  /** Current holder (player), NEUTRAL, or NO_OWNER. */
  owner: 2,
  /** Ticks left on the state's timer (plunder, repair, ruins), else 0. Paused timers keep their value. */
  timer: 3,
  /** Full length of that timer, for a progress bar (0 when there is none). */
  timerTotal: 4,
  /** Holder's military units inside the town radius (farmers do not count). */
  garrison: 5,
  /** Minimum garrison while repairing or governed (small 1, large 3). */
  garrisonNeeded: 6,
  militia: 7,
  /** Ticks left before a repairing or governed town revolts for lack of garrison; 0 = not counting. */
  revoltTimer: 8,
  /** Bit flags, see TownFlag. */
  flags: 9,
  /**
   * What governing it pays now, in permille of its full income (round 7, D-061): 1000 for a
   * town never plundered; a plundered one starts at `Rules.plunderRecovery.startPermille` and
   * climbs back while it is governed.
   */
  incomePermille: 10,
} as const;
/** 11 from round 7 (D-061; was 10). */
export const TOWN_STRIDE = 11;
export const TownFlag = {
  /** Both sides have military units inside the radius; state is frozen. */
  Contested: 1,
  Visible: 2,
  /** Governed or repairing without the minimum garrison. */
  BelowGarrison: 4,
  /**
   * Plundered once this game (round 7, D-061). With `Rules.features.plunderOnce` it cannot be
   * plundered again: `town_choice` plunder is rejected with AlreadyPlundered.
   */
  Plundered: 8,
} as const;

/** Crystal cannon warning areas on visible cells (from PR-4). Everyone who sees it gets it. */
export const WarningField = {
  id: 0,
  owner: 1,
  x: 2,
  y: 3,
  /** Fixed point. */
  radius: 4,
  ticksLeft: 5,
} as const;
export const WARNING_STRIDE = 6;

/** Snapshot header, one Int32Array. */
export const HeaderField = {
  tick: 0,
  paused: 1,
  /** Ticks per wall-clock second x 100 (e.g. 2000 = normal). */
  speed: 2,
  gameState: 3,
  food: 4,
  wood: 5,
  gold: 6,
  crystal: 7,
  population: 8,
  populationCap: 9,
  mages: 10,
  mageCap: 11,
  /** Economy ratio in percent (sums to 100) and on/off (from PR-3). */
  ratioFood: 12,
  ratioWood: 13,
  ratioGold: 14,
  ratioOn: 15,
  /** Recall (全體回城) on/off (from PR-3). */
  recall: 16,
  /** Microseconds the last tick took, and the sum over the last STEP_BATCH ticks. */
  stepMicros: 17,
  stepBatchMicros: 18,
  /** Tick of the last fog update carried in Snapshot.fog. */
  fogTick: 19,
  /** Scenario the game runs (Scenario value). */
  scenario: 20,
  /** What automatic training leaves untouched (`reserve`, round 6, D-054). */
  reserveFood: 21,
  reserveWood: 22,
  reserveGold: 23,
  reserveCrystal: 24,
} as const;
export const HEADER_LENGTH = 25;

/**
 * Fixed starting situations, generated entirely by the simulation from the seed.
 * - standard: the prototype game, 1 v 1 from the two spawns (units from PR-2, economy PR-3,
 *   mages and towns PR-4).
 * - e2e: both sides start with plenty of resources and a small army beside the small town,
 *   so a browser test can build, train, capture a town and choose within minutes
 *   (building and training from PR-3, the town part from PR-4).
 * - perf: both sides near the population cap, mages on autocast, fog on, fighting near a
 *   town: every system running, for the iPhone measurement (from PR-4).
 */
export const Scenario = { Standard: 0, E2e: 1, Perf: 2 } as const;
export type Scenario = (typeof Scenario)[keyof typeof Scenario];
export type ScenarioName = "standard" | "e2e" | "perf";

// --- building placement ---------------------------------------------------------------

/**
 * Per-cell placement bits, size * size bytes, sent with every fog update (Snapshot.placement).
 * sim/src/placement.ts checks a footprint against it; the simulation validates `build`
 * commands with the same function on its own full-knowledge grid, so the screen's green /
 * red preview and the final ruling come from one piece of code.
 */
export const PlaceBit = {
  /** Rock, a tree, or a known building (farms included). */
  Blocked: 1,
  /** Not yet explored: you cannot build there. */
  Unexplored: 2,
  /** Within reach of your own main city or granary: farms may go here. */
  FarmLand: 4,
  /**
   * Within reach of your own main city or of a town you govern or repair (`Rules.towerReach`):
   * arrow towers may go here (round 7, D-061; only while `Rules.features.towers`).
   */
  TowerLand: 8,
} as const;

// --- static data sent once, in "ready" -----------------------------------------------

export interface Cost {
  food: number;
  wood: number;
  gold: number;
  crystal: number;
}

export interface UnitInfo {
  type: UnitType;
  hp: number;
  /** Mage shield capacity; 0 for others. */
  shield: number;
  /** Damage per hit (mage: crystal bolt). */
  attack: number;
  /** Fixed point, centre to centre. */
  range: number;
  /** Fixed point per tick. */
  speed: number;
  /** Cells. */
  sight: number;
  /** Ticks between attacks. */
  cooldown: number;
  cost: Cost;
  /** Ticks to train. */
  trainTicks: number;
  population: number;
}

export interface BuildingInfo {
  type: BuildingType;
  hp: number;
  /** Footprint side in cells (square). */
  size: number;
  /** Units can walk over it (farms). */
  walkable: boolean;
  cost: Cost;
  /** Ticks for one builder. */
  buildTicks: number;
  /** Cells. */
  sight: number;
  populationCap: number;
  /** Resources it accepts as a drop-off point. */
  accepts: Resource[];
  trains: UnitType[];
  /** Farmers it can hide during recall. */
  shelter: number;
  /**
   * Soldiers (`Rules.garrisonTypes`) that can hide in it with `garrison` (round 7, D-061).
   * The simulation always fills it; optional only so tables written by hand (mocks) still compile.
   */
  holds?: number;
  /** Own finished buildings of these types needed before it can be built (round 7; always filled, as `holds`). */
  requires?: BuildingType[];
}

export interface Multiplier {
  attacker: UnitType;
  /** A unit type, or "shield" for damage that hits a mage's shield. */
  target: UnitType | "shield";
  /** Damage x num / den, integer arithmetic. */
  num: number;
  den: number;
}

/** Arrows a building shoots by itself (main city, the big city's tower, arrow towers). */
export interface ArrowInfo {
  damage: number;
  /** Fixed point, from the building's footprint. */
  range: number;
  /** Ticks between arrows. */
  cooldown: number;
  /** Extra arrows per farmer hiding inside, up to this many (main city only; 0 for others). */
  extraMax: number;
}

/** A town's rules by size (TownSize), as the simulation plays them. */
export interface TownInfo {
  militia: number;
  /** Cells. */
  radius: number;
  plunderTicks: number;
  plunder: Cost;
  ruinsTicks: number;
  governCost: Cost;
  repairTicks: number;
  /** Full income per minute while governed with the minimum garrison. */
  perMinute: Cost;
  populationCap: number;
  garrisonNeeded: number;
  revoltTicks: number;
}

/**
 * Round 7 rules that may be switched off (D-061). The screen and the AI leave out what is off;
 * the simulation rejects it.
 */
export interface Features {
  /** A town can be plundered once per game. */
  plunderOnce: boolean;
  /** Arrow towers can be built. */
  towers: boolean;
  /** Ranged units and mages can hide in main cities and arrow towers. */
  garrison: boolean;
  /** Stables can be built and cavalry trained. */
  cavalry: boolean;
}

export interface MapInfo {
  seed: number;
  /** Side in cells. */
  size: number;
  /** size * size cells, row by row: Terrain values. Trees are nodes, not terrain. */
  terrain: Uint8Array;
  spawns: { player: number; cellX: number; cellY: number }[];
  towns: { id: number; size: TownSize; cellX: number; cellY: number; radius: number }[];
}

export interface Rules {
  units: UnitInfo[];
  buildings: BuildingInfo[];
  multipliers: Multiplier[];
  mageCap: number;
  maxPopulation: number;
  queueMax: number;
  // Round 7 (D-061). The simulation always sends all of these; they are optional only so rules
  // written by hand (the screen's mocks) still compile. Read them with a default (absent = off).
  features?: Features;
  /** Arrows of the main city, the big city's tower and arrow towers (round 7). */
  arrows?: { mainCity: ArrowInfo; townTower: ArrowInfo; arrowTower: ArrowInfo };
  /** Unit types that may hide in buildings with `garrison` (round 7). */
  garrisonTypes?: UnitType[];
  /** A mage hiding in a building fires the cannon at `permille` of its damage, its cooldown `cooldownTimes` as long (round 7). */
  garrisonCannon?: { permille: number; cooldownTimes: number };
  /**
   * Where arrow towers may go (round 7, PlaceBit.TowerLand), in cells: within `mainCity` of an
   * own finished main city's footprint (Chebyshev), or within a held town's radius + `town`
   * of its centre (governed or repairing).
   */
  towerReach?: { mainCity: number; town: number };
  /** By TownSize (round 7). */
  towns?: TownInfo[];
  /**
   * A plundered town governed again pays `startPermille` of its income at first and climbs
   * linearly to 1000 over `ticks` of being governed (round 7; startPermille 1000 = off).
   */
  plunderRecovery?: { startPermille: number; ticks: number };
}

// --- commands (one JSON object per line in the command log) ---------------------------

interface CommandBase {
  /** Tick it runs on; stamped by the worker (the next tick not yet run). */
  t: number;
  /** Issuing player; stamped by the worker. */
  p: number;
  /** Client sequence number, echoed in CommandRejected. */
  seq: number;
}

export type CommandBody =
  | { c: "move"; u: number[]; x: number; y: number }
  | { c: "retreat"; u: number[]; x: number; y: number }
  | { c: "attack"; u: number[]; target: number }
  | { c: "stop"; u: number[] }
  | { c: "stance"; u: number[]; stance: Stance }
  /** Loose (true) or close (false) formation for these units: sets or clears UnitFlag.Loose and re-forms them (PROTOCOL.md 3). */
  | { c: "formation"; u: number[]; loose: boolean }
  | { c: "gather"; u: number[]; node: number }
  /** `u` may be empty: the simulation then sends the nearest free farmers (PROTOCOL.md 3.1). */
  | { c: "build"; u: number[]; type: BuildingType; x: number; y: number }
  | { c: "repair"; u: number[]; building: number }
  | { c: "train"; building: number; type: UnitType; n: number }
  | { c: "cancel_train"; building: number; index: number }
  /** Automatic training of an own barracks, range or mage hall on or off (round 6, D-054, PROTOCOL.md 3). */
  | { c: "auto_train"; building: number; on: boolean }
  /** What automatic training leaves untouched, per resource (round 6, D-054). */
  | { c: "reserve"; food: number; wood: number; gold: number; crystal: number }
  | { c: "rally"; building: number; x: number; y: number }
  | { c: "eco_ratio"; food: number; wood: number; gold: number; on: boolean }
  | { c: "recall"; on: boolean }
  | { c: "cast"; u: number; fx: number; fy: number }
  | { c: "autocast"; u: number[]; on: boolean }
  | { c: "town_choice"; town: number; choice: TownChoice }
  /** Ranged units and mages go and hide in an own finished main city or arrow tower (round 7). */
  | { c: "garrison"; u: number[]; building: number }
  /** Soldiers hiding in the building come out: all of them, or those in `u` (round 7). */
  | { c: "leave"; building: number; u?: number[] }
  | { c: "surrender" };

export type Command = CommandBase & CommandBody;
export type CommandKind = CommandBody["c"];

/** Every command kind, at run time (the type check below keeps it complete). */
export const COMMAND_KINDS = [
  "move",
  "retreat",
  "attack",
  "stop",
  "stance",
  "formation",
  "gather",
  "build",
  "repair",
  "train",
  "cancel_train",
  "auto_train",
  "reserve",
  "rally",
  "eco_ratio",
  "recall",
  "cast",
  "autocast",
  "town_choice",
  "garrison",
  "leave",
  "surrender",
] as const satisfies readonly CommandKind[];
type MissingCommand = Exclude<CommandKind, (typeof COMMAND_KINDS)[number]>;
export const COMMAND_KINDS_COMPLETE: [MissingCommand] extends [never] ? true : MissingCommand = true;

// --- events ---------------------------------------------------------------------------

export type SimEvent =
  /** At most one per 8 x 8-cell block per 60 ticks. */
  | { k: "attacked"; x: number; y: number; target: number }
  | { k: "unit_trained"; id: number; type: UnitType; building: number }
  | { k: "building_done"; id: number; type: BuildingType }
  | { k: "node_depleted"; id: number }
  /** by = new holder; if it is you, choose with town_choice. */
  | { k: "town_captured"; town: number; by: number }
  | { k: "town_plundered"; town: number; by: number; food: number; gold: number; crystal: number }
  | { k: "town_repaired"; town: number; by: number }
  | { k: "town_revolted"; town: number; from: number }
  | { k: "town_restored"; town: number }
  | { k: "mage_killed"; id: number; owner: number; killer: number; crystal: number }
  /**
   * A building's own arrow, or a soldier hiding in it, shot at `target` (unit id) this tick
   * (round 7, D-061). To every player who sees the building or the target.
   */
  | { k: "shot"; building: number; target: number }
  | { k: "rejected"; seq: number; reason: Reject }
  | { k: "game_over"; winner: number; reason: GameOverReason };
export type EventKind = SimEvent["k"];

/** Every event kind, at run time (the type check below keeps it complete). */
export const EVENT_KINDS = [
  "attacked",
  "unit_trained",
  "building_done",
  "node_depleted",
  "town_captured",
  "town_plundered",
  "town_repaired",
  "town_revolted",
  "town_restored",
  "mage_killed",
  "shot",
  "rejected",
  "game_over",
] as const satisfies readonly EventKind[];
type MissingEvent = Exclude<EventKind, (typeof EVENT_KINDS)[number]>;
export const EVENT_KINDS_COMPLETE: [MissingEvent] extends [never] ? true : MissingEvent = true;

// --- worker messages ------------------------------------------------------------------

export type ToWorker =
  | {
      type: "init";
      protocol: number;
      seed: number;
      /** The player the screen plays, or null to watch AI against AI (sees everything). */
      human: number | null;
      /** Which players the simple AI plays. */
      ai: boolean[];
      /** Ticks per second (normal = 30 from round 2 of the prototype). */
      tps: number;
      scenario: ScenarioName;
      /** Time limit in ticks, 0 = none. Absent: 0 when a person plays, MAX_TICKS for AI against AI. */
      maxTicks?: number;
      /** Per player (aligned with `ai`), how its simple AI plays. Absent: all "normal". */
      difficulty?: AiDifficulty[];
    }
  /** The worker stamps t (next tick not yet run) and p (the human player). */
  | { type: "command"; cmd: CommandBody & { seq: number } }
  | { type: "pause" }
  | { type: "resume" }
  /** Ticks per wall-clock second: 20 slow, 30 normal, 40 fast (D-024; tests may go higher). Never changes the game. */
  | { type: "speed"; tps: number }
  /** Run a whole AI-vs-AI game as fast as possible and report hashes. Use a separate Worker. */
  | { type: "determinism"; protocol: number; seed: number; scenario: ScenarioName; maxTicks: number }
  | { type: "export_log" };

export interface Snapshot {
  type: "snapshot";
  header: Int32Array;
  units: Int32Array;
  buildings: Int32Array;
  towns: Int32Array;
  warnings: Int32Array;
  /** Rows that changed since the previous snapshot (new, amount changed, visibility changed). */
  nodes: Int32Array;
  /** size * size Fog values; present only in snapshots that carry a fog update. */
  fog: Uint8Array | null;
  /** size * size PlaceBit values for this player, sent together with fog. */
  placement: Uint8Array | null;
  /** Own idle farmers, in id order (from PR-3). */
  idleFarmers: Int32Array;
  events: SimEvent[];
}

export interface GameStats {
  ticks: number;
  winner: number;
  reason: GameOverReason;
  perPlayer: {
    gathered: Cost;
    unitsTrained: number[];
    unitsLost: number[];
    magesTrained: number;
    magesLost: number;
    townsPlundered: number;
    townsGoverned: number;
  }[];
}

export type FromWorker =
  | { type: "ready"; protocol: number; player: number | null; map: MapInfo; rules: Rules }
  | Snapshot
  | { type: "hash"; tick: number; hash: string }
  | { type: "game_over"; winner: number; reason: GameOverReason; stats: GameStats }
  | { type: "determinism_progress"; tick: number; hash: string }
  | { type: "determinism_done"; ticks: number; finalHash: string; totalMs: number; tickMedianMs: number; tickMaxMs: number }
  /** Replay log: config line, then one command per line. */
  | { type: "log"; jsonl: string }
  | { type: "error"; message: string };

/** First line of an exported log. */
export interface LogHeader {
  protocol: number;
  seed: number;
  scenario: ScenarioName;
  ai: boolean[];
  /** Time limit in ticks, 0 = none. Absent (logs from before round 2): MAX_TICKS. */
  maxTicks?: number;
  /** Per player, how its AI played (informational: a replay runs without AIs). Absent: "normal". */
  difficulty?: AiDifficulty[];
  /** Per player, whether its barracks, ranges and mage halls start with automatic training on (round 6). Absent: all off. */
  autoTrain?: boolean[];
}

/**
 * What `node sim/src/headless.ts --expected <file>` writes (from PR-2): the hashes an
 * AI-vs-AI game must produce, for the phone-side determinism check to compare against.
 */
export interface ExpectedHashes {
  protocol: number;
  seed: number;
  scenario: ScenarioName;
  maxTicks: number;
  /** Tick (as a string key, every HASH_EVERY) -> 8-digit hex hash. */
  hashes: Record<string, string>;
  final: { tick: number; hash: string; winner: number };
}
