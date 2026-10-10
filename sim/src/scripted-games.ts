// The scripted player (ai/scripted-player.ts) as player 0 against the AI as player 1, without a
// time limit (as when a person plays): game by game, who won and when, the first mages, the
// first hit on the player's main city, its first march, and every wave of the AI at its door
// (D-045, D-046). The player decides from its own view only; the numbers here read the world.
//   node src/scripted-games.ts --seeds 1-15 --strategy defend --speed h1 --formation close
//   node src/scripted-games.ts --seeds 1,2,3 --strategy push --trace --json out.json
//   node src/scripted-games.ts --seeds 1-20 --strategy push --no-range --no-mage   (spearmen only)
//   node src/scripted-games.ts --seeds 1-40 --strategy push --corners --govern   (round 7: govern every town taken)
//   node src/scripted-games.ts --seeds 1-40 --strategy push --map random   (D-074: the player and the AI both scout)
// Prints Markdown; with --json also writes every game's details. Reports only, no threshold.

import { writeFileSync } from "node:fs";
import { createScriptedPlayer, FORMATIONS, type Formation, planFor, SCRIPTED_THINK_EVERY, SPEEDS, type Speed, STRATEGIES, type Strategy } from "./ai/scripted-player.ts";
import { type AiStyle, AI_STYLES } from "./ai/ai.ts";
import { rules } from "./core/rules.ts";
import { UNIT_KINDS } from "./core/world.ts";
import type { RandomMap } from "./core/random-map.ts";
import { Action, AI_DIFFICULTIES, type AiDifficulty, BuildingType, MAP_MODES, type MapMode, Resource, TownSize, TownState, UnitType } from "./protocol.ts";
import { Runner } from "./runner.ts";
import { buildView, mapInfo } from "./view/view.ts";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}
const flag = (name: string) => process.argv.includes(`--${name}`);
function oneOf<T extends string>(name: string, values: readonly T[], fallback: T): T {
  const v = arg(name, fallback);
  if (!(values as readonly string[]).includes(v)) throw new Error(`--${name} ${v}: one of ${values.join(", ")}`);
  return v as T;
}
/** "1-5" or "1,3,7" (or both: "1-3,9"). */
function seedList(text: string): number[] {
  const out: number[] = [];
  for (const part of text.split(",")) {
    const [a, b] = part.split("-").map(Number);
    if (b === undefined) out.push(a);
    else for (let s = a; s <= b; s++) out.push(s);
  }
  return out;
}

const strategy = oneOf<Strategy>("strategy", STRATEGIES, "defend");
const speed = oneOf<Speed>("speed", SPEEDS, "h1");
const formation = oneOf<Formation>("formation", FORMATIONS, "close");
const difficulty = oneOf<AiDifficulty>("difficulty", AI_DIFFICULTIES, "normal");
const mapMode = oneOf<MapMode>("map", MAP_MODES, "fixed");
/** The AI's style for every game; empty: drawn from the seed, as in an ordinary game. */
const style = arg("style", "");
if (style !== "" && !(AI_STYLES as readonly string[]).includes(style)) throw new Error(`--style ${style}: one of ${AI_STYLES.join(", ")}`);
const seeds = seedList(arg("seeds", "1-5"));
const think = Number(arg("think", String(SCRIPTED_THINK_EVERY)));
/** Games still going at this game minute are stopped and counted apart. */
const CAP = Number(arg("cap", "50")) * 1200;
/** D-081: an AI soldier dying this near (cells) one of the player's finished forts counts as lost to it. */
const FORT_NEAR = 12;
/** D-081: a bash that cost the AI this many soldiers and pulled down none of the player's forts failed. */
const FAILED_BASH = 10;
const trace = flag("trace");
const jsonOut = arg("json", "");
const plan = planFor(strategy, speed, formation);
// Options outside the fixed groups (ceo's measurements, D-046): the economy ratio left at
// 40/35/25, no mage hall, no range (with --no-mage too: spearmen only).
if (flag("static-ratio")) plan.staticRatio = true;
if (flag("no-mage")) plan.noMage = true;
if (flag("no-range")) plan.noRange = true;
if (flag("corners")) plan.corners = true;
if (flag("auto-train")) plan.autoTrain = true;
// Round 7 (D-061): every town taken is governed, not plundered.
if (flag("govern")) plan.choice = "govern";
// Round 7 (D-061): cavalry raiders, this many (--raid 4).
plan.raid = Number(arg("raid", "0"));
// D-072: racing the AI to its main city (--race edge|sentry), with these numbers.
const race = arg("race", "");
if (race !== "" && race !== "edge" && race !== "sentry") throw new Error(`--race ${race}: edge or sentry`);
plan.race = race;
plan.raceAt = Number(arg("race-at", String(plan.raceAt)));
plan.raceSeen = Number(arg("race-seen", String(plan.raceSeen)));
plan.raceBy = Number(arg("race-by", String(plan.raceBy / 1200))) * 1200;
plan.raceStage = flag("race-stage");
// D-080: the tower rush, with this many spearmen (--tower-rush 6), or its builders alone (--tower-rush-farmers).
plan.towerRush = Number(arg("tower-rush", "0"));
plan.rushBuildersOnly = flag("tower-rush-farmers");
// D-081: the midway fortress (--fortress).
plan.fortress = flag("fortress");
// D-081: the army holds by the fortress until it is this many or minute 30 (--fortress-hold 60).
plan.fortressHold = Number(arg("fortress-hold", "0"));
if (plan.fortressHold > 0) plan.fortress = true;
const rushing = plan.towerRush > 0 || plan.rushBuildersOnly;
/** The player puts up outposts and arrow towers: the rush or the fortress. */
const fortifying = rushing || plan.fortress;
// D-072: the user's economy (ai's replay of the game they beat hard): automatic training, 16
// farmers, no gold until the plunder, one trip, to the big town with 10 soldiers.
if (flag("user-eco")) {
  plan.userEco = true;
  plan.bigTown = true;
  plan.autoTrain = true;
  plan.hallFirst = false;
  plan.farmers = 16;
  plan.townAt = 10;
  plan.again = false;
}

const NAMES: Record<Strategy, string> = { push: "主動", defend: "守家", notown: "守家、不拿城鎮" };
const SPEED_NAMES: Record<Speed, string> = { h1: "手速 H1", eco: "經濟養大" };
const FORMATION_NAMES: Record<Formation, string> = { close: "密集", shooters: "遠程和法師散開", all: "整隊散開" };
const LEVEL_NAMES: Record<string, string> = { easy: "簡單", normal: "普通", hard: "困難" };
const STYLE_NAMES: Record<string, string> = { plunder: "掠奪型", govern: "治理型", balanced: "均衡型" };
const m = (t: number) => (t < 0 ? "沒有" : (t / 1200).toFixed(1));

interface Wave {
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
interface GameRecord {
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
  /** When the player first had a mage's crystal (early balance, D-057), and its first mage hall stood: did crystal or the hall hold the first mage back? */
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
  trained: { mages: [number, number] };
  cannonShots: [number, number];
  /** Units each side's crystal cannon killed (round 8). */
  cannonKills: [number, number];
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

function play(seed: number): GameRecord {
  const r = new Runner({
    seed,
    scenario: "standard",
    ai: [false, true],
    maxTicks: 0,
    difficulty: ["normal", difficulty],
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
  const home = map.spawns[0];
  const u = w.units.col;
  // SCRATCH (dtrace): the AI's last command naming each of its units.
  const lastCmd = new Map<number, string>();
  const aiAct = new Map<number, string>();
  {
    const ai = (r as unknown as { ais: ({ think: (v: unknown) => { c: string; u?: number[] | number; x?: number; y?: number; target?: number; building?: number; node?: number }[] } | null)[] }).ais[1]!;
    const think = ai.think.bind(ai);
    ai.think = (v: unknown) => {
      const out = think(v);
      for (const c of out) {
        if (c.c === "rally") console.log(`RL t=${w.tick} building=${c.building} at=${c.x},${c.y}`);
        if (!Array.isArray(c.u)) { delete (c as { line?: string }).line; continue; }
        let what = c.c;
        const tag = (c as { line?: string }).line;
        delete (c as { line?: string }).line;
        if (c.x !== undefined) what += `@${c.x},${c.y}`;
        if (c.target !== undefined) {
          const bi = w.building(c.target);
          what += bi >= 0 ? `>b${c.target}:${w.buildings.col.type[bi]}@${w.buildings.col.cellX[bi]},${w.buildings.col.cellY[bi]}` : `>u${c.target}`;
        }
        if (c.building !== undefined) what += `>b${c.building}`;
        if (c.node !== undefined) what += `>n${c.node}`;
        for (const id of c.u) lastCmd.set(id, `${what}(n${c.u.length},t${w.tick})#${tag ?? "?"}`);
      }
      return out;
    };
  }
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
  while (!r.over && w.tick < CAP) {
    if (w.tick % think === 0) {
      for (const body of player.think(buildView(g, 0))) r.command(0, { ...body, seq: seq++ });
    }
    r.tick();
    if (w.tick === 12000) aiFarmersLost10 = w.lost[UNIT_KINDS + UnitType.Farmer];
    for (const e of g.events) if (e.to === 0 && e.ev.k === "rejected") rejected++;
    if (town < 0 && w.townOwner[myTown.id] === 0) town = w.tick;
    for (let p = 0; p < 2; p++) for (let k = 0; k < taken[p].length; k++) if (taken[p][k] < 0 && w.townOwner[k] === p) taken[p][k] = w.tick;
    if (myMage < 0 && count(0, UnitType.Mage) > 0) myMage = w.tick;
    if (crystalForMage < 0 && w.res[Resource.Crystal] >= rules().units[UnitType.Mage].cost.crystal) crystalForMage = w.tick;
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
          aiAct.set(u.id[i], `type=${u.type[i]} act=${u.action[i]}`);
          if (forts.some((f) => within(x, y, f, f.reach))) inReach++;
        }
        for (const [id, at] of aiAt) {
          if (seen.has(id)) continue;
          aiAt.delete(id);
          if (w.unit(id) < 0 && forts.some((f) => within(at.x, at.y, f, FORT_NEAR))) {
            fortDeaths++;
            console.log(`DT t=${w.tick} id=${id} ${aiAct.get(id) ?? ""} at=${at.x},${at.y} last=${lastCmd.get(id) ?? "none"}`);
          }
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
      lines.push(
        `${(w.tick / 1200).toFixed(0)} 分｜我 ${res(0)} 農 ${count(0, UnitType.Farmer)} 兵 ${army(0)}${at(0)} ${player.state().mode} 城 ${cityHp(0)} ${income(0)}｜電腦 ${res(1)} 農 ${count(1, UnitType.Farmer)} 兵 ${army(1)}${at(1)} 城 ${cityHp(1)} ${income(1)}｜${towns}`,
      );
    }
  }
  closeWave();
  if (bashing && bashMax >= 5) {
    bashes++;
    bashLog.push({ start: bashAt.start, end: bashLast, most: bashMax, lost: lostSoldiers(1) - bashAt.lost, deaths: fortDeaths - bashAt.deaths, fell: bashAt.fell });
  }
  const st = player.state();
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
    marches: st.marches,
    brokenOff: st.brokenOff,
    waves,
    cityHp: [cityHp(0), cityHp(1)],
    armies: [army(0), army(1)],
    trained: { mages: [w.trained[UnitType.Mage], w.trained[UNIT_KINDS + UnitType.Mage]] },
    cannonShots: [w.cannonShots[0], w.cannonShots[1]],
    cannonKills: [w.cannonKills[0], w.cannonKills[1]],
    rejected,
    ...(mapMode === "random" ? { layout: (map as RandomMap).layout, found: st.found } : {}),
    finalHash: (g.hash() >>> 0).toString(16).padStart(8, "0"),
    ...(trace ? { trace: lines } : {}),
  };
}

const games = seeds.map(play);
const won = games.filter((x) => x.result === "won").length;
const open = games.filter((x) => x.result === "open");
const options = [
  plan.staticRatio ? "經濟比例固定" : "",
  plan.noMage ? "不蓋法術營" : "",
  plan.noRange ? "不蓋射場" : "",
  plan.corners ? "一直搶城鎮（最近、不是自己的小鎮）" : "",
  plan.autoTrain ? "用自動訓練（自己不點訓練兵）" : "",
  plan.choice === "govern" ? "打下來就治理" : "",
  plan.raid > 0 ? `${plan.raid} 名騎兵突襲電腦的村民` : "",
  plan.race === "edge" ? `偷家：${plan.raceAt} 名或第 ${plan.raceBy / 1200} 分從角落小鎮沿地圖邊緣去電腦主城${plan.raceStage ? "，半路停下等哨兵看到電腦大軍出門" : ""}` : "",
  plan.userEco ? "使用者的經濟（自動訓練、16 名村民、搶到大城前不採金、只去大城一趟）" : "",
  plan.race === "sentry" ? `偷家：哨兵看到電腦 ${plan.raceSeen} 名往家裡來就直衝電腦主城（${plan.raceAt} 名或第 ${plan.raceBy / 1200} 分也去）` : "",
  think !== SCRIPTED_THINK_EVERY ? `每 ${think} tick 下一輪指令` : "",
  mapMode === "random" ? "隨機地圖（我只知道探到的，派一名槍兵偵察；電腦也要偵察）" : "",
  plan.towerRush > 0 ? `塔攻：${plan.towerRush} 名槍兵到電腦主城旁蓋哨所駐守，再蓋 2 座箭樓（D-080）` : "",
  plan.rushBuildersOnly ? "塔攻（只派村民）：4 名村民到電腦主城旁蓋哨所和 2 座箭樓，沒有護送、沒有駐守（D-080）" : "",
  plan.fortress ? "半路要塞：第 12 分起，在往電腦主城的路上、離家 37 格，蓋哨所（6 名槍兵駐守）和 5 座箭樓（D-081）" : "",
  plan.fortressHold > 0 ? `大軍守在要塞旁，湊到 ${plan.fortressHold} 名或第 30 分才出發（D-081）` : "",
].filter((x) => x !== "");
const title = `${NAMES[strategy]}，${FORMATION_NAMES[formation]}，${SPEED_NAMES[speed]}${options.map((x) => `，${x}`).join("")}（種子 ${seeds.length === 1 ? seeds[0] : `${seeds[0]}–${seeds[seeds.length - 1]}`}，對手 ${LEVEL_NAMES[difficulty] ?? difficulty}）`;
const out: string[] = [`### ${title}`, ""];
out.push(`${games.length} 局贏 ${won} 局，輸 ${games.length - won - open.length} 局${open.length > 0 ? `，到第 ${m(CAP)} 分還沒分出勝負 ${open.length} 局` : ""}。`, "");
const byStyle = AI_STYLES.map((s) => {
  const of = games.filter((x) => x.style === s);
  return of.length === 0 ? "" : `${STYLE_NAMES[s]} ${of.filter((x) => x.result === "won").length}/${of.length}`;
}).filter((x) => x !== "");
out.push(`照電腦的性格：${byStyle.join("、")}。`, "");
if (fortifying) {
  // D-081: the AI's soldiers lost by the player's forts, and its bashes on them.
  const deaths = games.map((x) => x.fortDeaths).sort((a, c) => a - c);
  const bash = games.map((x) => x.bashes).sort((a, c) => a - c);
  // Failed bashes: 10 or more of the AI's soldiers lost and none of the player's forts fallen.
  const failed = games.map((x) => x.bashLog.filter((e) => e.lost >= FAILED_BASH && e.fell === 0));
  const failedCount = failed.map((l) => l.length).sort((a, c) => a - c);
  const failedLost = failed.map((l) => l.reduce((a, e) => a + e.lost, 0)).sort((a, c) => a - c);
  out.push(
    `撞了打不下來（一次撞死 ${FAILED_BASH} 名以上、一座據點都沒拆掉）：每局中位數 ${failedCount[failedCount.length >> 1]}、最多 ${failedCount[failedCount.length - 1]}、` +
      `合計 ${failedCount.reduce((a, c) => a + c, 0)} 次，${failed.filter((l) => l.length > 0).length} 局；這些撞死的兵每局中位數 ${failedLost[failedLost.length >> 1]}、最多 ${failedLost[failedLost.length - 1]}。`,
  );
  out.push(
    `電腦的兵死在玩家蓋好的據點 ${FORT_NEAR} 格內：中位數 ${deaths[deaths.length >> 1]}、最多 ${deaths[deaths.length - 1]}；` +
      `撞（5 名以上同時進到據點的射程，30 秒內沒人進去才算下一次）：中位數 ${bash[bash.length >> 1]}、最多 ${bash[bash.length - 1]}、合計 ${bash.reduce((a, c) => a + c, 0)}。`,
    "",
  );
}
if (fortifying) {
  // D-080: did the AI pull the rush down?
  const rushed = games.filter((x) => x.rush !== undefined);
  const built = (kind: "outpost" | "tower") => rushed.flatMap((x) => x.rush!.built.filter((b) => b.kind === kind));
  const count = (kind: "outpost" | "tower") => {
    const all = built(kind);
    const done = all.filter((b) => b.done >= 0);
    const fell = done.filter((b) => b.fell >= 0).map((b) => b.fell).sort((a, b) => a - b);
    const early = all.filter((b) => b.done < 0 && b.fell >= 0).length;
    const standing = done.filter((b) => b.fell < 0).length;
    return (
      `動工 ${all.length} 座、蓋好 ${done.length} 座；蓋好後被電腦拆掉 ${fell.length} 座` +
      `${fell.length === 0 ? "" : `（第 ${m(fell[0])}–${m(fell[fell.length - 1])} 分，中位數第 ${m(fell[fell.length >> 1])} 分）`}，` +
      `沒蓋好就被拆掉 ${early} 座，局末還立著 ${standing} 座`
    );
  };
  out.push(
    `${plan.fortress ? "半路要塞" : "塔攻"}：出發 ${rushed.filter((x) => x.rush!.start >= 0).length}/${rushed.length} 局。` +
      `哨所${count("outpost")}。箭樓${count("tower")}。`,
    "",
  );
}
if (mapMode === "random") {
  const by = (l: string) => games.filter((x) => x.layout === l);
  const foundAt = games.filter((x) => (x.found ?? -1) >= 0).map((x) => x.found!).sort((a, b) => a - b);
  out.push(
    `隨機地圖：對角出生 ${by("diagonal").filter((x) => x.result === "won").length}/${by("diagonal").length}、相鄰出生 ${by("adjacent").filter((x) => x.result === "won").length}/${by("adjacent").length}；` +
      `找到電腦主城 ${foundAt.length}/${games.length} 局${foundAt.length === 0 ? "" : `，中位數第 ${m(foundAt[foundAt.length >> 1])} 分`}。`,
    "",
  );
}
out.push(`逐種子（b 均衡、g 治理、p 掠奪）：${games.map((x) => `${x.seed}${x.style[0]}:${x.result === "won" ? "贏" : x.result === "lost" ? "輸" : "未分"} ${m(x.endTick)}`).join("; ")}`, "");
out.push("| 種子 | 電腦性格 | 攻下小鎮 | 我第一名法師 | 電腦第一名法師 | 主城第一次被打 | 第一次出發打電腦主城 | 結果 |", "|---|---|---|---|---|---|---|---|");
for (const x of games) {
  const result = x.result === "open" ? `第 ${m(x.endTick)} 分還沒分出` : `${x.result === "won" ? "贏" : "輸"}，第 ${m(x.endTick)} 分`;
  const hit = x.cityHit < 0 ? "沒有" : `${m(x.cityHit)}（電腦 ${x.cityHitAi[0]} 名，法師 ${x.cityHitAi[1]}）`;
  out.push(`| ${x.seed} | ${STYLE_NAMES[x.style] ?? x.style} | ${m(x.town)} | ${m(x.myMage)} | ${m(x.aiMage)} | ${hit} | ${m(x.firstMarch)} | ${result} |`);
}
out.push("");
if (plan.race !== "") {
  // D-072: did the armies pass each other, and whose main city went first?
  out.push("**偷家**（出發；出發後兩軍中心最近幾格；主城 我／電腦 開始掉血、倒下）", "");
  for (const x of games) {
    out.push(`- 種子 ${x.seed}：出發 ${m(x.raced)}；最近 ${x.armiesNearest < 0 ? "—" : `${x.armiesNearest} 格`}；我 ${m(x.cityFirstHit[0])}／${m(x.cityFell[0])}，電腦 ${m(x.cityFirstHit[1])}／${m(x.cityFell[1])}；${x.result === "won" ? "贏" : x.result === "lost" ? "輸" : "未分"}`);
  }
  out.push("");
}
if (open.length > 0) {
  out.push(`**到第 ${m(CAP)} 分還沒分出勝負**（主城血量 我／電腦；兵 槍兵/遠程/法師 我／電腦）`, "");
  for (const x of open) out.push(`- 種子 ${x.seed}：主城 ${x.cityHp[0]}／${x.cityHp[1]}；兵 ${x.armies[0]}／${x.armies[1]}`);
  out.push("");
}
out.push("<details><summary>電腦打到家門口（每一波：電腦 16 格內最多幾名、其中法師；開始時我方的兵；這一波雙方的傷亡；結束時主城血量）</summary>", "");
for (const x of games) {
  if (x.waves.length === 0) continue;
  out.push(`- 種子 ${x.seed}：`);
  for (const v of x.waves) {
    out.push(`  - 第 ${m(v.start)}–${m(v.last)} 分：電腦 ${v.max} 名（法師 ${v.mages}）；我方兵 ${v.mine}；電腦死 ${v.aiLost} 名，我方死 ${v.myLost} 名兵和 ${v.farmersLost} 名農民；主城剩 ${v.cityHp}`);
  }
}
out.push("", "</details>", "");
if (trace) for (const x of games) out.push(`<details><summary>種子 ${x.seed} 每分鐘</summary>`, "", ...(x.trace ?? []).map((l) => `- ${l}`), "", "</details>", "");
console.log(out.join("\n"));
if (jsonOut !== "") writeFileSync(jsonOut, JSON.stringify({ strategy, speed, formation, difficulty, style, think, cap: CAP, plan, games }, null, 1));
