// The scripted player's game (ai/scripted-player.ts as player 0 against the AI as player 1), one seed: what
// scripted-games.ts prints and writes (--json). Importing it plays nothing; war-game-ai's tools call playScripted
// with a plan of their own (D-147).

import { CrushWatch, type CrushRecord } from "./crush-watch.ts";
import { IdleWatch, type IdleRecord } from "./idle-watch.ts";
import { CityWatch, type CityRecord } from "./city-watch.ts";
import { DeathWatch, type DeathRecord } from "./death-watch.ts";
import { GoldWatch, type GoldRecord } from "./gold-watch.ts";
import { SiegeWatch, type SiegeRecord } from "./siege-watch.ts";
import { createScriptedPlayer, type Plan } from "./ai/scripted-player.ts";
import { type AiStyle, createAi } from "./ai/ai.ts";
import { NO_CRYSTAL, rules } from "./core/rules.ts";
import { UNIT_KINDS } from "./core/world.ts";
import type { RandomMap } from "./core/random-map.ts";
import { nearestWalkable } from "./core/paths.ts";
import { Action, type AiDifficulty, BuildingType, type MapMode, NodeKind, Order, Resource, TownSize, TownState, UnitType } from "./protocol.ts";
import { aiKnowledge, Runner } from "./runner.ts";
import { AiSeat, Bonus, WATCH_TICKS } from "./late-start.ts";
import { buildView, mapInfo } from "./view/view.ts";

/** D-081: an AI soldier dying this near (cells) one of the player's finished forts counts as lost to it. */
export const FORT_NEAR = 12;
/** D-081: a bash that cost the AI this many soldiers and pulled down none of the player's forts failed. */
export const FAILED_BASH = 10;
/** D-086 A: an AI order this soon after its last order at the player's main city is the same march. */
export const MARCH_GAP = 2 * 1200;
/** D-086 A: the late turn the measure looks for (the user's long wins): the player wins after this tick. */
export const LATE_WIN = 27 * 1200;
/** D-086 A3: an AI farmer with no order this near (cells) its main city is idle at home. */
export const FARMER_HOME = 15;
/** D-141 --steal-probe (scripted-games.ts): the probe's cavalry, how far from the AI's main city they start, and when the AI's army counts as out or home. */
const PROBE_AT = { cavalry: 30, from: 22, home: 20, out: 40, outMin: 15, homeMin: 15, outFew: 5 };

/** What a side has at a minute (push-late-siege). */
export interface LateSide {
  farmers: number;
  towers: number;
  spear: number;
  ranged: number;
  mage: number;
  cavalry: number;
  siege: number;
  governed: number;
}
export interface Wave {
  start: number;
  last: number;
  /** Most AI soldiers within 16 cells of the player's main city at once, and the most mages among them. */
  max: number;
  mages: number;
  /** The player's soldiers when it began: spearmen / ranged / mages. */
  mine: string;
  aiLost: number;
  myLost: number;
  farmersLost: number;
  /** The player's main city's hp when it ended. */
  cityHp: number;
}
export interface GameRecord {
  seed: number;
  style: string;
  /** "won", "lost" or "open" (still going at the cap). */
  result: "won" | "lost" | "open";
  endTick: number;
  /** The player first holds the small town nearest its main city; its first mage; the AI's first mage. */
  town: number;
  /** Per player, per town: when that player first held it, or -1 (round 6: the corner towns). */
  taken: [number[], number[]];
  myMage: number;
  /**
   * When the player first had a mage's crystal (early balance, D-057; with no crystal, D-135: a mage's gold), and its first
   * mage hall stood: did crystal or the hall hold the first mage back?
   */
  crystalForMage: number;
  hallDone: number;
  aiMage: number;
  /** The player's main city first hit, with the AI's soldiers (mages) near it then and the player's army. */
  cityHit: number;
  cityHitAi: [number, number];
  cityHitMine: string;
  /** The player's first march on the AI's main city. */
  firstMarch: number;
  marches: number;
  brokenOff: number;
  waves: Wave[];
  /** At the end: both main cities' hp, both armies (spearmen / ranged / mages). */
  cityHp: [number, number];
  armies: [string, string];
  /** Mages and (D-097) cavalry each side trained. */
  trained: { mages: [number, number]; cavalry: [number, number] };
  cannonShots: [number, number];
  /** Units each side's crystal cannon killed (round 8). */
  cannonKills: [number, number];
  /** The cannon's shots and kills each side by minute 20 (D-135: are mages stronger early without crystal). */
  cannonAt20: { shots: [number, number]; kills: [number, number] };
  /** Each side's mages alive at minute 20 (D-135; the AI's is player 1's); null if the game ended before. */
  magesAt20: [number, number] | null;
  rejected: number;
  /** Round 7 cavalry raids (--raid): raids sent, the first; the AI's farmers lost by minute 10 and in all. */
  raids: number;
  firstRaid: number;
  aiFarmersLost10: number;
  aiFarmersLost: number;
  /** D-072: when the race set out (-1: never, or not a race); how near the armies came after the first march (cells, -1: never both out); each main city's first hp lost and its fall (-1: never). */
  raced: number;
  armiesNearest: number;
  cityFirstHit: [number, number];
  cityFell: [number, number];
  /**
   * D-080, the tower rush only: when it set out, its outpost stood and its second tower was
   * placed (-1: never); and each outpost and arrow tower the player put down: when it was
   * placed, finished and pulled down (-1: never).
   */
  rush?: {
    start: number;
    outpost: number;
    towers: number;
    built: { kind: "outpost" | "tower"; placed: number; done: number; fell: number }[];
  };
  /**
   * D-081, every game: the AI's soldiers that died within FORT_NEAR cells of one of the player's
   * finished outposts or arrow towers (where they last stood, read every 20 ticks), and its bashes on
   * them: times 5 or more of its soldiers were at once within such a fort's reach (an arrow tower's
   * arrows, an outpost's guards' reach, from the footprint), counted once until 30 s pass with none
   * of them within reach.
   */
  fortDeaths: number;
  bashes: number;
  /**
   * Each bash: from the first tick some of its soldiers were within reach to the last; the most at once;
   * the AI's soldiers lost in it, and of those by the player's forts; the player's forts that fell in it.
   * One with 10 or more lost and no fort fallen is a failed bash.
   */
  bashLog: { start: number; end: number; most: number; lost: number; deaths: number; fell: number }[];
  /**
   * D-083, every game (read only): for each side [player, AI], the most population at once, the highest
   * cap and ceiling, the most finished houses and the most soldiers (not farmers) at once; and the AI's
   * minutes (looked at each minute) with its population full (within 2 of its cap) while its cap was a
   * house or more below its ceiling: room it did not build for.
   */
  pop: { most: [number, number]; cap: [number, number]; ceiling: [number, number]; houses: [number, number]; soldiers: [number, number]; stuck: number };
  /**
   * D-083 (D-081's leftover (a)): the AI's towns in Plundering (a plunder takes 15–25 s with its soldiers
   * inside): the longest stretch (ticks), and its soldiers that died within the town's radius + 4 cells
   * once a stretch had lasted a minute (where they last stood, read every 20 ticks).
   */
  plunder: { longest: number; deaths: number };
  /**
   * D-083 (ceo 2026-10-18: games where the AI sat at home with its army): the last tick 10 or more of the AI's soldiers
   * were more than 30 cells from its main city (-1: never).
   */
  aiAway: number;
  /** D-083 (c): at minute 15 the AI's farmers, finished houses and soldiers (null: the game was over by then). */
  aiAt15: { farmers: number; houses: number; soldiers: number } | null;
  /**
   * D-086 A, every game (read only): the AI's marches on the player's main city: its move and attack
   * orders with 10 or more soldiers aimed within 14 cells of it, or at it; an order within MARCH_GAP
   * ticks of the last is the same march. From the first order to the last, the most soldiers in one
   * order, and whether the player's main city fell by MARCH_GAP after the last.
   */
  aiMarches: { start: number; last: number; most: number; fell: boolean }[];
  /** D-086 A: soldiers (not farmers, not militia) of [the player, the AI] at minutes 10 (D-101), 15 and 20 (null: over by then). */
  armyAt: { m10: [number, number] | null; m15: [number, number] | null; m20: [number, number] | null };
  /** D-086 A5: arrow towers of [the player, the AI] at minutes 30 and 45 (null: over by then). */
  towersAt: { m30: [number, number] | null; m45: [number, number] | null };
  /** D-086 A5: the player's [farmers, soldiers, arrow towers] at minutes 5, 10, 15, 20, 25 and 30 (the user's pace to match). */
  pace: Record<string, [number, number, number]>;
  /** D-101: each side's own gold and when it ran out, the contested gold and how much each side mined it. */
  gold: GoldRecord;
  /** D-100 (ceo 2026-10-24): where the player's soldiers died (by a town and who held it, the AI's main city, home, the field), and to arrows. */
  deaths: DeathRecord;
  /** D-086 A5: towns [the player, the AI] governed at the end. */
  governedEnd: [number, number];
  /** push-crush, every game (read only): the first battle the AI lost big and the 15 minutes after it (null: none). */
  crush: CrushRecord | null;
  /** D-139: an idle army, each side (idle-watch.ts); the AI is side 1. */
  idle: IdleRecord;
  /** D-141: fights at either main city (city-watch.ts); fights[0] the player's at the AI's. */
  city: CityRecord;
  /**
   * D-141 --steal-probe: when the probe's 30 cavalry came (-1: the moment never came), the AI's soldiers then within
   * PROBE.home cells of its main city and beyond PROBE.out, and the first fight at its city from then on (city-watch.ts).
   */
  probe?: { at: number; aiHome: number; aiOut: number; fight: CityRecord["fights"][number][number] | null };
  /** push-late-siege: the player's engines (siege-watch.ts), and what each side had at minutes 30, 45, 60, 90. */
  siege?: SiegeRecord;
  lateAt?: Record<string, [LateSide, LateSide]>;
  /**
   * D-086 A3, every game (read only): the AI's farmers lost each minute (from minute 1); its hits (5 or more
   * lost in two minutes, none counted in the three minutes before) and of those, the ones back 3 minutes
   * later (within 2 of its farmers before the hit); its farmer-minutes idle at home (no order, within
   * FARMER_HOME cells of its main city) and hiding (Recall: on the way to its main city or in it), read
   * every 20 ticks.
   */
  aiFarmers: { lost: number[]; hits: number; back: number; idle: number; hiding: number };
  /** D-086 A3: what the AI counted of its own rescues (its stats(); null: this AI counts none). */
  aiRescue: Record<string, number> | null;
  /** Random maps (D-074): the map's layout and when the player first saw the AI's main city (-1: never). */
  layout?: string;
  found?: number;
  finalHash: string;
  trace?: string[];
}

/** A town's short name for the trace: the big city, the middle town, or a corner. */
function TOWN_SHORT(map: { size: number; towns: { size: number; cellX: number }[] }, t: number): string {
  const s = map.towns[t];
  if (s.size === TownSize.Large) return "大";
  const mid = map.size / 2;
  if (Math.abs(s.cellX - mid) < map.size / 4) return "中";
  return s.cellX < mid ? "左上" : "右下";
}

/** "=我治" (player 0 governs), "=電待" (the AI awaits its choice), "=廢" (ruins), "=中立". */
function townState(owner: number, state: number): string {
  const who = owner === 0 ? "我" : owner === 1 ? "電" : "";
  const what = ["中立", "待", "搶", "修", "治", "廢"][state] ?? "?";
  return state === TownState.Neutral || state === TownState.Ruins ? `=${what}` : `=${who}${what}`;
}

/** One game of the scripted player: everything playScripted reads besides the world. */
export interface ScriptedOptions {
  seed: number;
  plan: Plan;
  difficulty: AiDifficulty;
  map: MapMode;
  /** The AI's style; empty: drawn from the seed, as in an ordinary game. */
  style: string;
  /** The scripted player thinks every this many ticks. */
  think: number;
  /** Games still going at this tick are stopped and counted apart ("open"). */
  cap: number;
  /** Per-minute lines in the record (`trace`). */
  trace: boolean;
  /** push-late-siege's --takeover, in ticks (0: none). */
  takeover: number;
  /** push-crush's --bonus, percent (0: none). */
  bonus: number;
  /** D-141 --steal-probe: "" none, "away" or "home"; from this game minute (--steal-from). */
  probe: string;
  probeFrom: number;
}

export function playScripted(o: ScriptedOptions): GameRecord {
  const { seed, plan, difficulty, style, think, trace } = o;
  const mapMode = o.map;
  const CAP = o.cap;
  const TAKEOVER = o.takeover;
  const BONUS = o.bonus;
  const probeMode = o.probe;
  const PROBE = { ...PROBE_AT, fromMinute: o.probeFrom };
  const rushing = plan.towerRush > 0 || plan.rushBuildersOnly;
  /** The player puts up outposts and arrow towers: the rush or the fortress. */
  const fortifying = rushing || plan.fortress;
  const r = new Runner({
    seed,
    scenario: "standard",
    // --takeover: player 1's AI is played here (AiSeat), normal first.
    ai: [false, TAKEOVER === 0],
    maxTicks: 0,
    difficulty: ["normal", TAKEOVER === 0 ? difficulty : "normal"],
    styles: style === "" ? undefined : [style as AiStyle, style as AiStyle],
    // The scripted player's buildings train on their own only in the --auto-train group, so the
    // fixed groups play as before round 6.
    autoTrain: [plan.autoTrain, false],
    map: mapMode,
  });
  const g = r.game;
  const w = g.w;
  const map = w.map;
  // What the screen gets (view.ts mapInfo): on a random map its own main city only.
  const player = createScriptedPlayer(0, { map: mapInfo(map, 0), rules: rules(map), frame: map.frames[0] }, plan);
  const aiOf = (d: AiDifficulty) => createAi(1, seed, aiKnowledge(map, 1, 0, d), 1, style === "" ? undefined : (style as AiStyle));
  const seat = TAKEOVER > 0 ? new AiSeat(r, 1, aiOf("normal")) : null;
  const bonus = new Bonus(BONUS);
  const home = map.spawns[0];
  const u = w.units.col;
  const b = w.buildings.col;
  const count = (p: number, type: number) => {
    let n = 0;
    for (let i = 0; i < w.units.count; i++) if (u.owner[i] === p && u.type[i] === type) n++;
    return n;
  };
  const army = (p: number) => `${count(p, UnitType.Spearman)}/${count(p, UnitType.Ranged)}/${count(p, UnitType.Mage)}`;
  const lostSoldiers = (p: number) => w.lost[p * UNIT_KINDS + UnitType.Spearman] + w.lost[p * UNIT_KINDS + UnitType.Ranged] + w.lost[p * UNIT_KINDS + UnitType.Mage];
  /** Soldiers of p within r cells of (x, y), and the mages among them. */
  const near = (p: number, x: number, y: number, rad: number): [number, number] => {
    let n = 0;
    let mg = 0;
    for (let i = 0; i < w.units.count; i++) {
      if (u.owner[i] !== p || u.type[i] === UnitType.Farmer) continue;
      const dx = (u.x[i] >> 10) - x;
      const dy = (u.y[i] >> 10) - y;
      if (dx * dx + dy * dy > rad * rad) continue;
      n++;
      if (u.type[i] === UnitType.Mage) mg++;
    }
    return [n, mg];
  };
  const cityHp = (p: number) => {
    const s = w.mainCity(p);
    return s < 0 ? 0 : b.hp[s];
  };
  const myTown = map.towns
    .filter((t) => t.size === TownSize.Small)
    .sort((a, c) => (a.cellX - home.cellX) ** 2 + (a.cellY - home.cellY) ** 2 - (c.cellX - home.cellX) ** 2 - (c.cellY - home.cellY) ** 2 || a.id - c.id)[0];

  let seq = 0;
  let town = -1;
  const lastIncome = [
    [0, 0, 0],
    [0, 0, 0],
  ];
  let aiFarmersLost10 = -1;
  const taken: [number[], number[]] = [map.towns.map(() => -1), map.towns.map(() => -1)];
  let myMage = -1;
  let crystalForMage = -1;
  let cannonAt20: { shots: [number, number]; kills: [number, number] } | null = null;
  let magesAt20: [number, number] | null = null;
  let hallDone = -1;
  let aiMage = -1;
  let cityHit = -1;
  let cityHitAi: [number, number] = [0, 0];
  let cityHitMine = "";
  let rejected = 0;
  // D-072: when each main city first lost hp and when it fell; how near the two armies came after
  // the player's army first set out (cells between the centres of the player's soldiers and of the
  // AI's soldiers more than 20 cells from its main city, while both sides have 6 or more of them).
  const cityFirstHit: [number, number] = [-1, -1];
  const cityFell: [number, number] = [-1, -1];
  let armiesNearest = -1;
  // D-081: the AI's deaths by the player's forts and its bashes on them (GameRecord).
  const aiAt = new Map<number, { x: number; y: number }>();
  let fortDeaths = 0;
  let bashes = 0;
  let bashing = false;
  let bashMax = 0;
  let bashLast = -100000;
  const bashLog: GameRecord["bashLog"] = [];
  let bashAt = { start: 0, lost: 0, deaths: 0, fell: 0 };
  let fortIds = new Set<number>();
  const arrowReach = (rules().arrows.arrowTower.range + 1023) >> 10;
  const guardReach = rules().outpost.reach;
  // D-080: the player's outposts and arrow towers, by id: when placed, finished and gone.
  const rushBuilt = new Map<number, { kind: "outpost" | "tower"; placed: number; done: number; fell: number }>();
  const aiHome = map.spawns[1];
  const centre = (p: number, away: number): { x: number; y: number; n: number } => {
    let x = 0;
    let y = 0;
    let k = 0;
    for (let s = 0; s < w.units.count; s++) {
      const t = u.type[s];
      if (u.owner[s] !== p || t === UnitType.Farmer || t === UnitType.Militia || u.action[s] === Action.Garrisoned) continue;
      const cx = u.x[s] >> 10;
      const cy = u.y[s] >> 10;
      if (away > 0 && (cx - aiHome.cellX) ** 2 + (cy - aiHome.cellY) ** 2 <= away * away) continue;
      x += cx;
      y += cy;
      k++;
    }
    return k === 0 ? { x: 0, y: 0, n: 0 } : { x: x / k, y: y / k, n: k };
  };
  const waves: Wave[] = [];
  let wave: Wave | null = null;
  const closeWave = () => {
    if (wave === null) return;
    wave.aiLost = lostSoldiers(1) - wave.aiLost;
    wave.myLost = lostSoldiers(0) - wave.myLost;
    wave.farmersLost = w.lost[UnitType.Farmer] - wave.farmersLost;
    wave.cityHp = cityHp(0);
    waves.push(wave);
    wave = null;
  };
  const lines: string[] = [];
  // D-083 (read only): population, houses and soldiers; the AI's plunders that do not end.
  const popMost: [number, number] = [0, 0];
  const capMost: [number, number] = [0, 0];
  const ceilingMost: [number, number] = [0, 0];
  const housesMost: [number, number] = [0, 0];
  const soldiersMost: [number, number] = [0, 0];
  let popStuck = 0;
  const plunderFrom = map.towns.map(() => -1);
  let plunderLongest = 0;
  let plunderDeaths = 0;
  const plunderAt = new Map<number, { x: number; y: number }>();
  let aiAway = -1;
  let aiAt15: GameRecord["aiAt15"] = null;
  const marchLog: { start: number; last: number; most: number }[] = [];
  let logAt = 0;
  const armyAt: GameRecord["armyAt"] = { m10: null, m15: null, m20: null };
  const deaths = new DeathWatch(0);
  const towersAt: GameRecord["towersAt"] = { m30: null, m45: null };
  const pace: GameRecord["pace"] = {};
  const goldWatch = new GoldWatch(w);
  const crushWatch = new CrushWatch();
  const idleWatch = new IdleWatch(g);
  const cityWatch = new CityWatch();
  const siegeWatch = new SiegeWatch(0);
  const lateAt: Record<string, [LateSide, LateSide]> = {};
  const lateSide = (p: number): LateSide => ({
    farmers: count(p, UnitType.Farmer),
    towers: towersOf(p),
    spear: count(p, UnitType.Spearman),
    ranged: count(p, UnitType.Ranged),
    mage: count(p, UnitType.Mage),
    cavalry: count(p, UnitType.Cavalry),
    siege: count(p, UnitType.Siege),
    governed: w.townOwner.filter((o, t) => o === p && w.townState[t] === TownState.Governed).length,
  });
  const towersOf = (p: number) => {
    let n = 0;
    for (let s = 0; s < w.buildings.count; s++) if (b.owner[s] === p && b.type[s] === BuildingType.ArrowTower) n++;
    return n;
  };
  // D-086 A3 (read only): the AI's farmers lost, hit and back, idle and hiding (GameRecord).
  const farmerLog: { farmers: number; lost: number }[] = [];
  const farmerChecks: { at: number; before: number }[] = [];
  const aiFarmers: GameRecord["aiFarmers"] = { lost: [], hits: 0, back: 0, idle: 0, hiding: 0 };
  let lastFarmerHit = -100;
  let farmerIdle = 0;
  let farmerHiding = 0;
  const soldiersOf = (p: number) => {
    let n = 0;
    for (let i = 0; i < w.units.count; i++) if (u.owner[i] === p && u.type[i] !== UnitType.Farmer && u.type[i] !== UnitType.Militia) n++;
    return n;
  };
  let probe: GameRecord["probe"] = probeMode === "" ? undefined : { at: -1, aiHome: 0, aiOut: 0, fight: null };
  let probeIds: number[] = [];
  while (!r.over && w.tick < CAP) {
    if (w.tick % think === 0) {
      for (const body of player.think(buildView(g, 0))) r.command(0, { ...body, seq: seq++ });
    }
    if (probe !== undefined && w.tick >= PROBE.fromMinute * 1200 && w.tick % 20 === 0) {
      const cs = w.mainCity(1);
      if (cs >= 0 && probe.at < 0) {
        const cx = b.cellX[cs] + 2;
        const cy = b.cellY[cs] + 2;
        let near = 0;
        let far = 0;
        for (let s = 0; s < w.units.count; s++) {
          if (u.owner[s] !== 1 || u.type[s] === UnitType.Farmer) continue;
          const d = Math.max(Math.abs((u.x[s] >> 10) - cx), Math.abs((u.y[s] >> 10) - cy));
          if (d <= PROBE.home) near++;
          else if (d > PROBE.out) far++;
        }
        const go = probeMode === "away" ? far >= PROBE.outMin : near >= PROBE.homeMin && far < PROBE.outFew;
        if (go) {
          // From the AI's main city toward the map's middle.
          const n = w.size;
          const len = Math.max(1, Math.hypot(n / 2 - cx, n / 2 - cy));
          const at = nearestWalkable(w, Math.round(cx + ((n / 2 - cx) * PROBE.from) / len), Math.round(cy + ((n / 2 - cy) * PROBE.from) / len));
          for (let k = 0; k < PROBE.cavalry; k++) probeIds.push(w.addUnit(0, UnitType.Cavalry, ((at % n) << 10) + 512, (Math.trunc(at / n) << 10) + 512, rules().units[UnitType.Cavalry].hp));
          plan.ignore = new Set(probeIds);
          probe.at = w.tick;
          probe.aiHome = near;
          probe.aiOut = far;
        }
      }
      // The probe's cavalry keep at the city.
      probeIds = probeIds.filter((id) => w.unit(id) >= 0);
      // At the city once it is in sight; till then toward it (an attack-move).
      if (probe.at >= 0 && probeIds.length > 0 && cs >= 0 && (w.tick - probe.at) % 200 === 0) {
        const seen = g.fog.visible[0][(b.cellY[cs] + 1) * w.size + b.cellX[cs] + 1] === 1;
        r.command(0, seen ? { c: "attack", u: probeIds, target: b.id[cs], seq: seq++ } : { c: "move", u: probeIds, x: b.cellX[cs] + 1, y: b.cellY[cs] + 4, seq: seq++ });
      }
      if (process.env.PROBE_DEBUG && probe.at >= 0 && (w.tick - probe.at) % 100 === 0 && w.tick - probe.at <= 2400) {
        const xs = probeIds.map((id) => u.x[w.unit(id)] >> 10), ys = probeIds.map((id) => u.y[w.unit(id)] >> 10);
        console.error(`PROBE t${((w.tick - probe.at) / 20).toFixed(0)}s alive ${probeIds.length} centre ${Math.round(xs.reduce((a, v) => a + v, 0) / Math.max(1, xs.length))},${Math.round(ys.reduce((a, v) => a + v, 0) / Math.max(1, ys.length))} city ${cs >= 0 ? b.cellX[cs] + "," + b.cellY[cs] + " hp " + b.hp[cs] : "down"} actions ${probeIds.slice(0, 3).map((id) => u.action[w.unit(id)] + "/" + u.order[w.unit(id)]).join(" ")}`);
      }
    }
    if (seat !== null) {
      if (w.tick === TAKEOVER - WATCH_TICKS) seat.takeOver(aiOf(difficulty), TAKEOVER);
      seat.think();
    }
    r.tick();
    bonus.tick(w);
    deaths.tick(w);
    crushWatch.tick(w);
    idleWatch.tick();
    cityWatch.tick(w);
    if (plan.lateSiege) {
      siegeWatch.tick(w, g.events, player.state().mode === "base");
      if (w.tick % (15 * 1200) === 0 && w.tick >= 30 * 1200 && w.tick <= 90 * 1200) lateAt[`m${w.tick / 1200}`] = [lateSide(0), lateSide(1)];
    }
    if (w.tick === 12000) aiFarmersLost10 = w.lost[UNIT_KINDS + UnitType.Farmer];
    // D-086 A: the AI's orders this tick at the player's main city with 10 or more soldiers.
    for (; logAt < g.log.length; logAt++) {
      const c = g.log[logAt];
      if (c.p !== 1 || (c.c !== "move" && c.c !== "attack")) continue;
      let at = false;
      if (c.c === "move") at = (c.x - home.cellX - 2) ** 2 + (c.y - home.cellY - 2) ** 2 <= 14 * 14;
      else {
        const s = w.building(c.target);
        at = s >= 0 && b.owner[s] === 0 && b.type[s] === BuildingType.MainCity;
      }
      if (!at) continue;
      let n = 0;
      for (const id of c.u) {
        const s = w.unit(id);
        if (s >= 0 && u.type[s] !== UnitType.Farmer) n++;
      }
      if (n < 10) continue;
      const last = marchLog[marchLog.length - 1];
      if (last !== undefined && c.t - last.last < MARCH_GAP) {
        last.last = c.t;
        last.most = Math.max(last.most, n);
      } else marchLog.push({ start: c.t, last: c.t, most: n });
    }
    if (w.tick % 20 === 0) {
      for (let i = 0; i < w.units.count; i++) {
        if (u.owner[i] !== 1 || u.type[i] !== UnitType.Farmer) continue;
        if (u.order[i] === Order.Recall) farmerHiding++;
        else if (u.order[i] === Order.None && ((u.x[i] >> 10) - aiHome.cellX) ** 2 + ((u.y[i] >> 10) - aiHome.cellY) ** 2 <= FARMER_HOME * FARMER_HOME) farmerIdle++;
      }
    }
    if (w.tick % 1200 === 0) {
      const lost = w.lost[UNIT_KINDS + UnitType.Farmer];
      aiFarmers.lost.push(lost - (farmerLog.length === 0 ? 0 : farmerLog[farmerLog.length - 1].lost));
      farmerLog.push({ farmers: count(1, UnitType.Farmer), lost });
      const k = farmerLog.length - 1;
      if (k >= 2 && farmerLog[k].lost - farmerLog[k - 2].lost >= 5 && k - lastFarmerHit > 3) {
        lastFarmerHit = k;
        aiFarmers.hits++;
        farmerChecks.push({ at: k + 3, before: farmerLog[k - 2].farmers });
      }
      for (const x of farmerChecks) if (x.at === k && farmerLog[k].farmers >= x.before - 2) aiFarmers.back++;
    }
    if (w.tick % 1200 === 0) goldWatch.minute(w);
    if (w.tick === 10 * 1200) armyAt.m10 = [soldiersOf(0), soldiersOf(1)];
    if (w.tick === 15 * 1200) armyAt.m15 = [soldiersOf(0), soldiersOf(1)];
    if (w.tick === 20 * 1200) {
      armyAt.m20 = [soldiersOf(0), soldiersOf(1)];
      cannonAt20 = { shots: [w.cannonShots[0], w.cannonShots[1]], kills: [w.cannonKills[0], w.cannonKills[1]] };
      magesAt20 = [count(0, UnitType.Mage), count(1, UnitType.Mage)];
    }
    if (w.tick === 30 * 1200) towersAt.m30 = [towersOf(0), towersOf(1)];
    if (w.tick === 45 * 1200) towersAt.m45 = [towersOf(0), towersOf(1)];
    if (w.tick % (5 * 1200) === 0 && w.tick > 0 && w.tick <= 30 * 1200) pace[`m${w.tick / 1200}`] = [count(0, UnitType.Farmer), soldiersOf(0), towersOf(0)];
    for (const e of g.events) if (e.to === 0 && e.ev.k === "rejected") rejected++;
    if (town < 0 && w.townOwner[myTown.id] === 0) town = w.tick;
    for (let p = 0; p < 2; p++) for (let k = 0; k < taken[p].length; k++) if (taken[p][k] < 0 && w.townOwner[k] === p) taken[p][k] = w.tick;
    if (myMage < 0 && count(0, UnitType.Mage) > 0) myMage = w.tick;
    if (crystalForMage < 0 && (NO_CRYSTAL.on ? w.res[Resource.Gold] >= rules().units[UnitType.Mage].cost.gold : w.res[Resource.Crystal] >= rules().units[UnitType.Mage].cost.crystal)) crystalForMage = w.tick;
    if (hallDone < 0) {
      for (let s = 0; s < w.buildings.count; s++) if (b.owner[s] === 0 && b.type[s] === BuildingType.MageHall && b.progress[s] >= 1000) hallDone = w.tick;
    }
    if (aiMage < 0 && count(1, UnitType.Mage) > 0) aiMage = w.tick;
    if (w.tick % 20 === 0) {
      const forts: { x: number; y: number; size: number; reach: number }[] = [];
      for (let s = 0; s < w.buildings.count; s++) {
        if (b.owner[s] !== 0 || b.progress[s] < 1000 || (b.type[s] !== BuildingType.Outpost && b.type[s] !== BuildingType.ArrowTower)) continue;
        forts.push({ x: b.cellX[s], y: b.cellY[s], size: w.buildingSize(b.type[s]), reach: b.type[s] === BuildingType.ArrowTower ? arrowReach : guardReach });
      }
      const within = (x: number, y: number, f: { x: number; y: number; size: number }, r: number) => {
        const dx = Math.max(f.x - x, 0, x - (f.x + f.size - 1));
        const dy = Math.max(f.y - y, 0, y - (f.y + f.size - 1));
        return dx * dx + dy * dy <= r * r;
      };
      // The player's finished forts that fell since the last look.
      const ids = new Set<number>();
      for (let s = 0; s < w.buildings.count; s++) {
        if (b.owner[s] === 0 && b.progress[s] >= 1000 && (b.type[s] === BuildingType.Outpost || b.type[s] === BuildingType.ArrowTower)) ids.add(b.id[s]);
      }
      let fell = 0;
      for (const id of fortIds) if (!ids.has(id) && w.building(id) < 0) fell++;
      fortIds = ids;
      if (bashing) bashAt.fell += fell;
      if (forts.length === 0) aiAt.clear();
      else {
        const seen = new Set<number>();
        let inReach = 0;
        for (let i = 0; i < w.units.count; i++) {
          if (u.owner[i] !== 1 || u.type[i] === UnitType.Farmer) continue;
          const x = u.x[i] >> 10;
          const y = u.y[i] >> 10;
          seen.add(u.id[i]);
          aiAt.set(u.id[i], { x, y });
          if (forts.some((f) => within(x, y, f, f.reach))) inReach++;
        }
        for (const [id, at] of aiAt) {
          if (seen.has(id)) continue;
          aiAt.delete(id);
          if (w.unit(id) < 0 && forts.some((f) => within(at.x, at.y, f, FORT_NEAR))) fortDeaths++;
        }
        if (inReach > 0) {
          if (!bashing) {
            bashMax = 0;
            bashAt = { start: w.tick, lost: lostSoldiers(1), deaths: fortDeaths, fell: 0 };
          }
          bashing = true;
          bashMax = Math.max(bashMax, inReach);
          bashLast = w.tick;
        }
      }
      if (bashing && w.tick - bashLast >= 600) {
        if (bashMax >= 5) {
          bashes++;
          bashLog.push({ start: bashAt.start, end: bashLast, most: bashMax, lost: lostSoldiers(1) - bashAt.lost, deaths: fortDeaths - bashAt.deaths, fell: bashAt.fell });
        }
        bashing = false;
      }
    }
    if (fortifying) {
      for (let s = 0; s < w.buildings.count; s++) {
        if (b.owner[s] !== 0 || (b.type[s] !== BuildingType.Outpost && b.type[s] !== BuildingType.ArrowTower)) continue;
        let x = rushBuilt.get(b.id[s]);
        if (x === undefined) {
          x = { kind: b.type[s] === BuildingType.Outpost ? "outpost" : "tower", placed: w.tick, done: -1, fell: -1 };
          rushBuilt.set(b.id[s], x);
        }
        if (x.done < 0 && b.progress[s] >= 1000) x.done = w.tick;
      }
      for (const [id, x] of rushBuilt) if (x.fell < 0 && w.building(id) < 0) x.fell = w.tick;
    }
    for (let p = 0; p < 2; p++) {
      if (cityFirstHit[p] < 0 && cityHp(p) < rules().buildings[BuildingType.MainCity].hp) cityFirstHit[p] = w.tick;
      if (cityFell[p] < 0 && w.mainCity(p) < 0) cityFell[p] = w.tick;
    }
    if (w.tick % 20 === 0 && player.state().firstMarch >= 0) {
      const mine = centre(0, 0);
      const theirs = centre(1, 20);
      if (mine.n >= 6 && theirs.n >= 6) {
        const d = Math.round(Math.hypot(mine.x - theirs.x, mine.y - theirs.y));
        if (armiesNearest < 0 || d < armiesNearest) armiesNearest = d;
      }
    }
    if (cityHit < 0 && cityHp(0) < 1200) {
      cityHit = w.tick;
      cityHitAi = near(1, home.cellX, home.cellY, 16);
      cityHitMine = army(0);
    }
    if (w.tick % 20 === 0) {
      for (let p = 0; p < 2; p++) {
        let n = 0;
        for (let i = 0; i < w.units.count; i++) if (u.owner[i] === p && u.type[i] !== UnitType.Farmer && u.type[i] !== UnitType.Militia) n++;
        soldiersMost[p] = Math.max(soldiersMost[p], n);
      }
      let out = 0;
      for (let i = 0; i < w.units.count; i++) {
        if (u.owner[i] !== 1 || u.type[i] === UnitType.Farmer || u.type[i] === UnitType.Militia) continue;
        const dx = (u.x[i] >> 10) - aiHome.cellX;
        const dy = (u.y[i] >> 10) - aiHome.cellY;
        if (dx * dx + dy * dy > 30 * 30) out++;
      }
      if (out >= 10) aiAway = w.tick;
      // The AI's plunders: how long each has lasted, and its soldiers lost by one once it has lasted a minute.
      const stale: number[] = [];
      for (let k = 0; k < map.towns.length; k++) {
        if (w.townOwner[k] === 1 && w.townState[k] === TownState.Plundering) {
          if (plunderFrom[k] < 0) plunderFrom[k] = w.tick;
          plunderLongest = Math.max(plunderLongest, w.tick - plunderFrom[k]);
          if (w.tick - plunderFrom[k] >= 1200) stale.push(k);
        } else plunderFrom[k] = -1;
      }
      if (stale.length === 0) plunderAt.clear();
      else {
        const seen = new Set<number>();
        for (let i = 0; i < w.units.count; i++) {
          if (u.owner[i] !== 1 || u.type[i] === UnitType.Farmer) continue;
          seen.add(u.id[i]);
          plunderAt.set(u.id[i], { x: u.x[i] >> 10, y: u.y[i] >> 10 });
        }
        for (const [id, at] of plunderAt) {
          if (seen.has(id)) continue;
          plunderAt.delete(id);
          if (w.unit(id) >= 0) continue;
          const by = stale.some((k) => {
            const t = map.towns[k];
            const r = (rules().towns?.[t.size]?.radius ?? 5) + 4;
            return (at.x - t.cellX) ** 2 + (at.y - t.cellY) ** 2 <= r * r;
          });
          if (by) plunderDeaths++;
        }
      }
    }
    if (w.tick === 15 * 1200) {
      let farmers = 0;
      let soldiers = 0;
      for (let i = 0; i < w.units.count; i++) {
        if (u.owner[i] !== 1) continue;
        if (u.type[i] === UnitType.Farmer) farmers++;
        else if (u.type[i] !== UnitType.Militia) soldiers++;
      }
      let houses = 0;
      for (let s = 0; s < w.buildings.count; s++) if (b.owner[s] === 1 && b.type[s] === BuildingType.House && b.progress[s] >= 1000) houses++;
      aiAt15 = { farmers, houses, soldiers };
    }
    if (w.tick % 1200 === 0) {
      for (let p = 0; p < 2; p++) {
        const pop = w.population(p);
        const cap = w.populationCap(p);
        const ceiling = w.populationCeiling(p);
        popMost[p] = Math.max(popMost[p], pop);
        capMost[p] = Math.max(capMost[p], cap);
        ceilingMost[p] = Math.max(ceilingMost[p], ceiling);
        let houses = 0;
        for (let s = 0; s < w.buildings.count; s++) if (b.owner[s] === p && b.type[s] === BuildingType.House && b.progress[s] >= 1000) houses++;
        housesMost[p] = Math.max(housesMost[p], houses);
        if (p === 1 && pop >= cap - 2 && cap + rules().buildings[BuildingType.House].populationCap <= ceiling) popStuck++;
      }
    }
    // Waves: 4 or more AI soldiers within 16 cells of the player's main city.
    if (w.tick % 20 === 0) {
      const [n, mg] = near(1, home.cellX, home.cellY, 16);
      if (wave === null && n >= 4) {
        wave = { start: w.tick, last: w.tick, max: n, mages: mg, mine: army(0), aiLost: lostSoldiers(1), myLost: lostSoldiers(0), farmersLost: w.lost[UnitType.Farmer], cityHp: 0 };
      } else if (wave !== null) {
        if (n > 0) {
          wave.last = w.tick;
          wave.max = Math.max(wave.max, n);
          wave.mages = Math.max(wave.mages, mg);
        } else if (w.tick - wave.last >= 200) closeWave();
      }
    }
    if (trace && w.tick % 1200 === 0) {
      const res = (p: number) => [Resource.Food, Resource.Wood, Resource.Gold, Resource.Crystal].map((k) => w.res[p * 4 + k]).join("/");
      // Round 7 (D-061): who holds each town and how, and this minute's income by source.
      const income = (p: number) => {
        let g = 0;
        for (let k = 0; k < 4; k++) g += w.gathered[p * 4 + k];
        const now = [g, w.townIncome[p], w.plunderIncome[p]];
        const d = now.map((v, k) => v - lastIncome[p][k]);
        lastIncome[p] = now;
        return `收入 採${d[0]} 城${d[1]} 搶${d[2]}`;
      };
      const towns = map.towns.map((_, k) => `${TOWN_SHORT(map, k)}${townState(w.townOwner[k], w.townState[k])}`).join(" ");
      // Where the soldiers are (D-072): the centre of those standing (cells).
      const at = (p: number) => {
        const c = centre(p, 0);
        return c.n === 0 ? "" : ` @(${Math.round(c.x)},${Math.round(c.y)})`;
      };
      // D-086 A5: farmers on gold and the gold left within 20 cells of the player's main city.
      let onGold = 0;
      for (let i = 0; i < w.units.count; i++) if (u.owner[i] === 0 && u.type[i] === UnitType.Farmer && u.order[i] === Order.Gather && u.orderTarget[i] >= 0 && u.orderTarget[i] < w.nodeKind.length && w.nodeKind[u.orderTarget[i]] === NodeKind.GoldMine) onGold++;
      let goldNear = 0;
      for (let k = 0; k < w.nodeKind.length; k++) if (w.nodeKind[k] === NodeKind.GoldMine && (w.nodeX[k] - home.cellX) * (w.nodeX[k] - home.cellX) + (w.nodeY[k] - home.cellY) * (w.nodeY[k] - home.cellY) <= 400) goldNear += w.nodeAmount[k];
      lines.push(
        `${(w.tick / 1200).toFixed(0)} 分｜我 ${res(0)} 農 ${count(0, UnitType.Farmer)}（金 ${onGold}，家旁金 ${goldNear}） 兵 ${army(0)}${at(0)} ${player.state().mode} 城 ${cityHp(0)} ${income(0)}｜電腦 ${res(1)} 農 ${count(1, UnitType.Farmer)} 兵 ${army(1)}${at(1)} 城 ${cityHp(1)} ${income(1)}｜${towns}`,
      );
    }
  }
  closeWave();
  if (bashing && bashMax >= 5) {
    bashes++;
    bashLog.push({ start: bashAt.start, end: bashLast, most: bashMax, lost: lostSoldiers(1) - bashAt.lost, deaths: fortDeaths - bashAt.deaths, fell: bashAt.fell });
  }
  const st = player.state();
  aiFarmers.idle = Math.round((farmerIdle * 20 * 10) / 1200) / 10;
  aiFarmers.hiding = Math.round((farmerHiding * 20 * 10) / 1200) / 10;
  const aiRescue = (r as unknown as { ais: ({ stats?: () => Record<string, number> } | null)[] }).ais[1]?.stats?.() ?? null;
  return {
    seed,
    style: r.styles[1] ?? "",
    result: !r.over ? "open" : w.winner === 0 ? "won" : "lost",
    endTick: w.tick,
    town,
    taken,
    myMage,
    crystalForMage,
    hallDone,
    aiMage,
    cityHit,
    cityHitAi,
    cityHitMine,
    firstMarch: st.firstMarch,
    raids: st.raids,
    firstRaid: st.firstRaid,
    aiFarmersLost10,
    aiFarmersLost: w.lost[UNIT_KINDS + UnitType.Farmer],
    raced: st.raced,
    armiesNearest,
    cityFirstHit,
    cityFell,
    ...(fortifying
      ? {
          rush: { ...(plan.fortress ? st.fortress : st.rush), built: [...rushBuilt.values()] },
        }
      : {}),
    fortDeaths,
    bashes,
    bashLog,
    pop: { most: popMost, cap: capMost, ceiling: ceilingMost, houses: housesMost, soldiers: soldiersMost, stuck: popStuck },
    plunder: { longest: plunderLongest, deaths: plunderDeaths },
    aiAway,
    aiAt15,
    aiMarches: marchLog.map((x) => ({ ...x, fell: cityFell[0] >= 0 && cityFell[0] <= x.last + MARCH_GAP })),
    armyAt,
    deaths: deaths.result(),
    towersAt,
    pace,
    gold: goldWatch.result(),
    governedEnd: [0, 1].map((p) => w.townOwner.filter((o, t) => o === p && w.townState[t] === TownState.Governed).length) as [number, number],
    crush: crushWatch.result(),
    idle: idleWatch.result(),
    city: cityWatch.result(w),
    ...(probe !== undefined ? { probe: { ...probe, fight: probe.at < 0 ? null : (cityWatch.result(w).fights[0].find((f) => f.start >= probe!.at - 20) ?? null) } } : {}),
    ...(plan.lateSiege ? { siege: siegeWatch.result(), lateAt } : {}),
    aiFarmers,
    aiRescue,
    marches: st.marches,
    brokenOff: st.brokenOff,
    waves,
    cityHp: [cityHp(0), cityHp(1)],
    armies: [army(0), army(1)],
    trained: { mages: [w.trained[UnitType.Mage], w.trained[UNIT_KINDS + UnitType.Mage]], cavalry: [w.trained[UnitType.Cavalry], w.trained[UNIT_KINDS + UnitType.Cavalry]] },
    cannonShots: [w.cannonShots[0], w.cannonShots[1]],
    cannonKills: [w.cannonKills[0], w.cannonKills[1]],
    cannonAt20: cannonAt20 ?? { shots: [w.cannonShots[0], w.cannonShots[1]], kills: [w.cannonKills[0], w.cannonKills[1]] },
    magesAt20,
    rejected,
    ...(mapMode !== "fixed" ? { layout: (map as RandomMap).layout, found: st.found } : {}),
    finalHash: (g.hash() >>> 0).toString(16).padStart(8, "0"),
    ...(trace ? { trace: lines } : {}),
  };
}
