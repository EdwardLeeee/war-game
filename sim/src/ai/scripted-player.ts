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

/** What the player knows from the start, as the AI does (ai.ts AiKnowledge): the map, the rules, its symmetry frame. */
export interface PlayerKnowledge {
  map: Pick<MapInfo, "size" | "spawns" | "towns">;
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
}

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
  x: number;
  y: number;
  size: number;
}
type Mode = "home" | "town" | "base" | "defend";

/** Builds nothing whose centre is this close to a town's centre (cells), as the AI of round 4 PR A. */
const TOWN_CLEARANCE = 12;
const PRESS_ON_HP = 40;
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
  };
}

export interface ScriptedPlayer {
  think(view: PlayerView): CommandBody[];
  /** For the measurement: what it is doing. */
  state(): { mode: Mode; trips: number; marches: number; waves: number; brokenOff: number; firstMarch: number };
}

export function createScriptedPlayer(player: number, know: PlayerKnowledge, plan: Plan): ScriptedPlayer {
  const n = know.map.size;
  const home = know.map.spawns[player];
  const enemyHome = know.map.spawns[1 - player];
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
  // The town of the plan: the small town nearest the main city.
  const myTown = know.map.towns
    .filter((t) => t.size === TownSize.Small)
    .sort((a, b) => dist2(a.cellX, a.cellY, home.cellX, home.cellY) - dist2(b.cellX, b.cellY, home.cellX, home.cellY) || a.id - b.id)[0];

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
  let nextTown = 0;
  let waveMax = 0;
  let lastThreat = -100000;
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
        if (know.map.towns.some(near)) continue;
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
    state: () => ({ mode, trips, marches, waves, brokenOff, firstMarch }),
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

      // --- economy (the AI's) -----------------------------------------------------------------
      const ratio = done(BuildingType.MageHall).length > 0 ? [35, 30, 35] : done(BuildingType.Range).length > 0 ? [40, 35, 25] : [50, 40, 10];
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
      if (plan.woodBias && res.food >= 300 && res.gold >= 300 && res.wood < 100) {
        ratio[0] = 20;
        ratio[1] = 60;
        ratio[2] = 20;
      }
      const ratioKey = ratio.join("/");
      if (ratioKey !== ratioSet) {
        out.push({ c: "eco_ratio", food: ratio[0], wood: ratio[1], gold: ratio[2], on: true });
        ratioSet = ratioKey;
      }
      let room = cap - pop - queued;
      const main = done(BuildingType.MainCity)[0];
      const farmerCost = rules.units[UnitType.Farmer].cost;
      if (main && main.queue < 2 && farmers.length + main.queue < plan.farmers && room > 0 && afford(farmerCost)) {
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
        if (!has(BuildingType.Barracks) && farmers.length >= 10) add(BuildingType.Barracks, rally);
        if (!has(BuildingType.Range) && farmers.length >= 12) add(BuildingType.Range, rally);
        if (!plan.noMage && !has(BuildingType.MageHall) && has(BuildingType.Range) && (res.crystal >= 40 || tick > 10 * 1200)) add(BuildingType.MageHall, base);
        if (count(BuildingType.Farm) < Math.min(10, 2 + (farmers.length >> 2))) add(BuildingType.Farm, granary ? { x: granary.x + 1, y: granary.y + 1 } : base);
        if (!has(BuildingType.Mine) && farmers.length >= 14) add(BuildingType.Mine, nearestNode(NodeKind.GoldMine));
        if (res.food + res.wood >= 600 && count(BuildingType.Barracks) + count(BuildingType.Range) < plan.production) {
          add(count(BuildingType.Barracks) <= count(BuildingType.Range) ? BuildingType.Barracks : BuildingType.Range, rally);
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
        for (const b of done(t)) {
          if (b.queue >= 2 || room <= 0 || !afford(rules.units[type].cost)) continue;
          out.push({ c: "train", building: b.id, type, n: 1 });
          spend(rules.units[type].cost);
          room--;
        }
      };
      const hallQueue = done(BuildingType.MageHall).reduce((a, b) => a + b.queue, 0);
      if (mages + hallQueue < rules.mageCap && res.crystal >= mageCost.crystal + plan.mageReserve * mages) trainAt(BuildingType.MageHall, UnitType.Mage);
      if (spear * 100 <= plan.spearShare * (spear + ranged)) {
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
        // Ruins (after our plunder or theirs) turn neutral again, with half the militia, when the
        // timer ends: a person reads the timer while there and comes back a little after it.
        if (id === myTown.id && t.state === TownState.Ruins && t.visible) nextTown = tick + t.timer + 100;
        else if (id === myTown.id && t.state === TownState.Ruins && lastState.get(id) === TownState.Plundering) nextTown = tick + RUINS_TICKS;
        lastState.set(id, t.state);
      }
      const isGuard = (id: number) => [...garrison.values()].some((ids) => ids.includes(id));
      for (const [id, t] of towns) {
        const held = t.owner === player && (t.state === TownState.Repairing || t.state === TownState.Governed);
        if (!held) garrison.delete(id);
        if (t.owner !== player || t.state !== TownState.AwaitingChoice) continue;
        const cost = GOVERN_COST[t.size];
        const govern = plan.choice === "govern" && affordAll(cost);
        out.push({ c: "town_choice", town: id, choice: govern ? TownChoice.Govern : TownChoice.Plunder });
        if (govern) spend(cost);
      }
      for (const [id, t] of towns) {
        const held = t.owner === player && (t.state === TownState.Repairing || t.state === TownState.Governed);
        if (!held) continue;
        const alive = (garrison.get(id) ?? []).filter((gid) => soldiers.some((s) => s.id === gid));
        const free = soldiers
          .filter((s) => !isGuard(s.id) && s.type === UnitType.Spearman)
          .sort((a, b) => dist2(a.x, a.y, t.x, t.y) - dist2(b.x, b.y, t.x, t.y) || a.id - b.id);
        while (alive.length < Math.max(t.needed, plan.guards) && free.length > 0) alive.push(free.shift()!.id);
        garrison.set(id, alive);
        const away = alive.filter((gid) => {
          const s = soldiers.find((u) => u.id === gid)!;
          return dist2(s.x, s.y, t.x, t.y) > 9;
        });
        if (away.length > 0 && tick % 100 === 0) out.push({ c: "move", u: away, x: t.x, y: t.y });
      }
      const army = soldiers.filter((u) => !isGuard(u.id));
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

      // --- defence: under the main city's arrows, farmers inside ---------------------------------------
      const atHome = foes.filter((f) => dist2(f.x, f.y, home.cellX, home.cellY) <= 16 * 16);
      // On the march and nearer the enemy's main city than our own: a person would press on.
      const committed = mode === "base" && dist2(cx, cy, enemyHome.cellX, enemyHome.cellY) < dist2(cx, cy, home.cellX, home.cellY);
      if (atHome.length > 0) {
        waveMax = Math.max(waveMax, atHome.length);
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
        if (tick - lastThreat >= 200 && waveMax > 0) {
          if (waveMax >= 6) {
            counterReady = true;
            waves++;
          }
          waveMax = 0;
        }
        if (mode === "defend") mode = "home";
      }

      // --- the town of the plan --------------------------------------------------------------------------
      const t = towns.get(myTown.id)!;
      const oursNow = t.owner === player && t.state !== TownState.Neutral;
      if (t.owner === player && (t.state === TownState.Plundering || t.state === TownState.AwaitingChoice)) {
        send(t.x, t.y, "town");
        return out;
      }
      if (mode === "town") {
        if (oursNow || tick < nextTown) mode = "home";
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
      const go = (counterReady && army.length >= plan.counterAt) || (plan.pushAt > 0 && army.length >= plan.pushAt);
      const townOpen = plan.townAt > 0 && !oursNow && tick >= nextTown && (trips === 0 || plan.again || plan.choice === "govern");
      if (go) {
        armyAtStart = army.length;
        marched.clear();
        for (const id of armyIds) marched.add(id);
        marches++;
        if (firstMarch < 0) firstMarch = tick;
        send(enemyHome.cellX, enemyHome.cellY, "base");
      } else if (townOpen && army.length >= (trips === 0 ? plan.townAt : Math.min(plan.townAt, 4))) {
        trips++;
        send(t.x, t.y, "town");
      } else {
        send(post.x, post.y, "home");
      }
      return out;
    },
  };
}
