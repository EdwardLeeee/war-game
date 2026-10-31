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
import { type CastleMap, castleOf, FIXED_POSTS } from "./castle.ts";
import { KEEP } from "./keep.ts";

export { KEEP };

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
// the GDD). Trained only while CAVALRY is on. D-097 (the unit triangle): 60 food 60 gold, was 70
// and 70; 150 hp, was 130 (src/balance.ts).
UNITS[UnitType.Cavalry] = {
  type: UnitType.Cavalry, hp: 150, shield: 0, attack: 11, range: CELL, speed: speed(160), sight: 7,
  cooldown: 30, cost: cost(60, 0, 60), trainTicks: 28 * S, population: 1,
};
// D-099 (ceo 2026-10-22, the user: 「蓋一大堆防禦塔根本打不去」): GDD appendix A's siege engine; a
// stone every 5 s, sight 10 (it sees what it outranges: arrow towers shoot 9), splash 1 cell, nothing
// within 3. Trained only while SIEGE is on. D-115 (the user 2026-10-31: 「怎麼感覺他是攻擊距離更遠更痛的法師？」):
// 15 on units (35 before), SIEGE.vsBuildings and GATE.siege keeping what it does to buildings; `range` is for
// buildings, one more than arrow towers' 9, and units it throws at from `unitRange` (6, as ranged units).
UNITS[UnitType.Siege] = {
  type: UnitType.Siege, hp: 140, shield: 0, attack: 15, range: 10 * CELL, speed: speed(60), sight: 10,
  cooldown: 5 * S, cost: cost(0, 150, 100), trainTicks: 40 * S, population: 1, minRange: 3 * CELL, unitRange: 6 * CELL, splash: CELL,
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
// The big city's tower; with KEEP on (D-100) every town's keep, 3 x 3, its hp by its town's size
// (KEEP.hp, World.maxHp; this row then the big city's).
BUILDINGS[BuildingType.Keep] = building({ type: BuildingType.Keep, hp: 400, size: 2, sight: 8 });
// Round 7 (D-061): a player's arrow tower (only while TOWERS is on) and the stable (only while
// CAVALRY is on). Footprints from GDD section 8; the rest are the prototype's values.
BUILDINGS[BuildingType.ArrowTower] = building({
  type: BuildingType.ArrowTower, hp: 500, size: 2, cost: cost(0, 100, 50), buildTicks: 40 * S, sight: 8, holds: 3,
});
BUILDINGS[BuildingType.Stable] = building({
  type: BuildingType.Stable, hp: 500, size: 3, cost: cost(0, 150, 50), buildTicks: 40 * S, trains: [UnitType.Cavalry],
});
// D-099: the siege works (砲坊; only while SIEGE is on): GDD section 8 and appendix A, hp as the
// stable's; after a range, as the prototype has no ages.
BUILDINGS[BuildingType.SiegeWorks] = building({
  type: BuildingType.SiegeWorks, hp: 500, size: 3, cost: cost(0, 200), buildTicks: 45 * S, trains: [UnitType.Siege], requires: [BuildingType.Range],
});
// D-101: the market (only while MARKET is on), after a granary.
BUILDINGS[BuildingType.Market] = building({
  type: BuildingType.Market, hp: 600, size: 3, cost: cost(0, 150), buildTicks: 40 * S, requires: [BuildingType.Granary],
});
// D-080: the outpost (only while OUTPOST is on). The brief's starting values.
BUILDINGS[BuildingType.Outpost] = building({
  type: BuildingType.Outpost, hp: 400, size: 2, cost: cost(0, 50), buildTicks: 20 * S, sight: 10,
});
// D-096: a castle gate; never built by players. hp is the big city's (GATE.hp by town size), and
// size 1 only for the type: a gate's footprint is its opening's cells (World.sideX).
BUILDINGS[BuildingType.Gate] = building({ type: BuildingType.Gate, hp: 2100, size: 1, sight: 2 });

/**
 * Damage x num / den: only the unit triangle (D-097; the user 2026-10-21: 「簡化成一個三角＋修騎兵」),
 * spearmen beat cavalry, cavalry beat ranged units and mages (their shields too), ranged units
 * beat spearmen. Ranged x9/5 on cavalry (round 7) and x3 on shields (D-057, D-037) are gone.
 * At equal cost (src/balance.ts): 7 cavalry beat 12 ranged and 6 mages losing at most 2, 14
 * spearmen beat 7 cavalry keeping 12, 12 ranged beat 14 spearmen. Ranged on spearmen x7/2, was
 * x5/2; spearmen on cavalry x5/2, was x3; cavalry on mages and shields x3, was x2.
 */
export const MULTIPLIERS: Multiplier[] = [
  { attacker: UnitType.Ranged, target: UnitType.Spearman, num: 7, den: 2 },
  { attacker: UnitType.Spearman, target: UnitType.Cavalry, num: 5, den: 2 },
  { attacker: UnitType.Cavalry, target: UnitType.Mage, num: 3, den: 1 },
  { attacker: UnitType.Cavalry, target: "shield", num: 3, den: 1 },
  // D-099: siege engines sit outside the triangle, as mages; cavalry ride them down (GDD's table).
  { attacker: UnitType.Cavalry, target: UnitType.Siege, num: 2, den: 1 },
];

export const MAGE_CAP = 6;
/** The population ceiling while POPULATION_200 is off. */
export const MAX_POPULATION = 120;
/**
 * D-083 (the user 2026-10-17: 「2 可以 然後加混和1 一起，不過兵上限應該加多一點」): the population
 * ceiling is `base` plus `town[size]` for each town the player governs (fixed map at most 300,
 * random 360), and a governed town adds `town[size]` to the cap too (off: 5 / 10). A house adds
 * `house` (off: 5; the user 2026-10-17: main city and 24 houses fill 200, as 22 fill 120 now);
 * main cities as before. A town lost lowers both, and the units already there stay. Off: a flat
 * MAX_POPULATION. `town` by TownSize.
 */
export const POPULATION_200 = { on: true, base: 200, town: [20, 40], house: 8 };
/** The population ceiling without the towns: what `Rules.maxPopulation` says. */
export function basePopulation(): number {
  return POPULATION_200.on ? POPULATION_200.base : MAX_POPULATION;
}
/** Queue entries fit 4 bits each in BuildingField.queuePacked. */
export const QUEUE_MAX = 7;

/**
 * The rules a game sends (`ready`) and gives its AIs. With a map whose big city's tower has its
 * own size (GameMap.towerSize: 3 x 3 on random maps with adjacent starts, D-074), the tower's
 * row says so; every other value is the same for every game.
 */
export function rules(map?: { towerSize?: number } & Partial<CastleMap>): Required<Rules> {
  const towerSize = map?.towerSize;
  const same = towerSize === undefined || towerSize === BUILDINGS[BuildingType.TownTower].size;
  // D-099: the siege engine and the siege works only while SIEGE is on (they are the last of each).
  const units = SIEGE.on ? UNITS : UNITS.slice(0, UnitType.Siege);
  // D-101: the market only while MARKET is on. Each by its own switch (ceo 2026-10-29: so one of the batch can be
  // turned off alone): SIEGE off with MARKET on leaves the siege works' row empty (null in JSON).
  const off = (t: number) => (t === BuildingType.SiegeWorks && !SIEGE.on) || (t === BuildingType.Market && !MARKET.on);
  const buildings: typeof BUILDINGS = [];
  BUILDINGS.forEach((b, t) => {
    if (!off(t)) buildings[t] = b;
  });
  return {
    units,
    buildings: same ? buildings : buildings.map((b) => (b.type === BuildingType.TownTower ? { ...b, size: towerSize } : b)),
    multipliers: SIEGE.on ? MULTIPLIERS : MULTIPLIERS.filter((m) => m.target !== UnitType.Siege),
    mageCap: MAGE_CAP,
    maxPopulation: basePopulation(),
    population: { base: basePopulation(), town: [TownSize.Small, TownSize.Large].map((size) => (POPULATION_200.on ? POPULATION_200.town[size] : 0)) },
    queueMax: QUEUE_MAX,
    // `outpost`, `gates` and `walls` only while on: absent is off, and the screen's tables of the round 7 four stay as they were.
    features: {
      plunderOnce: TOWN_ONCE.on, towers: TOWERS.on, garrison: GARRISON.on, cavalry: CAVALRY.on,
      ...(OUTPOST.on ? { outpost: true } : {}), ...(GATE.on ? { gates: true } : {}), ...(WALLS.on ? { walls: true } : {}),
      ...(CAV_FLANK.on ? { cavalryFlank: true } : {}), ...(SIEGE.on ? { siege: true } : {}), ...(KEEP.on ? { keep: true } : {}), ...(MARKET.on ? { market: true } : {}),
    },
    arrows: {
      mainCity: MAIN_ARROW,
      townTower: { ...TOWER_ARROW, extraMax: 0 },
      arrowTower: { ...ARROW_TOWER, extraMax: 0 },
      ...(GATE.on ? { gate: { ...GATE_ARROW } } : {}),
    },
    garrisonTypes: GARRISON_TYPES,
    garrisonCannon: { permille: GARRISON.cannon ? GARRISON.cannonPermille : 0, cooldownTimes: GARRISON.cannonCooldown },
    towerReach: TOWER_REACH,
    outpost: { slots: OUTPOST.slots, reach: OUTPOST.reach, chase: OUTPOST.chase },
    towns: [TownSize.Small, TownSize.Large].map((size) => townInfo(size, map)),
    plunderRecovery: { startPermille: PLUNDER_RECOVERY.on ? PLUNDER_RECOVERY.startPermille : 1000, ticks: PLUNDER_RECOVERY.ticks },
    cannonRange: CANNON.range,
    // Sent as `outpost` is; `features` says whether they are on.
    gate: { rangedNum: GATE.rangedNum, rangedDen: GATE.rangedDen, rebuildTicks: GATE.rebuildTicks },
    walls: { range: WALLS.range, takenNum: WALLS.takenNum, takenDen: WALLS.takenDen, sling: WALLS.sling },
    siege: { vsBuildings: SIEGE.vsBuildings, flightTicks: SIEGE.flightTicks },
    market: { lot: MARKET.lot, start: MARKET.start, step: MARKET.step, min: MARKET.min, max: MARKET.max, sellPermille: MARKET.sellPermille, recoverTicks: MARKET.recoverTicks, maxLots: MARKET.maxLots },
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
/**
 * Castle gates (D-096; the user 2026-10-21: the walls were 「雞肋」, in everyone's way alike): a
 * gate building in each opening of a town's walls, closed to all but the town's holder (a neutral
 * town's to everyone, militia too), open to all once broken and while the town lies in ruins.
 * `hp` by TownSize (ceo 2026-10-21): 7 spearmen (4 damage a second each) break a small town's in
 * about 30 s (an early grab of 7-10 men still takes it, at a cost), 15 the big city's in about 60 s
 * (a mid-game target for a big army; up to 9 reach its 2-cell gate at once, under its tower's fire).
 * Hits on a gate: melee in full, ranged units and mages `rangedNum` / `rangedDen` (at least 1),
 * siege engines (to come) `siege` times. A governed town rebuilds a broken gate once no enemy
 * has stood inside its walls for `rebuildTicks`; the end of repairing and ruins turning neutral
 * rebuild them all. Off: no gates, the openings stay open to everyone (D-089).
 */
export const GATE = { on: true, hp: [850, 2100], rangedNum: 1, rangedDen: 5, siege: 18, rebuildTicks: 60 * S };
/**
 * On the walls (D-096; the user: 「中立城鎮也要攻城，不然電腦打太快了」; AoE4: on walls -25% ranged
 * damage, +1-2 range): ranged units and mages of the town's holder go up (`wall`), one a wall cell,
 * from the cell inside next to it; a neutral town's militia stand on them from the start (`militia`
 * of every 2, from the posts listed first), throwing stones to `sling`. There they never move,
 * shoot `range` further (the crystal cannon as ever), take hits of ranged units, mages and arrows
 * at `takenNum` / `takenDen` (the cannon in full), and melee reaches them only from inside the
 * walls, next to them. They count as inside the town (capturing, keeping it). Off: no `wall`.
 */
export const WALLS = { on: true, range: CELL, takenNum: 3, takenDen: 4, sling: 4 * CELL, militia: 2 };
/**
 * A governed town's gate towers shoot (D-096; the user: 城樓會射箭, more the more soldiers hold the
 * town, as AoE2's garrison arrows): each standing gate of a town its holder governs, at the
 * nearest enemy unit its holder sees within `range` of the gate, `damage` every `cooldown`; one
 * arrow more for every `perSoldiers` of the holder's soldiers inside the walls or on them, at most
 * `extraMax` more. A broken gate shoots nothing until it stands again.
 */
export const GATE_ARROW = { damage: 5, range: 9 * CELL, cooldown: 2 * S, perSoldiers: 3, extraMax: 3 };
/** Players can build arrow towers (BuildingType.ArrowTower). */
export const TOWERS = { on: true };
/**
 * Ranged units and mages can hide in main cities and arrow towers (`garrison`, `leave`). A mage
 * hiding fires the crystal cannon (`cannon`) at `cannonPermille` of its damage and `cannonCooldown`
 * times its cooldown: at full strength, 2 towers with 6 hidden wiped out 24 and 30 attackers
 * without a loss (src/balance.ts, "攻打主城"). ceo 2026-10-07 chose B (half, cooldown x2), then
 * B' (a third, cooldown as it is) once the normal AI hid in its main city and the scripted
 * player's town-taking games stopped ending (0 -> 13 undecided).
 */
export const GARRISON = { on: true, cannon: true, cannonPermille: 333, cannonCooldown: 1 };
/** Players can build stables and train cavalry. */
export const CAVALRY = { on: true };
/**
 * Siege engines (D-099; off until art-v6): siege works can be built and siege engines trained. A
 * stone lands `flightTicks` after it is thrown, where it was aimed then; there it hits every enemy
 * unit within the engine's splash (never its own side), or the building it was thrown at, that one
 * only, `vsBuildings` times (a gate GATE.siege times). Off: no siege works, rules() leaves the
 * engine, the works and their multiplier out, and games play as before.
 */
export const SIEGE = { on: true, vsBuildings: 7, flightTicks: S };
/** Unit types that may hide in buildings. */
export const GARRISON_TYPES: UnitType[] = [UnitType.Ranged, UnitType.Mage];
/**
 * Arrow towers: within `mainCity` cells of an own main city's footprint, or a held town's radius
 * + `town`, or (D-080, while OUTPOST is on) `outpost` cells of an own finished outpost's footprint.
 */
export const TOWER_REACH = { mainCity: 8, town: 2, outpost: 6 };

/**
 * Outposts (D-080, the user 2026-10-09): built anywhere walkable and explored; up to `slots`
 * spearmen stand guard around one (`post`). Attacking (the default) they go for enemies within
 * `reach` cells of it and give up `chase` cells out; holding (`outpost_mode`) they stand and
 * fight what comes next to them, and all go for whoever hits the outpost or one of them (and
 * attacking, they do that too). Off: building one and the three commands are rejected, and
 * the game plays as before D-080. `ownersWalk` (D-115, the user 2026-10-31: 「我方兵種應該可以通過自己架設的哨所才對」):
 * its owner's units walk through it, finished or not, as through a gate of its town; nobody else does.
 */
export const OUTPOST = { on: true, slots: 6, reach: 8, chase: 12, ownersWalk: true };

// --- round 8 (D-069): a defender is not beaten by the first cannon shots -------------------

/**
 * Stepping out of a cannon warning (rule 1): a player's soldier with no order (idle, hold, or
 * fighting where it stands) inside the blast of an enemy cannon that is calibrating, whose
 * target point its owner sees (the warning on the screen), walks straight out to `margin` past
 * the radius if it gets there before the shot lands (else it keeps fighting), and does not step
 * into a warning; after the shot it walks back to its place as after a chase. From the centre
 * itself it walks away from the caster. `farmers`: farmers at work or idle do it too.
 */
export const DODGE = { on: true, margin: 256, farmers: false };
/**
 * Going for the mage (rule 2): a player's soldier with no order that a cannon shot hits, hold
 * stance and squads too, goes for the mage that fired while its owner sees it (it shows itself
 * when it fires, REVEAL_CAST) and it is within `reach` of the soldier's place; then back to its
 * place. Its mates follow as they fight together (SQUAD, JOIN_FIGHT); hold stance mates stay.
 * The unit column it keeps (avenge) is in the hash only while it is on.
 */
export const AVENGE = { on: true, reach: 8 * CELL };
/**
 * Shooting back on the way (D-095; the user: attack-move is 「路上遇到敵人就打」): a player's
 * soldier on a move, not on hold, with no enemy within AGGRO_RANGE and no squad fight to join,
 * that an enemy unit hit in the last RETARGET_EVERY ticks from within `reach` of it goes for
 * that unit while its owner sees it (a mage shows itself when it fires, REVEAL_CAST) and it is
 * within `leash` of where the soldier was when it turned; then on with the move. Its mates
 * follow as they fight together (SQUAD). Arrows of buildings and shots from soldiers hiding in
 * one do not count, so an army is not drawn among towers (D-081). A retreat never fights. The
 * unit column it keeps (fireBack) is in the hash only while it is on, and so is hitById, which
 * it reads.
 */
export const FIRE_BACK = { on: true, reach: 9 * CELL, leash: 8 * CELL };
/**
 * Cavalry go for the back row (D-097 (c); the user 2026-10-22: 「騎兵自動繞去打後排」): a
 * player's cavalry choosing its own target (idle and aggressive; on a move when it would fight
 * anyway; with its squad, joining a fight, hitting back), not on hold, takes the nearest enemy
 * mage its owner sees within `reach`, else the nearest ranged unit, that it can walk to, within
 * `leash` of its place (on a move: of where it turned) and not within `towerMargin` of the range
 * of an enemy building it knows that shoots. On the way it rides round the enemy melee between
 * it and the target (within `line` of the straight way; those within `scan` either side count as
 * the same block): past the side the block reaches less far out, `margin` beyond its edge and
 * level with its furthest man, on straight open lines only (else the usual way). `giveUpTicks`
 * without landing a hit, it takes the nearest enemy as before and leaves the back row alone for
 * `restTicks`. An attack order, hold stance, a retreat, a garrison or a wall are left as they
 * are; after the dive a move goes on. Its unit columns are in the hash only while it is on.
 */
export const CAV_FLANK = {
  on: true,
  reach: 10 * CELL,
  leash: 12 * CELL,
  towerMargin: CELL,
  line: CELL + (CELL >> 1),
  scan: 5 * CELL,
  margin: 2 * CELL,
  arrive: CELL + (CELL >> 1),
  giveUpTicks: 8 * S,
  restTicks: 5 * S,
};
/**
 * Giving up a place it does not get to (D-095; the client's e2e, after R6-51's ridges): a unit on
 * a move or retreat, with no target, within its formation (no farther from the group's goal cell
 * than its place is, plus DIRECT_STEER), that has not come `progress` (3/8 of a cell) nearer its
 * place than it ever was for `ticks` ticks (3 s), counts as arrived where it stands. Shorter or
 * more, and units crossing a loose formation turned round in place gave up halfway (ranks out of
 * order); less, and the shuttling one still took 530 ticks. A ranged unit whose place was
 * behind a ridge's end walked the group's way round to the goal cell and then shuttled between
 * the way and its place, behind mates already standing, for good. The unit columns it keeps
 * (slotBest, slotIdle) are in the hash only while it is on.
 */
export const SLOT_GIVE_UP = { on: true, ticks: 60, progress: 384 };
/** A formation's ranks (GDD section 9): melee in front (0), then ranged (1), then mages (2). */
export const rank = (t: number) => (t === UnitType.Ranged ? 1 : t === UnitType.Mage ? 2 : t === UnitType.Siege ? 3 : 0);
/**
 * Ranks on the march (D-095; the user: 「常常跑一跑法師就跑到前排」): on a move, a ranged unit or
 * mage more than DIRECT_STEER from its place stands and lets the lower ranks of its group pass
 * (spearmen and cavalry; for a mage, ranged too) while it is not `margin` behind the middle of
 * those of them that walk, along its way to its place; at most `maxWait` ticks a command. Lower
 * ranks that stand do not count, so a front that stopped holds no one up, and once one of the
 * group fights nobody waits. A retreat is left as it is. The unit column it keeps (waited) is in
 * the hash only while it is on. Off for now (ceo 2026-10-21): with orders sent again on the way,
 * soldiers far behind in them, and all at the slowest one's speed, its marches came strung out
 * and lost (README); it is to be redesigned.
 */
export const MARCH_ORDER = { on: false, margin: CELL >> 1, maxWait: 10 * S };
/** The crystal cannon's range (rule 3): `range` while on, CANNON's 8 cells off (CANNON.range reads it). */
export const SHORT_CANNON = { on: true, range: 7 * CELL };
/**
 * Fighting at home (rule 4): a player's soldier within `mainCity` cells (Chebyshev, from the
 * footprint, as arrow towers' land) of its own finished main city, or within the radius of a
 * town it governs, takes `permille` thousandths less damage, hp and shield, rounded down.
 */
export const HOME_GUARD = { on: true, permille: 200, mainCity: 8 };
/**
 * Longer bows (rule 5; the user: "弓兵跟箭塔的視野跟攻擊範圍應該要比較大"): ranged units reach
 * `rangedRange` and see `rangedSight` cells (before: 5 and 7); main cities', the big town's tower's
 * and players' arrow towers' arrows reach `arrowRange` (before 7 cells) and those buildings see
 * `towerSight` cells (before 8): farther than the cannon's 7, so a mage that stands to fire at
 * them is shot. The tables read the switch (their fields are getters, set up below).
 */
export const LONG_BOWS = { on: true, rangedRange: 6 * CELL, rangedSight: 8, arrowRange: 9 * CELL, towerSight: 10 };
/** A table field that reads a round 8 switch: `on()` while the switch is on, else what the table said. */
function switched<T extends object>(table: T, key: keyof T & string, sw: { on: boolean }, on: () => unknown): void {
  const off = table[key];
  Object.defineProperty(table, key, { get: () => (sw.on ? on() : off), enumerable: true, configurable: true });
}
switched(UNITS[UnitType.Ranged], "range", LONG_BOWS, () => LONG_BOWS.rangedRange);
switched(UNITS[UnitType.Ranged], "sight", LONG_BOWS, () => LONG_BOWS.rangedSight);
for (const arrow of [MAIN_ARROW, TOWER_ARROW, ARROW_TOWER, ...KEEP.arrow]) switched(arrow, "range", LONG_BOWS, () => LONG_BOWS.arrowRange);
// D-100: the keep (the big city's tower before) and its arrows, and the bigger towns.
switched(BUILDINGS[BuildingType.Keep], "size", KEEP, () => KEEP.size);
switched(BUILDINGS[BuildingType.Keep], "hp", KEEP, () => KEEP.hp[TownSize.Large]);
switched(TOWER_ARROW, "damage", KEEP, () => KEEP.arrow[TownSize.Large].damage);
for (const type of [BuildingType.MainCity, BuildingType.Keep, BuildingType.ArrowTower]) switched(BUILDINGS[type], "sight", LONG_BOWS, () => LONG_BOWS.towerSight);
/**
 * Arrow towers worth building (rule 6, D-071; the user 2026-10-07: "箭塔太貴傷害又太低根本不可能選"):
 * a player's arrow tower costs `cost` (was wood 100, gold 50: two ranged units' worth for one's
 * firepower), has `hp` (500) and takes `buildTicks` (40 s); its arrow does `damage` (5) every
 * `cooldown` ticks (2 s). Range and sight as LONG_BOWS. The tables read the switch (getters).
 * ceo 2026-10-07: one arrow every 2 s as before, not 1.5 s (30 attackers in close order could no
 * longer take a main city with 2 towers).
 */
export const TOWER_VALUE = { on: true, cost: cost(0, 60, 20), hp: 600, buildTicks: 30 * S, damage: 10, cooldown: 2 * S };
switched(BUILDINGS[BuildingType.ArrowTower], "cost", TOWER_VALUE, () => TOWER_VALUE.cost);
switched(BUILDINGS[BuildingType.ArrowTower], "hp", TOWER_VALUE, () => TOWER_VALUE.hp);
switched(BUILDINGS[BuildingType.ArrowTower], "buildTicks", TOWER_VALUE, () => TOWER_VALUE.buildTicks);
switched(ARROW_TOWER, "damage", TOWER_VALUE, () => TOWER_VALUE.damage);
switched(ARROW_TOWER, "cooldown", TOWER_VALUE, () => TOWER_VALUE.cooldown);

// --- mages (from PR-4) ---------------------------------------------------------------

export const CANNON = {
  damage: 45,
  radius: Math.trunc(1.5 * CELL),
  /** 8 cells; 7 with round 8's SHORT_CANNON on. */
  get range(): number {
    return SHORT_CANNON.on ? SHORT_CANNON.range : 8 * CELL;
  },
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
  /** The big city's tower (while KEEP is off; with it on every town has a keep). */
  tower: boolean;
  /** The walls' distance from the centre (D-100, KEEP on: KEEP.radius). */
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

for (const size of [TownSize.Small, TownSize.Large]) switched(TOWNS[size], "radius", KEEP, () => KEEP.radius[size]);

// D-083: what a governed town and a house add to the population cap while POPULATION_200 is on (getters).
for (const size of [TownSize.Small, TownSize.Large]) switched(TOWNS[size], "populationCap", POPULATION_200, () => POPULATION_200.town[size]);
switched(BUILDINGS[BuildingType.House], "populationCap", POPULATION_200, () => POPULATION_200.house);

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
function townInfo(size: number, map?: { towerSize?: number } & Partial<CastleMap>): TownInfo {
  const t = TOWNS[size];
  // The castle on this map (D-089): the big city's is centred on this map's tower.
  const castles = map?.tower !== undefined && map.towns !== undefined ? (map as CastleMap) : undefined;
  const c = castleOf(size as TownSize, castles);
  const cells = (l: readonly (readonly [number, number])[]) => l.map(([x, y]): [number, number] => [x, y]);
  // Militia posts are offsets from the centre cell, as scenarios.ts places them.
  const posts = (map?.posts ?? FIXED_POSTS).slice(0, t.militia);
  return {
    militia: t.militia, radius: t.radius, plunderTicks: t.plunderTicks, plunder: t.plunder, ruinsTicks: t.ruinsTicks,
    governCost: t.governCost, repairTicks: t.repairTicks, perMinute: governPerMinute(size), populationCap: t.populationCap,
    garrisonNeeded: t.garrisonNeeded, revoltTicks: t.revoltTicks,
    castle: {
      inside: { ...c.inside },
      wall: cells(c.wall),
      corner: cells(c.corner),
      gate: cells(c.gate),
      gates: c.gates.map((g) => cells(g)),
      outside: cells(c.outside),
      behind: cells(c.behind),
      militia: posts.map(([x, y]): [number, number] => [x, y]),
      garrison: cells(c.garrison),
      towerLand: TOWER_REACH.town + 1,
    },
    ...(GATE.on ? { gateHp: GATE.hp[size] } : {}),
    ...(KEEP.on ? { keep: { hp: KEEP.hp[size], size: KEEP.size, arrow: { ...KEEP.arrow[size], extraMax: 0 }, rebuildTicks: KEEP.rebuildTicks } } : {}),
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
/**
 * D-101 (the user 2026-10-22/23: 「其實現在打很容易拖到後期都沒有樹跟金礦可以採」; ceo 2026-10-24/25): more gold
 * and wood. While on: each gold cell `goldCell` (the same cells), and `forests` more forests by each
 * main city, HOME_FOREST cells out (both maps, mirrored); each tree `tree`; the trees more than
 * FAR_TREE cells from both main cities `farTree` each instead (0: as `tree`); with `contested`, gold
 * mines on the axis too (as far from both starts; map.ts, random-map.ts) and gold by the random map's
 * third town on every map (else every other map, as before). The values chosen (ceo 2026-10-25, the
 * scripted player's measurements in PR D-101 wood): trees as before (100: at 150 the aggressive
 * groups won less on random maps), 3 forests a side (the nearest tree 12 cells out at minutes 45 and
 * 60 of long games, against 14-20), no contested gold (with it the push group won 3 of 160 random
 * maps against hard, 7 without, 9 with RICH off). Off: as before.
 */
export const RICH = { on: true, goldCell: 600, tree: 100, farTree: 0, forests: 3, contested: false };
/**
 * D-101 (the user: a market that trades what is left over for what is missing, dearer the more one
 * trades, as in AoE; ceo 2026-10-24): BuildingType.Market and `trade`, food or wood for gold, `lot`
 * units a lot, at most `maxLots` a trade. Each player has its own prices (gold a lot), `start` at
 * first: a lot bought costs the price and puts it up `step` (to `max`); a lot sold pays
 * price * sellPermille / 1000 and puts it down `step` (to `min`); every `recoverTicks` each price
 * moves 1 toward `start`. Crystal is not traded. Off: no market.
 */
export const MARKET = { on: true, lot: 100, start: 100, step: 5, min: 25, max: 300, sellPermille: 700, recoverTicks: 30 * S, maxLots: 5 };
switched(NODE_AMOUNT, "goldCell", RICH, () => RICH.goldCell);
switched(NODE_AMOUNT, "tree", RICH, () => RICH.tree);
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
/**
 * Farmers spread over the depots (D-070; the user 2026-10-07: "生出新的村民請平均派到有糧倉、伐木場、
 * 礦場的地方做開採"). The economy ratio picks the resource as before; then, when the player has
 * finished depots of it (granaries, lumber camps, mines; not the main city), the one with the
 * fewest farmers working near it (whose work's nearest drop-off it is; ties: the first in the
 * owner's canonical frame, then the lower id) gets the farmer, at the free farm or open node
 * nearest that depot within `reach` cells (nodes least crowded as before). A depot with no work
 * within reach is passed over; with none, the farmer goes to the nearest work as before. For
 * every farmer the economy sends (new ones, and those the ratio moves); farmers sent by hand stay.
 */
export const DEPOT_SPREAD = { on: true, reach: 12 };
/**
 * A farmer placed by hand (`stay`) who has waited this long with no new command goes to the economy ratio (D-115; the
 * user 2026-10-31: 「我覺得不要有閒置的居民 還是讓系統自動分配吧」「我是指說偶爾會有我手拉閒置的居民」). With the ratio off,
 * or during recall, it waits as before.
 */
export const STAY_LIMIT = { on: true, ticks: 30 * S };
/** Idle farmers repair own damaged buildings this close (cells, to the footprint). */
export const AUTO_REPAIR_RANGE = 6;
/** At the start each player has explored the disc of this radius (cells) around its spawn and knows its resource nodes. */
export const START_REVEAL = 16;
/** Gathering accumulates per-minute rates each tick; one unit is gathered per this many. */
export const GATHER_UNIT = 60 * S;
