// Rule values. Source: docs/design/gdd.md Appendix A, plus the prototype values
// war-game-ceo approved on 2026-09-30 (D1-D3, "補缺" — values the GDD does not give).
// Seconds become ticks (x 20), cells/s become fixed point per tick (x 1024 / 20, truncated).
// sim/README.md lists every value added here that is not in the GDD.

import {
  type ArrowInfo,
  BuildingType,
  CELL,
  type BuildingInfo,
  type Cost,
  type Multiplier,
  Resource,
  type Rules,
  TICKS_PER_SECOND,
  type TownInfo,
  TownSize,
  type UnitInfo,
  UnitType,
} from "../protocol.ts";

const S = TICKS_PER_SECOND;
const speed = (cellsPerSecond100: number) => Math.trunc((cellsPerSecond100 * CELL) / (100 * S));
const cost = (food = 0, wood = 0, gold = 0, crystal = 0): Cost => ({ food, wood, gold, crystal });

export const UNITS: UnitInfo[] = [];
UNITS[UnitType.Farmer] = {
  type: UnitType.Farmer, hp: 25, shield: 0, attack: 3, range: CELL, speed: speed(100), sight: 5,
  cooldown: 30, cost: cost(50), trainTicks: 12 * S, population: 1,
};
// Round 3 (D-026): spearmen 60 -> 100, so a full-health spearman stands two crystal cannon shots
// (2 x 45 = 90) and the mage side pays for beating them; ranged hit spearmen x5/2 (was x3/2), so a
// mixed army does not lose to spearmen alone (src/balance.ts).
UNITS[UnitType.Spearman] = {
  type: UnitType.Spearman, hp: 100, shield: 0, attack: 6, range: CELL, speed: speed(100), sight: 6,
  cooldown: 30, cost: cost(40, 20), trainTicks: 18 * S, population: 1,
};
UNITS[UnitType.Ranged] = {
  type: UnitType.Ranged, hp: 35, shield: 0, attack: 5, range: 5 * CELL, speed: speed(100), sight: 7,
  cooldown: 40, cost: cost(0, 40, 30), trainTicks: 20 * S, population: 1,
};
UNITS[UnitType.Mage] = {
  type: UnitType.Mage, hp: 30, shield: 60, attack: 4, range: 5 * CELL, speed: speed(90), sight: 7,
  cooldown: 20, cost: cost(0, 0, 90, 50), trainTicks: 35 * S, population: 1,
};
UNITS[UnitType.Militia] = {
  type: UnitType.Militia, hp: 40, shield: 0, attack: 4, range: CELL, speed: speed(100), sight: 5,
  cooldown: 30, cost: cost(), trainTicks: 0, population: 0,
};
// Round 7 (D-061): GDD appendix A's heavy cavalry; cooldown as spearmen, sight as ranged (not in
// the GDD). Trained only while CAVALRY is on.
UNITS[UnitType.Cavalry] = {
  type: UnitType.Cavalry, hp: 130, shield: 0, attack: 11, range: CELL, speed: speed(160), sight: 7,
  cooldown: 30, cost: cost(70, 0, 70), trainTicks: 28 * S, population: 1,
};

const ALL: Resource[] = [Resource.Food, Resource.Wood, Resource.Gold, Resource.Crystal];

/** BuildingInfo with the round 7 fields the simulation always fills (optional in the protocol for mocks). */
export type SimBuildingInfo = Required<BuildingInfo>;
export const BUILDINGS: SimBuildingInfo[] = [];
const building = (b: Partial<BuildingInfo> & Pick<BuildingInfo, "type" | "hp" | "size">): SimBuildingInfo => ({
  walkable: false, cost: cost(), buildTicks: 0, sight: 5, populationCap: 0, accepts: [], trains: [], shelter: 0,
  holds: 0, requires: [], ...b,
});
// holds: soldiers that can hide inside (round 7, D-061; only while GARRISON is on).
BUILDINGS[BuildingType.MainCity] = building({
  type: BuildingType.MainCity, hp: 1200, size: 4, sight: 8, populationCap: 10, accepts: ALL,
  trains: [UnitType.Farmer], shelter: 15, holds: 6,
});
BUILDINGS[BuildingType.House] = building({
  type: BuildingType.House, hp: 200, size: 2, cost: cost(0, 30), buildTicks: 20 * S, populationCap: 5, shelter: 5,
});
BUILDINGS[BuildingType.LumberCamp] = building({
  type: BuildingType.LumberCamp, hp: 300, size: 2, cost: cost(0, 60), buildTicks: 25 * S, accepts: [Resource.Wood],
});
BUILDINGS[BuildingType.Mine] = building({
  type: BuildingType.Mine, hp: 300, size: 2, cost: cost(0, 60), buildTicks: 25 * S,
  accepts: [Resource.Gold, Resource.Crystal],
});
BUILDINGS[BuildingType.Granary] = building({
  type: BuildingType.Granary, hp: 300, size: 2, cost: cost(0, 60), buildTicks: 25 * S, accepts: [Resource.Food],
});
BUILDINGS[BuildingType.Farm] = building({
  type: BuildingType.Farm, hp: 100, size: 3, walkable: true, cost: cost(0, 50), buildTicks: 15 * S, sight: 3,
});
BUILDINGS[BuildingType.Barracks] = building({
  type: BuildingType.Barracks, hp: 500, size: 3, cost: cost(0, 120), buildTicks: 35 * S, trains: [UnitType.Spearman],
});
BUILDINGS[BuildingType.Range] = building({
  type: BuildingType.Range, hp: 500, size: 3, cost: cost(0, 120), buildTicks: 35 * S, trains: [UnitType.Ranged],
});
BUILDINGS[BuildingType.MageHall] = building({
  type: BuildingType.MageHall, hp: 500, size: 3, cost: cost(0, 150, 100), buildTicks: 45 * S, trains: [UnitType.Mage],
});
BUILDINGS[BuildingType.TownTower] = building({ type: BuildingType.TownTower, hp: 400, size: 2, sight: 8 });
// Round 7 (D-061): a player's arrow tower (only while TOWERS is on) and the stable (only while
// CAVALRY is on). Footprints from GDD section 8; the rest are the prototype's values.
BUILDINGS[BuildingType.ArrowTower] = building({
  type: BuildingType.ArrowTower, hp: 500, size: 2, cost: cost(0, 100, 50), buildTicks: 40 * S, sight: 8, holds: 3,
});
BUILDINGS[BuildingType.Stable] = building({
  type: BuildingType.Stable, hp: 500, size: 3, cost: cost(0, 150, 50), buildTicks: 40 * S, trains: [UnitType.Cavalry],
});

/**
 * Ranged against a mage's shield (early balance, D-057; round 4, D-037): x3, was x3/2 (num 3,
 * den 2 gives that back).
 */
export const RANGED_VS_SHIELD = { num: 3, den: 1 };
/** Damage x num / den. Cavalry's (round 7, D-061) from GDD appendix A. */
export const MULTIPLIERS: Multiplier[] = [
  { attacker: UnitType.Ranged, target: UnitType.Spearman, num: 5, den: 2 },
  { attacker: UnitType.Ranged, target: "shield", ...RANGED_VS_SHIELD },
  { attacker: UnitType.Spearman, target: UnitType.Cavalry, num: 3, den: 1 },
  { attacker: UnitType.Cavalry, target: UnitType.Mage, num: 2, den: 1 },
  { attacker: UnitType.Cavalry, target: "shield", num: 2, den: 1 },
];

export const MAGE_CAP = 6;
export const MAX_POPULATION = 120;
/** Queue entries fit 4 bits each in BuildingField.queuePacked. */
export const QUEUE_MAX = 7;

export function rules(): Required<Rules> {
  return {
    units: UNITS,
    buildings: BUILDINGS,
    multipliers: MULTIPLIERS,
    mageCap: MAGE_CAP,
    maxPopulation: MAX_POPULATION,
    queueMax: QUEUE_MAX,
    features: { plunderOnce: TOWN_ONCE.on, towers: TOWERS.on, garrison: GARRISON.on, cavalry: CAVALRY.on },
    arrows: { mainCity: MAIN_ARROW, townTower: { ...TOWER_ARROW, extraMax: 0 }, arrowTower: { ...ARROW_TOWER, extraMax: 0 } },
    garrisonTypes: GARRISON_TYPES,
    towerReach: TOWER_REACH,
    towns: [TownSize.Small, TownSize.Large].map((size) => townInfo(size)),
    plunderRecovery: { startPermille: PLUNDER_RECOVERY.on ? PLUNDER_RECOVERY.startPermille : 1000, ticks: PLUNDER_RECOVERY.ticks },
  };
}

/** multiplier[attacker][target] as [num, den]; target index UnitType, or SHIELD. */
export const SHIELD = 8;
export const MULT_NUM: number[][] = [];
export const MULT_DEN: number[][] = [];
for (let a = 0; a < UNITS.length; a++) {
  MULT_NUM.push(new Array(9).fill(1));
  MULT_DEN.push(new Array(9).fill(1));
}
for (const m of MULTIPLIERS) {
  const t = m.target === "shield" ? SHIELD : m.target;
  MULT_NUM[m.attacker][t] = m.num;
  MULT_DEN[m.attacker][t] = m.den;
}

// --- combat behaviour (prototype values) -----------------------------------------------

/** Aggressive units and attack-move pick targets this close (fixed point). */
export const AGGRO_RANGE = 6 * CELL;
/** Aggressive idle units give up a chase this far from where they stood. */
export const LEASH = 8 * CELL;
/**
 * Joining a fight (round 3, D-026): a player's idle aggressive soldier with no enemy within
 * AGGRO_RANGE takes on an enemy that a friend within `range` had as its target at the start of
 * the tick (chasing or hitting it), the one nearest itself, if that enemy is within LEASH of
 * where it stands, so no chain of friends draws a unit away from its place. `range` 0 switches
 * it off (src/balance.ts measures both ways).
 */
export const JOIN_FIGHT = { range: 6 * CELL };
/**
 * A squad (operations round, D-050): the units that got the same move or attack command. A
 * member on a move or idle and aggressive, with no enemy within AGGRO_RANGE, takes on the enemy
 * nearest itself among those its mates are fighting and those within `near` of them, if that
 * enemy is within `reach` of it; an idle member gives up a chase `leash` from where it stood
 * (LEASH for units without a squad). Hold stance and retreat are left as they are. `reach` 0
 * switches it off (tests and src/balance.ts measure both ways).
 */
export const SQUAD = { reach: 12 * CELL, near: 3 * CELL, leash: 12 * CELL, crowd: 3 };
/**
 * Loose soldiers keep their distance (round 6, D-054; rule 1 of round 4 and E4, D-035, D-037):
 * a player's soldiers with UnitFlag.Loose (not farmers) push apart to `spacing` (fixed point)
 * from the loose soldiers of their own team, not just to SEPARATION, walking, chasing or
 * fighting. The team is the squad (one move or attack command, D-050), or on a retreat the
 * group. The user: loose soldiers chasing or advancing still bunched up (2026-10-04). Others
 * keep SEPARATION. `spacing` 0 switches it off (tests measure both ways).
 */
export const LOOSE_KEEP = { spacing: 2 * CELL };
/**
 * A retreat (early balance, D-057; rule 2 of round 4, D-034): each unit runs at its own speed
 * instead of the group's slowest, so the fast are not caught waiting for the slow; they still
 * form up at the goal. A move keeps to the slowest. `on` false gives the old way back.
 */
export const RETREAT_OWN_SPEED = { on: true };
/**
 * Counter-attack (early balance, D-057; rule 3 of round 4, D-037): an idle aggressive player
 * soldier without a squad (a squad fights together instead, SQUAD), with no enemy within
 * AGGRO_RANGE and no friend's fight to join, hit in the last RETARGET_EVERY ticks or with a
 * friend within JOIN_FIGHT.range hit then, takes on the unit that hit (the nearest such, ties to
 * the lower id) if its owner sees it and it is within LEASH of the soldier's place. Hold
 * (garrisons too), units with orders, farmers and militia do not. `on` false switches it off,
 * and the unit column it reads (hitById) then stays out of the hash.
 */
export const COUNTER_ATTACK = { on: true };
/**
 * A mage calibrating the crystal cannon, and for `ticks` after it fired, is seen by every other
 * player in its own cell (early balance, D-057; rule 3 of round 4, D-037). `on` false switches
 * it off.
 */
export const REVEAL_CAST = { on: true, ticks: 2 * S };
export const RETARGET_EVERY = 10;
export const UNIT_RADIUS = 358;
export const SEPARATION = 2 * UNIT_RADIUS;
export const PUSH = 16;
export const MAX_PUSH = 48;
/** A unit is "in combat" (shield regen, UnderAttack flag) this long after damage. */
export const COMBAT_TICKS = 5 * S;
export const UNDER_ATTACK_TICKS = 60;
/** Formation slots are this far apart. */
export const FORMATION_SPACING = CELL;
/**
 * Slots of a loose formation (UnitFlag.Loose, round 3): further apart than the crystal
 * cannon's radius (1.5 cells), so a shot on one unit standing in formation hits only that one.
 */
export const FORMATION_LOOSE_SPACING = 2 * CELL;
/** Closer than this to its slot, a unit stops (fixed point). */
export const ARRIVE_DISTANCE = 256;
/** Within this distance of its slot a unit steers straight at it instead of following the field. */
export const DIRECT_STEER = 3 * CELL;

/** Main city arrows (D3): one every 2 s, 5 damage, range 7; +1 arrow per sheltered farmer, max +10. */
export const MAIN_ARROW: ArrowInfo = { damage: 5, range: 7 * CELL, cooldown: 2 * S, extraMax: 10 };
/** The big city's tower (D1). */
export const TOWER_ARROW = { damage: 6, range: 7 * CELL, cooldown: 2 * S };
/** A player's arrow tower (round 7, D-061): as the main city's own arrow. */
export const ARROW_TOWER = { damage: 5, range: 7 * CELL, cooldown: 2 * S };

// --- round 7 (D-061): switches, all off until their PR -----------------------------------

/** A town can be plundered once per game; plundered again, `town_choice` is rejected. */
export const TOWN_ONCE = { on: true };
/**
 * Governing pays `boost` instead of TownRule.perMinute: about 3 minutes of it match one
 * plunder (small 230 a minute against 675, large 515 against 1530; the user 2026-10-07, after
 * 4 minutes: "應該拉高每分鐘的收益就好").
 */
export const GOVERN_INCOME = {
  on: true,
  boost: [cost(100, 0, 100, 30), cost(220, 0, 220, 75)] as Cost[],
};
/**
 * A plundered town, governed again, pays `startPermille` of its income at first, climbing
 * linearly to all of it over `ticks` of being governed; the town keeps what it climbed when it
 * changes hands.
 */
export const PLUNDER_RECOVERY = { on: true, startPermille: 250, ticks: 10 * 60 * S };
/** Players can build arrow towers (BuildingType.ArrowTower). */
export const TOWERS = { on: false };
/** Ranged units and mages can hide in main cities and arrow towers (`garrison`, `leave`). */
export const GARRISON = { on: false };
/** Players can build stables and train cavalry. */
export const CAVALRY = { on: false };
/** Unit types that may hide in buildings. */
export const GARRISON_TYPES: UnitType[] = [UnitType.Ranged, UnitType.Mage];
/** Arrow towers: within `mainCity` cells of an own main city's footprint, or a held town's radius + `town`. */
export const TOWER_REACH = { mainCity: 8, town: 2 };

// --- mages (from PR-4) ---------------------------------------------------------------

export const CANNON = {
  damage: 45,
  radius: Math.trunc(1.5 * CELL),
  range: 8 * CELL,
  calibrateTicks: Math.trunc(1.5 * S),
  cooldownTicks: 8 * S,
  crystal: 5,
  /** Autocast when this many enemies stand within the radius of some point in range. */
  autocastMinTargets: 3,
};
export const SHIELD_REGEN = { perSecond: 6, afterTicks: 5 * S };
export const MAGE_BOUNTY = 15;

// --- towns (from PR-4) -------------------------------------------------------------------

export interface TownRule {
  militia: number;
  tower: boolean;
  radius: number;
  plunderTicks: number;
  plunder: Cost;
  ruinsTicks: number;
  governCost: Cost;
  repairTicks: number;
  perMinute: Cost;
  populationCap: number;
  garrisonNeeded: number;
  revoltTicks: number;
}
/** Plunder takes: GDD appendix A x 1.5 (ceo balance ruling 2026-09-30, see sim/README.md). */
export const TOWNS: TownRule[] = [];
TOWNS[TownSize.Small] = {
  militia: 6, tower: false, radius: 5, plunderTicks: 15 * S, plunder: cost(300, 0, 300, 75), ruinsTicks: 240 * S,
  governCost: cost(0, 80, 80), repairTicks: 45 * S, perMinute: cost(40, 0, 40, 12), populationCap: 5,
  garrisonNeeded: 1, revoltTicks: 60 * S,
};
TOWNS[TownSize.Large] = {
  militia: 12, tower: true, radius: 7, plunderTicks: 25 * S, plunder: cost(675, 0, 675, 180), ruinsTicks: 240 * S,
  governCost: cost(0, 150, 150), repairTicks: 60 * S, perMinute: cost(90, 0, 90, 30), populationCap: 10,
  garrisonNeeded: 3, revoltTicks: 60 * S,
};

/** What governing a town of this size pays a minute at full income (GOVERN_INCOME). */
export function governPerMinute(size: number): Cost {
  return GOVERN_INCOME.on ? GOVERN_INCOME.boost[size] : TOWNS[size].perMinute;
}

/**
 * What governing town t pays now, in permille of governPerMinute (TownField.incomePermille):
 * 1000 unless it was plundered and PLUNDER_RECOVERY is on; then startPermille climbing
 * linearly to 1000 over PLUNDER_RECOVERY.ticks of being governed.
 */
export function townIncomePermille(plundered: number, recovered: number): number {
  if (!PLUNDER_RECOVERY.on || plundered === 0) return 1000;
  const r = PLUNDER_RECOVERY;
  if (recovered >= r.ticks) return 1000;
  return r.startPermille + Math.trunc(((1000 - r.startPermille) * recovered) / r.ticks);
}

/** A town's rules as sent in `Rules.towns`. */
function townInfo(size: number): TownInfo {
  const t = TOWNS[size];
  return {
    militia: t.militia, radius: t.radius, plunderTicks: t.plunderTicks, plunder: t.plunder, ruinsTicks: t.ruinsTicks,
    governCost: t.governCost, repairTicks: t.repairTicks, perMinute: governPerMinute(size), populationCap: t.populationCap,
    garrisonNeeded: t.garrisonNeeded, revoltTicks: t.revoltTicks,
  };
}

// --- economy (from PR-3) -----------------------------------------------------------------

export const START = { farmers: 5, resources: cost(200, 200, 100, 0) };
/** Per farmer per minute (GDD); carried 10 at a time. */
export const GATHER_PER_MINUTE: number[] = [];
GATHER_PER_MINUTE[Resource.Food] = 24; // farm; berries 30 (see BERRIES_PER_MINUTE)
GATHER_PER_MINUTE[Resource.Wood] = 30;
GATHER_PER_MINUTE[Resource.Gold] = 24;
GATHER_PER_MINUTE[Resource.Crystal] = 12;
export const BERRIES_PER_MINUTE = 30;
export const CARRY = 10;
export const NODE_AMOUNT = { tree: 100, goldCell: 400, bush: 100, crystalCell: 150 };
/** Builders on one building that add progress (more wait); the same cap applies to repairs. */
export const BUILDERS_MAX = 4;
/** Farmers a build without farmers sends (round 2): by footprint, 1 for 2 x 2 and 2 for 3 x 3. */
export function autoBuilders(size: number): number {
  return size <= 2 ? 1 : 2;
}
export const REPAIR_PER_SECOND = 5;
/** A main city cannot be repaired within this many ticks of taking damage (10 s); other buildings can. */
export const MAIN_CITY_REPAIR_LOCK = 10 * S;
/** Farms must be within this many cells (Chebyshev, footprint to footprint) of an own finished main city or granary. */
export const FARMLAND_REACH = 6;
/** Economy ratio default (GDD section 4): food / wood / gold in percent. */
export const ECO_DEFAULT = { food: 40, wood: 35, gold: 25 };

/**
 * The main city's crystal (early balance, D-051, D-057): every `every` ticks each standing main
 * city gives its owner `amount` crystal, so a side without towns still gets mages (one mage, 50,
 * by about game minute 13), while one plundered small town (75) stays worth 20 minutes of it.
 * `every` 0 switches it off.
 */
export const MAIN_CRYSTAL = { every: 16 * S, amount: 1 };

/**
 * Automatic training (round 6, D-054): a barracks, range or mage hall with it on queues its
 * unit whenever its queue is empty, paid only from what is above the player's reserve. The
 * default reserve keeps a mage hall's wood and gold (150 / 100) and 15 crystal for three
 * cannon shots (5 each); the player changes it with `reserve`. A player's buildings start with
 * it on when the game says so (GameConfig.autoTrain: a person's yes, an AI's no).
 */
export const AUTO_TRAIN = {
  reserve: { food: 0, wood: 150, gold: 100, crystal: 15 },
  /** Largest reserve per resource a `reserve` command may set. */
  reserveMax: 10000,
  buildings: [BuildingType.Barracks, BuildingType.Range, BuildingType.MageHall, BuildingType.Stable] as number[],
};
/** Idle farmers are handed work (auto-repair, then the economy ratio, or recall) every this many ticks. */
export const ECO_EVERY = 20;
/** A farmer works (gathers, drops off, builds, repairs, shelters) within this distance of the target's cell or footprint. */
export const WORK_REACH = 768;
/** Choosing a node, each farmer already on it counts as this much extra distance (2 cells). */
export const CROWD_PENALTY = 2 * CELL;
/** After a node runs out, a farmer looks for the same kind within this many cells of it. */
export const NEXT_NODE_RADIUS = 8;
/** Idle farmers repair own damaged buildings this close (cells, to the footprint). */
export const AUTO_REPAIR_RANGE = 6;
/** At the start each player has explored the disc of this radius (cells) around its spawn and knows its resource nodes. */
export const START_REVEAL = 16;
/** Gathering accumulates per-minute rates each tick; one unit is gathered per this many. */
export const GATHER_UNIT = 60 * S;
