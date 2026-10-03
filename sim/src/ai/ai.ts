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
  TownSize,
  TownState,
  UNIT_STRIDE,
  UnitField,
  UnitFlag,
  UnitType,
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
const LEVELS: Record<AiDifficulty, Level> = {
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
      // On the way to a town it may govern, it keeps the governing cost aside (D4: the choice
      // is made the tick the town falls, so the money has to be there).
      const aimTown = mode === "town" && targetTown >= 0 && myStyle !== "plunder" ? know.map.towns[targetTown] : undefined;
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
          .filter((s) => !isGuard(s.id) && s.type !== UnitType.Mage)
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
      const armyIds = army.map((u) => u.id);

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
        const near = foes.filter((u) => dist2(u.x, u.y, home.cellX, home.cellY) <= 256);
        const cx = Math.trunc(near.reduce((a, u) => a + u.x, 0) / near.length);
        const cy = Math.trunc(near.reduce((a, u) => a + u.y, 0) / near.length);
        send(cx, cy, "defend");
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
      const busy = [...towns.entries()].find(
        ([, t]) => t.owner === player && (t.state === TownState.Plundering || t.state === TownState.AwaitingChoice),
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
