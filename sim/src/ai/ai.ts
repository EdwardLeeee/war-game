// The prototype's simple AI (one difficulty). It sees only a PlayerView — never the
// simulation — plus what both players know from the start (the map's spawns and towns,
// the rules tables), and answers with ordinary commands, which go into the log like a
// player's, so a replay needs no AI. Its random choices come from an Rng seeded from the
// game seed and the player, so the same game always plays the same way.
// Imports allowed here: ../protocol.ts, ../placement.ts, ../frame.ts, ../view/view.ts
// (types), ../core/fixed.ts (Rng). test/boundaries.test.ts enforces that.
//
// What it does, every think (AI_THINK_EVERY ticks):
// - economy: keeps the ratio on, trains farmers up to a target, builds one building at a
//   time in a fixed order (houses whenever the population is nearly full);
// - army: keeps the barracks, range and (with crystal) mage hall busy; mages on autocast;
// - defence: pulls the army home when enemies come near the main city, and recalls the
//   farmers when they are outnumbered;
// - towns: once the army is big enough (a per-game random threshold), takes a town and
//   chooses plunder or govern from the situation (money, spare soldiers for the garrison,
//   enemies nearby, time left, a little chance) and its style (GDD section 13: plunderer,
//   governor or balanced); keeps a garrison in governed towns. Against farming one town
//   with plunders, a town it has plundered counts toward governing it next time, and it
//   leaves a town it plundered alone for 6 minutes;
// - crystal: two farmers to the vein (by hand) once there is a mage hall and the vein is known;
// - attack: with enough soldiers, or once the towns are taken, marches on the enemy main city
//   as a group, fights the defenders there before the city, breaks off when those that set out
//   are ground down (reinforcements do not count) and then waits for the full army for the
//   base; it does not give up on an enemy main city that is down to 40% of its hp. In a game with
//   a time limit (AI against AI), counted back from the limit: 8 minutes before it, it takes
//   no more towns and gathers for one assault (goes with 15, or from 6 minutes before with
//   8); in the last 4 minutes the garrisons go too and it no longer goes back to finish a
//   plunder. Without a limit (a person plays) none of that: it also marches once its
//   population is full;
// - difficulty (LEVELS): "easy" holds itself back and gets nothing extra.
//
// Every spatial choice is made in the canonical frame (frame.ts): player 1 on the mirrored
// 1 v 1 map sees the same picture as player 0, ties included.

import { type Frame, fromCanon, rectFromCanon, toCanon } from "../frame.ts";
import { checkPlacement } from "../placement.ts";
import {
  type AiDifficulty,
  BUILDING_STRIDE,
  BuildingField,
  BuildingFlag,
  BuildingType,
  CELL,
  CELL_SHIFT,
  type CommandBody,
  type Cost,
  Fog,
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
  WARNING_STRIDE,
  WarningField,
} from "../protocol.ts";
import { Rng } from "../core/fixed.ts";
import type { PlayerView } from "../view/view.ts";

export interface Ai {
  /** The style this AI plays (GDD section 13). */
  style: AiStyle;
  think(view: PlayerView): CommandBody[];
}

/** What every player knows from the start (the `ready` message), and its symmetry frame. */
export interface AiKnowledge {
  map: Pick<MapInfo, "size" | "spawns" | "towns">;
  rules: Rules;
  frame: Frame;
  /**
   * The game's time limit in ticks, 0 = none (a game a person plays, D-024). The end-of-game
   * rules (the assault) only apply with a limit, counted back from it.
   */
  maxTicks: number;
  /** How this AI plays (absent: "normal"). */
  difficulty?: AiDifficulty;
  /** Hard only: numbers that replace HARD's (tests and measurements). */
  hard?: Partial<HardPlan>;
}

/**
 * What each difficulty does (GDD section 13). "normal" is the AI of the first play test;
 * "easy" only holds itself back: fewer farmers, one barracks and one range, no farmers on
 * the crystal vein, and it waits longer before its first town and its first march on the
 * enemy base, with fewer soldiers. Nothing is ever added. Both draw the same random numbers,
 * so "normal" plays exactly as before.
 */
interface Level {
  /** Farmers it trains: base + a random 0..span-1 (per game). */
  farmers: [number, number];
  /** Barracks plus ranges at most (the plan adds more when food and wood pile up). */
  production: number;
  /** Farmers on the crystal vein once there is a mage hall. */
  veinCrew: number;
  /** Soldiers that set off for a town, the earliest game minute of that, and of a second trip. */
  townArmy: [number, number];
  townMinute: number;
  secondTownMinute: number;
  /** Soldiers that march on the enemy base, and the earliest game minute of that. */
  baseArmy: [number, number];
  baseMinute: number;
  /** Most soldiers outside garrisons (with those in training) from each game minute on; none: no limit. */
  armyCap: [number, number][];
}
const LEVELS: Record<Exclude<AiDifficulty, "hard">, Level> = {
  normal: { farmers: [28, 9], production: 6, veinCrew: 2, townArmy: [10, 8], townMinute: 0, secondTownMinute: 0, baseArmy: [26, 12], baseMinute: 0, armyCap: [] },
  easy: {
    farmers: [18, 5],
    production: 2,
    veinCrew: 0,
    townArmy: [8, 4],
    // The player needs about 18 game minutes for a first town (D-024: 12 real minutes at
    // normal speed): easy goes for the small town from minute 18 and leaves the big one
    // alone until minute 24 (ceo 2026-10-01).
    townMinute: 18,
    secondTownMinute: 24,
    baseArmy: [10, 3],
    baseMinute: 20,
    // Without a cap its two buildings bank soldiers while it waits (41 at its first town in
    // the first measurement, 67 at its first march on the base).
    armyCap: [[0, 8], [15, 12], [25, 16]],
  },
};

/** GDD section 13: plunderer, governor, balanced. It only shifts the plunder-or-govern choice. */
export const AI_STYLES = ["plunder", "govern", "balanced"] as const;
export type AiStyle = (typeof AI_STYLES)[number];
const STYLE_BIAS: Record<AiStyle, number> = { plunder: -3, govern: 3, balanced: 0 };

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
  x: number;
  y: number;
  size: number;
}

type Mode = "gather" | "town" | "base" | "defend";

const TICKS_PER_MINUTE = 1200;
// The end of a game with a time limit, counted back from the limit (in a 30-minute game these
// are minutes 20, 22, 24 and 26). A game without a limit has none of it.
/** From here the army it takes to march on the enemy base shrinks by 3 a minute. */
const LATE_TO_GO = 10 * TICKS_PER_MINUTE;
/** From here no new town expeditions: the army gathers for one assault on the enemy main city. */
const ASSAULT_TO_GO = 8 * TICKS_PER_MINUTE;
/** It sets off with this many (in round 9, 15-19 attackers took the city 76% of the time). */
const ASSAULT_ARMY = 15;
/** From here it sets off with ENDGAME_ARMY, so it arrives with minutes to spare. */
const LATEST_TO_GO = 6 * TICKS_PER_MINUTE;
/** From here the garrisons join, it no longer finishes plunders, and goes and stays with ENDGAME_ARMY or more. */
const ENDGAME_TO_GO = 4 * TICKS_PER_MINUTE;
const ENDGAME_ARMY = 8;
/** Without a time limit it also marches when its population is full (it cannot grow any more). */
const FULL_MARGIN = 2;
/** An enemy main city at or below this share of its hp (percent) is not given up on. */
const PRESS_ON_HP = 40;
/** Govern costs (GDD appendix A), for the choice. */
const GOVERN_COST: Cost[] = [];
GOVERN_COST[TownSize.Small] = { food: 0, wood: 80, gold: 80, crystal: 0 };
GOVERN_COST[TownSize.Large] = { food: 0, wood: 150, gold: 150, crystal: 0 };

/**
 * The AI for `player`. Its random choices come from (seed, slot); slot defaults to the
 * player, and swapping slots between the two players lets a tournament play the same pair
 * of AIs from both spawns. Without a `style`, the style is drawn at random (each game).
 */
export function createAi(player: number, seed: number, know: AiKnowledge, slot = player, style?: AiStyle): Ai {
  // Hard is its own AI below; nothing in this function changes for easy and normal.
  if (know.difficulty === "hard") return createHardAi(player, seed, know, slot);
  const rng = new Rng((seed ^ Math.imul(slot + 1, 0x9e3779b1)) >>> 0 || 1);
  const drawn = rng.below(AI_STYLES.length);
  const myStyle: AiStyle = style ?? AI_STYLES[drawn];
  const n = know.map.size;
  const home = know.map.spawns[player];
  const enemyHome = know.map.spawns[1 - player];
  const rules = know.rules;
  // Every spatial choice is made in player 0's frame: player 1 mirrors coordinates (x <-> y)
  // first, so on the mirror-symmetric map both sides make mirror-image choices, ties included.
  const real = (u: number, v: number) => fromCanon(know.frame, u, v);
  const frame = (x: number, y: number) => toCanon(know.frame, x, y);
  // Per-game style (from the personality's Rng): farmers, army mix, when to go out.
  const level = LEVELS[know.difficulty ?? "normal"];
  const farmerTarget = level.farmers[0] + rng.below(level.farmers[1]);
  const spearShare = 35 + rng.below(31);
  const townArmy = level.townArmy[0] + rng.below(level.townArmy[1]);
  const baseArmy = level.baseArmy[0] + rng.below(level.baseArmy[1]);
  // A gathering point about 6 cells from the main city toward the map centre, jittered.
  const mid = n >> 1;
  const homeF = frame(home.cellX, home.cellY);
  const rally = real(
    homeF.u + Math.sign(mid - homeF.u) * 6 + rng.below(3) - 1,
    homeF.v + Math.sign(mid - homeF.v) * 6 + rng.below(3) - 1,
  );

  let mode: Mode = "gather";
  let target = { x: rally.x, y: rally.y };
  let targetTown = -1;
  let lastMove = -100000;
  let armyAtStart = 0;
  /** The soldiers that set out on the current expedition (reinforcements are not counted). */
  const marched = new Set<number>();
  /**
   * An attack on the enemy base was broken off: from then on it goes again only with the full
   * army for the base (baseNeed), not with the smaller one it may take once the towns are done.
   */
  let baseBroken = false;
  /** Town expeditions started (the difficulty may wait before the second). */
  let townTrips = 0;
  let ratioSet = "";
  let recalled = false;
  /** Soldier ids kept as the garrison of a governed or repairing town, per town. */
  const garrison = new Map<number, number[]>();
  /** Towns this AI has plundered: how often, and when last (it prefers governing a town it keeps coming back to). */
  const plunders = new Map<number, { count: number; tick: number }>();
  const lastState = new Map<number, number>();
  /** Farmers sent to the crystal vein. */
  let veinCrew: number[] = [];
  /** Enemy soldiers seen at each think in the last 2 minutes (for weighing up a fight). */
  const enemySeen: { tick: number; count: number }[] = [];
  // Round 7 (D-061), normal only: cavalry once it has seen enemy ranged units or mages, and
  // ranged units and mages hiding in the main city while enemies are near it.
  const extras = (know.difficulty ?? "normal") === "normal";
  const useCavalry = extras && know.rules.features?.cavalry === true;
  const hide = extras && know.rules.features?.garrison === true;
  let sawShooters = false;
  let lastHomeThreat = -100000;

  const dist2 = (ax: number, ay: number, bx: number, by: number) => (ax - bx) * (ax - bx) + (ay - by) * (ay - by);

  /**
   * Nearest spot to (ax, ay) where `type` fits, with a free ring around it (farms may touch).
   * Searched in player 0's frame, so ties resolve the mirror-image way for player 1.
   */
  function spotNear(view: PlayerView, type: BuildingType, ax: number, ay: number, radius: number): { x: number; y: number } | null {
    const info = rules.buildings[type];
    const size = info.size;
    const grid = { size: n, cells: view.placement };
    const a = frame(ax, ay);
    let best: { x: number; y: number } | null = null;
    let bestD = 0;
    for (let v = Math.max(1, a.v - radius); v <= Math.min(n - size - 1, a.v + radius); v++) {
      for (let u = Math.max(1, a.u - radius); u <= Math.min(n - size - 1, a.u + radius); u++) {
        // The real footprint whose canonical image is the square at (u, v).
        const { x, y } = rectFromCanon(know.frame, u, v, size);
        if (checkPlacement(grid, info, x, y) !== 0) continue;
        let ok = true;
        if (type !== BuildingType.Farm) {
          for (let yy = y - 1; yy <= y + size && ok; yy++) {
            for (let xx = x - 1; xx <= x + size && ok; xx++) if ((view.placement[yy * n + xx] & PlaceBit.Blocked) !== 0) ok = false;
          }
        }
        if (!ok) continue;
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
    style: myStyle,
    think(view: PlayerView): CommandBody[] {
      const out: CommandBody[] = [];
      const h = view.header;
      const tick = view.tick;
      // Ticks to the time limit, or -1 without one.
      const toGo = know.maxTicks > 0 ? know.maxTicks - tick : -1;
      const res: Cost = { food: h[HeaderField.food], wood: h[HeaderField.wood], gold: h[HeaderField.gold], crystal: h[HeaderField.crystal] };
      const pop = h[HeaderField.population];
      const cap = h[HeaderField.populationCap];
      // Round 7 (D-061): each switch off, everything below plays as before.
      const feat = know.rules.features;
      const once = feat?.plunderOnce === true;
      /** Plundered already this game (TownFlag.Plundered): with `once` it can only be governed. */
      const plundered = (id: number) => {
        for (let r = 0; r < view.towns.length; r += TOWN_STRIDE) if (view.towns[r + TownField.id] === id) return (view.towns[r + TownField.flags] & TownFlag.Plundered) !== 0;
        return false;
      };
      // On the way to a town it may govern, it keeps the governing cost aside (D4: the choice
      // is made the tick the town falls, so the money has to be there).
      const aimTown =
        mode === "town" && targetTown >= 0 && (myStyle !== "plunder" || (once && plundered(targetTown))) ? know.map.towns[targetTown] : undefined;
      const reserve: Cost = aimTown !== undefined ? { ...GOVERN_COST[aimTown.size] } : { food: 0, wood: 0, gold: 0, crystal: 0 };
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
      const farmers = mine.filter((u) => u.type === UnitType.Farmer);
      const gatherers = farmers.filter((u) => u.order === Order.Gather).map((u) => u.id);
      const soldiers = mine.filter((u) => u.type !== UnitType.Farmer);
      const has = (t: number) => own.some((b) => b.type === t);
      const done = (t: number) => own.filter((b) => b.type === t && b.progress >= 1000);
      const count = (t: number) => own.filter((b) => b.type === t).length;

      // --- economy --------------------------------------------------------------------------
      // Gold matters once there is something to spend it on (ranged, then mages); then the
      // shares lean away from what is piling up and toward what is short.
      const ratio = done(BuildingType.MageHall).length > 0 ? [35, 30, 35] : done(BuildingType.Range).length > 0 ? [40, 35, 25] : [50, 40, 10];
      const stock = [res.food, res.wood, res.gold];
      for (let k = 0; k < 3; k++) {
        if (stock[k] > 400) ratio[k] -= 10;
        else if (stock[k] < 100) ratio[k] += 10;
      }
      const sum = ratio[0] + ratio[1] + ratio[2];
      for (let k = 0; k < 3; k++) ratio[k] = Math.max(5, Math.trunc((ratio[k] * 100) / sum));
      ratio[0] = 100 - ratio[1] - ratio[2];
      // The ratio moves farmers already at work too (D-050). Within one farmer of a share
      // nobody moves, so a ratio that changes often does not send farmers back and forth; a
      // 30 s limit on changing it was tried and made the normal AI stronger (sim/README.md).
      const ratioKey = ratio.join("/");
      if (ratioKey !== ratioSet) {
        out.push({ c: "eco_ratio", food: ratio[0], wood: ratio[1], gold: ratio[2], on: true });
        ratioSet = ratioKey;
      }
      let room = cap - pop - queued;
      const main = done(BuildingType.MainCity)[0];
      const farmerCost = rules.units[UnitType.Farmer].cost;
      if (main && main.queue < 2 && farmers.length + main.queue < farmerTarget && room > 0 && afford(farmerCost)) {
        out.push({ c: "train", building: main.id, type: UnitType.Farmer, n: 1 });
        spend(farmerCost);
        room--;
      }

      /** Nearest known node of a kind to the main city (ties: player 0's frame order); its id too. */
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

      // A building site nobody is working on (its builders were killed or called away) gets
      // two gatherers; otherwise one unfinished site would stop all building for good.
      for (const site of own.filter((b) => b.progress < 1000)) {
        if (farmers.some((f) => f.order === Order.Build && f.orderTarget === site.id)) continue;
        const crew = gatherers.slice(0, 2);
        if (crew.length > 0) out.push({ c: "repair", u: crew, building: site.id });
        gatherers.splice(0, crew.length);
      }

      // One building at a time: the first plan in priority order that has room somewhere
      // (near its spot, else anywhere near the base); if that one cannot be paid for yet, it
      // saves up for it rather than building something further down the list.
      if (!own.some((b) => b.progress < 1000) && gatherers.length >= 3) {
        const plans: { type: BuildingType; at: { x: number; y: number } | null }[] = [];
        const granary = done(BuildingType.Granary)[0];
        const base = { x: home.cellX, y: home.cellY };
        const add = (type: BuildingType, at: { x: number; y: number } | null) => plans.push({ type, at });
        if (cap < 120 && cap - pop - queued <= 5) add(BuildingType.House, base);
        if (!has(BuildingType.LumberCamp) && farmers.length >= 6) add(BuildingType.LumberCamp, nearestNode(NodeKind.Tree));
        if (!has(BuildingType.Granary) && farmers.length >= 8) add(BuildingType.Granary, base);
        if (!has(BuildingType.Barracks) && farmers.length >= 10) add(BuildingType.Barracks, rally);
        if (!has(BuildingType.Range) && farmers.length >= 12) add(BuildingType.Range, rally);
        if (!has(BuildingType.MageHall) && has(BuildingType.Range) && (res.crystal >= 40 || tick > 10 * TICKS_PER_MINUTE)) add(BuildingType.MageHall, base);
        if (useCavalry && sawShooters && !has(BuildingType.Stable) && (rules.buildings[BuildingType.Stable].requires ?? []).every((t) => done(t).length > 0)) {
          add(BuildingType.Stable, rally);
        }
        if (count(BuildingType.Farm) < Math.min(10, 2 + (farmers.length >> 2))) add(BuildingType.Farm, granary ? { x: granary.x + 1, y: granary.y + 1 } : base);
        if (!has(BuildingType.Mine) && farmers.length >= 14) add(BuildingType.Mine, nearestNode(NodeKind.GoldMine));
        // Spare food and wood: more places to train (one building trains one unit at a time).
        if (res.food + res.wood >= 600 && count(BuildingType.Barracks) + count(BuildingType.Range) < level.production) {
          add(count(BuildingType.Barracks) <= count(BuildingType.Range) ? BuildingType.Barracks : BuildingType.Range, rally);
        }
        for (const plan of plans) {
          if (plan.at === null) continue;
          const spot = spotNear(view, plan.type, plan.at.x, plan.at.y, 12) ?? spotNear(view, plan.type, base.x, base.y, 20);
          if (spot === null) continue;
          const cost = rules.buildings[plan.type].cost;
          if (!afford(cost)) {
            // Save up: training below must leave this much alone.
            reserve.food += cost.food;
            reserve.wood += cost.wood;
            reserve.gold += cost.gold;
            reserve.crystal += cost.crystal;
            break;
          }
          const crew = plan.type === BuildingType.House || plan.type === BuildingType.Farm ? 1 : 2;
          out.push({ c: "build", u: gatherers.slice(0, crew), type: plan.type, x: spot.x, y: spot.y });
          spend(rules.buildings[plan.type].cost);
          break;
        }
      }

      // --- army production --------------------------------------------------------------------
      // The difficulty's cap on soldiers (those in training count too).
      let armyCap = Infinity;
      for (const [minute, most] of level.armyCap) if (tick >= minute * TICKS_PER_MINUTE) armyCap = most;
      const training = own.filter((b) => b.type === BuildingType.Barracks || b.type === BuildingType.Range || b.type === BuildingType.MageHall).reduce((a, b) => a + b.queue, 0);
      // Garrisons do not count: they keep the towns, not the field army.
      const guarding = [...garrison.values()].reduce((a, ids) => a + ids.filter((id) => soldiers.some((u) => u.id === id)).length, 0);
      let armyRoom = armyCap - (soldiers.length - guarding) - training;
      const spear = soldiers.filter((u) => u.type === UnitType.Spearman).length;
      const ranged = soldiers.filter((u) => u.type === UnitType.Ranged).length;
      const mages = soldiers.filter((u) => u.type === UnitType.Mage).length;
      const trainAt = (t: number, type: UnitType) => {
        for (const b of done(t)) {
          if (b.queue >= 2 || room <= 0 || armyRoom <= 0 || !afford(rules.units[type].cost)) continue;
          out.push({ c: "train", building: b.id, type, n: 1 });
          spend(rules.units[type].cost);
          room--;
          armyRoom--;
        }
      };
      if (mages < rules.mageCap && res.crystal >= rules.units[UnitType.Mage].cost.crystal) trainAt(BuildingType.MageHall, UnitType.Mage);
      // About one soldier in four a horseman, once it has a stable (round 7).
      if (useCavalry) {
        if (foes.some((u) => u.type === UnitType.Ranged || u.type === UnitType.Mage)) sawShooters = true;
        const cavalry = soldiers.filter((u) => u.type === UnitType.Cavalry).length;
        if (cavalry * 4 < spear + ranged + cavalry + 1) trainAt(BuildingType.Stable, UnitType.Cavalry);
      }
      if (spear * 100 <= spearShare * (spear + ranged)) {
        trainAt(BuildingType.Barracks, UnitType.Spearman);
        trainAt(BuildingType.Range, UnitType.Ranged);
      } else {
        trainAt(BuildingType.Range, UnitType.Ranged);
        trainAt(BuildingType.Barracks, UnitType.Spearman);
      }
      // Crystal: once there is a mage hall and the vein is known, two farmers go there (by hand).
      veinCrew = veinCrew.filter((id) => farmers.some((f) => f.id === id && f.order === Order.Gather));
      const vein = nearestNode(NodeKind.CrystalVein);
      if (vein !== null && has(BuildingType.MageHall) && veinCrew.length < level.veinCrew) {
        const pick = gatherers.filter((id) => !veinCrew.includes(id)).slice(-(level.veinCrew - veinCrew.length));
        if (pick.length > 0) {
          out.push({ c: "gather", u: pick, node: vein.id });
          veinCrew.push(...pick);
        }
      }
      const quiet = soldiers.filter((u) => u.type === UnitType.Mage && (u.flags & UnitFlag.Autocast) === 0).map((u) => u.id);
      if (quiet.length > 0) out.push({ c: "autocast", u: quiet, on: true });

      // --- towns: choose, and keep garrisons ----------------------------------------------------
      const towns = new Map<number, Town>();
      for (let r = 0; r < view.towns.length; r += TOWN_STRIDE) {
        const id = view.towns[r + TownField.id];
        const t = know.map.towns[id];
        towns.set(id, {
          state: view.towns[r + TownField.state],
          owner: view.towns[r + TownField.owner],
          needed: view.towns[r + TownField.garrisonNeeded],
          x: t.cellX,
          y: t.cellY,
          size: t.size,
        });
      }
      // Towns not explored yet: their places are map knowledge; assume them neutral.
      for (const t of know.map.towns) {
        if (!towns.has(t.id)) towns.set(t.id, { state: TownState.Neutral, owner: NEUTRAL, needed: 0, x: t.cellX, y: t.cellY, size: t.size });
      }
      for (const [id, t] of towns) {
        if (t.state === TownState.Ruins && lastState.get(id) === TownState.Plundering) {
          const p = plunders.get(id) ?? { count: 0, tick };
          plunders.set(id, { count: p.count + 1, tick });
        }
        lastState.set(id, t.state);
      }
      const foesNear = (x: number, y: number, r: number) => foes.filter((f) => dist2(f.x, f.y, x, y) <= r * r).length;
      const isGuard = (id: number) => [...garrison.values()].some((ids) => ids.includes(id));
      for (const [id, t] of towns) {
        const held = t.owner === player && (t.state === TownState.Repairing || t.state === TownState.Governed);
        if (!held) garrison.delete(id);
        if (t.owner !== player || t.state !== TownState.AwaitingChoice) continue;
        // Govern when it can be paid for, held and paid back in time; otherwise plunder.
        const cost = GOVERN_COST[t.size];
        if (once && plundered(id)) {
          // Plundered before (round 7): it can only be governed, so it waits until it can pay.
          if (affordAll(cost)) {
            out.push({ c: "town_choice", town: id, choice: TownChoice.Govern });
            spend(cost);
          }
          continue;
        }
        const spare = soldiers.filter((s) => !isGuard(s.id)).length;
        let score = rng.below(3) - 1;
        if (affordAll(cost)) score += 2;
        if (spare >= t.needed + 6) score += 2;
        if (foesNear(t.x, t.y, 14) >= 3) score -= 3;
        if (tick < 15 * TICKS_PER_MINUTE) score += 1;
        // Too close to the time limit to pay governing back.
        if (toGo >= 0 && toGo < LATEST_TO_GO) score -= 3;
        // A town already plundered is better kept this time; and the style leans one way.
        score += 2 * (plunders.get(id)?.count ?? 0) + STYLE_BIAS[myStyle];
        const govern = score >= 3 && affordAll(cost);
        out.push({ c: "town_choice", town: id, choice: govern ? TownChoice.Govern : TownChoice.Plunder });
        if (govern) spend(cost);
      }
      // The clock: the end-of-game rules count back from the time limit, if there is one.
      const endgame = toGo >= 0 && toGo <= ENDGAME_TO_GO;
      // Garrisons: the soldiers nearest each held town (not mages), topped up as they fall;
      // in the endgame they join the assault.
      if (endgame) garrison.clear();
      for (const [id, t] of towns) {
        const held = t.owner === player && (t.state === TownState.Repairing || t.state === TownState.Governed);
        if (!held || endgame) continue;
        const alive = (garrison.get(id) ?? []).filter((gid) => soldiers.some((s) => s.id === gid));
        const free = soldiers
          .filter((s) => !isGuard(s.id) && s.type !== UnitType.Mage && s.order !== Order.Garrison)
          .sort((a, b) => dist2(a.x, a.y, t.x, t.y) - dist2(b.x, b.y, t.x, t.y) || a.id - b.id);
        while (alive.length < t.needed + 1 && free.length > 0) alive.push(free.shift()!.id);
        garrison.set(id, alive);
        const away = alive.filter((gid) => {
          const s = soldiers.find((u) => u.id === gid)!;
          return dist2(s.x, s.y, t.x, t.y) > 9;
        });
        if (away.length > 0 && tick % 100 === 0) out.push({ c: "move", u: away, x: t.x, y: t.y });
      }
      const army = soldiers.filter((u) => !isGuard(u.id));
      // Soldiers hiding in a building (round 7) are left out of orders: a move would bring them out.
      const armyIds = army.filter((u) => u.order !== Order.Garrison).map((u) => u.id);

      // --- defence, towns and attack --------------------------------------------------------------
      const threat = foesNear(home.cellX, home.cellY, 16);
      const send = (x: number, y: number, why: Mode) => {
        if (armyIds.length === 0) return;
        if (why !== mode || target.x !== x || target.y !== y || tick - lastMove >= 400) {
          out.push({ c: "move", u: armyIds, x, y });
          lastMove = tick;
        }
        mode = why;
        target = { x, y };
      };
      if (threat > 0) {
        lastHomeThreat = tick;
        const near = foes.filter((u) => dist2(u.x, u.y, home.cellX, home.cellY) <= 256);
        const cx = Math.trunc(near.reduce((a, u) => a + u.x, 0) / near.length);
        const cy = Math.trunc(near.reduce((a, u) => a + u.y, 0) / near.length);
        // Normal (round 7): ranged units and mages at home hide in the main city and shoot from it.
        const hiders: number[] = [];
        if (hide && main) {
          const holds = rules.buildings[BuildingType.MainCity].holds ?? 0;
          const used = soldiers.filter((u) => u.order === Order.Garrison && u.orderTarget === main.id).length;
          const types = rules.garrisonTypes ?? [];
          const pick = army
            .filter((u) => types.includes(u.type as UnitType) && u.order !== Order.Garrison && dist2(u.x, u.y, home.cellX, home.cellY) <= 400)
            .sort((a, b) => dist2(a.x, a.y, home.cellX, home.cellY) - dist2(b.x, b.y, home.cellX, home.cellY) || a.id - b.id)
            .slice(0, Math.max(0, holds - used));
          for (const u of pick) hiders.push(u.id);
          if (hiders.length > 0) {
            const keep = armyIds.filter((id) => !hiders.includes(id));
            armyIds.length = 0;
            armyIds.push(...keep);
          }
        }
        send(cx, cy, "defend");
        if (hiders.length > 0) out.push({ c: "garrison", u: hiders, building: main!.id });
        // Farmers hide when the raid outnumbers the soldiers at home.
        const defenders = army.filter((u) => dist2(u.x, u.y, home.cellX, home.cellY) <= 400).length;
        if (!recalled && threat >= 4 && defenders < threat) {
          out.push({ c: "recall", on: true });
          recalled = true;
        }
        return out;
      }
      if (recalled) {
        out.push({ c: "recall", on: false });
        recalled = false;
      }
      // The raid is over (10 s without enemies near): those hiding come out.
      if (hide && main && tick - lastHomeThreat >= 200 && soldiers.some((u) => u.order === Order.Garrison && u.orderTarget === main.id)) {
        out.push({ c: "leave", building: main.id });
      }
      // A town it took that it may only govern and cannot pay for yet (round 7) does not hold the army.
      const stuck = (id: number, t: Town) => once && t.state === TownState.AwaitingChoice && plundered(id) && !affordAll(GOVERN_COST[t.size]);
      const busy = [...towns.entries()].find(
        ([id, t]) => t.owner === player && (t.state === TownState.Plundering || t.state === TownState.AwaitingChoice) && !stuck(id, t),
      );
      if (busy !== undefined && !endgame) {
        // Stay inside until the plunder is done (not in the endgame: everything goes for the
        // enemy main city then).
        send(busy[1].x, busy[1].y, "town");
        return out;
      }
      // Near a time limit: from 10 minutes before it the army it takes to march on the enemy
      // base shrinks by 3 a minute; from 8 it gathers for the assault; in the last 4 it goes
      // with what it has and does not fall back.
      const assault = toGo >= 0 && toGo <= ASSAULT_TO_GO;
      const latest = toGo >= 0 && toGo <= LATEST_TO_GO;
      const lateMinutes = toGo >= 0 && toGo <= LATE_TO_GO ? Math.trunc((tick - (know.maxTicks - LATE_TO_GO)) / TICKS_PER_MINUTE) + 1 : 0;
      const baseNeed = lateMinutes === 0 ? baseArmy : Math.max(townArmy, baseArmy - lateMinutes * 3);
      // Without a limit it also marches once it cannot grow (population at the rules' maximum).
      const popFull = toGo < 0 && cap >= rules.maxPopulation && pop >= cap - FULL_MARGIN;
      // The difficulty's earliest first town and first march on the enemy base.
      const townTime = tick >= (townTrips === 0 ? level.townMinute : level.secondTownMinute) * TICKS_PER_MINUTE;
      const baseTime = tick >= level.baseMinute * TICKS_PER_MINUTE;
      // Weighing up: the most enemy soldiers seen at once in the last 2 minutes, and those
      // near the army now. It goes out only when clearly stronger (1.3 x), and pulls back
      // when outnumbered where it stands, so even armies do not just grind each other down.
      enemySeen.push({ tick, count: foes.length });
      while (enemySeen.length > 0 && tick - enemySeen[0].tick > 2 * TICKS_PER_MINUTE) enemySeen.shift();
      const enemyPeak = enemySeen.reduce((m, e) => Math.max(m, e.count), 0);
      const strongEnough = army.length * 10 >= enemyPeak * 13;
      const cx = army.length === 0 ? home.cellX : Math.trunc(army.reduce((a, u) => a + u.x, 0) / army.length);
      const cy = army.length === 0 ? home.cellY : Math.trunc(army.reduce((a, u) => a + u.y, 0) / army.length);
      const outnumbered = foesNear(cx, cy, 12) > army.length;
      // An enemy main city this low would be repaired to full within minutes if left alone.
      const cityLow = enemyCityHp >= 0 && enemyCityHp * 100 <= rules.buildings[BuildingType.MainCity].hp * PRESS_ON_HP;
      // Ground down: fewer than 40% of the soldiers that set out still stand. Reinforcements do
      // not count: sent on one by one, they kept a failed attack going for minutes while every
      // newcomer died on its own (normal against easy, 2026-10-01: 35 of 45 draws).
      const standing = soldiers.filter((u) => marched.has(u.id)).length;
      if (mode === "town" || mode === "base") {
        if (!endgame && !(mode === "base" && cityLow) && (standing * 5 < armyAtStart * 2 || outnumbered)) {
          // Ground down or outnumbered: break off (retreat ignores enemies) and rebuild.
          if (mode === "base") baseBroken = true;
          out.push({ c: "retreat", u: armyIds, x: rally.x, y: rally.y });
          lastMove = tick;
          mode = "gather";
          target = { x: rally.x, y: rally.y };
          return out;
        } else if (mode === "town") {
          // Done with the town once it is ours, or once it lies in ruins (after our plunder or
          // theirs): ruins have no owner, and waiting there for them to turn neutral again
          // parked whole armies in the middle of the map until the game ran out.
          const t = towns.get(targetTown);
          if (t === undefined || (t.owner === player && t.state !== TownState.Neutral) || t.state === TownState.Ruins) mode = "gather";
          else send(t.x, t.y, "town");
        } else {
          // March together (a group move keeps to the slowest and in formation) until those that
          // set out stand by the enemy main city; then fight the defenders there first (a move
          // fights what it meets) and the city once they are down. Told to attack the city from
          // afar, the soldiers streamed in one by one, ignored the defenders and were picked off
          // (normal against easy, 2026-10-01).
          const front = soldiers.filter((u) => marched.has(u.id));
          const fx = front.length === 0 ? cx : Math.trunc(front.reduce((a, u) => a + u.x, 0) / front.length);
          const fy = front.length === 0 ? cy : Math.trunc(front.reduce((a, u) => a + u.y, 0) / front.length);
          const there = dist2(fx, fy, enemyHome.cellX, enemyHome.cellY) <= 12 * 12;
          if (enemyCity >= 0 && there) {
            if (tick - lastMove >= 200) {
              if (foesNear(enemyHome.cellX, enemyHome.cellY, 12) > 0) out.push({ c: "move", u: armyIds, x: enemyHome.cellX, y: enemyHome.cellY });
              else out.push({ c: "attack", u: armyIds, target: enemyCity });
              lastMove = tick;
            }
          } else {
            send(enemyHome.cellX, enemyHome.cellY, "base");
          }
        }
      }
      if (mode === "gather" || mode === "defend") {
        // Towns to take: not ours, not ruins, and not one we plundered in the last 6 minutes.
        const open = [...towns.entries()]
          .filter(([, t]) => !(t.owner === player && t.state !== TownState.Neutral) && t.state !== TownState.Ruins)
          .filter(([id]) => tick - (plunders.get(id)?.tick ?? -100000) >= 6 * TICKS_PER_MINUTE)
          // Plundered already (round 7): worth taking only when it can pay to govern it.
          .filter(([id, t]) => !(once && plundered(id) && !affordAll(GOVERN_COST[t.size])))
          .sort(([a, ta], [b, tb]) => ta.size - tb.size || a - b);
        const go = endgame
          ? army.length >= ENDGAME_ARMY
          : assault
            ? army.length >= ASSAULT_ARMY || (latest && army.length >= ENDGAME_ARMY)
            : baseTime && strongEnough && (army.length >= baseNeed || (((open.length === 0 && !baseBroken) || popFull) && army.length >= townArmy + 6));
        if (go) {
          armyAtStart = army.length;
          marched.clear();
          for (const id of armyIds) marched.add(id);
          send(enemyHome.cellX, enemyHome.cellY, "base");
        } else if (!assault && townTime && army.length >= townArmy && open.length > 0 && strongEnough) {
          const pick = army.length >= 24 || open.length === 1 ? open[open.length - 1] : open[0];
          targetTown = pick[0];
          armyAtStart = army.length;
          marched.clear();
          for (const id of armyIds) marched.add(id);
          townTrips++;
          send(pick[1].x, pick[1].y, "town");
        } else {
          send(rally.x, rally.y, "gather");
        }
      }
      return out;
    },
  };
}

// --- hard (D-052, D-055) ------------------------------------------------------------------------
//
// As strong as it can get from its own PlayerView, with nothing extra (GDD section 13): no
// resources, population or numbers the others do not have, and nothing from beyond its fog. It
// plays the plan that beat normal (sim/README.md, scripted player): takes the nearest town early
// and plunders it again whenever it is neutral again, builds a mage hall as soon as it has the
// crystal for a mage, fights at home under the main city's arrows, strikes back after beating off
// a wave and marches once clearly stronger. On top of that it does what a careful player does:
// - keeps count of the enemy soldiers it has seen, and of those it saw fall (a soldier gone from
//   a place it still sees has died), so it weighs up against what the enemy has, not only what is
//   in sight;
// - answers the enemy's mix: spearmen against mages (a cannon shot kills a ranged unit, not a
//   spearman), ranged against spearmen;
// - steps out of the crystal cannon's warning area, and does not call off its own mages' shots
//   with an army order;
// - sends what was trained during an attack after it six at a time, and does not give up an attack
//   on a main city nobody defends.
// Kept only what won in AI-against-AI games (sim/README.md lists what was tried and dropped: raids
// on gatherers, a guard at home, a second front, sending ranged units at the enemy's mages, aiming
// its own cannon, a mine by the crystal vein, an earlier barracks, ...). Each game moves a few
// numbers a little (its own Rng), so no two games are alike. Every spatial choice and tie is made
// in player 0's frame, as in the normal AI.

/** What the hard AI tunes (HARD has the values it plays with; tests may replace them). */
export interface HardPlan {
  /** Farmers it trains (each game: +-2). */
  farmers: number;
  /** Barracks plus ranges at most. */
  production: number;
  /** Unfinished buildings at once. */
  sites: number;
  /** Percent spearmen among spearmen and ranged (each game: +-5)... */
  spearShare: number;
  /** ...moved this many points toward what beats the enemy's mix as it has seen it (0: never). */
  counterMix: number;
  /** Crystal kept per mage for its shots before it trains another. */
  mageReserve: number;
  /** Farmers on the crystal vein once there is a mage hall (and it has found the vein). */
  vein: number;
  /**
   * A town taken for the first time within this many cells of its main city is governed (if it
   * can pay), farther ones plundered; 0: always plunder the first time. A town plundered before
   * (round 7, plunderOnce) can only be governed.
   */
  governNear: number;
  /** Soldiers it takes to a small town (each game: +0..1), and to the big one. */
  townArmy: number;
  bigArmy: number;
  /** It marches on the enemy base with this many (each game: +-3)... */
  pushArmy: number;
  /** ...if its army is worth at least this percent of what it believes the enemy has. */
  pushRatio: number;
  /** After beating off a wave of 6 or more near home it strikes back with this many. */
  counterArmy: number;
  /** The farmers hide in the main city with this many enemy soldiers near it (0: never). */
  recallAt: number;
  /**
   * With the army out, this many enemy soldiers near the main city call it home; fewer, and only
   * the nearest few (two for each, and one more) go back (1: any enemy calls the army home).
   */
  pullAll: number;
  /** Steps out of crystal cannon warnings. */
  dodge: boolean;
  /** Round 7: arrow towers it builds by its main city, toward the map centre, once it has a range (0: none). */
  towers: number;
  /** Round 7: with enemies near its main city, its ranged units and mages at home hide in it and its towers. */
  hide: boolean;
  /**
   * Round 7: percent cavalry among spearmen, ranged units and cavalry (0: no stable); more against
   * enemy mages and ranged units, none against an army of spearmen.
   */
  cavShare: number;
  /** Round 7: each enemy arrow tower it knows by the enemy main city counts this much against marching on it. */
  towerWorth: number;
  /** Loose formation once it believes the enemy has this many mages (0: never)... */
  looseAt: number;
  /** ...for 1: ranged and mages, 2: every soldier. */
  looseWho: number;
}

export const HARD: HardPlan = {
  farmers: 32,
  production: 4,
  sites: 1,
  spearShare: 50,
  counterMix: 15,
  mageReserve: 10,
  vein: 2,
  governNear: 0,
  townArmy: 5,
  bigArmy: 14,
  pushArmy: 34,
  pushRatio: 120,
  counterArmy: 14,
  recallAt: 4,
  pullAll: 4,
  dodge: true,
  towers: 0,
  hide: true,
  cavShare: 0,
  towerWorth: 0,
  looseAt: 0,
  looseWho: 1,
};

/** What a soldier is worth when weighing up two armies (a mage for its cannon; cavalry, round 7). */
const WORTH = [0, 10, 10, 25, 6, 16];
/** Enemy soldiers not seen for this long are forgotten. */
const INTEL_TICKS = 4 * TICKS_PER_MINUTE;
/** Enemy soldiers within this many cells of the main city make a wave (as the scripted player counts). */
const WAVE_CELLS = 24;
/** A cannon warning: a unit this much further out than the blast radius (fixed point) is safe. */
const DODGE_MARGIN = 256;

interface Seen {
  type: number;
  x: number;
  y: number;
  tick: number;
  /** Seen going into this building, or gone from view beside it while someone hides there (round 7). */
  inside?: number;
}
interface HardUnit extends Unit {
  /** Position in fixed point. */
  fx: number;
  fy: number;
}
interface HardTown extends Town {
  timer: number;
  visible: boolean;
}
type HardMode = "home" | "town" | "base" | "defend";

function createHardAi(player: number, seed: number, know: AiKnowledge, slot: number): Ai {
  const plan: HardPlan = { ...HARD, ...know.hard };
  // Round 7 (D-061) switches; each off, it plays as before.
  const garrisonOn = know.rules.features?.garrison === true;
  const once = know.rules.features?.plunderOnce === true;
  /** Any round 7 rule on (what only matters then is behind it, so that all off it plays as before). */
  const r7 = Object.values(know.rules.features ?? {}).some((on) => on === true);
  const towersOn = know.rules.features?.towers === true && plan.towers > 0;
  const hideOn = garrisonOn && plan.hide;
  const cavalryOn = know.rules.features?.cavalry === true && plan.cavShare > 0;
  const governCost = (size: number): Cost => know.rules.towns?.[size]?.governCost ?? GOVERN_COST[size];
  const rng = new Rng((seed ^ Math.imul(slot + 1, 0x9e3779b1)) >>> 0 || 1);
  const n = know.map.size;
  const home = know.map.spawns[player];
  const enemyHome = know.map.spawns[1 - player];
  const rules = know.rules;
  const real = (u: number, v: number) => fromCanon(know.frame, u, v);
  const frame = (x: number, y: number) => toCanon(know.frame, x, y);
  /** Order of a point in player 0's frame (for ties: player 1 breaks them the mirror-image way). */
  const rank = (x: number, y: number) => {
    const f = frame(x, y);
    return f.v * n * CELL + f.u;
  };
  const dist2 = (ax: number, ay: number, bx: number, by: number) => (ax - bx) * (ax - bx) + (ay - by) * (ay - by);
  // Per game, a few numbers move a little.
  const farmerTarget = plan.farmers + rng.below(5) - 2;
  const spearBase = plan.spearShare + rng.below(11) - 5;
  const pushArmy = plan.pushArmy + rng.below(7) - 3;
  const townArmy = plan.townArmy + rng.below(2);
  const mid = n >> 1;
  const homeF = frame(home.cellX, home.cellY);
  const su = Math.sign(mid - homeF.u);
  const sv = Math.sign(mid - homeF.v);
  // Production buildings 6 cells toward the map centre; the army waits 4 cells out, inside the
  // main city's arrows (range 7).
  const rally = real(homeF.u + su * 6 + rng.below(3) - 1, homeF.v + sv * 6 + rng.below(3) - 1);
  const post = real(homeF.u + su * 4, homeF.v + sv * 4);
  // Arrow towers (round 7) go 7 cells out, toward the map centre (where attacks come from).
  const towerSpot = real(homeF.u + su * 7, homeF.v + sv * 7);

  let mode: HardMode = "home";
  let target = { x: post.x, y: post.y };
  let targetTown = -1;
  let lastMove = -100000;
  let armyAtStart = 0;
  const marched = new Set<number>();
  let ratioSet = "";
  let recalled = false;
  let lastThreat = -100000;
  let veinCrew: number[] = [];
  /** When each town turns neutral again, as last read off its ruins. */
  const restoreAt = new Map<number, number>();
  /** Enemy soldiers seen and not known to have fallen. */
  const intel = new Map<number, Seen>();
  let waveMax = 0;
  let lastWave = -100000;
  let counterReady = false;
  let loose = false;
  let lastEnemyMage = -100000;
  const loosed = new Set<number>();
  /** Units stepping out of a cannon warning, until the tick it lands (and a little). */
  const dodging = new Map<number, number>();
  /** Soldiers kept as the garrison of each governed (or repairing) town. */
  const townGuards = new Map<number, number[]>();
  /** Soldiers sent home against a small raid while the army is out. */
  const homeSquad = new Set<number>();
  let squadMove = -100000;

  /** Nearest spot to (ax, ay) where `type` fits, with a free ring around it (farms may touch); as normal. */
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
    // It always plunders (a town plundered again every 5 minutes pays more than governing it).
    style: "plunder",
    think(view: PlayerView): CommandBody[] {
      const out: CommandBody[] = [];
      const h = view.header;
      const tick = view.tick;
      const toGo = know.maxTicks > 0 ? know.maxTicks - tick : -1;
      const res: Cost = { food: h[HeaderField.food], wood: h[HeaderField.wood], gold: h[HeaderField.gold], crystal: h[HeaderField.crystal] };
      const pop = h[HeaderField.population];
      const cap = h[HeaderField.populationCap];
      /** Plundered already this game (TownFlag.Plundered). */
      const plunderedTown = (id: number) => {
        for (let r = 0; r < view.towns.length; r += TOWN_STRIDE) if (view.towns[r + TownField.id] === id) return (view.towns[r + TownField.flags] & TownFlag.Plundered) !== 0;
        return false;
      };
      /** It will govern this town when it takes it: plundered before (round 7), or near enough. */
      const toGovern = (id: number) => {
        const t = know.map.towns[id];
        return (once && plunderedTown(id)) || (plan.governNear > 0 && dist2(t.cellX, t.cellY, home.cellX, home.cellY) <= plan.governNear * plan.governNear);
      };
      // On the way to a town it will govern it keeps the cost aside (the choice comes the tick it falls).
      const reserve: Cost = mode === "town" && targetTown >= 0 && toGovern(targetTown) ? { ...governCost(know.map.towns[targetTown].size) } : { food: 0, wood: 0, gold: 0, crystal: 0 };
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
      const mine: HardUnit[] = [];
      const foes: HardUnit[] = [];
      for (let r = 0; r < view.units.length; r += UNIT_STRIDE) {
        const fx = view.units[r + UnitField.x];
        const fy = view.units[r + UnitField.y];
        const u: HardUnit = {
          id: view.units[r + UnitField.id],
          type: view.units[r + UnitField.type],
          x: fx >> CELL_SHIFT,
          y: fy >> CELL_SHIFT,
          fx,
          fy,
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
      /** Enemy buildings in sight that soldiers can hide in: id -> footprint, and whether someone is inside (round 7). */
      const shelters = new Map<number, { x: number; y: number; size: number; holds: number; occupied: boolean }>();
      for (let r = 0; r < view.buildings.length; r += BUILDING_STRIDE) {
        const owner = view.buildings[r + BuildingField.owner];
        const type = view.buildings[r + BuildingField.type];
        if (owner === 1 - player && type === BuildingType.MainCity) {
          enemyCity = view.buildings[r + BuildingField.id];
          enemyCityHp = view.buildings[r + BuildingField.hp];
        }
        const flags = view.buildings[r + BuildingField.flags];
        if (garrisonOn && owner === 1 - player && (rules.buildings[type].holds ?? 0) > 0 && (flags & BuildingFlag.Remembered) === 0) {
          shelters.set(view.buildings[r + BuildingField.id], {
            x: view.buildings[r + BuildingField.cellX],
            y: view.buildings[r + BuildingField.cellY],
            size: rules.buildings[type].size,
            holds: rules.buildings[type].holds ?? 0,
            occupied: (flags & BuildingFlag.Occupied) !== 0,
          });
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
      const farmers = mine.filter((u) => u.type === UnitType.Farmer);
      const gatherers = farmers.filter((u) => u.order === Order.Gather).map((u) => u.id);
      const soldiers = mine.filter((u) => u.type !== UnitType.Farmer);
      const byId = new Map<number, HardUnit>();
      for (const u of soldiers) byId.set(u.id, u);
      const has = (t: number) => own.some((b) => b.type === t);
      const done = (t: number) => own.filter((b) => b.type === t && b.progress >= 1000);
      const count = (t: number) => own.filter((b) => b.type === t).length;
      const worth = (list: { type: number }[]) => list.reduce((a, u) => a + WORTH[u.type], 0);
      const centre = (list: { x: number; y: number }[], fx: number, fy: number) =>
        list.length === 0 ? { x: fx, y: fy } : { x: Math.trunc(list.reduce((a, u) => a + u.x, 0) / list.length), y: Math.trunc(list.reduce((a, u) => a + u.y, 0) / list.length) };

      // --- what it knows of the enemy -------------------------------------------------------------
      // A soldier gone from view while every cell around where it stood is still in view has fallen
      // (none walks more than a cell in 20 ticks); one that walked into the fog is kept, and
      // forgotten after a while. Round 7: ranged units and mages can hide in a main city or an
      // arrow tower. One seen going in, or gone from view beside one where someone hides
      // (BuildingFlag.Occupied: it sees that someone is in, not who or how many), is counted as
      // hiding there until the building is seen empty or gone.
      const sees = (x: number, y: number) => {
        for (let yy = Math.max(0, y - 1); yy <= Math.min(n - 1, y + 1); yy++) {
          for (let xx = Math.max(0, x - 1); xx <= Math.min(n - 1, x + 1); xx++) if (view.fog[yy * n + xx] !== Fog.Visible) return false;
        }
        return true;
      };
      for (const f of foes) intel.set(f.id, { type: f.type, x: f.x, y: f.y, tick, inside: f.order === Order.Garrison && shelters.has(f.orderTarget) ? f.orderTarget : undefined });
      for (const [id, e] of intel) {
        if (e.tick === tick) continue;
        if (garrisonOn && (rules.garrisonTypes ?? []).includes(e.type as UnitType)) {
          if (e.inside === undefined && tick - e.tick <= 20 && sees(e.x, e.y)) {
            // Gone from view where it should still be seen: into a shelter beside it with someone in,
            // and with room (no more than it holds are counted inside)?
            for (const [bid, b] of shelters) {
              const dx = Math.max(b.x - e.x, 0, e.x - (b.x + b.size - 1));
              const dy = Math.max(b.y - e.y, 0, e.y - (b.y + b.size - 1));
              let inside = 0;
              for (const o of intel.values()) if (o.inside === bid) inside++;
              if (b.occupied && dx <= 2 && dy <= 2 && inside < b.holds) {
                e.inside = bid;
                break;
              }
            }
          }
          if (e.inside !== undefined) {
            const b = shelters.get(e.inside);
            if (b !== undefined && !b.occupied) intel.delete(id);
            else if (b !== undefined) e.tick = tick;
            else if (tick - e.tick > INTEL_TICKS) intel.delete(id);
            continue;
          }
        }
        if ((tick - e.tick <= 20 && sees(e.x, e.y)) || tick - e.tick > INTEL_TICKS) intel.delete(id);
      }
      let enemySpear = 0;
      let enemyRanged = 0;
      let enemyMages = 0;
      let enemyWorth = 0;
      for (const e of intel.values()) {
        if (e.type === UnitType.Spearman) enemySpear++;
        else if (e.type === UnitType.Ranged) enemyRanged++;
        else if (e.type === UnitType.Mage) enemyMages++;
        enemyWorth += WORTH[e.type];
      }
      if (enemyMages > 0) lastEnemyMage = tick;

      // --- economy --------------------------------------------------------------------------
      // The ratio leans hard away from what piles up (a plunder brings 300 gold and no wood, and
      // wood is in every soldier and building). It is sent as soon as it changes: with a limit of
      // 30 s between changes it won 41% of 80 games against itself without the limit.
      const ratio = done(BuildingType.MageHall).length > 0 ? [35, 40, 25] : done(BuildingType.Range).length > 0 ? [40, 40, 20] : [50, 40, 10];
      const stock = [res.food, res.wood, res.gold];
      for (let k = 0; k < 3; k++) {
        if (stock[k] > 800) ratio[k] >>= 2;
        else if (stock[k] > 400) ratio[k] >>= 1;
        else if (stock[k] < 100) ratio[k] += ratio[k] >> 1;
      }
      const sum = ratio[0] + ratio[1] + ratio[2];
      for (let k = 0; k < 3; k++) ratio[k] = Math.max(5, Math.trunc((ratio[k] * 100) / sum));
      ratio[0] = 100 - ratio[1] - ratio[2];
      const ratioKey = ratio.join("/");
      if (ratioKey !== ratioSet) {
        out.push({ c: "eco_ratio", food: ratio[0], wood: ratio[1], gold: ratio[2], on: true });
        ratioSet = ratioKey;
      }
      let room = cap - pop - queued;
      const main = done(BuildingType.MainCity)[0];
      const farmerCost = rules.units[UnitType.Farmer].cost;
      if (main && main.queue < 2 && farmers.length + main.queue < farmerTarget && room > 0 && afford(farmerCost)) {
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
          const key = rank(x, y);
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
      // Buildings in priority order; it saves up for the first that cannot be paid for yet.
      const mageCost = rules.units[UnitType.Mage].cost;
      const producers = count(BuildingType.Barracks) + count(BuildingType.Range) + count(BuildingType.MageHall);
      if (own.filter((b) => b.progress < 1000).length < plan.sites && gatherers.length >= 3) {
        const plans: { type: BuildingType; at: { x: number; y: number } | null }[] = [];
        const granary = done(BuildingType.Granary)[0];
        const base = { x: home.cellX, y: home.cellY };
        const add = (type: BuildingType, at: { x: number; y: number } | null) => {
          if (!plans.some((p) => p.type === type)) plans.push({ type, at });
        };
        // The mage hall first once there is the crystal for a mage (a plunder brings 75).
        if (!has(BuildingType.MageHall) && res.crystal >= mageCost.crystal) add(BuildingType.MageHall, base);
        // Houses before the population is full: every producer can add one at a time.
        if (cap < rules.maxPopulation && cap - pop - queued <= 5 + producers) add(BuildingType.House, base);
        if (!has(BuildingType.LumberCamp) && farmers.length >= 6) add(BuildingType.LumberCamp, nearestNode(NodeKind.Tree));
        if (!has(BuildingType.Granary) && farmers.length >= 8) add(BuildingType.Granary, base);
        if (!has(BuildingType.Barracks) && farmers.length >= 10) add(BuildingType.Barracks, rally);
        if (!has(BuildingType.Range) && farmers.length >= 12) add(BuildingType.Range, rally);
        if (!has(BuildingType.MageHall) && has(BuildingType.Range) && (res.crystal >= 40 || tick > 10 * TICKS_PER_MINUTE)) add(BuildingType.MageHall, base);
        if (cavalryOn && !has(BuildingType.Stable) && (rules.buildings[BuildingType.Stable].requires ?? []).every((t) => done(t).length > 0)) add(BuildingType.Stable, rally);
        if (towersOn && has(BuildingType.Range) && count(BuildingType.ArrowTower) < plan.towers) add(BuildingType.ArrowTower, towerSpot);
        if (count(BuildingType.Farm) < Math.min(10, 2 + (farmers.length >> 2))) add(BuildingType.Farm, granary ? { x: granary.x + 1, y: granary.y + 1 } : base);
        if (!has(BuildingType.Mine) && farmers.length >= 14) add(BuildingType.Mine, nearestNode(NodeKind.GoldMine));
        if (res.food + res.wood >= 600 && count(BuildingType.Barracks) + count(BuildingType.Range) < plan.production) {
          add(count(BuildingType.Barracks) <= count(BuildingType.Range) ? BuildingType.Barracks : BuildingType.Range, rally);
        }
        for (const p of plans) {
          if (p.at === null) continue;
          // A mine is only worth it by its node; an arrow tower only where towers may go.
          const fixed = p.type === BuildingType.Mine || p.type === BuildingType.ArrowTower;
          const spot = spotNear(view, p.type, p.at.x, p.at.y, p.type === BuildingType.ArrowTower ? 6 : 12) ?? (fixed ? null : spotNear(view, p.type, base.x, base.y, 20));
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
          gatherers.splice(0, crew);
          spend(cost);
          break;
        }
      }

      // --- army production ------------------------------------------------------------------
      const spear = soldiers.filter((u) => u.type === UnitType.Spearman).length;
      const ranged = soldiers.filter((u) => u.type === UnitType.Ranged).length;
      const mages = soldiers.filter((u) => u.type === UnitType.Mage).length;
      const trainAt = (t: number, type: UnitType) => {
        for (const b of done(t)) {
          if (b.queue >= 2 || room <= 0 || !afford(rules.units[type].cost)) continue;
          out.push({ c: "train", building: b.id, type, n: 1 });
          spend(rules.units[type].cost);
          room--;
        }
      };
      const hallQueue = done(BuildingType.MageHall).reduce((a, b) => a + b.queue, 0);
      if (mages + hallQueue < rules.mageCap && res.crystal >= mageCost.crystal + plan.mageReserve * mages) trainAt(BuildingType.MageHall, UnitType.Mage);
      // The mix answers what it has seen: a cannon shot kills a ranged unit but not a spearman, and
      // ranged units hit spearmen 2.5 times as hard.
      let share = spearBase;
      if (plan.counterMix > 0) {
        if (enemyMages >= 2) share += plan.counterMix;
        else if (enemySpear + enemyRanged >= 6 && enemySpear * 100 >= (enemySpear + enemyRanged) * 60) share -= plan.counterMix;
        else if (enemySpear + enemyRanged >= 6 && enemyRanged * 100 >= (enemySpear + enemyRanged) * 60) share += plan.counterMix;
      }
      share = Math.max(20, Math.min(80, share));
      if (cavalryOn) {
        // Cavalry beats mages and ranged units and loses to spearmen.
        const cav = soldiers.filter((u) => u.type === UnitType.Cavalry).length;
        const shooters = enemyMages + enemyRanged;
        let want = plan.cavShare;
        if (shooters >= 4 && shooters * 100 >= (shooters + enemySpear) * 50) want += plan.counterMix;
        else if (enemySpear >= 6 && enemySpear * 100 >= (shooters + enemySpear) * 70) want = 0;
        if (cav * 100 < want * (spear + ranged + cav + 1)) trainAt(BuildingType.Stable, UnitType.Cavalry);
      }
      if (spear * 100 <= share * (spear + ranged)) {
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

      // --- towns ------------------------------------------------------------------------------
      const towns = new Map<number, HardTown>();
      for (let r = 0; r < view.towns.length; r += TOWN_STRIDE) {
        const id = view.towns[r + TownField.id];
        const t = know.map.towns[id];
        towns.set(id, {
          state: view.towns[r + TownField.state],
          owner: view.towns[r + TownField.owner],
          needed: view.towns[r + TownField.garrisonNeeded],
          timer: view.towns[r + TownField.timer],
          visible: (view.towns[r + TownField.flags] & TownFlag.Visible) !== 0,
          x: t.cellX,
          y: t.cellY,
          size: t.size,
        });
      }
      for (const t of know.map.towns) {
        if (!towns.has(t.id)) towns.set(t.id, { state: TownState.Neutral, owner: NEUTRAL, needed: 0, timer: 0, visible: false, x: t.cellX, y: t.cellY, size: t.size });
      }
      for (const [id, t] of towns) {
        if (t.state === TownState.Ruins && t.visible) restoreAt.set(id, tick + t.timer);
        if (t.owner !== player || t.state !== TownState.AwaitingChoice) continue;
        if (!toGovern(id)) out.push({ c: "town_choice", town: id, choice: TownChoice.Plunder });
        else if (affordAll(governCost(t.size))) {
          out.push({ c: "town_choice", town: id, choice: TownChoice.Govern });
          spend(governCost(t.size));
        } else if (!(once && plunderedTown(id))) out.push({ c: "town_choice", town: id, choice: TownChoice.Plunder });
        // Plundered before and it cannot pay yet: it waits (a plunder would be refused).
      }
      // Garrisons: the spearmen (else any soldier but a mage) nearest each held town, one more
      // than it needs, topped up as they fall.
      for (const [id, t] of towns) {
        const held = t.owner === player && (t.state === TownState.Repairing || t.state === TownState.Governed);
        if (!held) {
          townGuards.delete(id);
          continue;
        }
        const guarded = new Set([...townGuards.values()].flat());
        const alive = (townGuards.get(id) ?? []).filter((g) => byId.has(g));
        const free = soldiers
          .filter((s) => !guarded.has(s.id) && s.type !== UnitType.Mage && s.order !== Order.Garrison)
          .sort((a, b) => (b.type === UnitType.Spearman ? 1 : 0) - (a.type === UnitType.Spearman ? 1 : 0) || dist2(a.x, a.y, t.x, t.y) - dist2(b.x, b.y, t.x, t.y) || a.id - b.id);
        while (alive.length < t.needed + 1 && free.length > 0) alive.push(free.shift()!.id);
        townGuards.set(id, alive);
        const away = alive.filter((g) => {
          const s = byId.get(g)!;
          return dist2(s.x, s.y, t.x, t.y) > 9;
        });
        if (away.length > 0 && tick % 100 === 0) out.push({ c: "move", u: away, x: t.x, y: t.y });
      }
      const guarding = new Set([...townGuards.values()].flat());

      // --- the clock (AI-against-AI games only: a person plays without a limit) ---------------------
      const endgame = toGo >= 0 && toGo <= ENDGAME_TO_GO;
      const assault = toGo >= 0 && toGo <= ASSAULT_TO_GO;
      const latest = toGo >= 0 && toGo <= LATEST_TO_GO;

      // --- cannon warnings: step out ------------------------------------------------------------------
      // Back from stepping out: with the army again.
      const rejoin: number[] = [];
      for (const [id, until] of dodging) {
        if (tick < until && byId.has(id)) continue;
        dodging.delete(id);
        if (byId.has(id)) rejoin.push(id);
      }
      if (plan.dodge) {
        for (let r = 0; r < view.warnings.length; r += WARNING_STRIDE) {
          if (view.warnings[r + WarningField.owner] === player) continue;
          const wx = view.warnings[r + WarningField.x];
          const wy = view.warnings[r + WarningField.y];
          const reach = view.warnings[r + WarningField.radius] + DODGE_MARGIN;
          const left = view.warnings[r + WarningField.ticksLeft] - 1;
          const caster = foes.find((f) => f.id === view.warnings[r + WarningField.id]);
          for (const u of soldiers) {
            if (dodging.has(u.id)) continue;
            const dx = u.fx - wx;
            const dy = u.fy - wy;
            const d2 = dx * dx + dy * dy;
            if (d2 > reach * reach) continue;
            const d = Math.sqrt(d2);
            const need = reach - d;
            if (need > rules.units[u.type].speed * left) continue; // too late: it keeps fighting
            // Straight out from the blast's centre; from the centre itself, away from the caster
            // (or toward home when the caster is out of sight).
            let ex = dx;
            let ey = dy;
            if (d < 128) {
              ex = caster !== undefined ? wx - caster.fx : (home.cellX << CELL_SHIFT) - wx;
              ey = caster !== undefined ? wy - caster.fy : (home.cellY << CELL_SHIFT) - wy;
            }
            const e = Math.sqrt(ex * ex + ey * ey) || 1;
            const step = need + CELL / 2;
            const x = Math.max(0, Math.min(n - 1, Math.trunc((u.fx + (ex * step) / e) / CELL)));
            const y = Math.max(0, Math.min(n - 1, Math.trunc((u.fy + (ey * step) / e) / CELL)));
            out.push({ c: "retreat", u: [u.id], x, y });
            dodging.set(u.id, tick + left + 10);
          }
        }
      }
      // Not told anything while stepping out of a shot or calibrating one (any order would call the
      // shot off).
      for (const id of homeSquad) if (!byId.has(id)) homeSquad.delete(id);
      // Hiding in a building (round 7) too: a move would bring it out.
      const detached = (id: number) => dodging.has(id) || homeSquad.has(id) || byId.get(id)?.order === Order.Cast || byId.get(id)?.order === Order.Garrison;

      // --- loose against several mages ---------------------------------------------------------------
      if (plan.looseAt > 0) {
        const want = enemyMages >= plan.looseAt || (loose && tick - lastEnemyMage < 2 * TICKS_PER_MINUTE);
        const who = (u: HardUnit) => plan.looseWho === 2 || u.type === UnitType.Ranged || u.type === UnitType.Mage;
        if (want) {
          const fresh = soldiers.filter((u) => who(u) && !loosed.has(u.id)).map((u) => u.id);
          if (fresh.length > 0) {
            out.push({ c: "formation", u: fresh, loose: true });
            for (const id of fresh) loosed.add(id);
          }
          loose = true;
        } else if (loose) {
          const all = soldiers.filter((u) => loosed.has(u.id)).map((u) => u.id);
          if (all.length > 0) out.push({ c: "formation", u: all, loose: false });
          loosed.clear();
          loose = false;
        }
      }

      // --- the army ------------------------------------------------------------------------------------
      const army = guarding.size === 0 ? soldiers : soldiers.filter((u) => !guarding.has(u.id));
      const armyIds = army.filter((u) => !detached(u.id)).map((u) => u.id);
      let sent = false;
      const send = (x: number, y: number, why: HardMode) => {
        if (armyIds.length === 0) return;
        if (why !== mode || target.x !== x || target.y !== y || tick - lastMove >= 400) {
          out.push({ c: "move", u: armyIds, x, y });
          lastMove = tick;
          sent = true;
        }
        mode = why;
        target = { x, y };
      };
      const fallBack = (x: number, y: number) => {
        const ids = army.map((u) => u.id);
        if (ids.length > 0) out.push({ c: "retreat", u: ids, x, y });
        for (const id of ids) dodging.delete(id);
        lastMove = tick;
        sent = true;
        mode = "home";
        target = { x: post.x, y: post.y };
      };
      const armyWorth = worth(army);
      const ac = centre(army, home.cellX, home.cellY);
      const foesNear = (x: number, y: number, r: number) => foes.filter((f) => dist2(f.x, f.y, x, y) <= r * r);

      // Waves: the most enemy soldiers near the main city at once; one is beaten off once none
      // have been near for 10 s. A beaten wave of 6 or more is the time to strike back.
      const nearHome = foesNear(home.cellX, home.cellY, WAVE_CELLS).length;
      if (nearHome > 0) {
        waveMax = Math.max(waveMax, nearHome);
        lastWave = tick;
      } else if (tick - lastWave >= 200 && waveMax > 0) {
        if (waveMax >= 6) counterReady = true;
        waveMax = 0;
      }


      const armyOrders = (): void => {
        // Defence: everyone home, under the main city's arrows; farmers inside against a raid.
        const atHome = foesNear(home.cellX, home.cellY, 16);
        const committed = mode === "base" && dist2(ac.x, ac.y, enemyHome.cellX, enemyHome.cellY) < dist2(ac.x, ac.y, home.cellX, home.cellY);
        if (atHome.length > 0) {
          lastThreat = tick;
          if (plan.recallAt > 0 && !recalled && atHome.length >= plan.recallAt) {
            out.push({ c: "recall", on: true });
            recalled = true;
          }
          if ((mode === "town" || mode === "base") && atHome.length < plan.pullAll) {
            // A few enemy soldiers while the army is out: the nearest few go back and the army
            // carries on (otherwise one raider would call the whole army home).
            const need = 2 * atHome.length + 1;
            const fresh = army
              .filter((u) => !detached(u.id))
              .sort((a, b) => dist2(a.x, a.y, home.cellX, home.cellY) - dist2(b.x, b.y, home.cellX, home.cellY) || rank(a.fx, a.fy) - rank(b.fx, b.fy))
              .slice(0, Math.max(0, need - homeSquad.size));
            for (const u of fresh) homeSquad.add(u.id);
            const ids = [...homeSquad].filter((id) => !dodging.has(id));
            if (ids.length > 0 && (fresh.length > 0 || tick - squadMove >= 100)) {
              const c = centre(atHome, post.x, post.y);
              out.push({ c: "move", u: ids, x: c.x, y: c.y });
              squadMove = tick;
            }
            const keep = armyIds.filter((id) => !homeSquad.has(id));
            armyIds.length = 0;
            armyIds.push(...keep);
          } else if (!committed) {
            if (homeSquad.size > 0) {
              homeSquad.clear();
              armyIds.length = 0;
              armyIds.push(...army.filter((u) => !detached(u.id)).map((u) => u.id));
              lastMove = -100000;
            }
            const wave = foesNear(home.cellX, home.cellY, WAVE_CELLS);
            const close = atHome.filter((f) => dist2(f.x, f.y, home.cellX, home.cellY) <= 100);
            // Clearly stronger: meet them; otherwise wait for them by the city.
            const meet = armyWorth >= worth(wave) * 2 ? wave : close;
            const c = centre(meet, post.x, post.y);
            // Round 7: ranged units and mages at home hide in the main city and its towers and shoot
            // from there (they cannot be hit inside).
            const hiding: { building: number; u: number[] }[] = [];
            if (hideOn) {
              const types = rules.garrisonTypes ?? [];
              const pool = army
                .filter((u) => types.includes(u.type as UnitType) && !detached(u.id) && dist2(u.x, u.y, home.cellX, home.cellY) <= 400)
                .sort((a, b) => dist2(a.x, a.y, home.cellX, home.cellY) - dist2(b.x, b.y, home.cellX, home.cellY) || rank(a.fx, a.fy) - rank(b.fx, b.fy));
              for (const b of [...done(BuildingType.MainCity), ...done(BuildingType.ArrowTower)]) {
                const used = soldiers.filter((u) => u.order === Order.Garrison && u.orderTarget === b.id).length;
                const go = pool.splice(0, Math.max(0, (rules.buildings[b.type].holds ?? 0) - used));
                if (go.length > 0) hiding.push({ building: b.id, u: go.map((u) => u.id) });
              }
              const hidden = new Set(hiding.flatMap((h) => h.u));
              if (hidden.size > 0) {
                const keep = armyIds.filter((id) => !hidden.has(id));
                armyIds.length = 0;
                armyIds.push(...keep);
              }
            }
            send(c.x, c.y, "defend");
            for (const h of hiding) out.push({ c: "garrison", u: h.u, building: h.building });
            return;
          }
        } else {
          if (recalled && tick - lastThreat >= 100) {
            out.push({ c: "recall", on: false });
            recalled = false;
          }
          // The raid is over: the home squad goes back to the army.
          if (homeSquad.size > 0 && tick - lastThreat >= 200) {
            rejoin.push(...homeSquad);
            homeSquad.clear();
          }
          // Round 7: and those hiding come out (the next army order takes them along).
          if (hideOn && tick - lastThreat >= 200) {
            for (const b of own) {
              if (soldiers.some((u) => u.order === Order.Garrison && u.orderTarget === b.id)) {
                out.push({ c: "leave", building: b.id });
                lastMove = -100000;
              }
            }
          }
          if (mode === "defend") mode = "home";
        }
        // Plundering: stay inside until it is done (not in the endgame). A town it may only govern
        // and cannot pay for yet does not hold the army.
        const busy = [...towns.entries()].find(
          ([id, t]) =>
            t.owner === player &&
            (t.state === TownState.Plundering || (t.state === TownState.AwaitingChoice && !(once && plunderedTown(id) && !affordAll(governCost(t.size))))),
        );
        if (busy !== undefined && !endgame) {
          send(busy[1].x, busy[1].y, "town");
          return;
        }
        const standing = soldiers.filter((u) => marched.has(u.id)).length;
        const local = worth(foesNear(ac.x, ac.y, 12));
        if (mode === "town") {
          const t = towns.get(targetTown);
          if (t === undefined || (t.owner === player && t.state !== TownState.Neutral) || t.state === TownState.Ruins) mode = "home";
          else if (standing * 5 < armyAtStart * 2 || local > armyWorth) {
            fallBack(post.x, post.y);
            return;
          } else {
            send(t.x, t.y, "town");
            return;
          }
        }
        if (mode === "base") {
          // Those that set out are the front; soldiers trained since wait at home and follow six at
          // a time (one by one they would be picked off on the way).
          // Round 7: a main city with soldiers hiding in it picks off what comes in small groups,
          // so then they wait for the next march instead.
          const reserves = army.filter((u) => !marched.has(u.id) && !detached(u.id));
          if (reserves.length >= 6 && !r7) for (const u of reserves) marched.add(u.id);
          const front = army.filter((u) => marched.has(u.id));
          const frontIds = front.filter((u) => !detached(u.id)).map((u) => u.id);
          const fc = centre(front, ac.x, ac.y);
          const cityLow = enemyCityHp >= 0 && enemyCityHp * 100 <= rules.buildings[BuildingType.MainCity].hp * PRESS_ON_HP;
          // It breaks off only when outmatched where the front stands (not because the city's arrows
          // thinned it: with nobody left to defend it, the city falls), or when too few are left.
          const atCity = front.filter((u) => dist2(u.x, u.y, enemyHome.cellX, enemyHome.cellY) <= 14 * 14);
          // Round 7: stragglers far behind do not hold up the siege; and soldiers hiding in the city
          // cannot be seen, so a front ground down to under 40% of those that set out breaks off.
          const nearFront = r7 ? front.filter((u) => dist2(u.x, u.y, enemyHome.cellX, enemyHome.cellY) <= 30 * 30).length : front.length;
          const there = atCity.length * 2 >= nearFront;
          const defenders = worth(foesNear(fc.x, fc.y, 12));
          const ground = r7 && front.length * 5 < armyAtStart * 2;
          if (front.length === 0 || (!endgame && !cityLow && (ground || defenders * 10 > worth(front) * 12 || (front.length < 6 && defenders > 0)))) {
            counterReady = false;
            fallBack(post.x, post.y);
            return;
          }
          if (enemyCity >= 0 && there) {
            if (tick - lastMove >= 100 && frontIds.length > 0) {
              // Defenders first (a move fights what it meets), then the city; those still on the way
              // keep coming.
              const close = atCity.filter((u) => !detached(u.id)).map((u) => u.id);
              const late = frontIds.filter((id) => !close.includes(id));
              // Round 7: a few defenders in sight do not stop an attack on the city that is clearly
              // stronger or nearly done (a move fights them but never hits the city, which is repaired).
              const guards = worth(foesNear(enemyHome.cellX, enemyHome.cellY, 12));
              const pressOn = r7 && close.length > 0 && (cityLow || worth(atCity) >= guards * 3);
              if ((guards > 0 && !pressOn) || close.length === 0) out.push({ c: "move", u: frontIds, x: enemyHome.cellX, y: enemyHome.cellY });
              else {
                out.push({ c: "attack", u: close, target: enemyCity });
                if (late.length > 0) out.push({ c: "move", u: late, x: enemyHome.cellX, y: enemyHome.cellY });
              }
              lastMove = tick;
              sent = true;
            }
          } else if (
            frontIds.length > 0 &&
            (target.x !== enemyHome.cellX || target.y !== enemyHome.cellY || tick - lastMove >= (there ? 100 : 400) || (reserves.length >= 6 && !r7))
          ) {
            // On the way, or there without the city in sight yet: on to it.
            out.push({ c: "move", u: frontIds, x: enemyHome.cellX, y: enemyHome.cellY });
            lastMove = tick;
            sent = true;
            target = { x: enemyHome.cellX, y: enemyHome.cellY };
          }
          const wait = reserves.filter((u) => !marched.has(u.id) && dist2(u.x, u.y, post.x, post.y) > 9).map((u) => u.id);
          if (wait.length > 0 && tick % 100 === 0) out.push({ c: "move", u: wait, x: post.x, y: post.y });
          return;
        }
        // At home: march, go for a town, or wait by the city.
        const popFull = toGo < 0 && cap >= rules.maxPopulation && pop >= cap - FULL_MARGIN;
        // Round 7: the enemy's arrow towers by its main city (seen, or remembered) make it harder.
        let towersThere = 0;
        if (plan.towerWorth > 0) {
          for (let r = 0; r < view.buildings.length; r += BUILDING_STRIDE) {
            if (view.buildings[r + BuildingField.owner] !== 1 - player || view.buildings[r + BuildingField.type] !== BuildingType.ArrowTower) continue;
            if (dist2(view.buildings[r + BuildingField.cellX], view.buildings[r + BuildingField.cellY], enemyHome.cellX, enemyHome.cellY) <= 14 * 14) towersThere++;
          }
        }
        const strong = armyWorth * 100 >= (enemyWorth + towersThere * plan.towerWorth) * plan.pushRatio;
        const go = endgame
          ? army.length >= ENDGAME_ARMY
          : assault
            ? army.length >= ASSAULT_ARMY || (latest && army.length >= ENDGAME_ARMY)
            : (counterReady && army.length >= plan.counterArmy && armyWorth >= enemyWorth) ||
              (army.length >= pushArmy && strong) ||
              (popFull && army.length >= townArmy + 6);
        if (go) {
          armyAtStart = army.length;
          marched.clear();
          for (const u of army) marched.add(u.id);
          counterReady = false;
          send(enemyHome.cellX, enemyHome.cellY, "base");
          return;
        }
        if (!assault) {
          let pick = -1;
          let pickD = 0;
          for (const [id, t] of towns) {
            if (t.state === TownState.Ruins || t.state === TownState.Plundering || (t.owner === player && t.state !== TownState.Neutral)) continue;
            if (tick < (restoreAt.get(id) ?? 0)) continue;
            // Plundered before (round 7): only worth it when it can pay to govern it.
            if (once && plunderedTown(id) && !affordAll(governCost(t.size))) continue;
            if (army.length < (t.size === TownSize.Small ? townArmy : plan.bigArmy)) continue;
            // Not into a stronger enemy seen there in the last minute.
            let there = 0;
            for (const e of intel.values()) if (tick - e.tick <= TICKS_PER_MINUTE && dist2(e.x, e.y, t.x, t.y) <= 14 * 14) there += WORTH[e.type];
            if (there * 10 > armyWorth * 8) continue;
            const d = dist2(t.x, t.y, home.cellX, home.cellY);
            if (pick < 0 || d < pickD || (d === pickD && rank(t.x, t.y) < rank(towns.get(pick)!.x, towns.get(pick)!.y))) {
              pick = id;
              pickD = d;
            }
          }
          if (pick >= 0) {
            targetTown = pick;
            armyAtStart = army.length;
            marched.clear();
            for (const u of army) marched.add(u.id);
            const t = towns.get(pick)!;
            send(t.x, t.y, "town");
            return;
          }
        }
        send(post.x, post.y, "home");
      };
      armyOrders();

      // Back from a dodge or a raid at home: with the army again (on an attack, those that did not
      // set out with it wait at home like the other reserves).
      const back = rejoin.filter((id) => byId.has(id) && !detached(id));
      const late = mode === "base" ? back.filter((id) => !marched.has(id)) : [];
      const on = back.filter((id) => !late.includes(id));
      if (on.length > 0 && !sent) out.push({ c: "move", u: on, x: target.x, y: target.y });
      if (late.length > 0) out.push({ c: "move", u: late, x: post.x, y: post.y });
      return out;
    },
  };
}
