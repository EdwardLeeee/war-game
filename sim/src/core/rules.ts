// Rule values. Source: docs/design/gdd.md Appendix A, plus the prototype values
// war-game-ceo approved on 2026-09-30 (D1-D3, "補缺" — values the GDD does not give).
// Seconds become ticks (x 20), cells/s become fixed point per tick (x 1024 / 20, truncated).
// sim/README.md lists every value added here that is not in the GDD.

import {
  BuildingType,
  CELL,
  type BuildingInfo,
  type Cost,
  type Multiplier,
  Resource,
  type Rules,
  TICKS_PER_SECOND,
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
UNITS[UnitType.Spearman] = {
  type: UnitType.Spearman, hp: 60, shield: 0, attack: 6, range: CELL, speed: speed(100), sight: 6,
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

const ALL: Resource[] = [Resource.Food, Resource.Wood, Resource.Gold, Resource.Crystal];

export const BUILDINGS: BuildingInfo[] = [];
const building = (b: Partial<BuildingInfo> & Pick<BuildingInfo, "type" | "hp" | "size">): BuildingInfo => ({
  walkable: false, cost: cost(), buildTicks: 0, sight: 5, populationCap: 0, accepts: [], trains: [], shelter: 0, ...b,
});
BUILDINGS[BuildingType.MainCity] = building({
  type: BuildingType.MainCity, hp: 1200, size: 4, sight: 8, populationCap: 10, accepts: ALL,
  trains: [UnitType.Farmer], shelter: 15,
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

/** Damage x num / den. Spearman x3 vs cavalry and cavalry x2 vs shields wait for cavalry. */
export const MULTIPLIERS: Multiplier[] = [
  { attacker: UnitType.Ranged, target: UnitType.Spearman, num: 3, den: 2 },
  { attacker: UnitType.Ranged, target: "shield", num: 3, den: 2 },
];

export const MAGE_CAP = 6;
export const MAX_POPULATION = 120;
/** Queue entries fit 4 bits each in BuildingField.queuePacked. */
export const QUEUE_MAX = 7;

export function rules(): Rules {
  return {
    units: UNITS,
    buildings: BUILDINGS,
    multipliers: MULTIPLIERS,
    mageCap: MAGE_CAP,
    maxPopulation: MAX_POPULATION,
    queueMax: QUEUE_MAX,
  };
}

/** multiplier[attacker][target] as [num, den]; target index UnitType, or SHIELD. */
export const SHIELD = 8;
export const MULT_NUM: number[][] = [];
export const MULT_DEN: number[][] = [];
for (let a = 0; a < 5; a++) {
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
/** Closer than this to its slot, a unit stops (fixed point). */
export const ARRIVE_DISTANCE = 256;
/** Within this distance of its slot a unit steers straight at it instead of following the field. */
export const DIRECT_STEER = 3 * CELL;

/** Main city arrows (D3): one every 2 s, 5 damage, range 7; +1 arrow per sheltered farmer, max +10. */
export const MAIN_ARROW = { damage: 5, range: 7 * CELL, cooldown: 2 * S, extraMax: 10 };
/** The big city's tower (D1). */
export const TOWER_ARROW = { damage: 6, range: 7 * CELL, cooldown: 2 * S };

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
