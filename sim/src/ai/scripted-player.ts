// A scripted player that follows a fixed plan, to measure how a person playing one way fares
// against the AI (D-045, D-046; src/scripted-games.ts runs it, the sim workflow reports it). Its
// economy is the AI's (ai.ts: ratio, farmers, one building at a time, training); its military
// part is the plan. Like the AI it sees only its PlayerView and sends ordinary commands.
// War-game-ceo's script, kept as it was measured (docs/briefs/2026-10-scripted-player/).

import { type Frame, fromCanon, rectFromCanon, toCanon } from "../frame.ts";
import { checkPlacement } from "../placement.ts";
import {
  BUILDING_STRIDE,
  BuildingField,
  BuildingType,
  CELL_SHIFT,
  type CommandBody,
  type Cost,
  HeaderField,
  type MapInfo,
  NEUTRAL,
  NODE_STRIDE,
  NodeField,
  NodeKind,
  Order,
  PlaceBit,
  type Rules,
  TOWN_STRIDE,
  TownChoice,
  TownField,
  TownFlag,
  TownSize,
  TownState,
  UNIT_STRIDE,
  UnitField,
  UnitFlag,
  UnitType,
} from "../protocol.ts";
import type { PlayerView } from "../view/view.ts";

/**
 * What the player knows from the start, as the AI does (ai.ts AiKnowledge): the map, the rules, its
 * symmetry frame. On a random map (D-074) that is the screen's MapInfo: its own main city only; it
 * learns the towns and the enemy's main city from its PlayerView, and sends a scout to find them.
 */
export interface PlayerKnowledge {
  map: Pick<MapInfo, "size" | "spawns" | "towns" | "mode">;
  rules: Rules;
  frame: Frame;
}

export interface Plan {
  /** Farmers it trains. */
  farmers: number;
  /** Barracks plus ranges at most. */
  production: number;
  /** Percent spearmen among spearmen and ranged. */
  spearShare: number;
  /** Soldiers before the first trip to the nearest small town (0: never goes). */
  townAt: number;
  choice: "plunder" | "govern";
  /** Goes back to plunder the town every time its ruins have turned neutral again. */
  again: boolean;
  /** Soldiers kept in a governed town. */
  guards: number;
  /** Builds the mage hall as soon as it has the crystal for a mage, before anything else. */
  hallFirst: boolean;
  /** Crystal kept per living mage (for shots) before it trains another. */
  mageReserve: number;
  /** After beating off an attack (6 or more enemy soldiers seen at home), marches on the enemy base with this many. */
  counterAt: number;
  /** Marches on the enemy base with this many whether attacked or not (0: never). */
  pushAt: number;
  /** Farmers sent to the crystal vein by hand once there is a mage hall (0: none); needs the vein explored. */
  vein: number;
  /** Loose formation: 0 nobody, 1 ranged and mages, 2 every soldier. */
  loose: number;
  /** With food and gold piling up (300 or more each) and wood short (under 100): farmers 20/60/20 until that ends. */
  woodBias: boolean;
  /**
   * At the enemy's main city: with this many enemy soldiers or fewer in sight there, everyone
   * attacks the city itself (0: the AI's way, the city only once no defender is in sight).
   */
  focus: number;
  /** Leaves the economy ratio at the game's default (40/35/25) instead of the AI's shifting one; woodBias still applies. */
  staticRatio: boolean;
  /** Never builds a mage hall (to see what the mages are worth to the plan). */
  noMage: boolean;
  /**
   * Never builds a range: spearmen (and mages) only. The mage hall then comes only from
   * hallFirst (the AI's own rule waits for a range), as in ceo's measurement.
   */
  noRange: boolean;
  /**
   * Keeps taking towns, as the user does (round 6, D-054): instead of only the small town
   * nearest home, each town trip goes to the nearest small town that is not ours and not lying
   * in ruins (equally near: the lower id, the AI's rule); the march on the main city is the
   * plan's as before. On a map with one small town it plays exactly as without it.
   */
  corners: boolean;
  /**
   * Leaves the soldiers to automatic training (round 6, D-054): never sends `train` for them,
   * the game's barracks, ranges and mage halls train on their own (scripted-games starts the
   * player's buildings with it on). Farmers are still trained at the main city.
   */
  autoTrain: boolean;
  /**
   * Cavalry raiders, a rush (round 7, D-061; 0: none): builds a stable first (from 6 farmers,
   * once its `requires` stand) and a mine, mines gold from the start, trains only 14 farmers
   * before the first raid and nothing else but mages while the group is short; keeps this many
   * cavalry apart from the army and sends them at the enemy's main city, where its farmers
   * work; they ride home when half of them are down, and go again once the group is full.
   */
  raid: number;
  /**
   * Racing the AI to its main city (D-072; the user beat hard so: "我直接帶三十幾隻兵攻擊電腦主堡，
   * 他的兵比我慢到我的主堡，他的主堡比我早被打爆了"). "" no. Once it sets out the army never comes
   * home to defend and never breaks off; farmers still go inside when the enemy comes (recall).
   * - "edge": the user's way: with `raceAt` soldiers, or at tick `raceBy` with `counterAt` or
   *   more, it sets out beside the small town in the far corner of its own side (canonical
   *   (76, 76), the town at (81, 81)) and up the map's edge (canonical (68, 62), (76, 39)) to the
   *   enemy's main city, whatever the enemy does.
   * - "sentry": a spearman stands 40% of the way to the enemy's main city; once `raceSeen` enemy
   *   soldiers are seen on our half of the map, nearer than the time before, the army sets out
   *   straight for the enemy's main city; with `raceAt` soldiers, or at tick `raceBy`, it sets
   *   out anyway.
   */
  race: "" | "edge" | "sentry";
  raceAt: number;
  raceSeen: number;
  raceBy: number;
  /**
   * The user's economy in the game they beat hard (D-072; ai's replay, d867633): automatic
   * training on, farmers held at `farmers` (16), no gold until the first plunder (food 50 / wood
   * 50, then 40 / 45 / 15), barracks and range early (from 9 and 10 farmers), the mage hall only
   * after a plunder. Set together with `bigTown` by scripted-games' --user-eco.
   */
  userEco: boolean;
  /** The plan's town is the big town, not the small town nearest home (D-072: the user's one trip, plundered). */
  bigTown: boolean;
  /**
   * A tower rush (D-080; 0: none), then the push: once the army reaches pushAt, the whole army
   * and RUSH_BUILDERS farmers walk round the big city (RUSH_WAY) to RUSH_DIST cells from the
   * enemy's main city; there the farmers build an outpost and this many of the spearmen are
   * posted at it; the rest march on the enemy's main city at once, while the farmers put up two
   * arrow towers beside the outpost (toward the enemy). An outpost pulled down before it is
   * finished is put down again, RUSH_TRIES times in all; then the army marches. Fixed map only.
   */
  towerRush: number;
  /**
   * The tower rush with builders only (D-080, ceo 2026-10-09: the AI leaves farmers alone): at the
   * moment the escorted rush would set out, only its farmers go, the same way to the same spot,
   * and build the outpost (nobody posted) and the two towers; the army plays the push as ever.
   * With towerRush 0. Fixed map only.
   */
  rushBuildersOnly: boolean;
  /**
   * "edge" only: the army that set out stops at the second waypoint (canonical (68, 62)) and goes
   * on once a sentry (as "sentry"'s, kept until then) sees the enemy's army coming on our half,
   * or 3 minutes after `raceBy`.
   */
  raceStage: boolean;
}

/**
 * The user's way to the enemy's main city in canonical cells (player 0's), D-072, from ai's replay
 * (d867633): beside the far corner town (81, 81) at 11.5-12 min, then (68, 64) at 13, (76, 39) at 14.
 */
const RACE_EDGE: { u: number; v: number }[] = [
  { u: 76, v: 76 },
  { u: 68, v: 62 },
  { u: 76, v: 39 },
];
/** A race waypoint counts as reached this near (cells). */
const RACE_NEAR = 6;
/**
 * The tower rush (plan.towerRush, D-080), on the fixed map: the escort goes round the big city
 * (its militia and tower) and the far corner town by these canonical cells, and the outpost goes
 * RUSH_DIST cells south of the enemy's main city (canonical, toward the escort's way in).
 */
const RUSH_WAY: { u: number; v: number }[] = [
  { u: 66, v: 74 },
  { u: 76, v: 44 },
];
const RUSH_DIST = 12;
/**
 * The escort is at a waypoint or the spot once its centre is within this many cells of it, or
 * once most of it has stopped within twice that (a big group's formation spreads out), or after
 * RUSH_WAIT ticks.
 */
const RUSH_NEAR = 6;
const RUSH_WAIT = 1800;
/** Farmers that walk with the rush and build the outpost and its towers. */
const RUSH_BUILDERS = 4;
/** The outpost is put down at most this many times; then the rush gives up (hard pulled it down at once, again and again). */
const RUSH_TRIES = 3;
/** Random maps (D-074): the scout's next stop once within this many cells of one, or after SCOUT_STUCK ticks without getting nearer. */
const SCOUT_NEAR = 6;
const SCOUT_STUCK = 600;

interface Unit {
  id: number;
  type: number;
  x: number;
  y: number;
  order: number;
  orderTarget: number;
  flags: number;
}
interface Building {
  id: number;
  type: number;
  x: number;
  y: number;
  progress: number;
  queue: number;
}
interface Town {
  state: number;
  owner: number;
  needed: number;
  timer: number;
  visible: boolean;
  /** Plundered once this game (round 7, TownFlag.Plundered). */
  plundered: boolean;
  x: number;
  y: number;
  size: number;
}
type Mode = "home" | "town" | "base" | "defend" | "race";

/** Builds nothing whose centre is this close to a town's centre (cells), as the AI of round 4 PR A. */
const TOWN_CLEARANCE = 12;
const PRESS_ON_HP = 40;
/**
 * Enemy soldiers this near the main city (cells) count toward a wave the player beats before it
 * counters. 16 missed the attacks its army beat on the way in, so it never countered (D-050).
 */
const WAVE_CELLS = 24;
const GOVERN_COST: Cost[] = [];
GOVERN_COST[TownSize.Small] = { food: 0, wood: 80, gold: 80, crystal: 0 };
GOVERN_COST[TownSize.Large] = { food: 0, wood: 150, gold: 150, crystal: 0 };
/** Ruins last 240 s; a person would go back a little after that. */
const RUINS_TICKS = 240 * 20 + 100;

/**
 * How the player plays (brief 2026-10-core-scripted-player): `push` takes the nearest small town
 * with 6 soldiers (plunders it, and again whenever it is neutral again), builds a mage hall as
 * soon as it has the crystal for a mage, marches on the enemy's main city with 24, breaks off when
 * fewer than 40% of those that set out still stand; with 4 or more enemy soldiers within 16 cells
 * of its main city everyone comes home (farmers inside) and fights there, and after beating off a
 * wave of 6 or more it marches with 14 or more. `defend` the same without marching on its own.
 * `notown` does not go for the town either.
 */
export const STRATEGIES = ["push", "defend", "notown"] as const;
export type Strategy = (typeof STRATEGIES)[number];
/** How fast a hand: `h1` 22 farmers, a barracks and a range; `eco` 30 farmers, up to 6 barracks and ranges, more wood when food and gold pile up. */
export const SPEEDS = ["h1", "eco"] as const;
export type Speed = (typeof SPEEDS)[number];
/** Formation: `close` nobody loose, `shooters` ranged units and mages loose, `all` every soldier loose. */
export const FORMATIONS = ["close", "shooters", "all"] as const;
export type Formation = (typeof FORMATIONS)[number];
/** The player thinks (and so commands) every this many ticks, like a person's pace. */
export const SCRIPTED_THINK_EVERY = 40;

/** The plan for a strategy, a speed and a formation (the values ceo measured with, D-045, D-046). */
export function planFor(strategy: Strategy, speed: Speed, formation: Formation): Plan {
  return {
    farmers: speed === "eco" ? 30 : 22,
    production: speed === "eco" ? 6 : 2,
    spearShare: 50,
    townAt: strategy === "notown" ? 0 : 6,
    choice: "plunder",
    again: true,
    guards: 2,
    hallFirst: true,
    mageReserve: 10,
    counterAt: 14,
    pushAt: strategy === "push" ? 24 : 0,
    vein: 0,
    loose: formation === "all" ? 2 : formation === "shooters" ? 1 : 0,
    woodBias: speed === "eco",
    focus: 0,
    staticRatio: false,
    noMage: false,
    noRange: false,
    corners: false,
    autoTrain: false,
    raid: 0,
    race: "",
    raceAt: 30,
    raceSeen: 12,
    raceBy: 20 * 1200,
    userEco: false,
    bigTown: false,
    raceStage: false,
    towerRush: 0,
    rushBuildersOnly: false,
  };
}

export interface ScriptedPlayer {
  think(view: PlayerView): CommandBody[];
  /**
   * For the measurement: what it is doing. found: when it first saw the enemy's main city (random
   * maps; 0 on the fixed map). rush: when the tower rush set out, its outpost stood, and its
   * second tower was placed (-1: not yet).
   */
  state(): {
    mode: Mode;
    trips: number;
    marches: number;
    waves: number;
    brokenOff: number;
    firstMarch: number;
    raids: number;
    firstRaid: number;
    raced: number;
    found: number;
    rush: { start: number; outpost: number; towers: number };
  };
}

export function createScriptedPlayer(player: number, know: PlayerKnowledge, plan: Plan): ScriptedPlayer {
  const n = know.map.size;
  const random = know.map.mode === "random";
  if (random && plan.race !== "") throw new Error("the race's route is on the fixed map only (D-072)");
  const rushing = plan.towerRush > 0 || plan.rushBuildersOnly;
  if (plan.towerRush > 0 && plan.rushBuildersOnly) throw new Error("the tower rush: escorted (towerRush) or builders only, not both");
  if (random && rushing) throw new Error("the tower rush's route is on the fixed map only (D-080)");
  const home = know.map.spawns.find((s) => s.player === player)!;
  // On a random map the enemy's main city and the towns are known once seen (D-074).
  let enemyHome = know.map.spawns.find((s) => s.player !== player) ?? { cellX: -1, cellY: -1 };
  let found = random ? -1 : 0;
  const known: { id: number; size: TownSize; cellX: number; cellY: number }[] = [...know.map.towns];
  const townOf = (id: number) => known.find((t) => t.id === id)!;
  const rules = know.rules;
  const real = (u: number, v: number) => fromCanon(know.frame, u, v);
  const frame = (x: number, y: number) => toCanon(know.frame, x, y);
  const mid = n >> 1;
  const homeF = frame(home.cellX, home.cellY);
  // Buildings go where the AI puts them (6 cells toward the map centre); the army waits 4 cells
  // from the main city, inside its arrows' range (7).
  const rally = real(homeF.u + Math.sign(mid - homeF.u) * 6, homeF.v + Math.sign(mid - homeF.v) * 6);
  const post = real(homeF.u + Math.sign(mid - homeF.u) * 4, homeF.v + Math.sign(mid - homeF.v) * 4);
  const dist2 = (ax: number, ay: number, bx: number, by: number) => (ax - bx) * (ax - bx) + (ay - by) * (ay - by);
  // The town of the plan: the small town nearest the main city (on a random map, of those seen so far).
  const nearestTown = () =>
    known
      .filter((t) => t.size === (plan.bigTown ? TownSize.Large : TownSize.Small))
      .sort((a, b) => dist2(a.cellX, a.cellY, home.cellX, home.cellY) - dist2(b.cellX, b.cellY, home.cellX, home.cellY) || a.id - b.id)[0] as
      | (typeof known)[number]
      | undefined;
  let myTown = nearestTown();
  // The scout's stops (random maps): round the edge of the map through the other three corners
  // (the middle has the big city's militia and tower), then the centre; after a scout dies, the
  // next one goes round the other way.
  const corner = { right: { u: n - 17, v: n - 18 }, far: { u: n - 18, v: 16 }, up: { u: 16, v: 17 }, centre: { u: n >> 1, v: n >> 1 } };
  const tours = random
    ? [
        [corner.right, corner.far, corner.up, corner.centre],
        [corner.up, corner.far, corner.right, corner.centre],
      ].map((t) => t.map((c) => real(c.u, c.v)))
    : [[], []];
  let tour = 0;
  /** The tower rush (plan.towerRush): its stage, spot, escort and builders, and when each step happened. */
  let rushStage: "" | "go" | "build" | "towers" | "done" = "";
  let rushSpot = { x: 0, y: 0 };
  let rushWay = 0;
  let escort: number[] = [];
  let rushFarmers: number[] = [];
  let rushBuild = -100000;
  let rushTries = 0;
  /** The army that escorted the rush marches on the enemy's main city as soon as the outpost is manned. */
  let rushPush = false;
  const rush = { start: -1, outpost: -1, towers: -1 };
  let scout = -1;
  let scoutStop = 0;
  let scoutSince = 0;
  let scoutBest = Number.MAX_SAFE_INTEGER;
  let scoutMove = -100000;

  let mode: Mode = "home";
  let target = { x: post.x, y: post.y };
  let lastMove = -100000;
  let armyAtStart = 0;
  const marched = new Set<number>();
  let ratioSet = "";
  let recalled = false;
  const garrison = new Map<number, number[]>();
  const lastState = new Map<number, number>();
  let veinCrew: number[] = [];
  let trips = 0;
  let marches = 0;
  let waves = 0;
  let brokenOff = 0;
  let firstMarch = -1;
  let raiding = false;
  let raids = 0;
  let firstRaid = -1;
  let lastRaidMove = -100000;
  /** The race (plan.race): when it set out (-1: not yet), the next waypoint, the sentry, and how near the enemy on our half was last time. */
  let raced = -1;
  let raceStep = 0;
  let sentry = -1;
  let lastSeenNear = Number.MAX_SAFE_INTEGER;
  /** The race goes on from its stop (plan.raceStage): the sentry saw the enemy's army coming, or time. */
  let raceGo = false;
  /** Towns of the plan this player has plundered (plan.userEco's ratio and mage hall wait for one). */
  let plunders = 0;
  const sentryAt =
    plan.race === ""
      ? post
      : real(homeF.u + Math.trunc(((frame(enemyHome.cellX, enemyHome.cellY).u - homeF.u) * 2) / 5), homeF.v + Math.trunc(((frame(enemyHome.cellX, enemyHome.cellY).v - homeF.v) * 2) / 5));
  /** Per small town: the tick from which it may be taken again (ruins turn neutral). */
  const nextTown = new Map<number, number>();
  /** The town of this trip, or of the next one (myTown unless plan.corners). */
  let aim = myTown;
  let waveMax = 0;
  let lastThreat = -100000;
  /** When enemy soldiers were last within WAVE_CELLS of the main city. */
  let lastWave = -100000;
  let counterReady = false;
  let siege = "";
  const loosed = new Set<number>();

  function spotNear(view: PlayerView, type: BuildingType, ax: number, ay: number, radius: number): { x: number; y: number } | null {
    const info = rules.buildings[type];
    const size = info.size;
    const grid = { size: n, cells: view.placement };
    const a = frame(ax, ay);
    let best: { x: number; y: number } | null = null;
    let bestD = 0;
    for (let v = Math.max(1, a.v - radius); v <= Math.min(n - size - 1, a.v + radius); v++) {
      for (let u = Math.max(1, a.u - radius); u <= Math.min(n - size - 1, a.u + radius); u++) {
        const { x, y } = rectFromCanon(know.frame, u, v, size);
        if (checkPlacement(grid, info, x, y) !== 0) continue;
        let ok = true;
        if (type !== BuildingType.Farm) {
          for (let yy = y - 1; yy <= y + size && ok; yy++) {
            for (let xx = x - 1; xx <= x + size && ok; xx++) if ((view.placement[yy * n + xx] & PlaceBit.Blocked) !== 0) ok = false;
          }
        }
        if (!ok) continue;
        const near = (t: { cellX: number; cellY: number }) => {
          const dx = 2 * x + size - 2 * t.cellX - 1;
          const dy = 2 * y + size - 2 * t.cellY - 1;
          return dx * dx + dy * dy <= 4 * TOWN_CLEARANCE * TOWN_CLEARANCE;
        };
        if (known.some(near)) continue;
        const du = 2 * u + size - 2 * a.u;
        const dv = 2 * v + size - 2 * a.v;
        const d = du * du + dv * dv;
        if (best === null || d < bestD) {
          best = { x, y };
          bestD = d;
        }
      }
    }
    return best;
  }

  return {
    state: () => ({ mode, trips, marches, waves, brokenOff, firstMarch, raids, firstRaid, raced, found, rush: { ...rush } }),
    think(view: PlayerView): CommandBody[] {
      const out: CommandBody[] = [];
      const h = view.header;
      const tick = view.tick;
      const res: Cost = { food: h[HeaderField.food], wood: h[HeaderField.wood], gold: h[HeaderField.gold], crystal: h[HeaderField.crystal] };
      const pop = h[HeaderField.population];
      const cap = h[HeaderField.populationCap];
      const reserve: Cost = { food: 0, wood: 0, gold: 0, crystal: 0 };
      const afford = (c: Cost) =>
        res.food - reserve.food >= c.food && res.wood - reserve.wood >= c.wood && res.gold - reserve.gold >= c.gold && res.crystal - reserve.crystal >= c.crystal;
      const affordAll = (c: Cost) => res.food >= c.food && res.wood >= c.wood && res.gold >= c.gold && res.crystal >= c.crystal;
      const spend = (c: Cost) => {
        res.food -= c.food;
        res.wood -= c.wood;
        res.gold -= c.gold;
        res.crystal -= c.crystal;
      };

      // --- read the view ------------------------------------------------------------------
      const mine: Unit[] = [];
      const foes: Unit[] = [];
      for (let r = 0; r < view.units.length; r += UNIT_STRIDE) {
        const u: Unit = {
          id: view.units[r + UnitField.id],
          type: view.units[r + UnitField.type],
          x: view.units[r + UnitField.x] >> CELL_SHIFT,
          y: view.units[r + UnitField.y] >> CELL_SHIFT,
          order: view.units[r + UnitField.order],
          orderTarget: view.units[r + UnitField.orderTarget],
          flags: view.units[r + UnitField.flags],
        };
        const owner = view.units[r + UnitField.owner];
        if (owner === player) mine.push(u);
        else if (owner === 1 - player && u.type !== UnitType.Farmer) foes.push(u);
      }
      const own: Building[] = [];
      let enemyCity = -1;
      let enemyCityHp = -1;
      let queued = 0;
      for (let r = 0; r < view.buildings.length; r += BUILDING_STRIDE) {
        const owner = view.buildings[r + BuildingField.owner];
        const type = view.buildings[r + BuildingField.type];
        if (owner === 1 - player && type === BuildingType.MainCity) {
          enemyCity = view.buildings[r + BuildingField.id];
          enemyCityHp = view.buildings[r + BuildingField.hp];
          if (random) enemyHome = { cellX: view.buildings[r + BuildingField.cellX] + 2, cellY: view.buildings[r + BuildingField.cellY] + 2 };
          if (found < 0) found = tick;
        } else if (owner === 1 - player && found < 0 && type !== BuildingType.ArrowTower) {
          // Random maps: any of its buildings (not a tower, which may stand at a town) shows where the
          // enemy lives; its main city's exact place comes once the army sees it.
          enemyHome = { cellX: view.buildings[r + BuildingField.cellX] + 1, cellY: view.buildings[r + BuildingField.cellY] + 1 };
          found = tick;
        }
        if (owner !== player) continue;
        const b: Building = {
          id: view.buildings[r + BuildingField.id],
          type,
          x: view.buildings[r + BuildingField.cellX],
          y: view.buildings[r + BuildingField.cellY],
          progress: view.buildings[r + BuildingField.progress],
          queue: view.buildings[r + BuildingField.queueLength],
        };
        queued += b.queue;
        own.push(b);
      }
      // Towns explored for the first time (random maps; the fixed map's are all known).
      for (let r = 0; r < view.towns.length; r += TOWN_STRIDE) {
        const id = view.towns[r + TownField.id];
        if (!known.some((t) => t.id === id)) {
          known.push({ id, size: view.towns[r + TownField.size] as TownSize, cellX: view.towns[r + TownField.cellX], cellY: view.towns[r + TownField.cellY] });
        }
      }
      if (random && trips === 0 && mode !== "town") {
        myTown = nearestTown();
        if (!plan.corners) aim = myTown;
      }
      const farmers = mine.filter((u) => u.type === UnitType.Farmer);
      const gatherers = farmers.filter((u) => u.order === Order.Gather).map((u) => u.id);
      const soldiers = mine.filter((u) => u.type !== UnitType.Farmer);
      const has = (t: number) => own.some((b) => b.type === t);
      const done = (t: number) => own.filter((b) => b.type === t && b.progress >= 1000);
      const count = (t: number) => own.filter((b) => b.type === t).length;

      // --- economy (the AI's) -----------------------------------------------------------------
      // A cavalry rush (plan.raid) mines gold from the start: cavalry cost 70 gold each.
      const ratio =
        done(BuildingType.MageHall).length > 0 ? [35, 30, 35] : plan.raid > 0 ? [45, 25, 30] : done(BuildingType.Range).length > 0 ? [40, 35, 25] : [50, 40, 10];
      const stock = [res.food, res.wood, res.gold];
      for (let k = 0; k < 3; k++) {
        if (stock[k] > 400) ratio[k] -= 10;
        else if (stock[k] < 100) ratio[k] += 10;
      }
      const sum = ratio[0] + ratio[1] + ratio[2];
      for (let k = 0; k < 3; k++) ratio[k] = Math.max(5, Math.trunc((ratio[k] * 100) / sum));
      ratio[0] = 100 - ratio[1] - ratio[2];
      if (plan.staticRatio) {
        ratio[0] = 40;
        ratio[1] = 35;
        ratio[2] = 25;
      }
      if (plan.userEco) {
        // The user's ratio (D-072): no gold until the first plunder.
        const r = plunders > 0 ? [40, 45, 15] : [50, 50, 0];
        for (let k = 0; k < 3; k++) ratio[k] = r[k];
      }
      if (plan.woodBias && res.food >= 300 && res.gold >= 300 && res.wood < 100) {
        ratio[0] = 20;
        ratio[1] = 60;
        ratio[2] = 20;
      }
      // Wood for governing (round 7, D-061): a town of ours waiting to be governed, or one the
      // plan goes for that can only be governed (plan.choice govern, or plundered once), and the
      // wood for it short: more farmers on wood, and the wood kept from other spending.
      const plunderOnce = rules.features?.plunderOnce === true;
      let govWood = 0;
      for (let r = 0; r < view.towns.length; r += TOWN_STRIDE) {
        const id = view.towns[r + TownField.id];
        const state = view.towns[r + TownField.state];
        const owner = view.towns[r + TownField.owner];
        const plundered = (view.towns[r + TownField.flags] & TownFlag.Plundered) !== 0;
        const size = townOf(id).size;
        if (plan.choice !== "govern" && !(plunderOnce && plundered)) continue;
        const waiting = owner === player && state === TownState.AwaitingChoice;
        const next = plan.townAt > 0 && state === TownState.Neutral && size === TownSize.Small;
        if (waiting || next) govWood = Math.max(govWood, GOVERN_COST[size].wood);
      }
      if (govWood > 0 && res.wood < govWood) {
        ratio[0] = 20;
        ratio[1] = 60;
        ratio[2] = 20;
      }
      if (govWood > 0) reserve.wood += govWood;
      // The tower rush (plan.towerRush): what its outpost and towers still cost is kept from other spending.
      if (rushing && (rushStage === "go" || rushStage === "build" || rushStage === "towers")) {
        const o = rules.buildings[BuildingType.Outpost].cost;
        const t = rules.buildings[BuildingType.ArrowTower].cost;
        const left = Math.max(0, 2 - own.filter((b) => b.type === BuildingType.ArrowTower).length);
        reserve.wood += (rushStage === "go" ? o.wood : 0) + left * t.wood;
        reserve.gold += (rushStage === "go" ? o.gold : 0) + left * t.gold;
      }
      const ratioKey = ratio.join("/");
      if (ratioKey !== ratioSet) {
        out.push({ c: "eco_ratio", food: ratio[0], wood: ratio[1], gold: ratio[2], on: true });
        ratioSet = ratioKey;
      }
      let room = cap - pop - queued;
      const main = done(BuildingType.MainCity)[0];
      const farmerCost = rules.units[UnitType.Farmer].cost;
      // A cavalry rush (plan.raid) stops at 14 farmers until its first raid has set off.
      const farmerGoal = plan.raid > 0 && raids === 0 ? Math.min(plan.farmers, 14) : plan.farmers;
      if (main && main.queue < 2 && farmers.length + main.queue < farmerGoal && room > 0 && afford(farmerCost)) {
        out.push({ c: "train", building: main.id, type: UnitType.Farmer, n: 1 });
        spend(farmerCost);
        room--;
      }
      const nearestNode = (kind: number): { x: number; y: number; id: number } | null => {
        let best: { x: number; y: number; id: number } | null = null;
        let bestD = 0;
        let bestKey = 0;
        for (let r = 0; r < view.nodes.length; r += NODE_STRIDE) {
          if (view.nodes[r + NodeField.kind] !== kind || view.nodes[r + NodeField.amount] <= 0) continue;
          const x = view.nodes[r + NodeField.cellX];
          const y = view.nodes[r + NodeField.cellY];
          const d = dist2(x, y, home.cellX, home.cellY);
          const f = frame(x, y);
          const key = f.v * n + f.u;
          if (best === null || d < bestD || (d === bestD && key < bestKey)) {
            best = { x, y, id: view.nodes[r + NodeField.id] };
            bestD = d;
            bestKey = key;
          }
        }
        return best;
      };
      for (const site of own.filter((b) => b.progress < 1000)) {
        if (farmers.some((f) => f.order === Order.Build && f.orderTarget === site.id)) continue;
        const crew = gatherers.slice(0, 2);
        if (crew.length > 0) out.push({ c: "repair", u: crew, building: site.id });
        gatherers.splice(0, crew.length);
      }
      const mageCost = rules.units[UnitType.Mage].cost;
      if (!own.some((b) => b.progress < 1000) && gatherers.length >= 3) {
        const plans: { type: BuildingType; at: { x: number; y: number } | null }[] = [];
        const granary = done(BuildingType.Granary)[0];
        const base = { x: home.cellX, y: home.cellY };
        const add = (type: BuildingType, at: { x: number; y: number } | null) => plans.push({ type, at });
        if (!plan.noMage && plan.hallFirst && !has(BuildingType.MageHall) && res.crystal >= mageCost.crystal) add(BuildingType.MageHall, base);
        if (cap < 120 && cap - pop - queued <= 5) add(BuildingType.House, base);
        if (!has(BuildingType.LumberCamp) && farmers.length >= 6) add(BuildingType.LumberCamp, nearestNode(NodeKind.Tree));
        if (!has(BuildingType.Granary) && farmers.length >= 8) add(BuildingType.Granary, base);
        // Raiders (round 7): the stable first, as early as it may go up (its `requires`, if any, before it).
        const stableReady = (rules.buildings[BuildingType.Stable]?.requires ?? []).every((t) => done(t).length > 0);
        if (plan.raid > 0 && rules.features?.cavalry === true && !has(BuildingType.Stable) && stableReady && farmers.length >= 6) add(BuildingType.Stable, rally);
        if (plan.raid > 0 && !has(BuildingType.Mine) && farmers.length >= 8) add(BuildingType.Mine, nearestNode(NodeKind.GoldMine));
        if (!has(BuildingType.Barracks) && farmers.length >= (plan.userEco ? 9 : 10)) add(BuildingType.Barracks, rally);
        if (!plan.noRange && !has(BuildingType.Range) && farmers.length >= (plan.userEco ? 10 : 12)) add(BuildingType.Range, rally);
        const hallTime = plan.userEco ? plunders > 0 : res.crystal >= 40 || tick > 10 * 1200;
        if (!plan.noMage && !has(BuildingType.MageHall) && has(BuildingType.Range) && hallTime) add(BuildingType.MageHall, base);
        if (count(BuildingType.Farm) < Math.min(10, 2 + (farmers.length >> 2))) add(BuildingType.Farm, granary ? { x: granary.x + 1, y: granary.y + 1 } : base);
        if (!has(BuildingType.Mine) && farmers.length >= 14) add(BuildingType.Mine, nearestNode(NodeKind.GoldMine));
        if (res.food + res.wood >= 600 && count(BuildingType.Barracks) + count(BuildingType.Range) < plan.production) {
          add(plan.noRange || count(BuildingType.Barracks) <= count(BuildingType.Range) ? BuildingType.Barracks : BuildingType.Range, rally);
        }
        for (const p of plans) {
          if (p.at === null) continue;
          const spot = spotNear(view, p.type, p.at.x, p.at.y, 12) ?? spotNear(view, p.type, base.x, base.y, 20);
          if (spot === null) continue;
          const cost = rules.buildings[p.type].cost;
          if (!afford(cost)) {
            reserve.food += cost.food;
            reserve.wood += cost.wood;
            reserve.gold += cost.gold;
            reserve.crystal += cost.crystal;
            break;
          }
          const crew = p.type === BuildingType.House || p.type === BuildingType.Farm ? 1 : 2;
          out.push({ c: "build", u: gatherers.slice(0, crew), type: p.type, x: spot.x, y: spot.y });
          spend(cost);
          break;
        }
      }

      // --- army production ----------------------------------------------------------------------
      const spear = soldiers.filter((u) => u.type === UnitType.Spearman).length;
      const ranged = soldiers.filter((u) => u.type === UnitType.Ranged).length;
      const mages = soldiers.filter((u) => u.type === UnitType.Mage).length;
      const trainAt = (t: number, type: UnitType) => {
        if (plan.autoTrain) return;
        for (const b of done(t)) {
          if (b.queue >= 2 || room <= 0 || !afford(rules.units[type].cost)) continue;
          out.push({ c: "train", building: b.id, type, n: 1 });
          spend(rules.units[type].cost);
          room--;
        }
      };
      // Raiders first (round 7): keep the cavalry group full.
      const cavalry = soldiers.filter((u) => u.type === UnitType.Cavalry);
      const stableQueue = done(BuildingType.Stable).reduce((a, b) => a + b.queue, 0);
      // A rush: while the group is short and a stable stands, nothing else is trained (mages aside).
      const raidFirst = plan.raid > 0 && has(BuildingType.Stable) && cavalry.length + stableQueue < plan.raid;
      if (raidFirst) trainAt(BuildingType.Stable, UnitType.Cavalry);
      const hallQueue = done(BuildingType.MageHall).reduce((a, b) => a + b.queue, 0);
      if (mages + hallQueue < rules.mageCap && res.crystal >= mageCost.crystal + plan.mageReserve * mages) trainAt(BuildingType.MageHall, UnitType.Mage);
      if (raidFirst) {
        // Spearmen and ranged wait for the raiders.
      } else if (spear * 100 <= plan.spearShare * (spear + ranged)) {
        trainAt(BuildingType.Barracks, UnitType.Spearman);
        trainAt(BuildingType.Range, UnitType.Ranged);
      } else {
        trainAt(BuildingType.Range, UnitType.Ranged);
        trainAt(BuildingType.Barracks, UnitType.Spearman);
      }
      veinCrew = veinCrew.filter((id) => farmers.some((f) => f.id === id && f.order === Order.Gather));
      const vein = nearestNode(NodeKind.CrystalVein);
      if (vein !== null && has(BuildingType.MageHall) && veinCrew.length < plan.vein) {
        const pick = gatherers.filter((id) => !veinCrew.includes(id)).slice(-(plan.vein - veinCrew.length));
        if (pick.length > 0) {
          out.push({ c: "gather", u: pick, node: vein.id });
          veinCrew.push(...pick);
        }
      }
      const quiet = soldiers.filter((u) => u.type === UnitType.Mage && (u.flags & UnitFlag.Autocast) === 0).map((u) => u.id);
      if (quiet.length > 0) out.push({ c: "autocast", u: quiet, on: true });
      if (plan.loose > 0) {
        const fresh = soldiers.filter((u) => (plan.loose === 2 || u.type === UnitType.Ranged || u.type === UnitType.Mage) && !loosed.has(u.id)).map((u) => u.id);
        if (fresh.length > 0) {
          out.push({ c: "formation", u: fresh, loose: true });
          for (const id of fresh) loosed.add(id);
        }
      }

      // --- towns -----------------------------------------------------------------------------------
      const towns = new Map<number, Town>();
      for (let r = 0; r < view.towns.length; r += TOWN_STRIDE) {
        const id = view.towns[r + TownField.id];
        const t = townOf(id);
        towns.set(id, {
          state: view.towns[r + TownField.state],
          owner: view.towns[r + TownField.owner],
          needed: view.towns[r + TownField.garrisonNeeded],
          timer: view.towns[r + TownField.timer],
          visible: (view.towns[r + TownField.flags] & TownFlag.Visible) !== 0,
          plundered: (view.towns[r + TownField.flags] & TownFlag.Plundered) !== 0,
          x: t.cellX,
          y: t.cellY,
          size: t.size,
        });
      }
      for (const t of known) {
        if (!towns.has(t.id)) towns.set(t.id, { state: TownState.Neutral, owner: NEUTRAL, needed: 0, timer: 0, visible: false, plundered: false, x: t.cellX, y: t.cellY, size: t.size });
      }
      for (const [id, t] of towns) {
        // Ruins (after our plunder or theirs) turn neutral again, with half the militia, when the
        // timer ends: a person reads the timer while there and comes back a little after it.
        const tracked = plan.corners ? t.size === TownSize.Small : id === myTown?.id;
        if (tracked && t.state === TownState.Ruins && t.visible) nextTown.set(id, tick + t.timer + 100);
        else if (tracked && t.state === TownState.Ruins && lastState.get(id) === TownState.Plundering) {
          nextTown.set(id, tick + RUINS_TICKS);
          plunders++;
        }
        lastState.set(id, t.state);
      }
      const isGuard = (id: number) => [...garrison.values()].some((ids) => ids.includes(id));
      for (const [id, t] of towns) {
        const held = t.owner === player && (t.state === TownState.Repairing || t.state === TownState.Governed);
        if (!held) garrison.delete(id);
        if (t.owner !== player || t.state !== TownState.AwaitingChoice) continue;
        const cost = GOVERN_COST[t.size];
        // A town plundered once can only be governed (round 7, Rules.features.plunderOnce): a
        // person governs it, or waits until it can be paid for.
        const once = rules.features?.plunderOnce === true && t.plundered;
        const wantGovern = plan.choice === "govern" || once;
        // Short of the cost: wait for it (round 7; before, the govern plan plundered instead).
        if (wantGovern && !affordAll(cost)) continue;
        const govern = wantGovern;
        out.push({ c: "town_choice", town: id, choice: govern ? TownChoice.Govern : TownChoice.Plunder });
        if (govern) spend(cost);
      }
      for (const [id, t] of towns) {
        const held = t.owner === player && (t.state === TownState.Repairing || t.state === TownState.Governed);
        if (!held) continue;
        const alive = (garrison.get(id) ?? []).filter((gid) => soldiers.some((s) => s.id === gid));
        const free = soldiers
          .filter((s) => !isGuard(s.id) && s.type === UnitType.Spearman && s.id !== scout && !escort.includes(s.id) && s.order !== Order.Post)
          .sort((a, b) => dist2(a.x, a.y, t.x, t.y) - dist2(b.x, b.y, t.x, t.y) || a.id - b.id);
        while (alive.length < Math.max(t.needed, plan.guards) && free.length > 0) alive.push(free.shift()!.id);
        garrison.set(id, alive);
        const away = alive.filter((gid) => {
          const s = soldiers.find((u) => u.id === gid)!;
          return dist2(s.x, s.y, t.x, t.y) > 9;
        });
        if (away.length > 0 && tick % 100 === 0) out.push({ c: "move", u: away, x: t.x, y: t.y });
      }
      // Cavalry raiders (round 7) are kept apart from the army.
      const raiders = plan.raid > 0 ? soldiers.filter((u) => u.type === UnitType.Cavalry && !isGuard(u.id)) : [];
      // --- the tower rush (plan.towerRush or plan.rushBuildersOnly, D-080) -----------------------
      escort = escort.filter((id) => soldiers.some((u) => u.id === id));
      rushFarmers = rushFarmers.filter((id) => farmers.some((f) => f.id === id));
      if (rushing && found >= 0) {
        const outpost = own.find((b) => b.type === BuildingType.Outpost);
        const towers = own.filter((b) => b.type === BuildingType.ArrowTower);
        if (rushStage === "" && done(BuildingType.Barracks).length > 0) {
          const free = soldiers
            .filter((u) => !isGuard(u.id) && !raiders.includes(u) && u.id !== scout && u.id !== sentry && u.order !== Order.Post)
            .sort((a, b) => a.id - b.id);
          const spears = free.filter((u) => u.type === UnitType.Spearman).length;
          if (free.length >= Math.max(plan.pushAt, plan.towerRush) && spears >= plan.towerRush && gatherers.length >= RUSH_BUILDERS + 3) {
            escort = plan.rushBuildersOnly ? [] : free.map((u) => u.id);
            rushFarmers = gatherers.slice(0, RUSH_BUILDERS);
            gatherers.splice(0, rushFarmers.length);
            const e = frame(enemyHome.cellX, enemyHome.cellY);
            rushSpot = real(e.u, e.v + RUSH_DIST);
            const wp = real(RUSH_WAY[0].u, RUSH_WAY[0].v);
            // A move: the escort fights what meets it on the way (on a retreat it was shot down unanswered).
            // Builders only: they walk alone.
            out.push({ c: "move", u: [...escort, ...rushFarmers], x: wp.x, y: wp.y });
            rushWay = 0;
            rushStage = "go";
            rush.start = tick;
          }
        }
        // Who walks there and counts for arriving: the escort, or the builders when they go alone.
        const walkers = plan.rushBuildersOnly ? rushFarmers : escort;
        const walking = (plan.rushBuildersOnly ? farmers : soldiers).filter((u) => walkers.includes(u.id));
        const centre = () => ({
          x: Math.trunc(walking.reduce((a, u) => a + u.x, 0) / walking.length),
          y: Math.trunc(walking.reduce((a, u) => a + u.y, 0) / walking.length),
        });
        if (rushStage === "go" && walking.length === 0) rushStage = "done";
        if (rushStage === "go" && walking.length > 0) {
          const c = centre();
          const stopped = walking.filter((u) => u.order === Order.None).length * 2 >= walking.length;
          const at = (x: number, y: number) => {
            const d = dist2(c.x, c.y, x, y);
            return d <= RUSH_NEAR * RUSH_NEAR || (stopped && d <= 4 * RUSH_NEAR * RUSH_NEAR);
          };
          if (rushWay < RUSH_WAY.length) {
            const wp = real(RUSH_WAY[rushWay].u, RUSH_WAY[rushWay].v);
            if (at(wp.x, wp.y)) {
              rushWay++;
              const next = rushWay < RUSH_WAY.length ? real(RUSH_WAY[rushWay].u, RUSH_WAY[rushWay].v) : rushSpot;
              out.push({ c: "move", u: [...escort, ...rushFarmers], x: next.x, y: next.y });
            }
          } else if (at(rushSpot.x, rushSpot.y) || tick - rush.start >= RUSH_WAIT) {
            // There: the escort stops round the builders and fights within its leash of that place.
            if (escort.length > 0) out.push({ c: "stop", u: escort });
            const cost = rules.buildings[BuildingType.Outpost].cost;
            const spot = spotNear(view, BuildingType.Outpost, rushSpot.x, rushSpot.y, 5);
            const crew = rushFarmers.length > 0 ? rushFarmers : gatherers.slice(0, RUSH_BUILDERS);
            if (spot !== null && crew.length > 0 && affordAll(cost)) {
              out.push({ c: "build", u: crew, type: BuildingType.Outpost, x: spot.x, y: spot.y });
              spend(cost);
              rushFarmers = crew;
              rushBuild = tick;
              rushTries++;
              rushStage = "build";
            }
          }
        }
        if (rushStage === "build") {
          if (outpost !== undefined && outpost.progress >= 1000) {
            const guards = soldiers
              .filter((u) => escort.includes(u.id) && u.type === UnitType.Spearman)
              .slice(0, Math.min(plan.towerRush, rules.outpost?.slots ?? 6))
              .map((u) => u.id);
            if (guards.length > 0) out.push({ c: "post", u: guards, building: outpost.id });
            rush.outpost = tick;
            rushStage = "towers";
          } else if (outpost === undefined && tick - rushBuild >= 600) {
            rushStage = walkers.length > 0 && rushTries < RUSH_TRIES ? "go" : "done";
            rushWay = RUSH_WAY.length;
            // Given up: the escort marches on the enemy.
            if (rushStage === "done" && escort.length > 0) {
              rushPush = true;
              escort = [];
            }
          }
        }
        if (rushStage === "towers") {
          // Both towers at once, beside the outpost toward the enemy's main city, half the builders each.
          const placed = towers.length;
          if (outpost === undefined || placed >= 2 || rushFarmers.length === 0) {
            if (placed >= 2) rush.towers = tick;
            // The escort that is not posted marches on the enemy (builders only: the army is on its own way).
            if (escort.length > 0) rushPush = true;
            escort = [];
            rushStage = "done";
          } else if (!towers.some((b) => b.progress < 1000) || placed === 1) {
            const cost = rules.buildings[BuildingType.ArrowTower].cost;
            const want = 2 - placed;
            for (let k = 0; k < want; k++) {
              const side = k === 0 ? 1 : -1;
              const ax = outpost.x + 1 + Math.sign(enemyHome.cellX - outpost.x) * 3 + side * 2;
              const ay = outpost.y + 1 + Math.sign(enemyHome.cellY - outpost.y) * 3 - side * 2;
              const spot = spotNear(view, BuildingType.ArrowTower, ax, ay, 6);
              const half = rushFarmers.length >> 1;
              const crew = want === 2 ? (k === 0 ? rushFarmers.slice(0, Math.max(1, half)) : rushFarmers.slice(Math.max(1, half))) : rushFarmers;
              if (spot === null || crew.length === 0 || !affordAll(cost)) continue;
              if (towers.some((b) => b.x === spot.x && b.y === spot.y)) continue;
              out.push({ c: "build", u: crew, type: BuildingType.ArrowTower, x: spot.x, y: spot.y });
              spend(cost);
            }
          }
        }
      }
      if (raiders.length > 0) {
        const ids = raiders.map((u) => u.id);
        if (!raiding && raiders.length >= plan.raid) {
          raiding = true;
          raids++;
          if (firstRaid < 0) firstRaid = tick;
          lastRaidMove = -100000;
        }
        if (raiding && raiders.length * 2 <= plan.raid) {
          raiding = false;
          out.push({ c: "retreat", u: ids, x: post.x, y: post.y });
        } else if (raiding && found >= 0 && tick - lastRaidMove >= 400) {
          out.push({ c: "move", u: ids, x: enemyHome.cellX, y: enemyHome.cellY });
          lastRaidMove = tick;
        }
      } else {
        raiding = false;
      }
      // The race's sentry (plan.race "sentry", D-072) stands apart until the army sets out.
      const watching = (plan.race === "sentry" && mode !== "race") || (plan.race === "edge" && plan.raceStage && !raceGo);
      if (watching) {
        if (!soldiers.some((u) => u.id === sentry)) {
          const spears = soldiers.filter((u) => u.type === UnitType.Spearman && !isGuard(u.id) && !raiders.includes(u)).sort((a, b) => a.id - b.id);
          sentry = spears.length >= 2 ? spears[0].id : -1;
        }
        const s = soldiers.find((u) => u.id === sentry);
        if (s !== undefined && dist2(s.x, s.y, sentryAt.x, sentryAt.y) > 4 && tick % 200 === 0) out.push({ c: "move", u: [s.id], x: sentryAt.x, y: sentryAt.y });
      }
      // Random maps: until the enemy's main city is seen, one spearman scouts the corners (D-074).
      if (found < 0) {
        if (!soldiers.some((u) => u.id === scout)) {
          // The last scout died on the way: the next goes round the other way.
          if (scout >= 0) tour = 1 - tour;
          scoutStop = 0;
          const free = soldiers.filter((u) => !isGuard(u.id) && !raiders.includes(u)).sort((a, b) => (a.type === UnitType.Spearman ? 0 : 1) - (b.type === UnitType.Spearman ? 0 : 1) || a.id - b.id);
          scout = free.length > 0 ? free[0].id : -1;
          scoutSince = tick;
          scoutBest = Number.MAX_SAFE_INTEGER;
          scoutMove = -100000;
        }
        const sc = soldiers.find((u) => u.id === scout);
        if (sc !== undefined) {
          const scoutStops = tours[tour];
          const stop = scoutStops[scoutStop % scoutStops.length];
          const d = dist2(sc.x, sc.y, stop.x, stop.y);
          if (d < scoutBest) {
            scoutBest = d;
            scoutSince = tick;
          }
          if (d <= SCOUT_NEAR * SCOUT_NEAR || tick - scoutSince >= SCOUT_STUCK) {
            scoutStop++;
            scoutSince = tick;
            scoutBest = Number.MAX_SAFE_INTEGER;
            scoutMove = -100000;
          }
          const next = scoutStops[scoutStop % scoutStops.length];
          if (tick - scoutMove >= 200) {
            // Retreat, not move: a scout does not stop to fight what it meets on the way (the AI's scout, militia).
            out.push({ c: "retreat", u: [sc.id], x: next.x, y: next.y });
            scoutMove = tick;
          }
        }
      } else {
        scout = -1;
      }
      const army = soldiers.filter(
        (u) => !isGuard(u.id) && !raiders.includes(u) && u.id !== sentry && u.id !== scout && !escort.includes(u.id) && u.order !== Order.Post,
      );
      const armyIds = army.map((u) => u.id);
      const send = (x: number, y: number, why: Mode) => {
        if (armyIds.length === 0) return;
        if (why !== mode || target.x !== x || target.y !== y || tick - lastMove >= 400) {
          out.push({ c: "move", u: armyIds, x, y });
          lastMove = tick;
        }
        mode = why;
        target = { x, y };
      };
      const cx = army.length === 0 ? home.cellX : Math.trunc(army.reduce((a, u) => a + u.x, 0) / army.length);
      const cy = army.length === 0 ? home.cellY : Math.trunc(army.reduce((a, u) => a + u.y, 0) / army.length);

      // --- the race (plan.race, D-072): setting out --------------------------------------------------------
      const setOut = () => {
        const joins = plan.race === "sentry" && sentry >= 0 && soldiers.some((u) => u.id === sentry);
        const ids = joins ? [...armyIds, sentry] : armyIds;
        if (joins) sentry = -1;
        armyAtStart = ids.length;
        marched.clear();
        for (const id of ids) marched.add(id);
        marches++;
        if (firstMarch < 0) firstMarch = tick;
        raced = tick;
        raceStep = plan.race === "edge" ? 0 : RACE_EDGE.length;
        if (ids.length > army.length) out.push({ c: "move", u: ids, x: enemyHome.cellX, y: enemyHome.cellY });
        mode = "race";
        lastMove = -100000;
      };
      if (watching) {
        // Enemy soldiers on our half of the map, nearer than the time before: its army is coming.
        const ourHalf = foes.filter((f) => dist2(f.x, f.y, home.cellX, home.cellY) < dist2(f.x, f.y, enemyHome.cellX, enemyHome.cellY));
        let coming = false;
        if (ourHalf.length >= plan.raceSeen) {
          const fx = Math.trunc(ourHalf.reduce((a, u) => a + u.x, 0) / ourHalf.length);
          const fy = Math.trunc(ourHalf.reduce((a, u) => a + u.y, 0) / ourHalf.length);
          const d = dist2(fx, fy, home.cellX, home.cellY);
          coming = lastSeenNear !== Number.MAX_SAFE_INTEGER && d < lastSeenNear;
          lastSeenNear = d;
        } else {
          lastSeenNear = Number.MAX_SAFE_INTEGER;
        }
        if (plan.race === "sentry") {
          if (coming && army.length >= plan.counterAt) setOut();
          if (raced < 0 && (army.length >= plan.raceAt || (tick >= plan.raceBy && army.length >= plan.counterAt))) setOut();
        } else if (raced >= 0 && (coming || tick >= plan.raceBy + 3 * 1200)) {
          // The staged race goes on, the sentry with it.
          raceGo = true;
          sentry = -1;
        }
      }

      // --- defence: under the main city's arrows, farmers inside ---------------------------------------
      const atHome = foes.filter((f) => dist2(f.x, f.y, home.cellX, home.cellY) <= 16 * 16);
      // On the march and nearer the enemy's main city than our own: a person would press on. Racing,
      // it never comes home (D-072).
      const committed = mode === "race" || (mode === "base" && dist2(cx, cy, enemyHome.cellX, enemyHome.cellY) < dist2(cx, cy, home.cellX, home.cellY));
      // A wave: the most enemy soldiers near the main city at once, wherever the army beat them.
      const near = foes.filter((f) => dist2(f.x, f.y, home.cellX, home.cellY) <= WAVE_CELLS * WAVE_CELLS).length;
      if (near > 0) {
        waveMax = Math.max(waveMax, near);
        lastWave = tick;
      }
      if (atHome.length > 0) {
        lastThreat = tick;
        if (!recalled && atHome.length >= 4) {
          out.push({ c: "recall", on: true });
          recalled = true;
        }
        if (!committed) {
          const close = atHome.filter((f) => dist2(f.x, f.y, home.cellX, home.cellY) <= 10 * 10);
          if (close.length > 0) {
            send(Math.trunc(close.reduce((a, u) => a + u.x, 0) / close.length), Math.trunc(close.reduce((a, u) => a + u.y, 0) / close.length), "defend");
          } else {
            send(post.x, post.y, "defend");
          }
          return out;
        }
      } else {
        if (recalled && tick - lastThreat >= 100) {
          out.push({ c: "recall", on: false });
          recalled = false;
        }
        if (tick - lastWave >= 200 && waveMax > 0) {
          if (waveMax >= 6) {
            counterReady = true;
            waves++;
          }
          waveMax = 0;
        }
        if (mode === "defend") mode = "home";
      }

      // --- the race (plan.race, D-072): the user's way out, then at the enemy's main city ----------------------
      if (plan.race === "edge" && mode !== "race" && (army.length >= plan.raceAt || (tick >= plan.raceBy && army.length >= plan.counterAt))) setOut();
      if (mode === "race") {
        // Where those that set out are (soldiers trained since walk after them and would hold the
        // centre back).
        const front = soldiers.filter((u) => marched.has(u.id));
        const fx = front.length === 0 ? cx : Math.trunc(front.reduce((a, u) => a + u.x, 0) / front.length);
        const fy = front.length === 0 ? cy : Math.trunc(front.reduce((a, u) => a + u.y, 0) / front.length);
        while (raceStep < RACE_EDGE.length) {
          const wp = real(RACE_EDGE[raceStep].u, RACE_EDGE[raceStep].v);
          if (dist2(fx, fy, wp.x, wp.y) > RACE_NEAR * RACE_NEAR) break;
          raceStep++;
        }
        if (plan.raceStage && !raceGo && raceStep >= 2) raceStep = 1;
        if (raceStep < RACE_EDGE.length) {
          const wp = real(RACE_EDGE[raceStep].u, RACE_EDGE[raceStep].v);
          send(wp.x, wp.y, "race");
          return out;
        }
        // At the enemy's main city as a march (defenders first, or the city: plan.focus), but it never
        // breaks off.
        if (enemyCity >= 0 && dist2(fx, fy, enemyHome.cellX, enemyHome.cellY) <= 12 * 12) {
          const near = foes.filter((f) => dist2(f.x, f.y, enemyHome.cellX, enemyHome.cellY) <= 12 * 12).length;
          const want = near > plan.focus ? "move" : "attack";
          if (tick - lastMove >= 200 || (plan.focus > 0 && want !== siege)) {
            if (want === "move") out.push({ c: "move", u: armyIds, x: enemyHome.cellX, y: enemyHome.cellY });
            else out.push({ c: "attack", u: armyIds, target: enemyCity });
            lastMove = tick;
            siege = want;
          }
        } else {
          send(enemyHome.cellX, enemyHome.cellY, "race");
        }
        return out;
      }

      // --- the town of the plan --------------------------------------------------------------------------
      // Keeping on taking towns (plan.corners): between trips, the nearest small town that is not
      // ours and may be taken now; on the way, the one the army set out for.
      const ours = (x: Town) => x.owner === player && x.state !== TownState.Neutral;
      // A town that can only be governed (plan.choice govern, or plundered once, round 7): not
      // worth a trip, nor waiting at, while governing it cannot be paid for.
      const blocked = (x: Town) => (plan.choice === "govern" || (rules.features?.plunderOnce === true && x.plundered)) && !affordAll(GOVERN_COST[x.size]);
      if (plan.corners && mode !== "town") {
        const open = known
          .filter((x) => x.size === TownSize.Small && !ours(towns.get(x.id)!) && !blocked(towns.get(x.id)!) && tick >= (nextTown.get(x.id) ?? 0))
          .sort((a, b) => dist2(a.cellX, a.cellY, home.cellX, home.cellY) - dist2(b.cellX, b.cellY, home.cellX, home.cellY) || a.id - b.id);
        aim = open[0] ?? myTown;
      }
      // No town seen yet (random maps): the army waits at home.
      const t = aim === undefined ? undefined : towns.get(aim.id);
      const oursNow = t !== undefined && ours(t);
      if (t !== undefined && t.owner === player && (t.state === TownState.Plundering || (t.state === TownState.AwaitingChoice && !blocked(t)))) {
        send(t.x, t.y, "town");
        return out;
      }
      if (mode === "town") {
        if (t === undefined || aim === undefined || oursNow || tick < (nextTown.get(aim.id) ?? 0)) mode = "home";
        else if (army.length < 3) {
          // Beaten at the town: back home, and again with the full number.
          out.push({ c: "retreat", u: armyIds, x: post.x, y: post.y });
          lastMove = tick;
          mode = "home";
          target = { x: post.x, y: post.y };
          trips = 0;
          return out;
        } else {
          send(t.x, t.y, "town");
          return out;
        }
      }

      // --- the march on the enemy's main city (the AI's way: together, defenders first) -------------------
      if (mode === "base") {
        const standing = soldiers.filter((u) => marched.has(u.id)).length;
        const cityLow = enemyCityHp >= 0 && enemyCityHp * 100 <= rules.buildings[BuildingType.MainCity].hp * PRESS_ON_HP;
        if (!cityLow && standing * 5 < armyAtStart * 2) {
          out.push({ c: "retreat", u: armyIds, x: post.x, y: post.y });
          lastMove = tick;
          mode = "home";
          target = { x: post.x, y: post.y };
          counterReady = false;
          brokenOff++;
          return out;
        }
        const front = soldiers.filter((u) => marched.has(u.id));
        const fx = front.length === 0 ? cx : Math.trunc(front.reduce((a, u) => a + u.x, 0) / front.length);
        const fy = front.length === 0 ? cy : Math.trunc(front.reduce((a, u) => a + u.y, 0) / front.length);
        const there = dist2(fx, fy, enemyHome.cellX, enemyHome.cellY) <= 12 * 12;
        if (enemyCity >= 0 && there) {
          const near = foes.filter((f) => dist2(f.x, f.y, enemyHome.cellX, enemyHome.cellY) <= 12 * 12).length;
          const want = near > plan.focus ? "move" : "attack";
          if (tick - lastMove >= 200 || (plan.focus > 0 && want !== siege)) {
            if (want === "move") out.push({ c: "move", u: armyIds, x: enemyHome.cellX, y: enemyHome.cellY });
            else out.push({ c: "attack", u: armyIds, target: enemyCity });
            lastMove = tick;
            siege = want;
          }
        } else {
          send(enemyHome.cellX, enemyHome.cellY, "base");
        }
        return out;
      }

      // --- at home: go for the town, march, or wait at the post ---------------------------------------------
      // Random maps: no march before the enemy's main city has been seen.
      const go = found >= 0 && (rushPush || (counterReady && army.length >= plan.counterAt) || (plan.pushAt > 0 && army.length >= plan.pushAt));
      if (go) rushPush = false;
      const townOpen =
        t !== undefined &&
        aim !== undefined &&
        plan.townAt > 0 &&
        !oursNow &&
        !blocked(t) &&
        tick >= (nextTown.get(aim.id) ?? 0) &&
        (trips === 0 || plan.again || plan.choice === "govern");
      if (go) {
        armyAtStart = army.length;
        marched.clear();
        for (const id of armyIds) marched.add(id);
        marches++;
        if (firstMarch < 0) firstMarch = tick;
        send(enemyHome.cellX, enemyHome.cellY, "base");
      } else if (townOpen && army.length >= (trips === 0 ? plan.townAt : Math.min(plan.townAt, 4))) {
        trips++;
        send(t!.x, t!.y, "town");
      } else {
        send(post.x, post.y, "home");
      }
      return out;
    },
  };
}
