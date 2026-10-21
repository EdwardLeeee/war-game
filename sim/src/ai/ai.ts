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

import { type Frame, footprintCentre, fromCanon, rectFromCanon, spawnCentre, toCanon } from "../frame.ts";
import { checkPlacement } from "../placement.ts";
import {
  Action,
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
import { ARMY_BASE, AS_HARD, BUILD_FARMERS, BUILD_PRODUCTION, choose, features, HEAD_ARMY, HEAD_BUILD, HEAD_MIX, HEAD_TOWN, type NetWeights, TOWN_GOVERN } from "./net.ts";
import type { PlayerView } from "../view/view.ts";

export interface Ai {
  /** The style this AI plays (GDD section 13). */
  style: AiStyle;
  think(view: PlayerView): CommandBody[];
  /** What it counted of its own doings, for the measuring tools (D-086 A3: hard's rescues); none in a game. */
  stats?(): Record<string, number>;
  /** What it believes now, for the measuring tools (D-086 A3: hard's memory of the enemy); none in a game. */
  peek?(): Record<string, number>;
}

/** What every player knows from the start (the `ready` message), and its symmetry frame. */
// --- the map as it knows it, and its scout (D-074) ---------------------------------------------
//
// The fixed map is known whole from the start (MapInfo has every town and both main cities), and
// the AIs read it as before: the objects here are the MapInfo's own, so nothing changes there.
// On a random map an AI starts knowing only its own main city (view.ts mapInfo): it learns towns
// from the PlayerView's town rows once explored, and the enemy from its buildings once seen. The
// one thing it assumes is the published rule that main cities stand in corners (GDD section 12):
// a scout goes round the edge of the map through the other three corners, and an enemy building
// seen near one of them says that is the enemy's corner. Its main city is then taken to stand as
// far in from that corner as the AI's own stands from its own (a guess to march at, nothing more:
// the city itself, its id and hp, only ever come from the view).

export interface Site {
  id: number;
  size: number;
  cellX: number;
  cellY: number;
}

/** How much it knows of the enemy's main city. */
export const Known = { None: 0, Corner: 1, City: 2 } as const;
export type Known = (typeof Known)[keyof typeof Known];

/** The scout's corners this far in from the map's edges (cells). */
const CORNER_INSET = 12;
/** A stop counts as reached this near (cells)... */
const STOP_NEAR = 6;
/** ...or once the scout has not got nearer for this long (ticks): stuck, or something in the way. */
const STOP_STUCK = 600;
/** The scout is told again where to go this often (ticks). */
const SCOUT_EVERY = 200;

export interface MapMemory {
  readonly random: boolean;
  /** Its own main city's centre cell. */
  readonly home: { cellX: number; cellY: number };
  /**
   * The enemy's main city: where it stands (Known.City), a guess in the corner it was seen in
   * (Known.Corner), or, Known.None, the corner across the map (a placeholder; nothing marches on
   * it). The fixed map: always Known.City.
   */
  readonly enemy: { cellX: number; cellY: number };
  readonly known: Known;
  /** A town it knows of (fixed map: every town). */
  site(id: number): Site | undefined;
  /** Towns known without having been explored: the fixed map's towns, none on a random map. */
  readonly unexplored: readonly Site[];
  /** The scout's stops for each way round (real cells), the other three corners. */
  readonly stops: readonly (readonly { x: number; y: number }[])[];
  /** Learns from what it sees now. */
  observe(view: PlayerView): void;
}

export function mapMemory(map: Pick<MapInfo, "size" | "spawns" | "towns" | "mode">, frame: Frame, player: number): MapMemory {
  const random = map.mode === "random";
  const n = map.size;
  const mine = map.spawns.find((s) => s.player === player)!;
  if (!random) {
    // As before: the map's own objects.
    const enemy = map.spawns.find((s) => s.player !== player)!;
    return {
      random,
      home: mine,
      enemy,
      known: Known.City,
      site: (id) => map.towns[id],
      unexplored: map.towns,
      stops: [[], []],
      observe: () => {},
    };
  }
  const real = (u: number, v: number) => fromCanon(frame, u, v);
  const home = (() => {
    const c = spawnCentre(frame, mine);
    return { cellX: c.x, cellY: c.y };
  })();
  // In its own frame every player starts in the same corner; the other three are the candidates,
  // the enemy's main city as far in from its corner as its own is from its own.
  const h = toCanon(frame, home.cellX, home.cellY);
  const guesses = [
    { u: n - 1 - h.u, v: h.v },
    { u: n - 1 - h.u, v: n - 1 - h.v },
    { u: h.u, v: n - 1 - h.v },
  ];
  const k = CORNER_INSET;
  const near = h.u <= n >> 1 ? k : n - 1 - k;
  const far = n - 1 - near;
  const nearV = h.v <= n >> 1 ? k : n - 1 - k;
  const farV = n - 1 - nearV;
  // Round the edge, never across the middle (the big city's militia and tower): along its own
  // side to the next corner, along the far side, back along the other side; or the other way.
  const corner = [
    { u: far, v: nearV },
    { u: far, v: farV },
    { u: near, v: farV },
  ].map((c) => real(c.u, c.v));
  const stops = [
    [corner[0], corner[1], corner[2]],
    [corner[2], corner[1], corner[0]],
  ];
  const towns = new Map<number, Site>();
  const enemy = (() => {
    const g = real(guesses[1].u, guesses[1].v);
    return { cellX: g.x, cellY: g.y };
  })();
  let known: Known = Known.None;
  return {
    random,
    home,
    enemy,
    get known() {
      return known;
    },
    site: (id) => towns.get(id),
    unexplored: [],
    stops,
    observe(view: PlayerView) {
      for (let r = 0; r < view.towns.length; r += TOWN_STRIDE) {
        const id = view.towns[r + TownField.id];
        if (!towns.has(id)) towns.set(id, { id, size: view.towns[r + TownField.size], cellX: view.towns[r + TownField.cellX], cellY: view.towns[r + TownField.cellY] });
      }
      if (known === Known.City) return;
      let seen: { x: number; y: number } | null = null;
      for (let r = 0; r < view.buildings.length; r += BUILDING_STRIDE) {
        if (view.buildings[r + BuildingField.owner] !== 1 - player) continue;
        const x = view.buildings[r + BuildingField.cellX];
        const y = view.buildings[r + BuildingField.cellY];
        if (view.buildings[r + BuildingField.type] === BuildingType.MainCity) {
          const c = footprintCentre(frame, x, y, 4);
          enemy.cellX = c.x;
          enemy.cellY = c.y;
          known = Known.City;
          return;
        }
        if (seen === null) seen = { x, y };
      }
      if (seen !== null && known === Known.None) {
        // The corner nearest the building (in its own frame; ties to the first).
        const s = toCanon(frame, seen.x, seen.y);
        let best = 0;
        let bestD = -1;
        guesses.forEach((g, i) => {
          const d = (g.u - s.u) * (g.u - s.u) + (g.v - s.v) * (g.v - s.v);
          if (bestD < 0 || d < bestD) {
            best = i;
            bestD = d;
          }
        });
        const g = real(guesses[best].u, guesses[best].v);
        enemy.cellX = g.x;
        enemy.cellY = g.y;
        known = Known.Corner;
      }
    },
  };
}

/** A soldier as the scout sees it. */
interface ScoutUnit {
  id: number;
  type: number;
  x: number;
  y: number;
}

export interface Scout {
  /** The scout's id, or -1: kept out of the army, garrisons and every other job. */
  readonly id: number;
  /** Picks a scout from `free` when it needs one and moves it on round the corners. */
  think(tick: number, soldiers: readonly ScoutUnit[], free: (u: ScoutUnit) => boolean, out: CommandBody[]): void;
}

/**
 * One soldier (not a mage) goes round the other three corners along the map's edge, once the
 * enemy's main city is known stopping when it has been round once; until then round again. A
 * scout that falls is replaced, and the next goes round the other way. Random maps only.
 */
export function createScout(mem: MapMemory): Scout {
  let id = -1;
  let way = 0;
  let stop = 0;
  let since = 0;
  let best = Number.MAX_SAFE_INTEGER;
  let lastMove = -100000;
  let done = !mem.random;
  return {
    get id() {
      return id;
    },
    think(tick, soldiers, free, out) {
      if (done) return;
      let s = id >= 0 ? soldiers.find((u) => u.id === id) : undefined;
      if (id >= 0 && s === undefined) {
        // It fell on the way: the next one goes round the other way.
        way = 1 - way;
        stop = 0;
        id = -1;
      }
      if (s === undefined) {
        const pick = soldiers.filter((u) => u.type !== UnitType.Mage && free(u)).sort((a, b) => a.id - b.id)[0];
        if (pick === undefined) return;
        s = pick;
        id = pick.id;
        since = tick;
        best = Number.MAX_SAFE_INTEGER;
        lastMove = -100000;
      }
      let target = mem.stops[way][stop];
      const d2 = (s.x - target.x) * (s.x - target.x) + (s.y - target.y) * (s.y - target.y);
      if (d2 < best) {
        best = d2;
        since = tick;
      }
      if (d2 <= STOP_NEAR * STOP_NEAR || tick - since >= STOP_STUCK) {
        stop++;
        if (stop >= mem.stops[way].length) {
          if (mem.known === Known.City) {
            // Been round once and the enemy's main city is known: back to the army.
            done = true;
            id = -1;
            return;
          }
          stop = 0;
        }
        target = mem.stops[way][stop];
        since = tick;
        best = Number.MAX_SAFE_INTEGER;
        lastMove = -100000;
      }
      if (tick - lastMove >= SCOUT_EVERY) {
        // A retreat: it walks on past what it meets instead of stopping to fight.
        out.push({ c: "retreat", u: [s.id], x: target.x, y: target.y });
        lastMove = tick;
      }
    },
  };
}

// --- enemy outposts and arrow towers (D-080) ---------------------------------------------------------
//
// An outpost can go up anywhere (the user, 2026-10-09) and arrow towers beside it, so a player can put
// up a fort by the AI's main city or its towns and shoot its farmers from there. Both AIs pull such
// forts down: an enemy outpost or arrow tower, finished or not, in sight or remembered, that reaches
// the ground they keep (FORT_HOME cells round the main city, a town they hold), or that stands by their
// way when they march (not by the enemy's main city: that is the siege's).

/** The ground round its main city an AI keeps clear of forts (cells; enemy soldiers this near already call the army home). */
const FORT_HOME = 16;
/** On the way: forts whose arrows or guards reach this much further than the army's centre (cells). */
const FORT_WAY = 2;
/** By the enemy's main city (cells): forts there are left to the siege. */
const FORT_SIEGE = 14;
/** Enemy soldiers this many cells beyond a group's reach count as defending it (D-081). */
const FORT_ARMY_NEAR = 6;
/** After breaking off from a group of forts, the next go at it within FORT_FORGET takes this many times the army (percent, D-081). */
const FORT_FAILED = 150;
/**
 * ceo 2026-10-11 asked for no time limit (until 1.5 x or the group is weaker); measured, the army then sat at home
 * once its population was full short of 1.5 x (fortress-hold draws 3 -> 26, sim/README.md), so 5 minutes it is.
 */
const FORT_FORGET = 5 * 1200;
/**
 * D-081 / A4 (ceo 2026-10-21, #260's half-way fortress, normal's soldiers dead by it 26.5 -> 75.0 a game): normal's two
 * trials, on since ceo 2026-10-22 (docs/research/2026-10-ai-a4.md section 4.3; hard's: HardPlan.fortStage, fortAgain). stage: forts on the way it can take, it gathers
 * outside their reach first and pulls them down together (it marched past them in a column and began only once its
 * centre stood by them); again: after breaking off from forts, the next go takes FORT_FAILED_AGAIN of that army and
 * it remembers for FORT_FORGET_AGAIN (hard went at the same fortress every 5 minutes with 15–27).
 */
export const NORMAL_FORT = { stage: true, again: true };
const FORT_FAILED_AGAIN = 200;
const FORT_FORGET_AGAIN = 10 * 1200;
/** fortStage: the gathering point at most this many cells beyond the reach of the group's forts (and 2 at least, as stagePoint). */
const FORT_STAGE_OUT = 6;
/** fortStage: the group it gathers for, the point, when it set off for it and the first got there, and whether it went on. */
interface FortStop {
  ids: number[];
  x: number;
  y: number;
  from: number;
  first: number;
  go: boolean;
  mode: string;
}
/** It goes for a fort with no fewer soldiers than this. */
const FORT_ARMY = 4;
/** Enemy soldiers this near a fort (cells) count as its defenders. */
const FORT_GUARDS = 10;
/** Orders against a fort go again this often (ticks)... */
const FORT_EVERY = 100;
/** ...and after breaking off from one, it waits this long before trying again (ticks). */
const FORT_AGAIN = 600;
/** Normal: the army stays home at most this long for a fort it is not yet strong enough for (ticks). */
const FORT_HOLD = 3 * 1200;

export interface Fort {
  id: number;
  type: number;
  /** Footprint: top-left cell and size. */
  x: number;
  y: number;
  size: number;
  /** How far beyond its footprint it hurts now (cells): an arrow tower's range, an outpost's guards' reach. */
  hits: number;
  /** How far it can come to hurt (cells): for an outpost, the arrows of towers that may go up beside it. */
  reach: number;
  done: boolean;
  /** In sight now (not only remembered), and then whether someone hides in it (BuildingFlag.Occupied: the screen shows it too). */
  seen: boolean;
  occupied: boolean;
}

/** The enemy outposts and arrow towers in the view (in sight or remembered). */
export function enemyForts(view: PlayerView, player: number, rules: Rules): Fort[] {
  const arrows = rules.arrows === undefined ? 7 : (rules.arrows.arrowTower.range + CELL - 1) >> CELL_SHIFT;
  const guards = rules.outpost?.reach ?? 8;
  const towers = (rules.towerReach?.outpost ?? 6) + arrows;
  const out: Fort[] = [];
  for (let r = 0; r < view.buildings.length; r += BUILDING_STRIDE) {
    const owner = view.buildings[r + BuildingField.owner];
    const type = view.buildings[r + BuildingField.type];
    if (owner === player || owner === NEUTRAL || (type !== BuildingType.Outpost && type !== BuildingType.ArrowTower)) continue;
    const outpost = type === BuildingType.Outpost;
    out.push({
      id: view.buildings[r + BuildingField.id],
      type,
      x: view.buildings[r + BuildingField.cellX],
      y: view.buildings[r + BuildingField.cellY],
      size: rules.buildings[type]?.size ?? 2,
      hits: outpost ? guards : arrows,
      reach: outpost ? Math.max(guards, towers) : arrows,
      done: view.buildings[r + BuildingField.progress] >= 1000,
      seen: (view.buildings[r + BuildingField.flags] & BuildingFlag.Remembered) === 0,
      occupied: (view.buildings[r + BuildingField.flags] & BuildingFlag.Occupied) !== 0,
    });
  }
  return out;
}

/** Squared distance (cells) from (x, y) to a fort's footprint. */
/**
 * D-089 (ceo 2026-10-21: core's #239 + #245 traces, the long ways round obstacles and through gates): the stronger
 * side's attacks reached the enemy main city strung out along the way, at most 10-12 there at once, and some 80 fell
 * there in the last 8 minutes of a drawn game. So those that set out first gather STAGE_DIST cells out from the enemy
 * main city on the side they come from: the nearest open cell to that point that it knows to be open ground (on a
 * random map, explored) and out of the enemy forts' reach; null when there is none, or it is that near already.
 */
const STAGE_DIST = 16;
/** Whether they gather first (measurements turn it off for the baseline; the game always has it on). */
export const STAGING = { on: true };
/**
 * D-089, normal: in the last minutes of an AI-against-AI game it goes for the enemy main city with `assault` soldiers
 * (from 6 minutes before the end, and in the last 4, with `endgame`); after an attack on the enemy main city ground
 * down, it goes again only with `failed` percent of those that set out then (0: as before), but in the last 4 minutes.
 * Measured (scratch run 39463615390, fixed map, normal against normal, 100 games each): draws 33 and 36 (seeds 1-50,
 * 51-100) with `failed` 0, 7 and 6 with 120; a bigger `assault` (25) alone 35 and 39.
 */
export const SIEGE = { assault: 15, endgame: 8, failed: 120 };
/** Gathered: this share (percent) of those that set out within STAGE_NEAR cells of it, or STAGE_WAIT ticks after the first got there, or STAGE_MAX after setting out. */
const STAGE_SHARE = 70;
const STAGE_NEAR = 6;
const STAGE_WAIT = 600;
const STAGE_MAX = 3 * 1200;
/** As many as a building can queue (no limit of its own). */
const QUEUE_MOST = 99;
/** Normal: soldiers trained after it set out wait at the gathering point and go on together once this many are there. */
const STAGE_JOIN = 6;
export function stagePoint(
  view: { placement: Uint8Array },
  map: { size: number; mode?: string },
  forts: readonly Fort[],
  from: { x: number; y: number },
  enemy: { cellX: number; cellY: number },
  rank: (x: number, y: number) => number,
): { x: number; y: number } | null {
  const n = map.size;
  const fx = from.x - enemy.cellX;
  const fy = from.y - enemy.cellY;
  if (!STAGING.on || fx * fx + fy * fy <= (STAGE_DIST + 4) * (STAGE_DIST + 4)) return null;
  // Rock, walls, water and cliffs are Blocked in the view (the fixed map is known whole; a random one where explored).
  // Steps from the enemy main city over ground not known to be blocked (8 neighbours), so the point is STAGE_DIST
  // steps away along the way round obstacles, not straight across them (on core's #245 maps that was up to a
  // minute and a half's walk); the point itself on ground known to be open.
  const blocked = (i: number) => (view.placement[i] & PlaceBit.Blocked) !== 0;
  const known = (i: number) => map.mode !== "random" || (view.placement[i] & PlaceBit.Unexplored) === 0;
  const steps = new Int16Array(n * n).fill(-1);
  const queue = new Int32Array(n * n);
  let head = 0;
  let tail = 0;
  for (let y = enemy.cellY - 3; y <= enemy.cellY + 3; y++) {
    for (let x = enemy.cellX - 3; x <= enemy.cellX + 3; x++) {
      if (x < 0 || y < 0 || x >= n || y >= n) continue;
      steps[y * n + x] = 0;
      queue[tail++] = y * n + x;
    }
  }
  let best: { x: number; y: number } | null = null;
  let bestD = 0;
  let bestKey = 0;
  while (head < tail) {
    const i = queue[head++];
    const d = steps[i];
    if (d >= STAGE_DIST + 4) continue;
    const x = i % n;
    const y = (i - x) / n;
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const xx = x + ox;
        const yy = y + oy;
        if (xx < 1 || yy < 1 || xx >= n - 1 || yy >= n - 1) continue;
        const j = yy * n + xx;
        if (steps[j] >= 0 || blocked(j)) continue;
        steps[j] = d + 1;
        queue[tail++] = j;
        // STAGE_DIST (+-4) cells out, at most STAGE_DIST + 4 steps' walk (no long way round from there).
        const out2 = (xx - enemy.cellX) * (xx - enemy.cellX) + (yy - enemy.cellY) * (yy - enemy.cellY);
        if (out2 < (STAGE_DIST - 4) * (STAGE_DIST - 4) || out2 > (STAGE_DIST + 4) * (STAGE_DIST + 4) || !known(j)) continue;
        if (forts.some((o) => fortDist2(o, xx, yy) <= (o.hits + 2) * (o.hits + 2))) continue;
        // Of those, the nearest to the army.
        const dd = (xx - from.x) * (xx - from.x) + (yy - from.y) * (yy - from.y);
        const key = rank(xx, yy);
        if (best === null || dd < bestD || (dd === bestD && key < bestKey)) {
          best = { x: xx, y: yy };
          bestD = dd;
          bestKey = key;
        }
      }
    }
  }
  return best;
}

/**
 * D-081 / A4 (fortStage): where an army gathers before going for a group of forts: ground known to be open, 2 to
 * FORT_STAGE_OUT cells beyond the reach of one of the group's forts and out of every fort's reach + 2, reached by steps
 * from the group (8 neighbours, over ground not known to be blocked: not across a river or a cliff), the nearest to
 * the army; null for none.
 */
export function fortStagePoint(
  view: { placement: Uint8Array },
  map: { size: number; mode?: string },
  forts: readonly Fort[],
  group: FortGroup,
  from: { x: number; y: number },
  rank: (x: number, y: number) => number,
): { x: number; y: number } | null {
  const n = map.size;
  const mine = forts.filter((f) => group.ids.includes(f.id));
  if (mine.length === 0) return null;
  const blocked = (i: number) => (view.placement[i] & PlaceBit.Blocked) !== 0;
  const known = (i: number) => map.mode !== "random" || (view.placement[i] & PlaceBit.Unexplored) === 0;
  let far = 0;
  for (const f of mine) far = Math.max(far, f.hits + FORT_STAGE_OUT + 4);
  const steps = new Int16Array(n * n).fill(-1);
  const queue = new Int32Array(n * n);
  let head = 0;
  let tail = 0;
  for (const f of mine) {
    for (let y = f.y; y < f.y + f.size; y++) {
      for (let x = f.x; x < f.x + f.size; x++) {
        if (x < 0 || y < 0 || x >= n || y >= n || steps[y * n + x] >= 0) continue;
        steps[y * n + x] = 0;
        queue[tail++] = y * n + x;
      }
    }
  }
  let best: { x: number; y: number } | null = null;
  let bestD = 0;
  let bestKey = 0;
  while (head < tail) {
    const i = queue[head++];
    const d = steps[i];
    if (d >= far) continue;
    const x = i % n;
    const y = (i - x) / n;
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const xx = x + ox;
        const yy = y + oy;
        if (xx < 1 || yy < 1 || xx >= n - 1 || yy >= n - 1) continue;
        const j = yy * n + xx;
        if (steps[j] >= 0 || blocked(j)) continue;
        steps[j] = d + 1;
        queue[tail++] = j;
        if (!known(j) || forts.some((o) => fortDist2(o, xx, yy) <= (o.hits + 2) * (o.hits + 2))) continue;
        if (!mine.some((f) => fortDist2(f, xx, yy) <= (f.hits + FORT_STAGE_OUT) * (f.hits + FORT_STAGE_OUT))) continue;
        const dd = (xx - from.x) * (xx - from.x) + (yy - from.y) * (yy - from.y);
        const key = rank(xx, yy);
        if (best === null || dd < bestD || (dd === bestD && key < bestKey)) {
          best = { x: xx, y: yy };
          bestD = dd;
          bestKey = key;
        }
      }
    }
  }
  return best;
}

/**
 * D-081 / A4 (fortStage), one think: the group of forts it gathers for (`stop`, reset when the mode changed or the group
 * is gone), or the first it can take on the straight way from `at` to `aim`; then where the army goes: the gathering
 * point until STAGE_SHARE of `army` stand within STAGE_NEAR of it (or STAGE_WAIT after the first, or STAGE_MAX), then the
 * group's fort it was pulling down or the nearest. Nothing: on as before.
 */
function fortStopNext(
  stop: FortStop | null,
  mode: string,
  tick: number,
  groups: readonly FortGroup[],
  forts: readonly Fort[],
  canTake: (g: FortGroup) => boolean,
  army: readonly { x: number; y: number }[],
  at: { x: number; y: number },
  aim: { x: number; y: number } | undefined,
  view: { placement: Uint8Array },
  map: { size: number; mode?: string },
  rank: (x: number, y: number) => number,
  razing: number,
): { stop: FortStop | null; gather?: { x: number; y: number }; raze?: Fort } {
  let s = stop;
  if (s !== null && (s.mode !== mode || !groups.some((g) => g.ids.some((id) => s!.ids.includes(id))))) s = null;
  if (s === null && aim !== undefined && army.length > 0) {
    const next = groupsOnWay(groups.filter(canTake), at, aim)[0];
    const p = next === undefined ? null : fortStagePoint(view, map, forts, next, at, rank);
    if (next !== undefined && p !== null) s = { ids: [...next.ids], x: p.x, y: p.y, from: tick, first: -1, go: false, mode };
  }
  if (s === null) return { stop: null };
  if (!s.go) {
    const point = s;
    const by = army.filter((u) => (u.x - point.x) * (u.x - point.x) + (u.y - point.y) * (u.y - point.y) <= STAGE_NEAR * STAGE_NEAR).length;
    if (by > 0 && s.first < 0) s.first = tick;
    if (by * 100 >= STAGE_SHARE * army.length || (s.first >= 0 && tick - s.first >= STAGE_WAIT) || tick - s.from >= STAGE_MAX) s.go = true;
    else return { stop: s, gather: { x: s.x, y: s.y } };
  }
  const ids = s.ids;
  const mine = forts.filter((f) => ids.includes(f.id));
  let f = mine.find((x) => x.id === razing);
  if (f === undefined) {
    let bestD = 0;
    let bestKey = 0;
    for (const o of mine) {
      const d = fortDist2(o, at.x, at.y);
      const key = rank(o.x, o.y);
      if (f === undefined || d < bestD || (d === bestD && key < bestKey)) {
        f = o;
        bestD = d;
        bestKey = key;
      }
    }
  }
  return f === undefined ? { stop: null } : { stop: s, raze: f };
}

export function fortDist2(f: Fort, x: number, y: number): number {
  const dx = Math.max(f.x - x, 0, x - (f.x + f.size - 1));
  const dy = Math.max(f.y - y, 0, y - (f.y + f.size - 1));
  return dx * dx + dy * dy;
}

/** A fort's middle cell. */
function fortCentre(f: Fort): { x: number; y: number } {
  return { x: f.x + (f.size >> 1), y: f.y + (f.size >> 1) };
}

/**
 * The forts reaching the ground an AI keeps: FORT_HOME round its main city, each held town's radius
 * round it (`held`: centre and radius in cells).
 */
function fortsOnOurGround(forts: Fort[], home: { cellX: number; cellY: number }, held: { x: number; y: number; radius: number }[]): Fort[] {
  return forts.filter((f) => {
    const home2 = (FORT_HOME + f.reach) * (FORT_HOME + f.reach);
    if (fortDist2(f, home.cellX, home.cellY) <= home2) return true;
    return held.some((t) => fortDist2(f, t.x, t.y) <= (t.radius + f.reach) * (t.radius + f.reach));
  });
}

/** What it remembers of breaking off from a fort (D-081): the army (worth against forts) that did, and when. */
interface Failed {
  worth: number;
  tick: number;
}

/**
 * The army (worth against forts) that broke off from `f` or from forts whose arrows or guards reach it,
 * within FORT_FORGET (D-081); 0 for none.
 */
function failedNear(f: Fort, forts: readonly Fort[], failedAt: ReadonlyMap<number, Failed>, tick: number, forget = FORT_FORGET): number {
  const c = fortCentre(f);
  let failed = 0;
  for (const o of forts) {
    const m = failedAt.get(o.id);
    if (m === undefined || tick - m.tick >= forget) continue;
    if (o.id === f.id || fortDist2(o, c.x, c.y) <= (o.hits + FORT_WAY) * (o.hits + FORT_WAY)) failed = Math.max(failed, m.worth);
  }
  return failed;
}

/** The forts by an army marching from (x, y): within their arrows' or guards' reach and FORT_WAY, but not by the enemy's main city. */
function fortsOnTheWay(forts: Fort[], x: number, y: number, enemyHome: { cellX: number; cellY: number }): Fort[] {
  return forts.filter(
    (f) => fortDist2(f, x, y) <= (f.hits + FORT_WAY) * (f.hits + FORT_WAY) && fortDist2(f, enemyHome.cellX, enemyHome.cellY) > FORT_SIEGE * FORT_SIEGE,
  );
}

// --- fort groups and the way round them (D-081) --------------------------------------------------------
//
// The user (2026-10-10): hard "一直打我的哨所但都打不下來死傷慘重". In f1fd2a87 it marched 41–50 soldiers five
// times into an outpost and five arrow towers, three ranged units hidden in each, and lost 157 there. So:
// forts that cover each other count together; what they and an attacker are worth comes from the live rules;
// an army too weak for a group on its way does not go (a way round was tried and dropped, sim/README.md); a
// group it broke off from is not tried again with as many for a while.

/** What fighters are worth against forts (a spearman is 10): Lanchester's square law, damage per tick times hp, from the live rules. */
export interface FortValues {
  /** A finished arrow tower. */
  tower: number;
  /** A ranged unit or mage hidden in it: it shoots and cannot be hit while the tower stands, and falls with it. */
  hidden: number;
  /** A spearman posted at an outpost. */
  guard: number;
  /** Soldiers that hide in an arrow tower at most; spearmen posted at an outpost at most. */
  holds: number;
  slots: number;
  /** An attacker against forts, by UnitType. */
  vs: number[];
}

export function fortValues(rules: Rules): FortValues {
  const spear = rules.units[UnitType.Spearman];
  const base = (spear.attack / spear.cooldown) * spear.hp;
  const worth = (dps: number, hp: number) => Math.round(10 * Math.sqrt((dps * hp) / base));
  const arrow = rules.arrows?.arrowTower ?? { damage: 5, cooldown: 40 };
  const ranged = rules.units[UnitType.Ranged];
  const vs: number[] = [];
  for (const t of [UnitType.Spearman, UnitType.Ranged, UnitType.Mage, UnitType.Cavalry]) {
    const u = rules.units[t];
    if (u !== undefined) vs[t] = worth(u.attack / u.cooldown, u.hp + u.shield);
  }
  return {
    tower: worth(arrow.damage / arrow.cooldown, rules.buildings[BuildingType.ArrowTower]?.hp ?? 500),
    // Its damage as a ranged unit's (it dies with the tower). Calibrated on scratch: twice this, hard
    // would not go with the 45 soldiers that took the scripted fortress (5 towers, 3 in each) in base runs.
    hidden: Math.round((10 * (ranged.attack / ranged.cooldown)) / (spear.attack / spear.cooldown)),
    guard: 10,
    holds: rules.buildings[BuildingType.ArrowTower]?.holds ?? 0,
    slots: rules.outpost?.slots ?? 6,
    vs,
  };
}

/** Forts that cover each other: their middle, how far from it they hurt (cells), and what they are worth. */
export interface FortGroup {
  ids: number[];
  x: number;
  y: number;
  radius: number;
  worth: number;
}

/**
 * The finished towers and outposts in groups: two are in one group when either reaches the other. A tower
 * counts with those hiding in it: as many as it holds when seen with someone inside, or when only
 * remembered (the AI cannot tell, so it assumes the worst; in f1fd2a87 every one of them was full); an
 * outpost with its guards in sight (`guardsAt`), or as many as it holds when only remembered.
 */
export function fortGroups(forts: Fort[], guardsAt: (f: Fort) => number, v: FortValues): FortGroup[] {
  const list = forts.filter((f) => f.done).sort((a, b) => a.id - b.id);
  const root = list.map((_, k) => k);
  const find = (k: number): number => (root[k] === k ? k : (root[k] = find(root[k])));
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
      const reach = Math.max(a.hits, b.hits);
      const c = fortCentre(b);
      if (fortDist2(a, c.x, c.y) <= reach * reach) root[find(j)] = find(i);
    }
  }
  const groups = new Map<number, Fort[]>();
  for (let k = 0; k < list.length; k++) {
    const r = find(k);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)!.push(list[k]);
  }
  const out: FortGroup[] = [];
  for (const members of groups.values()) {
    let x = 0;
    let y = 0;
    let worth = 0;
    for (const f of members) {
      const c = fortCentre(f);
      x += c.x;
      y += c.y;
      if (f.type === BuildingType.ArrowTower) worth += v.tower + v.hidden * (!f.seen || f.occupied ? v.holds : 0);
      else worth += v.guard * (f.seen ? guardsAt(f) : v.slots);
    }
    x = Math.trunc(x / members.length);
    y = Math.trunc(y / members.length);
    let radius = 0;
    for (const f of members) {
      const c = fortCentre(f);
      radius = Math.max(radius, Math.ceil(Math.sqrt((c.x - x) * (c.x - x) + (c.y - y) * (c.y - y))) + f.hits + 1);
    }
    out.push({ ids: members.map((f) => f.id), x, y, radius, worth });
  }
  return out;
}

/** Squared distance (cells) from (px, py) to the straight way from a to b. */
function wayDist2(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  const qx = ax + t * dx - px;
  const qy = ay + t * dy - py;
  return qx * qx + qy * qy;
}

/** The groups an army walking straight from a to b passes within reach of (FORT_WAY cells to spare), the nearest to a first. */
export function groupsOnWay(groups: FortGroup[], a: { x: number; y: number }, b: { x: number; y: number }): FortGroup[] {
  return groups
    .filter((g) => wayDist2(g.x, g.y, a.x, a.y, b.x, b.y) <= (g.radius + FORT_WAY) * (g.radius + FORT_WAY))
    .sort((p, q) => (p.x - a.x) * (p.x - a.x) + (p.y - a.y) * (p.y - a.y) - ((q.x - a.x) * (q.x - a.x) + (q.y - a.y) * (q.y - a.y)) || p.ids[0] - q.ids[0]);
}

/**
 * D-083 (D-081's leftover (a)): what the forts reaching a town of radius `radius` at (x, y) are worth together
 * (their groups, as D-081 counts them: towers, those hiding, an outpost's guards).
 */
function fortsAtTown(groups: readonly FortGroup[], x: number, y: number, radius: number): number {
  let w = 0;
  for (const g of groups) if ((g.x - x) * (g.x - x) + (g.y - y) * (g.y - y) <= (g.radius + radius) * (g.radius + radius)) w += g.worth;
  return w;
}

// --- castle gates (D-096) ------------------------------------------------------------------------------------------
//
// The user (2026-10-21): gates that close and can be broken, walls the owner's ranged units stand on, and a governed
// town's gates that shoot. The simulation already breaks the gate nearest a soldier whose goal is behind it (ranged
// units and mages at 1/5); these are what both AIs do on top (ceo 2026-10-22: on, the gates are a rule).

/**
 * D-096. focus: at a town with gates closed to it, the melee go for the gate nearest the army together, ranged units
 * and mages for those on its walls first (else the gate too); walls: ranged units and mages in a town it is plundering
 * go up its walls while enemy soldiers are by it; arrows: a governed enemy town's gate arrows count in what it takes;
 * retreat, the break-off at a gate (ceo 2026-10-22, measured): "" as before, "a" not for its losses while the gate
 * falls (GATE_FALL_SHARE of its hp in GATE_FALL), "b" not off to a town where the slings and gate arrows would take
 * more than GATE_LOSS of its army's hp while it breaks in, "ab" both.
 */
export const GATE_AI = { focus: true, walls: true, arrows: true, retreat: "" };
/** The army goes for the gate within this many cells of a town's walls (its radius + this). */
const GATE_NEAR = 10;
const GATE_FALL = 400;
const GATE_FALL_SHARE = 10;
const GATE_LOSS = 25;

/** A castle gate in the view (in sight or remembered; a broken one is gone). */
export interface Gate {
  id: number;
  owner: number;
  x: number;
  y: number;
  hp: number;
}

/** D-096: the gates of town `t` standing in the view, by their openings (rules.towns[size].castle.gates); [] without gates. */
export function townGates(view: PlayerView, rules: Rules, t: { x: number; y: number; size: number }): Gate[] {
  const openings = rules.towns?.[t.size]?.castle?.gates;
  if (rules.features?.gates !== true || openings === undefined) return [];
  const out: Gate[] = [];
  for (let r = 0; r < view.buildings.length; r += BUILDING_STRIDE) {
    if (view.buildings[r + BuildingField.type] !== BuildingType.Gate) continue;
    const x = view.buildings[r + BuildingField.cellX];
    const y = view.buildings[r + BuildingField.cellY];
    if (!openings.some((o) => o.length > 0 && t.x + o[0][0] === x && t.y + o[0][1] === y)) continue;
    out.push({ id: view.buildings[r + BuildingField.id], owner: view.buildings[r + BuildingField.owner], x, y, hp: view.buildings[r + BuildingField.hp] });
  }
  return out;
}

/** D-096: units in sight on town `t`'s walls that are not `player`'s (militia too). */
export function onWalls(view: PlayerView, player: number, rules: Rules, t: { x: number; y: number; size: number }): { id: number; x: number; y: number }[] {
  // The walls are a square round the town (its radius out, a cell more for the big city's).
  const reach = (rules.towns?.[t.size]?.radius ?? 5) + 1;
  const out: { id: number; x: number; y: number }[] = [];
  for (let r = 0; r < view.units.length; r += UNIT_STRIDE) {
    if (view.units[r + UnitField.owner] === player || view.units[r + UnitField.action] !== Action.OnWall) continue;
    const x = view.units[r + UnitField.x] >> CELL_SHIFT;
    const y = view.units[r + UnitField.y] >> CELL_SHIFT;
    if (Math.abs(x - t.x) > reach || Math.abs(y - t.y) > reach) continue;
    out.push({ id: view.units[r + UnitField.id], x, y });
  }
  return out;
}

/**
 * D-096 (GATE_AI.focus): the orders for `army` (centre `at`) by town `t` while gates closed to `player` stand: the melee
 * on the gate nearest it, ranged units and mages on those on the walls nearest that gate, a third of them on each (else
 * on the gate); null when it is not by the town or no gate is closed to it (in as before).
 */
export function gateOrders(
  view: PlayerView,
  rules: Rules,
  player: number,
  t: { x: number; y: number; size: number; state: number },
  army: readonly { id: number; type: number }[],
  at: { x: number; y: number },
  rank: (x: number, y: number) => number,
): { gate: Gate; orders: CommandBody[] } | null {
  if (!GATE_AI.focus || t.state === TownState.Ruins || army.length === 0) return null;
  const r0 = (rules.towns?.[t.size]?.radius ?? 5) + GATE_NEAR;
  if ((at.x - t.x) * (at.x - t.x) + (at.y - t.y) * (at.y - t.y) > r0 * r0) return null;
  let gate: Gate | undefined;
  let bestD = 0;
  for (const g of townGates(view, rules, t)) {
    if (g.owner === player) continue;
    const d = (g.x - at.x) * (g.x - at.x) + (g.y - at.y) * (g.y - at.y);
    if (gate === undefined || d < bestD || (d === bestD && rank(g.x, g.y) < rank(gate.x, gate.y))) {
      gate = g;
      bestD = d;
    }
  }
  if (gate === undefined) return null;
  const g = gate;
  const melee = army.filter((u) => u.type === UnitType.Spearman || u.type === UnitType.Cavalry).map((u) => u.id);
  const shooters = army.filter((u) => u.type === UnitType.Ranged || u.type === UnitType.Mage).map((u) => u.id);
  const dg = (w: { x: number; y: number }) => (w.x - g.x) * (w.x - g.x) + (w.y - g.y) * (w.y - g.y);
  const walls = onWalls(view, player, rules, t).sort((a, b) => dg(a) - dg(b) || a.id - b.id);
  const orders: CommandBody[] = [];
  if (melee.length > 0) orders.push({ c: "attack", u: melee, target: g.id });
  if (shooters.length > 0 && walls.length === 0) orders.push({ c: "attack", u: shooters, target: g.id });
  else if (shooters.length > 0) {
    const k = Math.min(walls.length, Math.max(1, Math.ceil(shooters.length / 3)));
    for (let i = 0; i < k; i++) orders.push({ c: "attack", u: shooters.filter((_, j) => j % k === i), target: walls[i].id });
  }
  return { gate: g, orders };
}

/**
 * D-096 (GATE_AI.retreat "b"): what the slings on town `t`'s walls and its gate arrows would take of `army`'s hp
 * (percent) while its melee (and ranged units, at 1/5) break the weakest gate closed to `player`, its ranged units and
 * mages shooting the slingers meanwhile; 0 with no gate closed to it.
 */
export function gateLoss(view: PlayerView, rules: Rules, player: number, t: { x: number; y: number; size: number; state: number; owner: number }, army: readonly { type: number }[]): number {
  const tr = rules.towns?.[t.size];
  if (rules.features?.gates !== true || tr === undefined || t.state === TownState.Ruins || (t.owner === player && t.state !== TownState.Neutral)) return 0;
  const known = townGates(view, rules, t).filter((g) => g.owner !== player);
  const hp = known.length > 0 ? Math.min(...known.map((g) => g.hp)) : (tr.gateHp ?? 0);
  if (hp <= 0) return 0;
  const num = rules.gate?.rangedNum ?? 1;
  const den = rules.gate?.rangedDen ?? 5;
  const takenNum = rules.walls?.takenNum ?? 3;
  const takenDen = rules.walls?.takenDen ?? 4;
  let melee = 0;
  let onGate = 0;
  let onWall = 0;
  let armyHp = 0;
  for (const u of army) {
    const s = rules.units[u.type];
    if (s === undefined) continue;
    armyHp += s.hp + (s.shield ?? 0);
    if (u.type === UnitType.Spearman || u.type === UnitType.Cavalry) melee += s.attack / s.cooldown;
    else if (u.type === UnitType.Ranged || u.type === UnitType.Mage) {
      onGate += Math.max(1, Math.trunc((s.attack * num) / den)) / s.cooldown;
      onWall += (s.attack * takenNum) / takenDen / s.cooldown;
    }
  }
  if (melee + onGate <= 0) return 100;
  const ticks = hp / (melee + onGate);
  const m = rules.units[UnitType.Militia];
  const seen = onWalls(view, player, rules, t).length;
  const slingers = t.state === TownState.Neutral && seen === 0 ? tr.militia >> 1 : seen;
  let damage = 0;
  if (slingers > 0 && m !== undefined) {
    const each = m.attack / m.cooldown;
    const down = onWall > 0 ? (slingers * m.hp) / onWall : ticks;
    damage += down < ticks ? (slingers * each * down) / 2 : slingers * each * ticks;
  }
  const arrows = rules.arrows?.gate;
  // Two gates' arrows on the army at one gate, one arrow each (their extra arrows count in gateArrowWorth).
  if (arrows !== undefined && t.state === TownState.Governed && t.owner !== player) damage += ((2 * arrows.damage) / arrows.cooldown) * ticks;
  return Math.round((damage * 100) / Math.max(1, armyHp));
}

/**
 * D-096 (GATE_AI.arrows): what town `t`'s standing gates are worth as forts (fortValues' measure) while it is a
 * governed enemy town: each shoots, and 1 more arrow for every perSoldiers of `guards` (its soldiers in sight by it).
 */
export function gateArrowWorth(view: PlayerView, rules: Rules, player: number, t: { x: number; y: number; size: number; state: number; owner: number }, guards: number): number {
  const a = rules.arrows?.gate;
  if (a === undefined || t.state !== TownState.Governed || t.owner === player) return 0;
  const spear = rules.units[UnitType.Spearman];
  const base = (spear.attack / spear.cooldown) * spear.hp;
  const shots = 1 + Math.min(a.extraMax ?? 0, Math.trunc(guards / Math.max(1, a.perSoldiers ?? 3)));
  let worth = 0;
  for (const g of townGates(view, rules, t)) if (g.owner !== player) worth += Math.round(10 * Math.sqrt(((a.damage / a.cooldown) * shots * g.hp) / base));
  return worth;
}

/** D-096 (GATE_AI.retreat "a"): the gate's hp seen (`seen`, pruned to GATE_FALL); whether it lost GATE_FALL_SHARE of `full` since. */
function gateFalling(seen: { tick: number; hp: number }[], tick: number, hp: number, full: number): boolean {
  while (seen.length > 0 && tick - seen[0].tick > GATE_FALL) seen.shift();
  seen.push({ tick, hp });
  return full > 0 && (seen[0].hp - hp) * 100 >= full * GATE_FALL_SHARE;
}

/** Falling back round forts (aroundForts): points this many cells beyond their reach, and half as far again, and twice... */
const VIA_SPARE = 3;
/** ...and on home once within VIA_NEAR cells of the point, or after VIA_TICKS. */
const VIA_NEAR = 4;
const VIA_TICKS = 1200;
/** Sixteen directions in thousandths (no sin or cos in the sim). */
const DIRS16: readonly (readonly [number, number])[] = [
  [1000, 0], [924, 383], [707, 707], [383, 924], [0, 1000], [-383, 924], [-707, 707], [-924, 383],
  [-1000, 0], [-924, -383], [-707, -707], [-383, -924], [0, -1000], [383, -924], [707, -707], [924, -383],
];

/**
 * Falling back from `from` to `to` (D-081, ceo 2026-10-11: falling back straight through the forts' reach
 * killed half of those lost to them): when the straight way nears one of these groups (within reach, FORT_WAY
 * to spare) before leaving it, a point round the first such group to fall back to first: of points round it
 * just beyond its reach (and further out), the one with the shortest way there and on whose two legs the army
 * keeps out of its reach (or, starting within it, does not come nearer). Undefined when the way is clear, leads
 * away from the group from the first step, or no such point is found.
 */
export function aroundForts(groups: readonly FortGroup[], from: { x: number; y: number }, to: { x: number; y: number }, size: number): { x: number; y: number } | undefined {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return undefined;
  let g: FortGroup | undefined;
  let gt = 0;
  for (const o of groups) {
    const t = ((o.x - from.x) * dx + (o.y - from.y) * dy) / len2;
    if (t <= 0) continue;
    const r = o.radius + FORT_WAY;
    if (wayDist2(o.x, o.y, from.x, from.y, to.x, to.y) > r * r) continue;
    if (g === undefined || t < gt || (t === gt && o.ids[0] < g.ids[0])) {
      g = o;
      gt = t;
    }
  }
  if (g === undefined) return undefined;
  const reach = g.radius + FORT_WAY;
  const near = Math.min(reach * reach, (from.x - g.x) * (from.x - g.x) + (from.y - g.y) * (from.y - g.y));
  const out = reach + VIA_SPARE;
  let best: { x: number; y: number } | undefined;
  let bestWay = 0;
  for (const r of [out, out + (out >> 1), 2 * out]) {
    for (const [ux, uy] of DIRS16) {
      const x = g.x + Math.trunc((ux * r) / 1000);
      const y = g.y + Math.trunc((uy * r) / 1000);
      if (x < 1 || y < 1 || x > size - 2 || y > size - 2) continue;
      if (wayDist2(g.x, g.y, from.x, from.y, x, y) < near || wayDist2(g.x, g.y, x, y, to.x, to.y) <= reach * reach) continue;
      const way = Math.sqrt((x - from.x) * (x - from.x) + (y - from.y) * (y - from.y)) + Math.sqrt((to.x - x) * (to.x - x) + (to.y - y) * (to.y - y));
      if (best === undefined || way < bestWay) {
        best = { x, y };
        bestWay = way;
      }
    }
    if (best !== undefined) return best;
  }
  return undefined;
}

/** Farmers sent against an unguarded fort: this many, or three for each builder, and FORT_CREW_MAX under arrows. */
const FORT_CREW = 4;
const FORT_CREW_MAX = 12;
/** Enemy farmers this near a fort (cells, to the footprint) are its builders. */
const FORT_BUILDERS = 3;
/** Soldiers this near a fort (cells) count as there for it. */
const FORT_THERE = 12;

interface Spot {
  id: number;
  x: number;
  y: number;
}

export interface FortCrew {
  /** The farmers sent, or none. */
  readonly ids: readonly number[];
  /** The fort they go for, or -1: the soldiers at home go with them (the army's orders). */
  readonly aim: number;
  think(
    tick: number,
    ours: Fort[],
    forts: Fort[],
    home: { cellX: number; cellY: number },
    foes: readonly Spot[],
    enemyFarmers: readonly Spot[],
    soldiers: readonly Spot[],
    farmers: readonly (Spot & { order: number })[],
    out: CommandBody[],
    /** Forts it leaves alone (D-081: the army broke off from them and is not FORT_FAILED of that army yet). */
    blocked?: (f: Fort) => boolean,
  ): void;
}

/**
 * Farmers against an unguarded fort on its ground (D-080): with too few soldiers by it, farmers go (they
 * fight only when told to attack) at the builders of every site first, then a finished arrow tower, a
 * site, an outpost, and the soldiers at home with them. Not against one with enemy soldiers by it, nor
 * under the arrows of two finished towers or more without two soldiers at home for each; called off
 * then, and once it is gone or soldiers enough are there (released, the economy hands them work).
 */
export function createFortCrew(rank: (x: number, y: number) => number): FortCrew {
  let crew: number[] = [];
  let aim = -1;
  let hitting = -1;
  let last = -100000;
  return {
    get ids() {
      return crew;
    },
    get aim() {
      return crew.length > 0 ? aim : -1;
    },
    think(tick, ours, forts, home, foes, enemyFarmers, soldiers, farmers, out, blocked) {
      crew = crew.filter((id) => farmers.some((f) => f.id === id));
      // Not against guards; nor under the arrows of two finished towers or more without two soldiers at
      // home for each (three arrows kill a farmer: two towers killed a crew of 12 in 50 s without falling,
      // scratch run 37923387505; one tower falls to 12 in about 25 s).
      const shooting = forts.filter((o) => o.done && o.type === BuildingType.ArrowTower);
      // A tower with soldiers hiding in it (seen so, or only remembered: it cannot tell) counts twice (D-081).
      const shooters = (f: Fort) => {
        const c = fortCentre(f);
        let k = 0;
        for (const o of shooting) if (o === f || fortDist2(o, c.x, c.y) <= (o.hits + 1) * (o.hits + 1)) k += !o.seen || o.occupied ? 2 : 1;
        return k;
      };
      let atHome = 0;
      for (const u of soldiers) if ((u.x - home.cellX) * (u.x - home.cellX) + (u.y - home.cellY) * (u.y - home.cellY) <= FORT_HOME * FORT_HOME) atHome++;
      const open = ours.filter((f) => {
        if (foes.some((e) => fortDist2(f, e.x, e.y) <= FORT_GUARDS * FORT_GUARDS)) return false;
        // The soldiers at home go with the farmers to the end (the army's orders): not where the army broke off (D-081).
        if (blocked?.(f) === true) return false;
        const k = shooters(f);
        return k <= 1 || atHome >= 2 * k;
      });
      // The fort to go for: a finished arrow tower first (it shoots), then a site, then an outpost; of a
      // kind the nearest to the main city (ties: player 0's frame).
      const kind = (f: Fort) => (f.done && f.type === BuildingType.ArrowTower ? 0 : !f.done ? 1 : 2);
      let f: Fort | undefined;
      let fk = 0;
      let fd = 0;
      for (const o of open) {
        const k = kind(o);
        const d = fortDist2(o, home.cellX, home.cellY);
        if (f === undefined || k < fk || (k === fk && (d < fd || (d === fd && rank(o.x, o.y) < rank(f.x, f.y))))) {
          f = o;
          fk = k;
          fd = d;
        }
      }
      let near = 0;
      const arrows = f === undefined ? 0 : shooters(f);
      if (f !== undefined) for (const u of soldiers) if (fortDist2(f, u.x, u.y) <= FORT_THERE * FORT_THERE) near++;
      if (f === undefined || near >= FORT_ARMY + 2 * arrows) {
        // Nothing to do, or soldiers enough there: back to work (`release`: a farmer told to stop or
        // attack waits where he is once idle, and the economy leaves him there).
        if (crew.length > 0) out.push({ c: "release", u: crew });
        crew = [];
        aim = -1;
        hitting = -1;
        return;
      }
      // The builders of every site first: once they are down nothing more goes up.
      const builders = enemyFarmers.filter((e) => open.some((o) => !o.done && fortDist2(o, e.x, e.y) <= FORT_BUILDERS * FORT_BUILDERS));
      // Under arrows as many as it sends at all (a tower kills at its own pace: the sooner it falls, the
      // fewer it kills); else three for each builder (the sooner they fall, the less goes up).
      const want = arrows > 0 ? FORT_CREW_MAX : Math.min(FORT_CREW_MAX, Math.max(FORT_CREW, 3 * builders.length));
      if (crew.length < want) {
        const c = fortCentre(f);
        const d2 = (u: Spot) => (u.x - c.x) * (u.x - c.x) + (u.y - c.y) * (u.y - c.y);
        const pick = farmers
          .filter((u) => u.order === Order.Gather && !crew.includes(u.id))
          .sort((a, b) => d2(a) - d2(b) || rank(a.x, a.y) - rank(b.x, b.y) || a.id - b.id)
          .slice(0, want - crew.length);
        crew.push(...pick.map((u) => u.id));
      }
      // The builder nearest the crew (ties to the lower id), else the fort.
      let target = f.id;
      if (builders.length > 0) {
        const mine = farmers.filter((u) => crew.includes(u.id));
        const cx = mine.length === 0 ? home.cellX : Math.trunc(mine.reduce((a, u) => a + u.x, 0) / mine.length);
        const cy = mine.length === 0 ? home.cellY : Math.trunc(mine.reduce((a, u) => a + u.y, 0) / mine.length);
        let bestD = 0;
        let best: Spot | undefined;
        for (const e of builders) {
          const d = (e.x - cx) * (e.x - cx) + (e.y - cy) * (e.y - cy);
          if (best === undefined || d < bestD || (d === bestD && e.id < best.id)) {
            best = e;
            bestD = d;
          }
        }
        target = best!.id;
      }
      if (crew.length > 0 && (target !== hitting || f.id !== aim || tick - last >= FORT_EVERY)) {
        out.push({ c: "attack", u: crew, target });
        last = tick;
      }
      aim = f.id;
      hitting = target;
    },
  };
}

export interface AiKnowledge {
  /** On a random map only its own main city (view.ts mapInfo, D-074): the rest it scouts (scout.ts). */
  map: Pick<MapInfo, "size" | "spawns" | "towns" | "mode">;
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

type Mode = "gather" | "town" | "base" | "defend" | "raze";

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
/** What governing a town of this size costs: from the rules (round 7 sends them), else GOVERN_COST. */
function governCostOf(rules: Rules, size: number): Cost {
  return rules.towns?.[size]?.governCost ?? GOVERN_COST[size];
}

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
  // The map as it knows it (scout.ts, D-074): on the fixed map the MapInfo's own objects.
  const mem = mapMemory(know.map, know.frame, player);
  const scout = createScout(mem);
  const home = mem.home;
  const enemyHome = mem.enemy;
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
  /** D-089: where those that set out for the enemy base gather first (null: straight on), when it set out and the first got there, and whether they have gathered. */
  let stage: { x: number; y: number } | null = null;
  let setOut = 0;
  let stageFirst = -1;
  let staged = true;
  /** D-089 (SIEGE.failed): how many set out on the last attack on the enemy main city that was ground down. */
  let cityFailed = 0;
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
  /** The enemy fort (D-080) the army is pulling down, and when it may try again after breaking off. */
  let razing = -1;
  /** D-081 / A4 (NORMAL_FORT.again, NORMAL_FORT.stage): what it takes after breaking off from forts and how long it remembers; the forts it gathers for. */
  const fortFailed = NORMAL_FORT.again ? FORT_FAILED_AGAIN : FORT_FAILED;
  const fortForget = NORMAL_FORT.again ? FORT_FORGET_AGAIN : FORT_FORGET;
  const fortStage = NORMAL_FORT.stage;
  let fortStop: FortStop | null = null;
  /** D-096: the gate it goes for (-1: none), when it last told the army so, that gate's hp as seen (GATE_AI.retreat "a"), when it last sent soldiers up a wall. */
  let gateAim = -1;
  let gateMove = -100000;
  let gateFell = false;
  const gateSeen: { tick: number; hp: number }[] = [];
  let wallMove = -100000;
  let razeAgain = -100000;
  /** While the army is away: the soldiers trained since, at home, pulling down a fort on its ground. */
  let reservesRazing = -1;
  let reservesMove = -100000;
  /** Since when the army has gathered at home for a fort it is not yet strong enough for (-1: not). */
  let holdFrom = -1;
  /** D-081, as hard: the army (worth against forts) that broke off from each fort. */
  /** What the army that set out was worth against forts (D-081: a break-off remembers that, not what is left). */
  let marchWorth = 0;
  const failedAt = new Map<number, Failed>();
  /** Falling back round forts (aroundForts): the point first, and until when. */
  let via: { x: number; y: number; until: number } | null = null;
  /** Towns it fell back from because of forts (D-081, ceo 2026-10-10): the forts, and when. */
  const townForts = new Map<number, { ids: number[]; tick: number }>();
  /** D-083 (a): the most enemy soldiers seen by each town it holds in a plunder lately, and when. */
  const plunderFoes = new Map<number, { worth: number; tick: number }>();
  const fv = fortValues(know.rules);
  const crew = createFortCrew((x, y) => {
    const f = frame(x, y);
    return f.v * n + f.u;
  });

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
      mem.observe(view);
      // Ticks to the time limit, or -1 without one.
      const toGo = know.maxTicks > 0 ? know.maxTicks - tick : -1;
      const res: Cost = { food: h[HeaderField.food], wood: h[HeaderField.wood], gold: h[HeaderField.gold], crystal: h[HeaderField.crystal] };
      const pop = h[HeaderField.population];
      const cap = h[HeaderField.populationCap];
      // D-083: houses reach the ceiling now (base, and more for each town it governs; off: 120), a house's room as the rules say.
      const ceiling = h[HeaderField.populationCeiling];
      const houseRoom = rules.buildings[BuildingType.House].populationCap;
      // D-083 (ceo 2026-10-18): D-081's leftover (a) comes with the population rules.
      const d083 = (rules.population?.town[TownSize.Small] ?? 0) > 0;
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
        mode === "town" && targetTown >= 0 && (myStyle !== "plunder" || (once && plundered(targetTown))) ? mem.site(targetTown) : undefined;
      const reserve: Cost = aimTown !== undefined ? { ...governCostOf(rules, aimTown.size) } : { food: 0, wood: 0, gold: 0, crystal: 0 };
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
      const enemyFarmers: Unit[] = [];
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
        else if (owner === 1 - player) enemyFarmers.push(u);
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
      // Random maps (D-074): one soldier scouts (scout.ts) and is left out of everything else.
      const allSoldiers = mine.filter((u) => u.type !== UnitType.Farmer);
      scout.think(tick, allSoldiers, (u) => ![...garrison.values()].some((ids) => ids.includes(u.id)), out);
      const soldiers = scout.id < 0 ? allSoldiers : allSoldiers.filter((u) => u.id !== scout.id);
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
        if (cap < ceiling && cap - pop - queued <= houseRoom) add(BuildingType.House, base);
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
      const trainAt = (t: number, type: UnitType, most = QUEUE_MOST) => {
        for (const b of done(t)) {
          if (most <= 0) break;
          if (b.queue >= 2 || room <= 0 || armyRoom <= 0 || !afford(rules.units[type].cost)) continue;
          out.push({ c: "train", building: b.id, type, n: 1 });
          spend(rules.units[type].cost);
          room--;
          armyRoom--;
          most--;
        }
      };
      // The mage cap counts mages queued too (D-089, ceo 2026-10-21: orders refused for the cap went up with the longer games).
      // The scout counts too, if it is a mage (random maps).
      const mageRoom = rules.mageCap - allSoldiers.filter((u) => u.type === UnitType.Mage).length - done(BuildingType.MageHall).reduce((a, b) => a + b.queue, 0);
      if (mageRoom > 0 && res.crystal >= rules.units[UnitType.Mage].cost.crystal) trainAt(BuildingType.MageHall, UnitType.Mage, mageRoom);
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
        const t = mem.site(id)!;
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
      for (const t of mem.unexplored) {
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
        const cost = governCostOf(rules, t.size);
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
      // Enemy forts (D-080, D-081).
      const forts = enemyForts(view, player, rules);
      /** A town under the arrows or guards of an enemy fort (D-081). */
      const underArrows = (t: { x: number; y: number }) => forts.some((o) => o.done && fortDist2(o, t.x, t.y) <= (o.hits + 1) * (o.hits + 1));
      // Garrisons: the soldiers nearest each held town (not mages), topped up as they fall;
      // in the endgame they join the assault. None under enemy forts' arrows (D-081: seed 9 of the
      // fortress-hold runs topped one up as each fell, 21 shot).
      if (endgame) garrison.clear();
      for (const [id, t] of towns) {
        const held = t.owner === player && (t.state === TownState.Repairing || t.state === TownState.Governed);
        if (!held || endgame) continue;
        if (underArrows(t)) {
          garrison.delete(id);
          continue;
        }
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

      // Enemy forts (D-080) on its ground (by the main city or a town it holds): farmers go for an
      // unguarded one while too few soldiers are by it (the army's part comes below).
      const held = [...towns.values()]
        .filter((t) => t.owner === player && (t.state === TownState.Repairing || t.state === TownState.Governed))
        .map((t) => ({ x: t.x, y: t.y, radius: rules.towns?.[t.size]?.radius ?? 0 }));
      const ours = forts.length === 0 ? [] : fortsOnOurGround(forts, home, held);
      if (!recalled) {
        // Farmers going take the soldiers at home along to the end: not where the army broke off, as its own goes (D-081, ceo 2026-10-10).
        // Those that would go: not the towns' garrisons (seed 9 of the fortress-hold runs: counted in, the farmers went with 14).
        const vs = army.reduce((a, u) => a + (fv.vs[u.type] ?? 0), 0);
        crew.think(tick, ours, forts, home, foes, enemyFarmers, soldiers, farmers, out, (f) => vs * 100 < failedNear(f, forts, failedAt, tick, fortForget) * fortFailed);
      }

      // --- defence, towns and attack --------------------------------------------------------------
      const threat = foesNear(home.cellX, home.cellY, 16);
      const send = (x: number, y: number, why: Mode) => {
        if (armyIds.length === 0) return;
        // Falling back round forts (aroundForts): to the point first, then on to the rally point.
        if (via !== null) {
          const back = why === "gather" && x === rally.x && y === rally.y;
          if (back && tick < via.until && dist2(cx, cy, via.x, via.y) > VIA_NEAR * VIA_NEAR) {
            mode = why;
            target = { x, y };
            return;
          }
          if (back) lastMove = -100000;
          via = null;
        }
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
      const stuck = (id: number, t: Town) => once && t.state === TownState.AwaitingChoice && plundered(id) && !affordAll(governCostOf(rules, t.size));
      /**
       * D-083 (D-081's leftover (a), ceo 2026-10-18): not back one by one to a town whose plunder it lost the fight for
       * (#188 seed 11: the army beaten there, the town stayed in its plunder and each new soldier went alone). Those that
       * would go must beat, as for a fort (D-081), the forts reaching the town and 1.3 x the enemy soldiers seen by it in
       * the last 2 minutes.
       */
      const holdsOut = (id: number, t: Town) => {
        if (!d083) return true;
        const r = (rules.towns?.[t.size]?.radius ?? 5) + FORT_ARMY_NEAR;
        const seen = 10 * foes.filter((e) => e.order !== Order.Post && dist2(e.x, e.y, t.x, t.y) <= r * r).length;
        const was = plunderFoes.get(id);
        const enemy = was !== undefined && tick - was.tick < 2 * TICKS_PER_MINUTE && was.worth > seen ? was.worth : seen;
        if (seen > 0 && (was === undefined || seen >= was.worth || tick - was.tick >= 2 * TICKS_PER_MINUTE)) plunderFoes.set(id, { worth: seen, tick });
        const gs = forts.length === 0 ? [] : fortGroups(forts, (o) => foes.filter((e) => e.order === Order.Post && fortDist2(o, e.x, e.y) <= 9).length, fv);
        const w = army.reduce((a, u) => a + (fv.vs[u.type] ?? 0), 0);
        return w * 10 >= fortsAtTown(gs, t.x, t.y, rules.towns?.[t.size]?.radius ?? 5) * 10 + enemy * 13;
      };
      /**
       * D-096 (GATE_AI.walls): with enemy soldiers by town `id` it holds, its ranged units and mages there go up the walls
       * (told again every 100 ticks); those on its walls, or going up, are left out of the army's orders this think.
       */
      const wallUp = (id: number, t: Town) => {
        if (!GATE_AI.walls || rules.features?.walls !== true) return;
        const r = rules.towns?.[t.size]?.radius ?? 5;
        const threat = foes.some((e) => dist2(e.x, e.y, t.x, t.y) <= (r + GATE_NEAR) * (r + GATE_NEAR));
        const up = threat ? army.filter((u) => (u.type === UnitType.Ranged || u.type === UnitType.Mage) && u.order !== Order.Wall && dist2(u.x, u.y, t.x, t.y) <= (r + 3) * (r + 3)).map((u) => u.id) : [];
        if (up.length > 0 && tick - wallMove >= 100) {
          out.push({ c: "wall", u: up, town: id });
          wallMove = tick;
        }
        const away = new Set([...up, ...army.filter((u) => u.order === Order.Wall && u.orderTarget === id).map((u) => u.id)]);
        if (away.size === 0) return;
        const keep = armyIds.filter((x) => !away.has(x));
        armyIds.length = 0;
        armyIds.push(...keep);
      };
      const busy = [...towns.entries()].find(
        ([id, t]) => t.owner === player && (t.state === TownState.Plundering || t.state === TownState.AwaitingChoice) && !stuck(id, t) && holdsOut(id, t),
      );
      if (busy !== undefined && !endgame) {
        // Stay inside until the plunder is done (not in the endgame: everything goes for the
        // enemy main city then). D-096 (GATE_AI.walls): enemy soldiers by it, its ranged units and mages up on the walls.
        wallUp(busy[0], busy[1]);
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
      // Without a limit it also marches once it cannot grow (population at the ceiling).
      const popFull = toGo < 0 && cap >= ceiling && pop >= cap - FULL_MARGIN;
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
      // Enemy forts (D-080). On its ground (by the main city or a town it holds) the army at home
      // pulls them down, the nearest first, once clearly stronger than what defends it, and keeps at
      // it until they are gone; on the way to a town or the enemy base, those by the way first.
      const nearestFort = (list: Fort[], x: number, y: number): Fort | undefined => {
        let best: Fort | undefined;
        let bestD = 0;
        let bestKey = 0;
        for (const f of list) {
          const d = fortDist2(f, x, y);
          const c = frame(f.x, f.y);
          const key = c.v * n + c.u;
          if (best === undefined || d < bestD || (d === bestD && key < bestKey)) {
            best = f;
            bestD = d;
            bestKey = key;
          }
        }
        return best;
      };
      const razeOrders = (f: Fort) => {
        const c = fortCentre(f);
        if (razing !== f.id || target.x !== c.x || target.y !== c.y || tick - lastMove >= FORT_EVERY) {
          // Its defenders first (a move fights what it meets), then the fort itself.
          if (foesNear(c.x, c.y, FORT_GUARDS) > 0) out.push({ c: "move", u: armyIds, x: c.x, y: c.y });
          else out.push({ c: "attack", u: armyIds, target: f.id });
          lastMove = tick;
        }
        razing = f.id;
        target = c;
      };
      // Fort groups (D-081), as hard; the enemy soldiers it counts are those in sight (normal keeps no count of the unseen).
      const guardsAt = (f: Fort) => foes.filter((e) => e.order === Order.Post && fortDist2(f, e.x, e.y) <= 9).length;
      const groups = forts.length === 0 ? [] : fortGroups(forts, guardsAt, fv);
      const groupOf = (f: Fort) => groups.find((g) => g.ids.includes(f.id));
      const bySiege = (g: FortGroup) => dist2(g.x, g.y, enemyHome.cellX, enemyHome.cellY) <= FORT_SIEGE * FORT_SIEGE;
      const armyBy = (g: FortGroup) => {
        const r = g.radius + FORT_ARMY_NEAR;
        return 10 * foes.filter((e) => e.order !== Order.Post && dist2(e.x, e.y, g.x, g.y) <= r * r).length;
      };
      const vsForts = (list: { type: number }[]) => list.reduce((a, u) => a + (fv.vs[u.type] ?? 0), 0);
      const beats = (g: FortGroup, list: { type: number }[]) => {
        const w = vsForts(list);
        let failed = 0;
        for (const id of g.ids) {
          const f = failedAt.get(id);
          if (f !== undefined && tick - f.tick < fortForget) failed = Math.max(failed, f.worth);
        }
        // At least as strong as the forts (scratch base runs: 30 or more soldiers in reach took the scripted
        // fortress 68 times of 69, fewer than 20 failed 12 times of 20) and clearly (1.3 x) stronger than the army by them.
        return w * 10 >= g.worth * 10 + armyBy(g) * 13 && w * 100 >= failed * fortFailed;
      };
      const tooStrong = (list: { type: number }[]) => groups.filter((g) => !bySiege(g) && !beats(g, list));
      const routeFor = (from: { x: number; y: number }, to: { x: number; y: number }, list: { type: number }[]) => ({ go: groupsOnWay(tooStrong(list), from, to).length === 0 });
      const remember = (list: { type: number }[], near: FortGroup[]) => {
        // The army that set out, not what is left of it.
        const w = Math.max(vsForts(list), marchWorth);
        for (const g of near) for (const id of g.ids) failedAt.set(id, { worth: Math.max(failedAt.get(id)?.worth ?? 0, w), tick });
      };
      /** The groups whose arrows or guards reach (x, y), and the one `f` is in. */
      const covering = (x: number, y: number, f?: Fort) =>
        groups.filter((g) => dist2(g.x, g.y, x, y) <= (g.radius + FORT_WAY) * (g.radius + FORT_WAY) || (f !== undefined && g.ids.includes(f.id)));
      /** Broke off from pulling down `f` (gone, maybe) with the army at (x, y): it and the groups there, as from a march (D-081, ceo 2026-10-10). */
      const rememberFort = (list: { type: number }[], f: Fort | undefined, x: number, y: number) => {
        remember(list, covering(x, y, f));
        if (f !== undefined) failedAt.set(f.id, { worth: Math.max(failedAt.get(f.id)?.worth ?? 0, vsForts(list), marchWorth), tick });
      };
      /** The army that broke off from `f` or from the groups covering it, within FORT_FORGET (0: none). */
      const failedBy = (f: Fort) => {
        const c = fortCentre(f);
        let failed = 0;
        for (const id of [f.id, ...covering(c.x, c.y, f).flatMap((g) => g.ids)]) {
          const m = failedAt.get(id);
          if (m !== undefined && tick - m.tick < fortForget) failed = Math.max(failed, m.worth);
        }
        return failed;
      };
      /**
       * Strong enough for a fort: at least the group it is in, and 1.3 x the enemy soldiers by it, not its guards (D-081; D-080 counted 3 soldiers a tower);
       * and, within FORT_FORGET of breaking off from it, FORT_FAILED of the army that did (ceo 2026-10-10: it went again every 0.6–3 minutes).
       */
      const enough = (list: { type: number }[], f: Fort) => {
        const c = fortCentre(f);
        const g = groupOf(f);
        const army = 10 * foes.filter((e) => e.order !== Order.Post && dist2(e.x, e.y, c.x, c.y) <= FORT_GUARDS * FORT_GUARDS).length;
        const w = vsForts(list);
        return w * 10 >= (g === undefined ? 0 : g.worth) * 10 + army * 13 && w * 100 >= failedBy(f) * fortFailed;
      };
      /** Fell back from town `id` because of forts, and they are still too strong for the army (with FORT_FAILED within FORT_FORGET). */
      const fortsBar = (id: number) => {
        const m = townForts.get(id);
        return m !== undefined && tooStrong(army).some((g) => g.ids.some((x) => m.ids.includes(x)));
      };
      /** Back to the rally point, round forts too strong for it that the straight way passes first (aroundForts, ceo 2026-10-11). */
      const fallBackPast = (cause: FortGroup[]) => {
        const v = aroundForts([...cause, ...tooStrong(army)], { x: cx, y: cy }, rally, know.map.size);
        via = v === undefined ? null : { x: v.x, y: v.y, until: tick + VIA_TICKS };
        out.push({ c: "retreat", u: armyIds, x: v?.x ?? rally.x, y: v?.y ?? rally.y });
      };
      /** D-096 (GATE_AI.focus): at town `t` with gates closed to it, the army on the gate (orders again every FORT_EVERY); false: none (in as before). */
      const gateFocus = (t: Town) => {
        const go = gateOrders(view, rules, player, t, army.filter((u) => armyIds.includes(u.id)), { x: cx, y: cy }, (x, y) => {
          const f = frame(x, y);
          return f.v * n + f.u;
        });
        if (go === null) {
          // The gate down: in, now.
          if (gateAim >= 0) lastMove = -100000;
          gateAim = -1;
          gateSeen.length = 0;
          return false;
        }
        if (go.gate.id !== gateAim) gateSeen.length = 0;
        gateFell = gateFalling(gateSeen, tick, go.gate.hp, rules.towns?.[t.size]?.gateHp ?? 0);
        if (go.gate.id !== gateAim || tick - gateMove >= FORT_EVERY) {
          out.push(...go.orders);
          gateMove = tick;
        }
        gateAim = go.gate.id;
        return true;
      };
      if (mode === "raze" || ((mode === "gather" || mode === "defend") && !endgame && forts.length > 0)) {
        // With farmers going for a fort, the soldiers at home go with them, however few, to the end.
        const withCrew = crew.aim >= 0 ? ours.find((x) => x.id === crew.aim) : undefined;
        if (mode === "raze" && withCrew === undefined && (standing * 5 < armyAtStart * 2 || outnumbered)) {
          // Ground down or outnumbered: back to the rally point, and again a little later; remembered, as from a march.
          const was = forts.find((x) => x.id === razing);
          rememberFort(army, was, cx, cy);
          fallBackPast(covering(cx, cy, was));
          lastMove = tick;
          mode = "gather";
          target = { x: rally.x, y: rally.y };
          razing = -1;
          razeAgain = tick + FORT_AGAIN;
          return out;
        }
        const f = withCrew ?? ours.find((x) => x.id === razing) ?? nearestFort(ours, cx, cy);
        if (f !== undefined && !endgame && (withCrew !== undefined ? armyIds.length > 0 : tick >= razeAgain && armyIds.length >= FORT_ARMY)) {
          if (mode === "raze" || withCrew !== undefined || enough(army, f)) {
            if (mode !== "raze") {
              armyAtStart = army.length;
              marchWorth = vsForts(army);
              marched.clear();
              for (const id of armyIds) marched.add(id);
            }
            mode = "raze";
            holdFrom = -1;
            razeOrders(f);
            return out;
          }
        }
        if (mode === "raze") mode = "gather";
        razing = -1;
        // Not strong enough for it yet: the army gathers at home for a while rather than go out for a
        // town or the enemy base and leave it shooting the farmers (scratch, an outpost 20 cells out with
        // six guards and two towers: four games went to the time limit, 107–191 farmers shot).
        if (f === undefined || endgame || assault) holdFrom = -1;
        else {
          if (holdFrom < 0) holdFrom = tick;
          if (tick - holdFrom < FORT_HOLD) {
            send(rally.x, rally.y, "gather");
            return out;
          }
        }
      }
      if (mode === "town" || mode === "base") {
        // Forts by the army too strong for it (D-081; not the siege's): it breaks off as when outnumbered.
        const byArmy = groups.filter((g) => !bySiege(g) && dist2(g.x, g.y, cx, cy) <= (g.radius + FORT_WAY) * (g.radius + FORT_WAY) && !beats(g, army));
        // D-096 (GATE_AI.retreat "a"): not for its losses while the gate it is breaking falls.
        const gateHolds = mode === "town" && GATE_AI.retreat.includes("a") && gateAim >= 0 && gateFell;
        if (!endgame && !(mode === "base" && cityLow) && ((standing * 5 < armyAtStart * 2 && !gateHolds) || outnumbered || byArmy.length > 0)) {
          gateAim = -1;
          // Ground down or outnumbered: break off (retreat ignores enemies) and rebuild.
          if (mode === "base") {
            baseBroken = true;
            cityFailed = armyAtStart;
          }
          // D-081 / A4 (NORMAL_FORT.stage): broke off from the forts it gathered for: remembered too.
          const stopped = fortStop;
          remember(army, stopped !== null && stopped.go ? [...byArmy, ...groups.filter((g) => g.ids.some((id) => stopped.ids.includes(id)))] : byArmy);
          fortStop = null;
          if (mode === "town" && byArmy.length > 0) townForts.set(targetTown, { ids: byArmy.flatMap((g) => g.ids), tick });
          fallBackPast(byArmy);
          lastMove = tick;
          mode = "gather";
          target = { x: rally.x, y: rally.y };
          razing = -1;
          return out;
        }
        // Soldiers trained since it set out, at home, go for forts on its ground once clearly stronger.
        const waiting = army.filter((u) => !marched.has(u.id) && u.order !== Order.Garrison && dist2(u.x, u.y, home.cellX, home.cellY) <= FORT_HOME * FORT_HOME);
        const homeForts = waiting.length >= FORT_ARMY ? ours : [];
        const mine = homeForts.find((x) => x.id === reservesRazing) ?? nearestFort(homeForts, home.cellX, home.cellY);
        let reserves = false;
        if (mine !== undefined) {
          const c = fortCentre(mine);
          if (mine.id === reservesRazing || enough(waiting, mine)) {
            const ids = waiting.map((u) => u.id);
            if (mine.id !== reservesRazing || tick - reservesMove >= FORT_EVERY) {
              if (foesNear(c.x, c.y, FORT_GUARDS) > 0) out.push({ c: "move", u: ids, x: c.x, y: c.y });
              else out.push({ c: "attack", u: ids, target: mine.id });
              reservesMove = tick;
            }
            reservesRazing = mine.id;
            reserves = true;
            const keep = armyIds.filter((id) => !ids.includes(id));
            armyIds.length = 0;
            armyIds.push(...keep);
          }
        }
        if (!reserves) reservesRazing = -1;
        // On the way round forts too strong for it (D-081), or back if there is none.
        const aim = mode === "town" ? towns.get(targetTown) : { x: enemyHome.cellX, y: enemyHome.cellY };
        // Soldiers trained since it set out do not go on their own past forts too strong for them (D-081:
        // in scratch base runs fewer than 20 soldiers within reach failed 43 times of 86): they wait at the rally point.
        const newcomers = army.filter((u) => !marched.has(u.id) && armyIds.includes(u.id));
        if (aim !== undefined && newcomers.length > 0 && groupsOnWay(tooStrong(newcomers), { x: home.cellX, y: home.cellY }, aim).length > 0) {
          const ids = newcomers.map((u) => u.id);
          const keep = armyIds.filter((id) => !ids.includes(id));
          armyIds.length = 0;
          armyIds.push(...keep);
          const away = newcomers.filter((u) => dist2(u.x, u.y, rally.x, rally.y) > 9).map((u) => u.id);
          if (away.length > 0 && tick % 100 === 0) out.push({ c: "move", u: away, x: rally.x, y: rally.y });
        }
        // Forts too strong for it ahead (seen only now, D-081): back, and remember.
        if (aim !== undefined && armyIds.length > 0 && !endgame) {
          const ahead = groupsOnWay(tooStrong(army), { x: cx, y: cy }, aim);
          if (ahead.length > 0) {
            if (mode === "base") baseBroken = true;
            remember(army, ahead);
            if (mode === "town") townForts.set(targetTown, { ids: ahead.flatMap((g) => g.ids), tick });
            fallBackPast(ahead);
            lastMove = tick;
            mode = "gather";
            target = { x: rally.x, y: rally.y };
            razing = -1;
            return out;
          }
        }
        // D-081 / A4 (NORMAL_FORT.stage): forts on the way it can take: it gathers outside their reach first, then pulls them down together.
        if (fortStage && !endgame) {
          const next = fortStopNext(fortStop, mode, tick, groups, forts, (g) => !bySiege(g) && beats(g, army), army.filter((u) => armyIds.includes(u.id)), { x: cx, y: cy }, aim, view, know.map, (x, y) => {
            const f = frame(x, y);
            return f.v * n + f.u;
          }, razing);
          fortStop = next.stop;
          if (next.gather !== undefined) {
            send(next.gather.x, next.gather.y, mode);
            return out;
          }
          if (next.raze !== undefined) {
            razeOrders(next.raze);
            return out;
          }
        }
        const way = armyIds.length > 0 ? fortsOnTheWay(forts, cx, cy, enemyHome).filter((o) => {
          const g = groupOf(o);
          return g === undefined || beats(g, army);
        }) : [];
        const f = way.find((x) => x.id === razing) ?? nearestFort(way, cx, cy);
        if (f !== undefined) {
          razeOrders(f);
          return out;
        }
        razing = -1;
        if (mode === "town") {
          // Done with the town once it is ours, or once it lies in ruins (after our plunder or
          // theirs): ruins have no owner, and waiting there for them to turn neutral again
          // parked whole armies in the middle of the map until the game ran out.
          const t = towns.get(targetTown);
          if (t === undefined || (t.owner === player && t.state !== TownState.Neutral) || t.state === TownState.Ruins) mode = "gather";
          else if (!gateFocus(t)) send(t.x, t.y, "town");
        } else {
          // March together (a group move keeps to the slowest and in formation) until those that
          // set out stand by the enemy main city; then fight the defenders there first (a move
          // fights what it meets) and the city once they are down. Told to attack the city from
          // afar, the soldiers streamed in one by one, ignored the defenders and were picked off
          // (normal against easy, 2026-10-01).
          // D-089: those that set out gather outside first; those trained since wait there and go on STAGE_JOIN or more together.
          const at = stage;
          if (at !== null) {
            const near = (u: { x: number; y: number }) => dist2(u.x, u.y, at.x, at.y) <= STAGE_NEAR * STAGE_NEAR;
            // Gathered now, or the enemy main city nearly down: those trained since go along, however few.
            let all = cityLow;
            if (!staged) {
              const setters = soldiers.filter((u) => marched.has(u.id));
              const by = setters.filter(near).length;
              if (by > 0 && stageFirst < 0) stageFirst = tick;
              if (by * 100 >= STAGE_SHARE * setters.length || (stageFirst >= 0 && tick - stageFirst >= STAGE_WAIT) || tick - setOut >= STAGE_MAX) {
                staged = true;
                all = true;
              }
            }
            const fresh = army.filter((u) => !marched.has(u.id) && armyIds.includes(u.id));
            const ready = fresh.filter(near);
            if (staged && ready.length > 0 && (all || ready.length >= STAGE_JOIN)) {
              for (const u of ready) marched.add(u.id);
              armyAtStart += ready.length;
            } else if (fresh.length > 0 && !cityLow) {
              const ids = fresh.map((u) => u.id);
              const keep = armyIds.filter((id) => !ids.includes(id));
              armyIds.length = 0;
              armyIds.push(...keep);
              const away = fresh.filter((u) => !near(u)).map((u) => u.id);
              if (away.length > 0 && tick % 100 === 0) out.push({ c: "move", u: away, x: at.x, y: at.y });
            }
          }
          const front = soldiers.filter((u) => marched.has(u.id));
          const fx = front.length === 0 ? cx : Math.trunc(front.reduce((a, u) => a + u.x, 0) / front.length);
          const fy = front.length === 0 ? cy : Math.trunc(front.reduce((a, u) => a + u.y, 0) / front.length);
          const there = dist2(fx, fy, enemyHome.cellX, enemyHome.cellY) <= 12 * 12;
          if (at !== null && !staged) {
            send(at.x, at.y, "base");
          } else if (enemyCity >= 0 && there) {
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
          .filter(([id, t]) => !(once && plundered(id) && !affordAll(governCostOf(rules, t.size))))
          // D-081: not where forts too strong for the army stand on the way or by the town, unless it can go round.
          .filter(([, t]) => groups.length === 0 || routeFor({ x: home.cellX, y: home.cellY }, t, army).go)
          // Nor back to one it fell back from because of forts, while it remembers them (ceo 2026-10-10: the straight way
          // from home can miss forts the walk passes by).
          .filter(([id]) => !fortsBar(id))
          // D-096: a governed enemy town's gates shoot (GATE_AI.arrows); nor one it cannot break into (GATE_AI.retreat "b").
          .filter(([, t]) => !GATE_AI.arrows || vsForts(army) * 10 >= gateArrowWorth(view, rules, player, t, foes.filter((e) => dist2(e.x, e.y, t.x, t.y) <= 100).length) * 13)
          .filter(([, t]) => !GATE_AI.retreat.includes("b") || gateLoss(view, rules, player, t, army) <= GATE_LOSS)
          .sort(([a, ta], [b, tb]) => ta.size - tb.size || a - b);
        // Random maps (D-074): not before it has seen where the enemy is, but for the end of an
        // AI-against-AI game (then the corner across the map, the last resort).
        // D-089 (SIEGE.failed): not again with fewer than broke off last time, but in the last 4 minutes.
        const notLess = endgame || SIEGE.failed <= 0 || army.length * 100 >= cityFailed * SIEGE.failed;
        const go =
          (mem.known !== Known.None || endgame || assault) &&
          notLess &&
          (endgame
            ? army.length >= SIEGE.endgame
            : assault
              ? army.length >= SIEGE.assault || (latest && army.length >= SIEGE.endgame)
              : baseTime && strongEnough && (army.length >= baseNeed || (((open.length === 0 && !baseBroken) || popFull) && army.length >= townArmy + 6)));
        // Forts on the way too strong for the army (D-081): round them, or not to the base this time.
        const toBase = go ? routeFor({ x: home.cellX, y: home.cellY }, { x: enemyHome.cellX, y: enemyHome.cellY }, army) : null;
        if (go && toBase!.go) {
          armyAtStart = army.length;
          marchWorth = vsForts(army);
          marched.clear();
          for (const id of armyIds) marched.add(id);
          // D-089: to the gathering point first, when there is one.
          stage = stagePoint(view, know.map, forts, { x: cx, y: cy }, enemyHome, (x, y) => {
            const f = frame(x, y);
            return f.v * n + f.u;
          });
          setOut = tick;
          stageFirst = -1;
          staged = stage === null;
          send(stage?.x ?? enemyHome.cellX, stage?.y ?? enemyHome.cellY, "base");
        } else if (!assault && townTime && army.length >= townArmy && open.length > 0 && strongEnough) {
          const pick = army.length >= 24 || open.length === 1 ? open[open.length - 1] : open[0];
          targetTown = pick[0];
          armyAtStart = army.length;
          marchWorth = vsForts(army);
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
  /** Round 7: with enemies near its main city, its ranged units and mages at home hide in it (and towers it holds). */
  hide: boolean;
  /** Loose formation once it believes the enemy has this many mages (0: never)... */
  looseAt: number;
  /** ...for 1: ranged and mages, 2: every soldier. */
  looseWho: number;
  /** D-081: after falling back from a town it leaves that town alone this many minutes (0: never, as before). */
  townRest: number;
  /**
   * D-083 (c): with food and gold piling up (PRODUCTION_FIRST of the two) a barracks or range comes before houses
   * (but for one it needs now) and farms (the trace: two of four built till minute 19, the wood going elsewhere).
   */
  productionFirst: boolean;
  /**
   * D-086 A (docs/research/2026-10-ai-late.md: wood short while food and gold pile up, mostly on the side
   * ahead): cavalry (food and gold, no wood) up to this percent of its soldiers, trained while wood is
   * short (WOOD_SHORT) and food plus gold pile up (RICH); its stable goes up once a range stands and food
   * plus gold reach RICH (0: no cavalry, as before).
   */
  cavalry: number;
  /** D-086 A: with wood short and food plus gold piling up, the ratio is WOOD_SHIFT at once (false: as before). */
  woodShift: boolean;
  /** D-086 A: with wood short and food plus gold piling up, this many farmers over its target (0: as before). */
  woodFarmers: number;
  /**
   * D-086 A (the user governed a town from minute 9-26; hard none by minute 20): from this minute (0: never,
   * as before) a town taken for the first time is governed, not plundered, when it can pay for it and keep
   * governSpare food and gold besides...
   */
  governFrom: number;
  governSpare: number;
  /** ...only the small town nearest its main city (false: any town it takes). */
  governNearest: boolean;
  /**
   * D-086 A3 (the user's 75830947: some 40 of hard's farmers killed 23-50 cells from its main city, minutes
   * 14-26). Farmers FAR_FARMER cells or more from its main city are under attack at a spot when 2 of them fell
   * within a minute there (FARMER_SPOT cells), or it sees enemy soldiers that near one; not a spot under an
   * enemy fort's reach (D-081: not drawn into its arrows). rescue: soldiers at home (at most half, RESCUE_MIN
   * or more) go there when they beat what it knows of the enemy there (D-083 (a)'s weighing); back home when
   * the enemy is gone RESCUE_DONE ticks, grows too strong, the squad is half gone, or the main city is hit;
   * never past the spot. After falling back (too strong, half gone) it leaves that spot alone rescueRest
   * minutes (false: as before).
   */
  rescue: boolean;
  rescueRest: number;
  /** D-086 A3: the farmers by such a spot go home, and back to work (release) once FAR_CLEAR ticks pass with no enemy seen by it (false: as before). */
  hideFar: boolean;
  /**
   * D-086 A3 (75830947: it forgot the user's army after INTEL_TICKS and marched into it): the enemy's worth it
   * believes in for marching is at least the most it knew of at once, less what it saw fall since, shrinking
   * foeDecay percent a minute (false: as before). With its population full it marches as before regardless.
   */
  foeMemory: boolean;
  foeDecay: number;
  /**
   * D-086 A3 (ceo 2026-10-19: in 75830947 the user trained 41 -> 65 out of its sight): with foeMemory, once it has
   * seen the enemy's soldiers, what it believes in grows by every soldier it trains itself (the enemy trains as fast) (false: no).
   */
  foeGrow: boolean;
  /**
   * D-086 A3 (ceo 2026-10-19): about to march on the enemy's main city with no enemy soldier seen for this many minutes,
   * one soldier goes to look first, and the march waits until enemy soldiers are seen, it falls, or PEEK_WALK passes;
   * then it weighs again (0: never, as before). Not with its population full, nor at the end of an AI game.
   */
  peekFirst: number;
  /** D-086 A3 (75830947: food at 9-49 for 12 minutes, farmers 28 -> 8): with farmers under its target, soldiers leave this much food for the next one (0: as before). */
  farmerFood: number;
  /** D-086 A3: wood or food under WOOD_SHORT with food, wood and gold together RICH or more counts as wood short (false: as before). */
  shortEither: boolean;
  /** D-089: after its front broke off from the enemy main city, it marches on it again only with this percent of those that set out then (0: as before), but at the end of an AI game. */
  cityAgain: number;
  /**
   * D-086 B: the network's weights (net.ts) for its big-picture choices; null: its own rules, as before.
   * Only learn/ and scratch branches set them (docs/research/2026-10-ai-nn.md).
   */
  net: NetWeights | null;
  /**
   * D-086 B (learn/ only): at each think, the network's inputs and what hard itself did (-1: nothing at this think):
   * army 0 wait, 1 a town, 2 a march; mix 0 spearmen first, 1 even, 2 ranged first; build 0 as usual, 1 barracks
   * and ranges first; town 0 plunder, 1 govern.
   */
  netLog?: (x: number[], labels: number[]) => void;
  /** D-086 B (learn/ only): at each think with the network on, its choices (net.ts heads). */
  netSeen?: (choice: number[]) => void;
  /**
   * D-086 B, choices other than AS_HARD the network may not make (ceo 2026-10-19, the user's 「人工給它一些意见」):
   * no march on the enemy's main city with fewer than netMarch soldiers (hard's counterArmy) or before it knows
   * where it is, and no barracks and ranges first below netFarmers farmers (hard's range comes at 12).
   */
  netMarch: number;
  netFarmers: number;
  /**
   * D-086 A4 (the user 2026-10-20: 「ai困難都不會用騎兵跟防禦建築」): cavalry beats mages x2 (D-061). Once ranged
   * units and mages are cavalryWhen percent or more of the enemy soldiers it knows of (CAVALRY_SEEN or more), it
   * puts up a stable and trains cavalry up to cavalryCounter percent of its soldiers (0: never, as before).
   */
  cavalryCounter: number;
  cavalryWhen: number;
  /**
   * D-086 A4: its cavalry (CHARGE_MIN or more) charge the enemy ranged units and mages in sight CHARGE_NEAR cells
   * from them, the nearest first, when no more enemy spearmen than cavalry are by the target and it is out of
   * enemy forts' reach; back to the army when enemy spearmen by them outnumber them, they come into a fort's
   * reach, half of them are gone, or no such target is left. A charge given up (spearmen, forts, half gone)
   * leaves that spot alone chargeRest minutes (false: as before).
   */
  charge: boolean;
  chargeRest: number;
  /**
   * D-086 A4: arrow towers by its main city (this many), and by each town it governs (townTowers), toward where
   * the last wave came from (else the enemy's main city, else the map's middle); only with its farmers at their
   * target, wood and gold enough for one and towerSpare more of each besides, no enemy soldier in sight by the
   * spot, and not by the doors of its main city or production buildings (0: none, as before).
   */
  towers: number;
  townTowers: number;
  towerSpare: number;
  /**
   * D-086 A4: within TOWER_FIRST ticks of a wave by its main city, a tower comes right after houses and it saves up
   * for it (this takes from the soldiers' money: measured apart; false: only with money left over, as above).
   */
  towerFirst: boolean;
  /**
   * D-086 A4 (the user's 75830947: 21-30 cavalry in minutes 22-26; cf56e34c: 16 by minute 16): the mix also answers
   * enemy cavalry: CAVALRY_MIX percent or more of the enemy soldiers it knows of moves it counterMix points toward
   * spearmen (spearmen hit cavalry x3) (false: cavalry not counted, as before).
   */
  counterCavalry: boolean;
  /**
   * D-086 A4 (the user's a09c2367 and 691b4349, random maps: hard knew 2 and 3 of the 7 towns, its scout done once it
   * found the enemy's main city): on a random map, once that city is known, one soldier (cavalry first) goes on to the
   * points of a 4 x 4 grid over the map not yet explored, the nearest first, until all are (false: as before).
   */
  townScout: boolean;
  /**
   * D-086 A4 (a09c2367: two towns it plundered stayed ruins in its view, out of sight, though neutral again from minute
   * 14): a town it last saw in ruins, out of sight now and past the time it read off the ruins, is worth going to see
   * again (false: as before).
   */
  ruinsAgain: boolean;
  /**
   * D-086 A4 (a09c2367: one mine all game, the gold by it gone at minute 31, none gathered after 36): no gold left within
   * MINE_NEAR cells of its mines, another mine by the nearest gold it knows of on its own side: nearer its main city
   * than the enemy's, within MINE_FAR cells of it or MINE_TOWN of a town it governs, no enemy soldier in sight within
   * BUILD_SAFE cells (false: as before).
   */
  mineMove: boolean;
  /**
   * D-086 A4 (691b4349: a barracks put down three times where the enemy army stood, paid for each): no new building, nor
   * farmers to a site, with enemy soldiers in sight within BUILD_SAFE cells of it; and a site of its own gone before it
   * was done (or one it put down last think not there), nothing within SITE_NEAR cells of it for SITE_REST (false: as before).
   */
  buildSafe: boolean;
  /** D-081 / A4 (ceo 2026-10-21): forts on the way it can take: it gathers outside their reach first (fortStagePoint), then pulls them down together (false: as before). */
  fortStage: boolean;
  /** D-081 / A4: after breaking off from forts, the next go takes FORT_FAILED_AGAIN of that army, remembered FORT_FORGET_AGAIN (false: FORT_FAILED, FORT_FORGET). */
  fortAgain: boolean;
}

export const HARD: HardPlan = {
  farmers: 32,
  production: 4,
  sites: 1,
  spearShare: 50,
  counterMix: 15,
  mageReserve: 10,
  vein: 2,
  townArmy: 5,
  bigArmy: 14,
  pushArmy: 44,
  pushRatio: 120,
  counterArmy: 14,
  recallAt: 4,
  pullAll: 4,
  dodge: true,
  hide: true,
  looseAt: 0,
  looseWho: 1,
  // D-081: measured and left off (hard against hard 50.3% of 200; with it the scripted push on random maps won 4 of 40, without 3).
  townRest: 0,
  productionFirst: false,
  cavalry: 0,
  woodShift: false,
  woodFarmers: 0,
  governFrom: 0,
  governSpare: 0,
  governNearest: true,
  rescue: false,
  rescueRest: 3,
  hideFar: false,
  foeMemory: false,
  foeDecay: 10,
  foeGrow: false,
  peekFirst: 0,
  farmerFood: 0,
  shortEither: false,
  cityAgain: 0,
  net: null,
  netMarch: 14,
  netFarmers: 12,
  cavalryCounter: 0,
  cavalryWhen: 50,
  charge: false,
  chargeRest: 2,
  towers: 0,
  townTowers: 0,
  towerSpare: 150,
  towerFirst: false,
  counterCavalry: false,
  // D-086 A4 (ceo 2026-10-22, docs/research/2026-10-ai-a4.md): on; ruinsAgain and mineMove measured and left off.
  townScout: true,
  ruinsAgain: false,
  mineMove: false,
  buildSafe: true,
  fortStage: true,
  fortAgain: true,
};
/** D-086 A4 (plan.townScout): a soldier lost scouting, the next goes this much later; told again this often. */
const TOWN_SCOUT_AGAIN = 2 * 1200;
const TOWN_SCOUT_EVERY = 200;
/** D-086 A4 (plan.mineMove): gold this near (cells) a mine is its own; at most this many mines. */
const MINE_NEAR = 6;
const MINE_MOST = 3;
const MINE_FAR = 40;
const MINE_TOWN = 12;
/** D-086 A4 (plan.buildSafe): a site lost before it was done, nothing this near (cells) for this long. */
const SITE_NEAR = 8;
const SITE_REST = 3 * 1200;
/** D-086 A4 (plan.buildSafe): enemy soldiers this near (cells) a spot. */
const BUILD_SAFE = 10;
/** D-086 A4 (plan.counterCavalry): this share (percent) of cavalry among the enemy soldiers it knows of. */
const CAVALRY_MIX = 30;
/** D-086 A4 (plan.cavalryCounter): enemy soldiers it must know of before it weighs their mix. */
const CAVALRY_SEEN = 6;
/** D-086 A4 (plan.charge): the least cavalry that charge, how far from them the targets may be, spearmen this near count as by them, and how often (ticks) it picks again. */
const CHARGE_MIN = 3;
const CHARGE_NEAR = 8;
const CHARGE_SPEAR = 4;
const CHARGE_MOVE = 40;
/** D-086 A4 (plan.towers): how far (cells) from the main city toward the threat, how near an enemy may be to the spot, and the clear ring (cells) left by the doors of its main city and production buildings. */
const TOWER_AT = 6;
const TOWER_SAFE = 12;
const TOWER_CLEAR = 2;
/** D-086 A4 (plan.towerFirst): how long after a wave by its main city (3 minutes). */
const TOWER_FIRST = 3 * 1200;
/** D-086 A3 (plan.rescue, plan.hideFar): farmers this far (cells) from the main city are far; a spot is this near them. */
const FAR_FARMER = 20;
const FARMER_SPOT = 8;
/** D-086 A3 (plan.rescue): the enemy weighed this near the spot; soldiers this near the main city are at home; the least that go; done after this long with no enemy by it (30 s), or this long without getting there. */
const RESCUE_NEAR = 10;
const RESCUE_HOME = 15;
const RESCUE_MIN = 5;
const RESCUE_DONE = 600;
const RESCUE_WALK = 2 * TICKS_PER_MINUTE;
/** D-086 A3 (plan.hideFar): farmers sent home go back to work once this long passes with no enemy seen by the spot (30 s). */
const FAR_CLEAR = 600;
/** D-086 A3 (plan.peekFirst): how long the one sent to look may walk, and how long before another goes. */
const PEEK_WALK = 3 * TICKS_PER_MINUTE;
const PEEK_AGAIN = 2 * TICKS_PER_MINUTE;
/** D-086 A: wood under this is short; food plus gold from this pile up (the research note's measure). */
const WOOD_SHORT = 50;
const RICH = 600;
/** D-086 A (plan.woodShift): the ratio while wood is short and food and gold pile up. */
const WOOD_SHIFT = [15, 75, 10];
/** D-086 B: what the network's choices mean: the spearmen's share (by MIX_*), and farmers more for "farmers first". */
const NET_SHARE = [0, 70, 30];
const NET_FARMERS = 4;
const NET_MODES: readonly string[] = ["home", "town", "base", "defend", "raze"];
/** D-083 (c): food plus gold it holds for productionFirst. */
const PRODUCTION_FIRST = 800;

/**
 * D-083 (c), the user 2026-10-10: hard 「太晚來打我」「來打的兵太少」 (ceo 2026-10-18: earlier and with more). With the
 * population rules on, hard plays these over HARD.
 */
export const HARD_POP: Partial<HardPlan> = {
  // A barracks or range before houses and farms once food and gold pile up (the trace: two of four till minute 19).
  productionFirst: true,
  // And a little more to march with (44): measured with the above, minute 16.6 -> 16.1 and 29 -> 32 at the city (sim/README.md).
  pushArmy: 48,
  // D-086 A (docs/research/2026-10-ai-late.md section 8): 8 farmers more while wood is short and food and gold pile up,
  // and the nearest small town governed when taken from minute 12: against hard without them it won 89 games to 60 of
  // 200; cavalry (cavalry) and a faster ratio (woodShift) were measured and left off (no stronger, with or without these).
  woodFarmers: 8,
  governFrom: 12,
  // D-086 A3 (docs/research/2026-10-ai-late.md section 9): farmers by a spot attacked far from home go home and back
  // to work 30 s after; and before a march with no enemy seen for a minute, one goes to look first. Against main's hard
  // 173 games to 145 over seeds 1-50 and 101-150 (main against itself 81 to 70), draws 108 to main's 113 of 800.
  hideFar: true,
  peekFirst: 1,
  // D-089 (docs/research/2026-10-ai-d089.md): after its front broke off from the enemy main city, again only with 120% of
  // those that set out then. Hard against hard, draws (seeds 1-50, 51-100): fixed map 15, 13 -> 2, 4; random 24, 27 -> 27, 20;
  // against hard without it 41 to 47 (fixed) and 38 to 37 (random); the four active groups 0 of 160 as before.
  cityAgain: 120,
};
// SCRATCH ONLY (ai/scratch-*, never merged): candidate plans from the environment.
const SCRATCH_ENV = (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
const HARD_BASE: HardPlan = { ...HARD };
Object.assign(HARD, JSON.parse(SCRATCH_ENV.HARD_PLAN || "{}"));
{ const ga = JSON.parse(SCRATCH_ENV.HARD_PLAN || "{}"); for (const k of ["focus", "walls", "arrows", "retreat"] as const) { const v = ga["gate" + k[0].toUpperCase() + k.slice(1)]; if (v !== undefined) (GATE_AI as Record<string, unknown>)[k] = v; } }
{ const nf = JSON.parse(SCRATCH_ENV.HARD_PLAN || "{}"); if (nf.normalFortStage !== undefined) NORMAL_FORT.stage = nf.normalFortStage; if (nf.normalFortAgain !== undefined) NORMAL_FORT.again = nf.normalFortAgain; }
const HARD_B: HardPlan = { ...HARD_BASE, ...JSON.parse(SCRATCH_ENV.HARD_PLAN_B || SCRATCH_ENV.HARD_PLAN || "{}") };

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
  /** Seen posted at an outpost (D-081: it counts with the outpost, not apart). */
  post?: boolean;
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
type HardMode = "home" | "town" | "base" | "defend" | "raze";

function createHardAi(player: number, seed: number, know: AiKnowledge, slot: number): Ai {
  const plan: HardPlan = { ...(slot === 1 ? HARD_B : HARD), ...know.hard };
  // D-083 (c): with the population rules on, HARD_POP over HARD (what the caller gives still wins).
  if ((know.rules.population?.town[TownSize.Small] ?? 0) > 0) Object.assign(plan, HARD_POP, know.hard);
  // Round 7 (D-061) switches; each off, it plays as before.
  const garrisonOn = know.rules.features?.garrison === true;
  const once = know.rules.features?.plunderOnce === true;
  const hideOn = garrisonOn && plan.hide;
  const governCost = (size: number): Cost => governCostOf(rules, size);
  const rng = new Rng((seed ^ Math.imul(slot + 1, 0x9e3779b1)) >>> 0 || 1);
  const n = know.map.size;
  // The map as it knows it (scout.ts, D-074): on the fixed map the MapInfo's own objects.
  const mem = mapMemory(know.map, know.frame, player);
  const scout = createScout(mem);
  const home = mem.home;
  const enemyHome = mem.enemy;
  const rules = know.rules;
  const real = (u: number, v: number) => fromCanon(know.frame, u, v);
  /** D-086 A4 (plan.townScout): the points it looks at, in player 0's frame; the soldier, and when the next may go or it was last told. */
  const townGrid = [1, 3, 5, 7].flatMap((v) => [1, 3, 5, 7].map((u) => real((know.map.size * u) >> 3, (know.map.size * v) >> 3)));
  let townScoutId = -1;
  let townScoutAgain = 0;
  let townScoutMove = -100000;
  /** D-086 A4 (plan.buildSafe): its sites not done yet at the last think, and those lost since, till when. */
  const sitesSeen = new Map<number, { type: number; x: number; y: number }>();
  const lostSites: { type: number; x: number; y: number; until: number }[] = [];
  /** D-086 A4 (plan.buildSafe): what it put down last think (691b4349: a barracks razed before the next think). */
  const ordered: { type: number; x: number; y: number }[] = [];
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

  let mode: HardMode = "home";
  /** D-089: where the front gathers before the enemy main city (null: straight on), when it set out and the first got there, and whether it has gathered. */
  let stage: { x: number; y: number } | null = null;
  let setOut = 0;
  let stageFirst = -1;
  let staged = true;
  /** D-089 (plan.cityAgain): how many set out on the last march that broke off from the enemy main city. */
  let cityFailed = 0;
  /** D-086 B: the network's choices at the last think (null: off), its soldiers then, its losses and the enemy soldiers it saw fall (ticks), the enemy city's hp last seen. */
  const netOn = plan.net !== null || plan.netLog !== undefined;
  let netChoice: number[] | null = null;
  let netPrev = new Set<number>();
  const netLost: number[] = [];
  const netKilled: number[] = [];
  let netCityHp = -1;
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
  /** The enemy fort (D-080) the army is pulling down, and when it may try again after breaking off. */
  let razing = -1;
  /** D-081 / A4 (plan.fortAgain, plan.fortStage): what it takes after breaking off from forts and how long it remembers; the forts it gathers for. */
  const fortFailed = plan.fortAgain ? FORT_FAILED_AGAIN : FORT_FAILED;
  const fortForget = plan.fortAgain ? FORT_FORGET_AGAIN : FORT_FORGET;
  let fortStop: FortStop | null = null;
  /** D-096: the gate it goes for (-1: none), when it last told the army so, that gate's hp as seen (GATE_AI.retreat "a"), when it last sent soldiers up a wall. */
  let gateAim = -1;
  let gateMove = -100000;
  let gateFell = false;
  const gateSeen: { tick: number; hp: number }[] = [];
  let wallMove = -100000;
  let razeAgain = -100000;
  /** While the army is away: the soldiers left at home pulling down a fort on its ground, and that fort. */
  let reservesRazing = -1;
  let reservesMove = -100000;
  const crew = createFortCrew(rank);
  /** D-081: the army (worth against forts) that broke off from each fort; towns it fell back from, left alone until this tick. */
  /** What the army that set out was worth against forts (D-081: a break-off remembers that, not what is left). */
  let marchWorth = 0;
  const failedAt = new Map<number, Failed>();
  /** Falling back round forts (aroundForts): the point first, and until when. */
  let via: { x: number; y: number; until: number } | null = null;
  /** Towns it fell back from because of forts (D-081, ceo 2026-10-10): the forts, and when. */
  const townForts = new Map<number, { ids: number[]; tick: number }>();
  const townRest = new Map<number, number>();
  const fv = fortValues(know.rules);
  // D-086 A3: where its farmers were last think, and those that fell far from home in the last minute.
  const farmerSeen = new Map<number, { x: number; y: number }>();
  const farmerFell: { x: number; y: number; tick: number }[] = [];
  /** plan.rescue: the squad, the spot it went to, how many set out, when it got there, last saw the enemy by it, was told where to go; spots left alone until a tick. */
  const rescueSquad = new Set<number>();
  let rescueAt: { x: number; y: number; start: number; size: number; arrived: boolean } | null = null;
  let rescueClear = 0;
  let rescueMove = -100000;
  const rescueRest = new Map<number, number>();
  let rescueDeclined = -1;
  /** plan.hideFar: farmers sent home from each spot, and when the enemy was last seen by it. */
  const farHide: { x: number; y: number; clear: number; ids: number[] }[] = [];
  /** plan.foeMemory: the enemy's worth it believes in, and when it last shrank. */
  let foeMemo = 0;
  let foeMemoTick = 0;
  /** The same in soldiers (for peek only), and what it knew of last think. */
  let foeMemoN = 0;
  /** plan.foeGrow: its own soldiers counted so far. plan.peekFirst: when it last saw enemy soldiers; the one sent to look, until when, and when another may go. */
  const ownSeen = new Set<number>();
  let lastFoeSeen = 0;
  let peekId = -1;
  let peekUntil = 0;
  let peekAgain = 0;
  let known = { worth: 0, n: 0 };
  /** plan.charge: the cavalry charging, where the charge began and how many set out, its target, when last told; spots left alone until a tick. plan.towers: where the last wave came from. */
  const chargers = new Set<number>();
  let chargeAt: { x: number; y: number; size: number; target: number } | null = null;
  let chargeMove = -100000;
  const chargeRestAt = new Map<number, number>();
  let waveFrom: { x: number; y: number } | null = null;
  const counted = { gateFocus: 0, gateBrokeOff: 0, gateSkipped: 0, wallUp: 0, chargeSent: 0, chargeDone: 0, chargeBack: 0, chargeLost: 0, chargeCavalryLost: 0, cavalryTrained: 0, towersPlaced: 0, rescueSent: 0, rescueDone: 0, rescueWeak: 0, rescueLost: 0, rescueCityHit: 0, rescueDeclined: 0, farmersHid: 0, farmersReleased: 0, peekSent: 0, peekSaw: 0, peekFell: 0, peekTimeout: 0 };

  /** Nearest spot to (ax, ay) where `type` fits, with a free ring around it (farms may touch); as normal. */
  function spotNear(view: PlayerView, type: BuildingType, ax: number, ay: number, radius: number, fits?: (x: number, y: number) => boolean): { x: number; y: number } | null {
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
        if (!ok || (fits !== undefined && !fits(x, y))) continue;
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
    stats: () => ({ ...counted }),
    peek: () => ({ knownWorth: known.worth, known: known.n, believedWorth: Math.max(known.worth, foeMemo), believed: Math.max(known.n, foeMemoN) }),
    think(view: PlayerView): CommandBody[] {
      const out: CommandBody[] = [];
      const h = view.header;
      const tick = view.tick;
      mem.observe(view);
      const toGo = know.maxTicks > 0 ? know.maxTicks - tick : -1;
      const res: Cost = { food: h[HeaderField.food], wood: h[HeaderField.wood], gold: h[HeaderField.gold], crystal: h[HeaderField.crystal] };
      const pop = h[HeaderField.population];
      const cap = h[HeaderField.populationCap];
      // D-083: houses reach the ceiling now (base, and more for each town it governs; off: 120), a house's room as the rules say.
      const ceiling = h[HeaderField.populationCeiling];
      const houseRoom = rules.buildings[BuildingType.House].populationCap;
      // D-083 (ceo 2026-10-18): D-081's leftover (a) comes with the population rules.
      const d083 = (rules.population?.town[TownSize.Small] ?? 0) > 0;
      /** Plundered already this game (TownFlag.Plundered). */
      const plunderedTown = (id: number) => {
        for (let r = 0; r < view.towns.length; r += TOWN_STRIDE) if (view.towns[r + TownField.id] === id) return (view.towns[r + TownField.flags] & TownFlag.Plundered) !== 0;
        return false;
      };
      /** D-086 A (plan.governNearest): the small town nearest its main city of those it knows (-1: none). */
      const nearestSmall = (): number => {
        let best = -1;
        let bestD = 0;
        let bestKey = 0;
        const consider = (id: number) => {
          const t = mem.site(id);
          if (t === undefined || t.size !== TownSize.Small) return;
          const d = dist2(t.cellX, t.cellY, home.cellX, home.cellY);
          const key = rank(t.cellX, t.cellY);
          if (best < 0 || d < bestD || (d === bestD && key < bestKey)) {
            best = id;
            bestD = d;
            bestKey = key;
          }
        };
        for (let r = 0; r < view.towns.length; r += TOWN_STRIDE) consider(view.towns[r + TownField.id]);
        for (const t of mem.unexplored) consider(t.id);
        return best;
      };
      /** D-086 A (plan.governFrom): a first capture governed, from that minute, when it can pay and keep governSpare. */
      const governFirst = (id: number) => {
        if (plan.governFrom <= 0 || tick < plan.governFrom * TICKS_PER_MINUTE) return false;
        const t = mem.site(id);
        if (t === undefined || (plan.governNearest && id !== nearestSmall())) return false;
        const c = governCost(t.size);
        return res.food >= c.food + plan.governSpare && res.wood >= c.wood && res.gold >= c.gold + plan.governSpare && res.crystal >= c.crystal;
      };
      /**
       * It governs a town it takes only when it was plundered before (round 7); a first capture it
       * plunders (governing first captures won 3% of 120 games on the final round 7 rules), unless
       * plan.governFrom says otherwise (D-086 A).
       */
      /** D-086 B: what governing town id costs can be paid now (res as the think starts). */
      const payable = (id: number) => {
        const t = mem.site(id);
        if (t === undefined) return false;
        const c = governCost(t.size);
        return res.food >= c.food && res.wood >= c.wood && res.gold >= c.gold && res.crystal >= c.crystal;
      };
      // D-086 B: with the network on, a first capture is governed when it chooses so and can pay (in place of plan.governFrom).
      const toGovern = (id: number) =>
        (once && plunderedTown(id)) || (netChoice === null || netChoice[HEAD_TOWN] === AS_HARD ? governFirst(id) : netChoice[HEAD_TOWN] === TOWN_GOVERN && payable(id));
      // On the way to a town it will govern it keeps the cost aside (the choice comes the tick it falls).
      const reserve: Cost = mode === "town" && targetTown >= 0 && toGovern(targetTown) ? { ...governCost(mem.site(targetTown)!.size) } : { food: 0, wood: 0, gold: 0, crystal: 0 };
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
      const enemyFarmers: HardUnit[] = [];
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
        else if (owner === 1 - player) enemyFarmers.push(u);
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
      // Random maps (D-074): one soldier scouts (scout.ts) and is left out of everything else.
      const allSoldiers = mine.filter((u) => u.type !== UnitType.Farmer);
      scout.think(tick, allSoldiers, (u) => ![...townGuards.values()].some((ids) => ids.includes(u.id)), out);
      // D-086 A4 (plan.townScout): once the enemy's main city is known on a random map, one soldier goes on looking for towns.
      if (plan.townScout && mem.random && mem.known === Known.City) {
        if (townScoutId >= 0 && !allSoldiers.some((u) => u.id === townScoutId)) {
          townScoutId = -1;
          townScoutAgain = tick + TOWN_SCOUT_AGAIN;
        }
        const left = townGrid.filter((p) => (view.placement[p.y * n + p.x] & PlaceBit.Unexplored) !== 0);
        if (left.length === 0) townScoutId = -1;
        else {
          if (townScoutId < 0 && tick >= townScoutAgain) {
            const guards = new Set([...townGuards.values()].flat());
            const kind = (u: HardUnit) => (u.type === UnitType.Cavalry ? 0 : u.type === UnitType.Spearman ? 1 : 2);
            const pick = allSoldiers
              .filter((u) => u.id !== scout.id && !guards.has(u.id) && u.type !== UnitType.Mage && u.order !== Order.Garrison)
              .sort((a, b) => kind(a) - kind(b) || dist2(a.x, a.y, home.cellX, home.cellY) - dist2(b.x, b.y, home.cellX, home.cellY) || rank(a.fx, a.fy) - rank(b.fx, b.fy))[0];
            if (pick !== undefined) {
              townScoutId = pick.id;
              townScoutMove = -100000;
            }
          }
          const s = allSoldiers.find((u) => u.id === townScoutId);
          if (s !== undefined && tick - townScoutMove >= TOWN_SCOUT_EVERY) {
            const to = left.sort((a, b) => dist2(a.x, a.y, s.x, s.y) - dist2(b.x, b.y, s.x, s.y) || rank(a.x, a.y) - rank(b.x, b.y))[0];
            out.push({ c: "retreat", u: [s.id], x: to.x, y: to.y });
            townScoutMove = tick;
          }
        }
      }
      const soldiers = allSoldiers.filter((u) => u.id !== scout.id && u.id !== townScoutId);
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
      for (const f of foes) {
        intel.set(f.id, { type: f.type, x: f.x, y: f.y, tick, inside: f.order === Order.Garrison && shelters.has(f.orderTarget) ? f.orderTarget : undefined, post: f.order === Order.Post });
      }
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
        if (tick - e.tick <= 20 && sees(e.x, e.y)) {
          if (netOn) netKilled.push(tick);
          // Fallen (plan.foeMemory: no longer believed in either).
          intel.delete(id);
          if (plan.foeMemory) {
            foeMemo = Math.max(0, foeMemo - WORTH[e.type]);
            foeMemoN = Math.max(0, foeMemoN - 1);
          }
        } else if (tick - e.tick > INTEL_TICKS) intel.delete(id);
      }
      let enemySpear = 0;
      let enemyRanged = 0;
      let enemyMages = 0;
      let enemyWorth = 0;
      let enemyCavalry = 0;
      for (const e of intel.values()) {
        if (e.type === UnitType.Cavalry) enemyCavalry++;
        if (e.type === UnitType.Spearman) enemySpear++;
        else if (e.type === UnitType.Ranged) enemyRanged++;
        else if (e.type === UnitType.Mage) enemyMages++;
        enemyWorth += WORTH[e.type];
      }
      if (enemyMages > 0) lastEnemyMage = tick;
      // D-086 A4 (plan.cavalryCounter): its enemy is mostly ranged units and mages.
      const knownSoldiers = enemySpear + enemyRanged + enemyMages;
      const cavalryWant =
        plan.cavalryCounter > 0 &&
        rules.features?.cavalry === true &&
        knownSoldiers >= CAVALRY_SEEN &&
        (enemyRanged + enemyMages) * 100 >= plan.cavalryWhen * knownSoldiers;
      if (foes.some((f) => f.order !== Order.Post)) lastFoeSeen = tick;
      // D-086 A3 (plan.foeGrow): once it has seen them, the enemy grows by what it trains itself.
      if (plan.foeMemory && plan.foeGrow) {
        let grown = 0;
        let grownN = 0;
        for (const u of soldiers) {
          if (ownSeen.has(u.id)) continue;
          ownSeen.add(u.id);
          grown += WORTH[u.type];
          grownN++;
        }
        if (foeMemo > 0) {
          foeMemo += grown;
          foeMemoN += grownN;
        }
      }
      // D-086 A3 (plan.foeMemory): the most it knew of at once, shrinking a little each minute.
      if (plan.foeMemory) {
        if (enemyWorth >= foeMemo) {
          foeMemo = enemyWorth;
          foeMemoN = intel.size;
          foeMemoTick = tick;
        } else if (tick - foeMemoTick >= TICKS_PER_MINUTE) {
          foeMemo -= Math.trunc((foeMemo * plan.foeDecay) / 100);
          foeMemoN -= Math.trunc((foeMemoN * plan.foeDecay) / 100);
          foeMemoTick = tick;
        }
      }
      known = { worth: enemyWorth, n: intel.size };
      const believed = plan.foeMemory ? Math.max(enemyWorth, foeMemo) : enemyWorth;

      // --- D-086 B: the network's choices, from its own view and memory --------------------------------
      let netX: number[] = [];
      const labels = [-1, -1, -1, -1];
      if (netOn) {
        if (enemyCityHp >= 0) netCityHp = enemyCityHp;
        const ids = new Set(soldiers.map((u) => u.id));
        for (const id of netPrev) if (!ids.has(id)) netLost.push(tick);
        netPrev = ids;
        while (netLost.length > 0 && tick - netLost[0] > 2 * TICKS_PER_MINUTE) netLost.shift();
        while (netKilled.length > 0 && tick - netKilled[0] > 2 * TICKS_PER_MINUTE) netKilled.shift();
        let cavalryFoes = 0;
        for (const e of intel.values()) if (e.type === UnitType.Cavalry) cavalryFoes++;
        let cityHp = 0;
        for (let r = 0; r < view.buildings.length; r += BUILDING_STRIDE) {
          if (view.buildings[r + BuildingField.owner] === player && view.buildings[r + BuildingField.type] === BuildingType.MainCity) cityHp = view.buildings[r + BuildingField.hp];
        }
        const townCount = [0, 0, 0, 0, 0];
        let townD = -1;
        const neutralAt = (x: number, y: number) => {
          const d = Math.trunc(Math.sqrt(dist2(x, y, home.cellX, home.cellY)));
          if (townD < 0 || d < townD) townD = d;
        };
        const seenTowns = new Set<number>();
        for (let r = 0; r < view.towns.length; r += TOWN_STRIDE) {
          const id = view.towns[r + TownField.id];
          const st = view.towns[r + TownField.state];
          const ow = view.towns[r + TownField.owner];
          seenTowns.add(id);
          if (st === TownState.Ruins) townCount[4]++;
          else if (st === TownState.Neutral) {
            townCount[3]++;
            neutralAt(view.towns[r + TownField.cellX], view.towns[r + TownField.cellY]);
          } else if (ow === player && (st === TownState.Governed || st === TownState.Repairing)) townCount[0]++;
          else if (ow === player) townCount[1]++;
          else townCount[2]++;
        }
        for (const t of mem.unexplored) {
          if (seenTowns.has(t.id)) continue;
          townCount[3]++;
          neutralAt(t.cellX, t.cellY);
        }
        const nearHome = soldiers.filter((u) => dist2(u.x, u.y, home.cellX, home.cellY) <= WAVE_CELLS * WAVE_CELLS).length;
        netX = features({
          tick,
          food: res.food,
          wood: res.wood,
          gold: res.gold,
          crystal: res.crystal,
          pop,
          cap,
          ceiling,
          farmers: farmers.length,
          spear: soldiers.filter((u) => u.type === UnitType.Spearman).length,
          ranged: soldiers.filter((u) => u.type === UnitType.Ranged).length,
          mages: soldiers.filter((u) => u.type === UnitType.Mage).length,
          cavalry: soldiers.filter((u) => u.type === UnitType.Cavalry).length,
          buildings: [
            BuildingType.Barracks,
            BuildingType.Range,
            BuildingType.MageHall,
            BuildingType.Stable,
            BuildingType.House,
            BuildingType.Farm,
            BuildingType.LumberCamp,
            BuildingType.Mine,
            BuildingType.ArrowTower,
          ].map((t) => done(t).length),
          worth: worth(soldiers),
          home: nearHome,
          away: soldiers.length - nearHome,
          cityHp,
          enemy: [enemySpear, enemyRanged, enemyMages, cavalryFoes],
          enemyWorth,
          enemyNear: foes.filter((f) => dist2(f.x, f.y, home.cellX, home.cellY) <= WAVE_CELLS * WAVE_CELLS).length,
          enemyCityKnown: mem.known === Known.City ? 1 : 0,
          enemyCityHp: netCityHp < 0 ? 0 : netCityHp,
          enemyForts: enemyForts(view, player, rules).length,
          towns: townCount,
          townDist: townD,
          mode: NET_MODES.indexOf(mode),
          lost: netLost.length,
          killed: netKilled.length,
        });
        if (plan.net !== null) {
          const guards = new Set([...townGuards.values()].flat());
          const free = soldiers.filter((u) => !guards.has(u.id)).length;
          const fewFarmers = farmers.length < plan.netFarmers;
          // AS_HARD always; army: wait, or march once it may; mix: all; build: no barracks and ranges first with few farmers; town: all.
          const allowed = [true, true, mem.known !== Known.None && free >= plan.netMarch, true, true, true, true, true, !fewFarmers, true, true, true];
          netChoice = choose(plan.net, netX, allowed);
          plan.netSeen?.(netChoice);
        }
      }

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
      // D-086 A: wood short while food and gold pile up (soldiers want wood, and the stock does not turn into any).
      const woodShort = plan.shortEither
        ? (res.wood < WOOD_SHORT || res.food < WOOD_SHORT) && res.food + res.wood + res.gold >= RICH
        : res.wood < WOOD_SHORT && res.food + res.gold >= RICH;
      if (plan.woodShift && woodShort) for (let k = 0; k < 3; k++) ratio[k] = WOOD_SHIFT[k];
      const ratioKey = ratio.join("/");
      if (ratioKey !== ratioSet) {
        out.push({ c: "eco_ratio", food: ratio[0], wood: ratio[1], gold: ratio[2], on: true });
        ratioSet = ratioKey;
      }
      let room = cap - pop - queued;
      const main = done(BuildingType.MainCity)[0];
      const farmerCost = rules.units[UnitType.Farmer].cost;
      // D-086 A: more while wood is short and food and gold pile up; D-086 B: the network's "farmers first", a few more.
      const farmersWanted = farmerTarget + (woodShort ? plan.woodFarmers : 0) + (netChoice !== null && netChoice[HEAD_BUILD] === BUILD_FARMERS ? NET_FARMERS : 0);
      let farmerQueued = false;
      if (main && main.queue < 2 && farmers.length + main.queue < farmersWanted && room > 0 && afford(farmerCost)) {
        out.push({ c: "train", building: main.id, type: UnitType.Farmer, n: 1 });
        spend(farmerCost);
        room--;
        farmerQueued = true;
      }
      // D-086 A3 (plan.farmerFood): farmers still short and room for one more in the queue: soldiers leave it its food.
      const keepFood =
        plan.farmerFood > 0 && main && main.queue + (farmerQueued ? 1 : 0) < 2 && farmers.length + main.queue + (farmerQueued ? 1 : 0) < farmersWanted ? plan.farmerFood : 0;
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
      /** D-086 A4 (plan.towers): an enemy soldier in sight this near (cells) a spot. */
      const foeBy = (x: number, y: number) => foes.some((f) => dist2(f.x, f.y, x, y) <= TOWER_SAFE * TOWER_SAFE);
      /** D-086 A4 (plan.towers, plan.townTowers): where the next tower goes (null: none wanted, or no spot), toward the threat, clear of doors and of enemies. */
      const towerSpotFor = (): { x: number; y: number } | null => {
        if ((plan.towers <= 0 && plan.townTowers <= 0) || rules.features?.towers !== true || !has(BuildingType.Range)) return null;
        const towersBy = (x: number, y: number, r: number) => own.filter((b) => b.type === BuildingType.ArrowTower && dist2(b.x, b.y, x, y) <= r * r).length;
        // Not by the doors of its main city or production buildings: TOWER_CLEAR cells round their footprints stay open.
        const doors = own.filter((b) => b.type === BuildingType.MainCity || b.type === BuildingType.Barracks || b.type === BuildingType.Range || b.type === BuildingType.Stable || b.type === BuildingType.MageHall);
        const tsize = rules.buildings[BuildingType.ArrowTower].size;
        const clear = (x: number, y: number) =>
          doors.every((b) => {
            const bs = rules.buildings[b.type].size;
            return x + tsize + TOWER_CLEAR <= b.x || b.x + bs + TOWER_CLEAR <= x || y + tsize + TOWER_CLEAR <= b.y || b.y + bs + TOWER_CLEAR <= y;
          });
        const from = waveFrom ?? (mem.known !== Known.None ? { x: enemyHome.cellX, y: enemyHome.cellY } : real(mid, mid));
        const toward = (x: number, y: number, k: number) => {
          const dx = from.x - x;
          const dy = from.y - y;
          const d = Math.sqrt(dx * dx + dy * dy) || 1;
          return { x: x + Math.trunc((dx * k) / d), y: y + Math.trunc((dy * k) / d) };
        };
        const sites: { x: number; y: number }[] = [];
        if (plan.towers > 0 && towersBy(home.cellX, home.cellY, TOWER_AT + 6) < plan.towers) sites.push(toward(home.cellX, home.cellY, TOWER_AT));
        if (plan.townTowers > 0) {
          for (let r = 0; r < view.towns.length; r += TOWN_STRIDE) {
            if (view.towns[r + TownField.owner] !== player || view.towns[r + TownField.state] !== TownState.Governed) continue;
            const t = mem.site(view.towns[r + TownField.id]);
            if (t === undefined) continue;
            const radius = rules.towns?.[t.size]?.radius ?? 5;
            if (towersBy(t.cellX, t.cellY, radius + 3) < plan.townTowers) sites.push(toward(t.cellX, t.cellY, radius));
          }
        }
        // The nearest free spot to it (its production stands that way too); round a town, within its reach.
        for (const at of sites) {
          if (foeBy(at.x, at.y)) continue;
          const spot = spotNear(view, BuildingType.ArrowTower, at.x, at.y, TOWER_AT + 2, clear);
          if (spot !== null) return spot;
        }
        return null;
      };
      // D-086 A4 (plan.buildSafe): a site seen last think and gone now, not done: lost (the enemy razed it).
      if (plan.buildSafe) {
        for (let i = lostSites.length - 1; i >= 0; i--) if (lostSites[i].until <= tick) lostSites.splice(i, 1);
        const now = new Set(own.map((b) => b.id));
        for (const [id, l] of sitesSeen) if (!now.has(id)) lostSites.push({ ...l, until: tick + SITE_REST });
        for (const o of ordered) if (!own.some((b) => b.type === o.type && b.x === o.x && b.y === o.y)) lostSites.push({ ...o, until: tick + SITE_REST });
        ordered.length = 0;
        sitesSeen.clear();
        for (const b of own) if (b.progress < 1000) sitesSeen.set(b.id, { type: b.type, x: b.x, y: b.y });
      }
      for (const site of own.filter((b) => b.progress < 1000)) {
        if (farmers.some((f) => f.order === Order.Build && f.orderTarget === site.id)) continue;
        // D-086 A4 (plan.buildSafe): no farmers to a site with enemies by it.
        if (plan.buildSafe && foes.some((f) => dist2(f.x, f.y, site.x, site.y) <= BUILD_SAFE * BUILD_SAFE)) continue;
        // D-086 A4: no farmers to a tower with enemies by it; later, once they are gone.
        if (site.type === BuildingType.ArrowTower && (plan.towers > 0 || plan.townTowers > 0) && foeBy(site.x, site.y)) continue;
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
        // D-083 (c): food and gold piling up, more barracks and ranges first (a house first only when it needs one now).
        const prodCount = count(BuildingType.Barracks) + count(BuildingType.Range);
        const roomFor = prodCount < plan.production && has(BuildingType.Range) && cap - pop - queued > producers;
        const hardFirst = plan.productionFirst && res.food + res.gold >= PRODUCTION_FIRST && roomFor;
        labels[HEAD_BUILD] = hardFirst ? 1 : 0;
        // D-086 B: or as the network chooses (barracks and ranges first, or not before farmers).
        if (netChoice === null || netChoice[HEAD_BUILD] === AS_HARD ? hardFirst : netChoice[HEAD_BUILD] === BUILD_PRODUCTION && roomFor) {
          add(count(BuildingType.Barracks) <= count(BuildingType.Range) ? BuildingType.Barracks : BuildingType.Range, rally);
        }
        // Houses before the population is full: every producer can add one at a time.
        if (cap < ceiling && cap - pop - queued <= houseRoom + producers) add(BuildingType.House, base);
        // D-086 A4 (plan.towerFirst): a wave by its main city lately: a tower next, saved up for.
        if (plan.towerFirst && tick - lastWave <= TOWER_FIRST) {
          const spot = towerSpotFor();
          if (spot !== null) add(BuildingType.ArrowTower, spot);
        }
        // D-086 A: a stable, for cavalry while wood is short (plan.cavalry).
        const stableReady = (rules.buildings[BuildingType.Stable]?.requires ?? []).every((t) => done(t).length > 0);
        if (plan.cavalry > 0 && rules.features?.cavalry === true && !has(BuildingType.Stable) && has(BuildingType.Range) && res.food + res.gold >= RICH && stableReady) add(BuildingType.Stable, rally);
        // D-086 A4 (plan.cavalryCounter): a stable once it wants cavalry against the enemy's mix.
        if (cavalryWant && !has(BuildingType.Stable) && has(BuildingType.Range) && stableReady) add(BuildingType.Stable, rally);
        if (!has(BuildingType.LumberCamp) && farmers.length >= 6) add(BuildingType.LumberCamp, nearestNode(NodeKind.Tree));
        if (!has(BuildingType.Granary) && farmers.length >= 8) add(BuildingType.Granary, base);
        if (!has(BuildingType.Barracks) && farmers.length >= 10) add(BuildingType.Barracks, rally);
        if (!has(BuildingType.Range) && farmers.length >= 12) add(BuildingType.Range, rally);
        if (!has(BuildingType.MageHall) && has(BuildingType.Range) && (res.crystal >= 40 || tick > 10 * TICKS_PER_MINUTE)) add(BuildingType.MageHall, base);
        if (count(BuildingType.Farm) < Math.min(10, 2 + (farmers.length >> 2))) add(BuildingType.Farm, granary ? { x: granary.x + 1, y: granary.y + 1 } : base);
        if (!has(BuildingType.Mine) && farmers.length >= 14) add(BuildingType.Mine, nearestNode(NodeKind.GoldMine));
        // D-086 A4 (plan.mineMove): the gold by its mines gone: another by the nearest gold it knows of.
        else if (plan.mineMove && farmers.length >= 14 && count(BuildingType.Mine) < MINE_MOST) {
          const mines = own.filter((b) => b.type === BuildingType.Mine);
          let near = false;
          for (let r = 0; r < view.nodes.length && !near; r += NODE_STRIDE) {
            if (view.nodes[r + NodeField.kind] !== NodeKind.GoldMine || view.nodes[r + NodeField.amount] <= 0) continue;
            const x = view.nodes[r + NodeField.cellX];
            const y = view.nodes[r + NodeField.cellY];
            near = mines.some((m) => dist2(m.x, m.y, x, y) <= MINE_NEAR * MINE_NEAR);
          }
          if (!near) {
            // Not by the enemy (a09c2367 with the first try: 90 mines put down by the player's main city, each paid and razed).
            const held: { x: number; y: number }[] = [];
            for (let r = 0; r < view.towns.length; r += TOWN_STRIDE) {
              if (view.towns[r + TownField.owner] !== player || view.towns[r + TownField.state] !== TownState.Governed) continue;
              const t = mem.site(view.towns[r + TownField.id])!;
              held.push({ x: t.cellX, y: t.cellY });
            }
            let best: { x: number; y: number; id: number } | null = null;
            let bestD = 0;
            let bestKey = 0;
            for (let r = 0; r < view.nodes.length; r += NODE_STRIDE) {
              if (view.nodes[r + NodeField.kind] !== NodeKind.GoldMine || view.nodes[r + NodeField.amount] <= 0) continue;
              const x = view.nodes[r + NodeField.cellX];
              const y = view.nodes[r + NodeField.cellY];
              const d = dist2(x, y, home.cellX, home.cellY);
              if (mem.known === Known.City && d >= dist2(x, y, enemyHome.cellX, enemyHome.cellY)) continue;
              if (d > MINE_FAR * MINE_FAR && !held.some((t) => dist2(x, y, t.x, t.y) <= MINE_TOWN * MINE_TOWN)) continue;
              if (foes.some((f) => dist2(f.x, f.y, x, y) <= BUILD_SAFE * BUILD_SAFE)) continue;
              const key = rank(x, y);
              if (best === null || d < bestD || (d === bestD && key < bestKey)) {
                best = { x, y, id: view.nodes[r + NodeField.id] };
                bestD = d;
                bestKey = key;
              }
            }
            if (best !== null) add(BuildingType.Mine, best);
          }
        }
        if (res.food + res.wood >= 600 && count(BuildingType.Barracks) + count(BuildingType.Range) < plan.production) {
          add(count(BuildingType.Barracks) <= count(BuildingType.Range) ? BuildingType.Barracks : BuildingType.Range, rally);
        }
        for (const p of plans) {
          if (p.at === null) continue;
          // A mine is only worth it by its node.
          // D-086 A4: a tower only where it was picked.
          const spot = p.type === BuildingType.ArrowTower ? p.at : (spotNear(view, p.type, p.at.x, p.at.y, 12) ?? (p.type === BuildingType.Mine ? null : spotNear(view, p.type, base.x, base.y, 20)));
          if (spot === null) continue;
          // D-086 A4 (plan.buildSafe): not where enemy soldiers stand by, nor where a site was lost; the next on the list instead.
          if (plan.buildSafe && foes.some((f) => dist2(f.x, f.y, spot.x, spot.y) <= BUILD_SAFE * BUILD_SAFE)) continue;
          if (plan.buildSafe && lostSites.some((l) => dist2(l.x, l.y, spot.x, spot.y) <= SITE_NEAR * SITE_NEAR)) continue;
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
          if (plan.buildSafe) ordered.push({ type: p.type, x: spot.x, y: spot.y });
          if (p.type === BuildingType.ArrowTower) counted.towersPlaced++;
          break;
        }
      }

      // --- army production ------------------------------------------------------------------
      const spear = soldiers.filter((u) => u.type === UnitType.Spearman).length;
      const ranged = soldiers.filter((u) => u.type === UnitType.Ranged).length;
      const mages = soldiers.filter((u) => u.type === UnitType.Mage).length;
      const trainAt = (t: number, type: UnitType, most = QUEUE_MOST) => {
        for (const b of done(t)) {
          if (most <= 0) break;
          if (b.queue >= 2 || room <= 0 || !afford(rules.units[type].cost)) continue;
          if (keepFood > 0 && res.food - reserve.food - rules.units[type].cost.food < keepFood) continue;
          out.push({ c: "train", building: b.id, type, n: 1 });
          spend(rules.units[type].cost);
          room--;
          most--;
        }
      };
      const hallQueue = done(BuildingType.MageHall).reduce((a, b) => a + b.queue, 0);
      // No more than the cap leaves room for, with those queued (D-089: two halls each queued one with one place left).
      const mageRoom = rules.mageCap - allSoldiers.filter((u) => u.type === UnitType.Mage).length - hallQueue;
      if (mageRoom > 0 && res.crystal >= mageCost.crystal + plan.mageReserve * mages) trainAt(BuildingType.MageHall, UnitType.Mage, mageRoom);
      // The mix answers what it has seen: a cannon shot kills a ranged unit but not a spearman, and
      // ranged units hit spearmen 2.5 times as hard.
      let share = spearBase;
      const cavalryMix = plan.counterCavalry && knownSoldiers + enemyCavalry >= CAVALRY_SEEN && enemyCavalry * 100 >= CAVALRY_MIX * (knownSoldiers + enemyCavalry);
      if (plan.counterMix > 0) {
        if (cavalryMix) share += plan.counterMix;
        else if (enemyMages >= 2) share += plan.counterMix;
        else if (enemySpear + enemyRanged >= 6 && enemySpear * 100 >= (enemySpear + enemyRanged) * 60) share -= plan.counterMix;
        else if (enemySpear + enemyRanged >= 6 && enemyRanged * 100 >= (enemySpear + enemyRanged) * 60) share += plan.counterMix;
      }
      share = Math.max(20, Math.min(80, share));
      labels[HEAD_MIX] = share >= 60 ? 0 : share <= 40 ? 2 : 1;
      if (netChoice !== null && netChoice[HEAD_MIX] !== AS_HARD) share = NET_SHARE[netChoice[HEAD_MIX]];
      // D-086 A4 (plan.cavalryCounter): cavalry first while below its share against a mostly ranged and mage enemy.
      if (cavalryWant) {
        const cavalry = soldiers.filter((u) => u.type === UnitType.Cavalry).length + done(BuildingType.Stable).reduce((a, b) => a + b.queue, 0);
        const before = room;
        if (cavalry * 100 < plan.cavalryCounter * (soldiers.length + 1)) trainAt(BuildingType.Stable, UnitType.Cavalry);
        counted.cavalryTrained += before - room;
      }
      // D-086 A (plan.cavalry): while wood is short and food and gold pile up, cavalry first, up to its share.
      if (plan.cavalry > 0 && woodShort) {
        const cavalry = soldiers.filter((u) => u.type === UnitType.Cavalry).length + done(BuildingType.Stable).reduce((a, b) => a + b.queue, 0);
        if (cavalry * 100 < plan.cavalry * (soldiers.length + 1)) trainAt(BuildingType.Stable, UnitType.Cavalry);
      }
      if (spear * 100 <= share * (spear + ranged)) {
        trainAt(BuildingType.Barracks, UnitType.Spearman);
        trainAt(BuildingType.Range, UnitType.Ranged);
      } else {
        trainAt(BuildingType.Range, UnitType.Ranged);
        trainAt(BuildingType.Barracks, UnitType.Spearman);
      }
      // D-086 A4 (plan.towers, plan.townTowers): with what is left once farmers and soldiers are trained this think
      // (and what it saves up for kept aside); it never saves up for a tower here.
      const towerCost = rules.buildings[BuildingType.ArrowTower]?.cost;
      if (
        (plan.towers > 0 || plan.townTowers > 0) &&
        towerCost !== undefined &&
        gatherers.length >= 2 &&
        own.filter((b) => b.progress < 1000).length < plan.sites &&
        res.wood - reserve.wood >= towerCost.wood + plan.towerSpare &&
        res.gold - reserve.gold >= towerCost.gold + plan.towerSpare
      ) {
        const towerSpot = towerSpotFor();
        if (towerSpot !== null) {
          out.push({ c: "build", u: gatherers.slice(0, 2), type: BuildingType.ArrowTower, x: towerSpot.x, y: towerSpot.y });
          gatherers.splice(0, 2);
          spend(towerCost);
          counted.towersPlaced++;
        }
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
        const t = mem.site(id)!;
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
      for (const t of mem.unexplored) {
        if (!towns.has(t.id)) towns.set(t.id, { state: TownState.Neutral, owner: NEUTRAL, needed: 0, timer: 0, visible: false, x: t.cellX, y: t.cellY, size: t.size });
      }
      for (const [id, t] of towns) {
        if (t.state === TownState.Ruins && t.visible) restoreAt.set(id, tick + t.timer);
        if (t.owner !== player || t.state !== TownState.AwaitingChoice) continue;
        if (!(once && plunderedTown(id))) labels[HEAD_TOWN] = toGovern(id) ? 1 : 0;
        if (!toGovern(id)) out.push({ c: "town_choice", town: id, choice: TownChoice.Plunder });
        else if (affordAll(governCost(t.size))) {
          out.push({ c: "town_choice", town: id, choice: TownChoice.Govern });
          spend(governCost(t.size));
        } else if (!(once && plunderedTown(id))) out.push({ c: "town_choice", town: id, choice: TownChoice.Plunder });
        // Plundered before and it cannot pay yet: it waits (a plunder would be refused).
      }
      /** D-086 A4 (plan.ruinsAgain): last seen in ruins, out of sight now, and past the time read off them: maybe neutral again. */
      const staleRuin = (id: number, t: HardTown) => plan.ruinsAgain && t.state === TownState.Ruins && !t.visible && restoreAt.has(id) && tick >= restoreAt.get(id)!;
      // Enemy forts (D-080, D-081).
      const forts = enemyForts(view, player, rules);
      /** A town under the arrows or guards of an enemy fort (D-081). */
      const underArrows = (t: { x: number; y: number }) => forts.some((o) => o.done && fortDist2(o, t.x, t.y) <= (o.hits + 1) * (o.hits + 1));
      // Garrisons: the spearmen (else any soldier but a mage) nearest each held town, one more
      // than it needs, topped up as they fall; none under enemy forts' arrows (D-081, as normal).
      for (const [id, t] of towns) {
        const held = t.owner === player && (t.state === TownState.Repairing || t.state === TownState.Governed);
        if (!held || underArrows(t)) {
          townGuards.delete(id);
          continue;
        }
        const guarded = new Set([...townGuards.values()].flat());
        const alive = (townGuards.get(id) ?? []).filter((g) => byId.has(g));
        const free = soldiers
          .filter((s) => !guarded.has(s.id) && s.type !== UnitType.Mage && s.order !== Order.Garrison && !rescueSquad.has(s.id) && s.id !== peekId)
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
      const detached = (id: number) => dodging.has(id) || homeSquad.has(id) || rescueSquad.has(id) || chargers.has(id) || id === peekId || byId.get(id)?.order === Order.Cast || byId.get(id)?.order === Order.Garrison;

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
      // D-086 A3 (plan.peekFirst): the one sent to look comes home once enemy soldiers are seen, or after PEEK_WALK.
      if (peekId >= 0) {
        if (!byId.has(peekId)) {
          counted.peekFell++;
          peekId = -1;
          peekAgain = tick + PEEK_AGAIN;
        } else if (lastFoeSeen === tick || tick >= peekUntil) {
          counted[lastFoeSeen === tick ? "peekSaw" : "peekTimeout"]++;
          out.push({ c: "move", u: [peekId], x: post.x, y: post.y });
          peekId = -1;
          peekAgain = tick + PEEK_AGAIN;
        }
      }
      const army =
        guarding.size === 0 && rescueSquad.size === 0 && peekId < 0 ? soldiers : soldiers.filter((u) => !guarding.has(u.id) && !rescueSquad.has(u.id) && u.id !== peekId);
      const armyIds = army.filter((u) => !detached(u.id)).map((u) => u.id);
      let sent = false;
      const send = (x: number, y: number, why: HardMode) => {
        if (armyIds.length === 0) return;
        // Falling back round forts (aroundForts): to the point first, then on home.
        if (via !== null) {
          const back = why === "home" && x === post.x && y === post.y;
          if (back && tick < via.until && dist2(ac.x, ac.y, via.x, via.y) > VIA_NEAR * VIA_NEAR) {
            mode = why;
            target = { x, y };
            return;
          }
          if (back) lastMove = -100000;
          via = null;
        }
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
        if (plan.towers > 0 || plan.townTowers > 0) waveFrom = centre(foesNear(home.cellX, home.cellY, WAVE_CELLS), home.cellX, home.cellY);
      } else if (tick - lastWave >= 200 && waveMax > 0) {
        if (waveMax >= 6) counterReady = true;
        waveMax = 0;
      }


      // Enemy forts (D-080) on its ground (by the main city or a town it holds): farmers go for an
      // unguarded one while too few soldiers are by it (the army's part is in its orders).
      const held = [...towns.values()]
        .filter((t) => t.owner === player && (t.state === TownState.Repairing || t.state === TownState.Governed))
        .map((t) => ({ x: t.x, y: t.y, radius: rules.towns?.[t.size]?.radius ?? 0 }));
      const ours = forts.length === 0 ? [] : fortsOnOurGround(forts, home, held);
      if (!recalled) {
        // Farmers going take the soldiers at home along to the end: not where the army broke off, as its own goes (D-081, ceo 2026-10-10).
        // Those that would go: not the towns' guards.
        const vs = soldiers.filter((u) => !guarding.has(u.id)).reduce((a, u) => a + (fv.vs[u.type] ?? 0), 0);
        crew.think(tick, ours, forts, home, foes, enemyFarmers, soldiers, farmers, out, (f) => vs * 100 < failedNear(f, forts, failedAt, tick, fortForget) * fortFailed);
      }

      // --- D-086 A4: cavalry charge the enemy's ranged units and mages (plan.charge) -------------------------
      if (plan.charge) {
        for (const id of chargers) if (!byId.has(id)) chargers.delete(id);
        const spotKey = (x: number, y: number) => {
          const f = frame(x, y);
          return (f.v >> 3) * n + (f.u >> 3);
        };
        /** Ranged units and mages in sight this near (x, y), out of enemy forts' reach, nearest first (ties in player 0's frame). */
        const prey = (x: number, y: number) =>
          foes
            .filter((f) => (f.type === UnitType.Ranged || f.type === UnitType.Mage) && f.order !== Order.Garrison && dist2(f.x, f.y, x, y) <= CHARGE_NEAR * CHARGE_NEAR && !underArrows(f))
            .sort((a, b) => dist2(a.x, a.y, x, y) - dist2(b.x, b.y, x, y) || rank(a.fx, a.fy) - rank(b.fx, b.fy));
        const spearsBy = (x: number, y: number) => foes.filter((f) => f.type === UnitType.Spearman && dist2(f.x, f.y, x, y) <= CHARGE_SPEAR * CHARGE_SPEAR).length;
        if (chargeAt !== null) {
          const at = chargeAt;
          const squad = soldiers.filter((u) => chargers.has(u.id));
          const sc = centre(squad, at.x, at.y);
          // Weighed again on the way: spearmen closing in, forts' reach, half gone; done once no target is left.
          let why: "" | "chargeBack" | "chargeLost" | "chargeDone" = "";
          if (squad.length * 2 < at.size) why = "chargeLost";
          else if (spearsBy(sc.x, sc.y) > squad.length || underArrows(sc)) why = "chargeBack";
          const left = why === "" ? prey(sc.x, sc.y) : [];
          if (why === "" && left.length === 0) why = "chargeDone";
          const ids = squad.map((u) => u.id);
          if (why !== "") {
            if (ids.length > 0) out.push({ c: why === "chargeDone" ? "move" : "retreat", u: ids, x: ac.x, y: ac.y });
            if (why !== "chargeDone") chargeRestAt.set(spotKey(at.x, at.y), tick + plan.chargeRest * TICKS_PER_MINUTE);
            counted[why]++;
            counted.chargeCavalryLost += at.size - squad.length;
            chargers.clear();
            chargeAt = null;
            if (why === "chargeDone") rejoin.push(...ids);
          } else if (left[0].id !== at.target || tick - chargeMove >= CHARGE_MOVE) {
            out.push({ c: "attack", u: ids, target: left[0].id });
            at.target = left[0].id;
            chargeMove = tick;
          }
        } else {
          const cavalry = army.filter((u) => u.type === UnitType.Cavalry && !detached(u.id));
          if (cavalry.length >= CHARGE_MIN) {
            const cc = centre(cavalry, ac.x, ac.y);
            const target = prey(cc.x, cc.y)[0];
            // Weighed first: no more spearmen than cavalry by the target, not a spot it gave up lately.
            if (target !== undefined && spearsBy(target.x, target.y) <= cavalry.length && tick >= (chargeRestAt.get(spotKey(target.x, target.y)) ?? 0)) {
              const ids = cavalry.map((u) => u.id);
              for (const id of ids) chargers.add(id);
              chargeAt = { x: target.x, y: target.y, size: ids.length, target: target.id };
              chargeMove = tick;
              out.push({ c: "attack", u: ids, target: target.id });
              counted.chargeSent++;
              const keep = armyIds.filter((id) => !chargers.has(id));
              armyIds.length = 0;
              armyIds.push(...keep);
            }
          }
        }
      }

      // --- D-086 A3: farmers attacked far from home (plan.rescue, plan.hideFar) -------------------------
      let farmerSpot: { x: number; y: number } | null = null;
      const cityHit = foesNear(home.cellX, home.cellY, 16).length > 0;
      if (plan.rescue || plan.hideFar) {
        const far = (x: number, y: number) => dist2(x, y, home.cellX, home.cellY) >= FAR_FARMER * FAR_FARMER;
        const alive = new Set(farmers.map((f) => f.id));
        for (const [id, at] of farmerSeen) {
          if (alive.has(id)) continue;
          farmerSeen.delete(id);
          if (far(at.x, at.y)) farmerFell.push({ x: at.x, y: at.y, tick });
        }
        for (const f of farmers) farmerSeen.set(f.id, { x: f.x, y: f.y });
        while (farmerFell.length > 0 && tick - farmerFell[0].tick > TICKS_PER_MINUTE) farmerFell.shift();
        const spots: { x: number; y: number }[] = [];
        for (const d of farmerFell) if (farmerFell.filter((e) => dist2(e.x, e.y, d.x, d.y) <= FARMER_SPOT * FARMER_SPOT).length >= 2) spots.push(d);
        for (const f of farmers) if (far(f.x, f.y) && foes.some((e) => dist2(e.x, e.y, f.x, f.y) <= FARMER_SPOT * FARMER_SPOT)) spots.push({ x: f.x, y: f.y });
        // The one nearest home (ties in player 0's frame), not under an enemy fort's reach.
        let best = 0;
        for (const p of spots) {
          if (underArrows(p)) continue;
          const d = dist2(p.x, p.y, home.cellX, home.cellY);
          if (farmerSpot === null || d < best || (d === best && rank(p.x, p.y) < rank(farmerSpot.x, farmerSpot.y))) {
            farmerSpot = p;
            best = d;
          }
        }
      }
      if (plan.rescue) {
        const spotKey = (x: number, y: number) => {
          const f = frame(x, y);
          return (f.v >> 3) * n + (f.u >> 3);
        };
        /** D-083 (a)'s weighing at a spot: those that would go against the forts reaching it and 1.3 x the enemy it knows of by it (seen in the last minute). */
        const beats = (list: { type: number }[], x: number, y: number) => {
          let enemy = 0;
          for (const e of intel.values()) if (!e.post && tick - e.tick <= TICKS_PER_MINUTE && dist2(e.x, e.y, x, y) <= RESCUE_NEAR * RESCUE_NEAR) enemy += WORTH[e.type];
          const gs = forts.length === 0 ? [] : fortGroups(forts, (o) => foes.filter((e) => e.order === Order.Post && fortDist2(o, e.x, e.y) <= 9).length, fv);
          const w = list.reduce((a, u) => a + (fv.vs[u.type] ?? 0), 0);
          return w * 10 >= fortsAtTown(gs, x, y, RESCUE_NEAR) * 10 + enemy * 13;
        };
        for (const id of rescueSquad) if (!byId.has(id)) rescueSquad.delete(id);
        if (rescueAt !== null) {
          const at = rescueAt;
          const squad = soldiers.filter((u) => rescueSquad.has(u.id));
          const sc = centre(squad, at.x, at.y);
          if (!at.arrived && dist2(sc.x, sc.y, at.x, at.y) <= RESCUE_NEAR * RESCUE_NEAR) {
            at.arrived = true;
            rescueClear = tick;
          }
          if (foesNear(at.x, at.y, RESCUE_NEAR).length > 0 || foesNear(sc.x, sc.y, FARMER_SPOT).length > 0) rescueClear = tick;
          // Home: the main city hit; half gone; the enemy there too strong now, or the squad under a fort's reach; done.
          let why: "" | "rescueCityHit" | "rescueLost" | "rescueWeak" | "rescueDone" = "";
          if (cityHit) why = "rescueCityHit";
          else if (squad.length * 2 < at.size) why = "rescueLost";
          else if (!beats(squad, at.x, at.y) || underArrows(sc)) why = "rescueWeak";
          else if ((at.arrived && tick - rescueClear >= RESCUE_DONE) || (!at.arrived && tick - at.start >= RESCUE_WALK)) why = "rescueDone";
          const ids = squad.map((u) => u.id);
          if (why !== "") {
            if (ids.length > 0) out.push({ c: why === "rescueDone" ? "move" : "retreat", u: ids, x: post.x, y: post.y });
            if (why === "rescueLost" || why === "rescueWeak") rescueRest.set(spotKey(at.x, at.y), tick + plan.rescueRest * TICKS_PER_MINUTE);
            counted[why]++;
            rescueSquad.clear();
            rescueAt = null;
          } else {
            // Never past the spot: those further from it (and from home) than it come back to it.
            const atD = dist2(at.x, at.y, home.cellX, home.cellY);
            const past = squad.filter((u) => dist2(u.x, u.y, at.x, at.y) > RESCUE_NEAR * RESCUE_NEAR && dist2(u.x, u.y, home.cellX, home.cellY) > atD).map((u) => u.id);
            if (past.length > 0 && tick - rescueMove >= 100) {
              out.push({ c: "retreat", u: past, x: at.x, y: at.y });
              rescueMove = tick;
            } else if (!at.arrived && tick - rescueMove >= 400) {
              out.push({ c: "move", u: ids, x: at.x, y: at.y });
              rescueMove = tick;
            }
          }
        } else if (farmerSpot !== null && mode === "home" && !cityHit && !recalled && tick >= (rescueRest.get(spotKey(farmerSpot.x, farmerSpot.y)) ?? 0)) {
          const spot = farmerSpot;
          // From the soldiers at home, nearest the spot first; at most half of them, never fewer than RESCUE_MIN.
          const pool = army
            .filter((u) => !detached(u.id) && dist2(u.x, u.y, home.cellX, home.cellY) <= RESCUE_HOME * RESCUE_HOME)
            .sort((a, b) => dist2(a.x, a.y, spot.x, spot.y) - dist2(b.x, b.y, spot.x, spot.y) || rank(a.fx, a.fy) - rank(b.fx, b.fy));
          const most = pool.length >> 1;
          const pick: HardUnit[] = [];
          for (const u of pool) {
            if (pick.length >= most) break;
            pick.push(u);
            if (pick.length >= RESCUE_MIN && beats(pick, spot.x, spot.y)) break;
          }
          if (pick.length >= RESCUE_MIN && beats(pick, spot.x, spot.y)) {
            const ids = pick.map((u) => u.id);
            for (const id of ids) rescueSquad.add(id);
            rescueAt = { x: spot.x, y: spot.y, start: tick, size: ids.length, arrived: false };
            rescueClear = tick;
            rescueMove = tick;
            out.push({ c: "move", u: ids, x: spot.x, y: spot.y });
            counted.rescueSent++;
            const keep = armyIds.filter((id) => !rescueSquad.has(id));
            armyIds.length = 0;
            armyIds.push(...keep);
          } else {
            // Too few for it: none go (never one by one); counted once a spot.
            const key = spotKey(spot.x, spot.y);
            if (key !== rescueDeclined) counted.rescueDeclined++;
            rescueDeclined = key;
          }
        }
      }
      if (plan.hideFar) {
        // Those sent home go back to work once no enemy has been seen by their spot for a while (not while all hide in the main city).
        for (const h of farHide) if (recalled || foesNear(h.x, h.y, FARMER_SPOT).length > 0) h.clear = tick;
        for (let k = farHide.length - 1; k >= 0; k--) {
          const h = farHide[k];
          if (tick - h.clear < FAR_CLEAR) continue;
          const ids = h.ids.filter((id) => farmers.some((f) => f.id === id));
          if (ids.length > 0) out.push({ c: "release", u: ids });
          counted.farmersReleased += ids.length;
          farHide.splice(k, 1);
        }
        if (farmerSpot !== null && !recalled) {
          const spot = farmerSpot;
          const sent = new Set(farHide.flatMap((h) => h.ids));
          // The farmers by the spot (not those pulling down a fort, D-080) go home.
          const go = farmers
            .filter((f) => !sent.has(f.id) && f.order !== Order.Attack && dist2(f.x, f.y, spot.x, spot.y) <= (FARMER_SPOT + 2) * (FARMER_SPOT + 2) && dist2(f.x, f.y, home.cellX, home.cellY) >= FAR_FARMER * FAR_FARMER)
            .map((f) => f.id);
          if (go.length > 0) {
            out.push({ c: "retreat", u: go, x: post.x, y: post.y });
            counted.farmersHid += go.length;
            const h = farHide.find((e) => dist2(e.x, e.y, spot.x, spot.y) <= FARMER_SPOT * FARMER_SPOT);
            if (h !== undefined) {
              h.ids.push(...go);
              h.clear = tick;
            } else farHide.push({ x: spot.x, y: spot.y, clear: tick, ids: [...go] }); // its own copy: go is in the order sent
          }
        }
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
        /**
         * D-083 (D-081's leftover (a), ceo 2026-10-18), as normal: back to a town whose plunder it holds only when those that
         * would go beat the forts reaching it and 1.3 x the enemy soldiers it knows of by it (seen in the last 2 minutes).
         */
        const holdsOut = (t: Town) => {
          if (!d083) return true;
          const r = (rules.towns?.[t.size]?.radius ?? 5) + FORT_ARMY_NEAR;
          let enemy = 0;
          for (const e of intel.values()) if (!e.post && tick - e.tick < 2 * TICKS_PER_MINUTE && dist2(e.x, e.y, t.x, t.y) <= r * r) enemy += WORTH[e.type];
          const gs = forts.length === 0 ? [] : fortGroups(forts, (o) => foes.filter((e) => e.order === Order.Post && fortDist2(o, e.x, e.y) <= 9).length, fv);
          const w = army.reduce((a, u) => a + (fv.vs[u.type] ?? 0), 0);
          return w * 10 >= fortsAtTown(gs, t.x, t.y, rules.towns?.[t.size]?.radius ?? 5) * 10 + enemy * 13;
        };
        /**
         * D-096 (GATE_AI.walls): with enemy soldiers by town `id` it holds, its ranged units and mages there go up the walls
         * (told again every 100 ticks); those on its walls, or going up, are left out of the army's orders this think.
         */
        const wallUp = (id: number, t: HardTown) => {
          if (!GATE_AI.walls || rules.features?.walls !== true) return;
          const r = rules.towns?.[t.size]?.radius ?? 5;
          const threat = foes.some((e) => dist2(e.x, e.y, t.x, t.y) <= (r + GATE_NEAR) * (r + GATE_NEAR));
          const up = threat ? army.filter((u) => (u.type === UnitType.Ranged || u.type === UnitType.Mage) && u.order !== Order.Wall && dist2(u.x, u.y, t.x, t.y) <= (r + 3) * (r + 3)).map((u) => u.id) : [];
          if (up.length > 0 && tick - wallMove >= 100) {
            out.push({ c: "wall", u: up, town: id });
            wallMove = tick;
            counted.wallUp++;
          }
          const away = new Set([...up, ...army.filter((u) => u.order === Order.Wall && u.orderTarget === id).map((u) => u.id)]);
          if (away.size === 0) return;
          const keep = armyIds.filter((x) => !away.has(x));
          armyIds.length = 0;
          armyIds.push(...keep);
        };
        const busy = [...towns.entries()].find(
          ([id, t]) =>
            t.owner === player &&
            (t.state === TownState.Plundering || (t.state === TownState.AwaitingChoice && !(once && plunderedTown(id) && !affordAll(governCost(t.size))))) &&
            holdsOut(t),
        );
        if (busy !== undefined && !endgame) {
          // D-096 (GATE_AI.walls): enemy soldiers by it, its ranged units and mages up on the walls.
          wallUp(busy[0], busy[1]);
          send(busy[1].x, busy[1].y, "town");
          return;
        }
        const standing = soldiers.filter((u) => marched.has(u.id)).length;
        const local = worth(foesNear(ac.x, ac.y, 12));
        // Enemy forts (D-080), as normal: on its ground the army at home pulls them down once clearly
        // stronger than what defends them, and keeps at it until they are gone; on the way, those by
        // the way first; and with the army away at the enemy base, the soldiers waiting at home go for
        // those on its ground.
        const nearestFort = (list: Fort[], x: number, y: number): Fort | undefined => {
          let best: Fort | undefined;
          let bestD = 0;
          for (const f of list) {
            const d = fortDist2(f, x, y);
            if (best === undefined || d < bestD || (d === bestD && rank(f.x, f.y) < rank(best.x, best.y))) {
              best = f;
              bestD = d;
            }
          }
          return best;
        };
        // Fort groups (D-081): forts that cover each other count together, with those hiding in them.
        const guardsAt = (f: Fort) => foes.filter((e) => e.order === Order.Post && fortDist2(f, e.x, e.y) <= 9).length;
        const groups = forts.length === 0 ? [] : fortGroups(forts, guardsAt, fv);
        const groupOf = (f: Fort) => groups.find((g) => g.ids.includes(f.id));
        /** A group whose middle is by the enemy's main city (FORT_SIEGE) is the siege's: the city's defences count as before. */
        const bySiege = (g: FortGroup) => dist2(g.x, g.y, enemyHome.cellX, enemyHome.cellY) <= FORT_SIEGE * FORT_SIEGE;
        /** The enemy soldiers it knows of near a group (posted guards count with the forts). */
        const armyBy = (g: FortGroup) => {
          let w = 0;
          const r = g.radius + FORT_ARMY_NEAR;
          for (const e of intel.values()) if (!e.post && dist2(e.x, e.y, g.x, g.y) <= r * r) w += WORTH[e.type];
          return w;
        };
        const vsForts = (list: { type: number }[]) => list.reduce((a, u) => a + (fv.vs[u.type] ?? 0), 0);
        /** Stronger than a group and the enemy soldiers by it, and than the army that broke off from it before (FORT_FAILED). */
        const beats = (g: FortGroup, list: { type: number }[]) => {
          const w = vsForts(list);
          let failed = 0;
          for (const id of g.ids) {
            const f = failedAt.get(id);
            if (f !== undefined && tick - f.tick < fortForget) failed = Math.max(failed, f.worth);
          }
          // At least as strong as the forts (scratch base runs: 30 or more soldiers in reach took the scripted
          // fortress 68 times of 69, fewer than 20 failed 12 times of 20) and clearly (1.3 x) stronger than the army by them.
          return w * 10 >= g.worth * 10 + armyBy(g) * 13 && w * 100 >= failed * fortFailed;
        };
        /** The groups too strong for `list` (not the siege's). */
        const tooStrong = (list: { type: number }[]) => groups.filter((g) => !bySiege(g) && !beats(g, list));
        /** A march with `list` from `from` to `to`: clear of groups too strong for it (D-081: a way round was tried and dropped, sim/README.md). */
        const routeFor = (from: { x: number; y: number }, to: { x: number; y: number }, list: { type: number }[]) => ({ go: groupsOnWay(tooStrong(list), from, to).length === 0 });
        /** Broke off by these groups: the next go at them takes more (FORT_FAILED). */
        const remember = (list: { type: number }[], near: FortGroup[]) => {
          // The army that set out, not what is left of it.
          const w = Math.max(vsForts(list), marchWorth);
          for (const g of near) for (const id of g.ids) failedAt.set(id, { worth: Math.max(failedAt.get(id)?.worth ?? 0, w), tick });
        };
        /** The groups whose arrows or guards reach (x, y), and the one `f` is in. */
        const covering = (x: number, y: number, f?: Fort) =>
          groups.filter((g) => dist2(g.x, g.y, x, y) <= (g.radius + FORT_WAY) * (g.radius + FORT_WAY) || (f !== undefined && g.ids.includes(f.id)));
        /** Broke off from pulling down `f` (gone, maybe) with the army at (x, y): it and the groups there, as from a march (D-081, ceo 2026-10-10). */
        const rememberFort = (list: { type: number }[], f: Fort | undefined, x: number, y: number) => {
          remember(list, covering(x, y, f));
          if (f !== undefined) failedAt.set(f.id, { worth: Math.max(failedAt.get(f.id)?.worth ?? 0, vsForts(list), marchWorth), tick });
        };
        /** The army that broke off from `f` or from the groups covering it, within FORT_FORGET (0: none). */
        const failedBy = (f: Fort) => {
          const c = fortCentre(f);
          let failed = 0;
          for (const id of [f.id, ...covering(c.x, c.y, f).flatMap((g) => g.ids)]) {
            const m = failedAt.get(id);
            if (m !== undefined && tick - m.tick < fortForget) failed = Math.max(failed, m.worth);
          }
          return failed;
        };
        /**
         * Strong enough for a fort: at least the group it is in, and 1.3 x the enemy soldiers by it, not its guards (D-081; D-080 counted 3 soldiers a tower);
         * and, within FORT_FORGET of breaking off from it, FORT_FAILED of the army that did (ceo 2026-10-10: it went again every 0.6–3 minutes).
         */
        const enough = (list: { type: number }[], f: Fort) => {
          const c = fortCentre(f);
          const g = groupOf(f);
          const army = worth(foesNear(c.x, c.y, FORT_GUARDS).filter((e) => e.order !== Order.Post));
          const w = vsForts(list);
          return w * 10 >= (g === undefined ? 0 : g.worth) * 10 + army * 13 && w * 100 >= failedBy(f) * fortFailed;
        };
        /** Fell back from town `id` because of forts, and they are still too strong for the army (with FORT_FAILED within FORT_FORGET). */
        const fortsBar = (id: number) => {
          const m = townForts.get(id);
          return m !== undefined && tooStrong(army).some((g) => g.ids.some((x) => m.ids.includes(x)));
        };
        /** Back home, round forts too strong for it that the straight way from `from` passes first (aroundForts, ceo 2026-10-11). */
        const fallBackPast = (cause: FortGroup[], from: { x: number; y: number }) => {
          const v = aroundForts([...cause, ...tooStrong(army)], from, post, know.map.size);
          fallBack(v?.x ?? post.x, v?.y ?? post.y);
          via = v === undefined ? null : { x: v.x, y: v.y, until: tick + VIA_TICKS };
        };
        /** Its defenders first (a move fights what it meets), then the fort itself. */
        const hit = (ids: number[], f: Fort) => {
          const c = fortCentre(f);
          if (foesNear(c.x, c.y, FORT_GUARDS).length > 0) out.push({ c: "move", u: ids, x: c.x, y: c.y });
          else out.push({ c: "attack", u: ids, target: f.id });
        };
        const razeWith = (ids: number[], f: Fort) => {
          const c = fortCentre(f);
          if (ids.length > 0 && (razing !== f.id || target.x !== c.x || target.y !== c.y || tick - lastMove >= FORT_EVERY)) {
            hit(ids, f);
            lastMove = tick;
            sent = true;
          }
          razing = f.id;
          target = c;
        };
        if (mode === "raze" || (mode === "home" && !endgame && forts.length > 0)) {
          // With farmers going for a fort, the soldiers at home go with them, however few, to the end.
          const withCrew = crew.aim >= 0 ? ours.find((x) => x.id === crew.aim) : undefined;
          if (mode === "raze" && withCrew === undefined && (standing * 5 < armyAtStart * 2 || local > armyWorth)) {
            // Remembered, as from a march (ceo 2026-10-10).
            const was = forts.find((x) => x.id === razing);
            rememberFort(army, was, ac.x, ac.y);
            razing = -1;
            razeAgain = tick + FORT_AGAIN;
            fallBackPast(covering(ac.x, ac.y, was), ac);
            return;
          }
          const f = withCrew ?? ours.find((x) => x.id === razing) ?? nearestFort(ours, ac.x, ac.y);
          const able = withCrew !== undefined ? armyIds.length > 0 : tick >= razeAgain && armyIds.length >= FORT_ARMY;
          if (f !== undefined && !endgame && able && (mode === "raze" || withCrew !== undefined || enough(army, f))) {
            if (mode !== "raze") {
              armyAtStart = army.length;
              marchWorth = vsForts(army);
              marched.clear();
              for (const u of army) marched.add(u.id);
            }
            mode = "raze";
            razeWith(armyIds, f);
            return;
          }
          if (mode === "raze") mode = "home";
          razing = -1;
        }
        /** D-096 (GATE_AI.focus): at town `t` with gates closed to it, the army on the gate (orders again every FORT_EVERY); false: none (in as before). */
        const gateFocus = (t: HardTown) => {
          const go = gateOrders(view, rules, player, t, army.filter((u) => armyIds.includes(u.id)), ac, rank);
          if (go === null) {
            // The gate down: in, now.
            if (gateAim >= 0) lastMove = -100000;
            gateAim = -1;
            gateSeen.length = 0;
            return false;
          }
          if (go.gate.id !== gateAim) gateSeen.length = 0;
          gateFell = gateFalling(gateSeen, tick, go.gate.hp, rules.towns?.[t.size]?.gateHp ?? 0);
          if (go.gate.id !== gateAim || tick - gateMove >= FORT_EVERY) {
            out.push(...go.orders);
            gateMove = tick;
            sent = true;
            counted.gateFocus++;
          }
          gateAim = go.gate.id;
          return true;
        };
        if (mode === "town") {
          const t = towns.get(targetTown);
          // Forts by the army too strong for it (D-081): it breaks off as from a stronger enemy.
          const byArmy = groups.filter((g) => !bySiege(g) && dist2(g.x, g.y, ac.x, ac.y) <= (g.radius + FORT_WAY) * (g.radius + FORT_WAY) && !beats(g, army));
          if (t === undefined || (t.owner === player && t.state !== TownState.Neutral) || (t.state === TownState.Ruins && !staleRuin(targetTown, t))) mode = "home";
          // D-096 (GATE_AI.retreat "a"): not for its losses while the gate it is breaking falls.
          else if ((standing * 5 < armyAtStart * 2 && !(GATE_AI.retreat.includes("a") && gateAim >= 0 && gateFell)) || local > armyWorth || byArmy.length > 0) {
            razing = -1;
            if (gateAim >= 0) counted.gateBrokeOff++;
            gateAim = -1;
            // D-081 / A4 (plan.fortStage): broke off from the forts it gathered for: remembered too.
            const stopped = fortStop;
            remember(army, stopped !== null && stopped.go ? [...byArmy, ...groups.filter((g) => g.ids.some((id) => stopped.ids.includes(id)))] : byArmy);
            fortStop = null;
            if (byArmy.length > 0) townForts.set(targetTown, { ids: byArmy.flatMap((g) => g.ids), tick });
            // D-081: not straight back to the same town (in 03a70878, 13 orders between it and home in 12 s).
            if (plan.townRest > 0) townRest.set(targetTown, tick + plan.townRest * TICKS_PER_MINUTE);
            fallBackPast(byArmy, ac);
            return;
          } else {
            // Forts too strong for it ahead (seen only now, D-081): back, and remember.
            const ahead = groupsOnWay(tooStrong(army), ac, t);
            if (ahead.length > 0) {
              razing = -1;
              remember(army, ahead);
              townForts.set(targetTown, { ids: ahead.flatMap((g) => g.ids), tick });
              if (plan.townRest > 0) townRest.set(targetTown, tick + plan.townRest * TICKS_PER_MINUTE);
              fallBackPast(ahead, ac);
              return;
            }
            // D-081 / A4 (plan.fortStage): forts on the way it can take: it gathers outside their reach first, then pulls them down together.
            if (plan.fortStage && !endgame) {
              const next = fortStopNext(fortStop, mode, tick, groups, forts, (g) => !bySiege(g) && beats(g, army), army.filter((u) => armyIds.includes(u.id)), ac, t, view, know.map, rank, razing);
              fortStop = next.stop;
              if (next.gather !== undefined) {
                send(next.gather.x, next.gather.y, "town");
                return;
              }
              if (next.raze !== undefined) {
                razeWith(armyIds, next.raze);
                return;
              }
            }
            const f = nearestFort(
              fortsOnTheWay(forts, ac.x, ac.y, enemyHome).filter((o) => {
                const g = groupOf(o);
                return g === undefined || beats(g, army);
              }),
              ac.x,
              ac.y,
            );
            if (f !== undefined) {
              razeWith(armyIds, f);
              return;
            }
            razing = -1;
            if (!gateFocus(t)) send(t.x, t.y, "town");
            return;
          }
        }
        if (mode === "base") {
          // Those that set out are the front; soldiers trained since wait at home and follow six at
          // a time (one by one they would be picked off on the way).
          // Round 7 (garrison): a main city with soldiers hiding in it picks off what comes in small
          // groups, so then they wait for the next march instead.
          const reserves = army.filter((u) => !marched.has(u.id) && !detached(u.id));
          if (reserves.length >= 6 && !garrisonOn) for (const u of reserves) marched.add(u.id);
          const front = army.filter((u) => marched.has(u.id));
          const frontIds = front.filter((u) => !detached(u.id)).map((u) => u.id);
          const fc = centre(front, ac.x, ac.y);
          const cityLow = enemyCityHp >= 0 && enemyCityHp * 100 <= rules.buildings[BuildingType.MainCity].hp * PRESS_ON_HP;
          // It breaks off only when outmatched where the front stands (not because the city's arrows
          // thinned it: with nobody left to defend it, the city falls), or when too few are left.
          const atCity = front.filter((u) => dist2(u.x, u.y, enemyHome.cellX, enemyHome.cellY) <= 14 * 14);
          // Round 7: stragglers far behind do not hold up the siege; and soldiers hiding in the city
          // cannot be seen, so a front ground down to under 40% of those that set out breaks off.
          const nearFront = garrisonOn ? front.filter((u) => dist2(u.x, u.y, enemyHome.cellX, enemyHome.cellY) <= 30 * 30).length : front.length;
          const there = atCity.length * 2 >= nearFront;
          const defenders = worth(foesNear(fc.x, fc.y, 12));
          const ground = garrisonOn && front.length * 5 < armyAtStart * 2;
          // Forts by the front too strong for it (D-081; not the siege's): it breaks off as from a stronger enemy.
          const byFront = groups.filter((g) => !bySiege(g) && dist2(g.x, g.y, fc.x, fc.y) <= (g.radius + FORT_WAY) * (g.radius + FORT_WAY) && !beats(g, front));
          if (front.length === 0 || (!endgame && !cityLow && (ground || defenders * 10 > worth(front) * 12 || (front.length < 6 && defenders > 0) || byFront.length > 0))) {
            cityFailed = armyAtStart;
            // D-081 / A4 (plan.fortStage): broke off from the forts it gathered for: remembered too.
            const stopped = fortStop;
            remember(front, stopped !== null && stopped.go ? [...byFront, ...groups.filter((g) => g.ids.some((id) => stopped.ids.includes(id)))] : byFront);
            fortStop = null;
            counterReady = false;
            razing = -1;
            reservesRazing = -1;
            fallBackPast(byFront, fc);
            return;
          }
          // Forts too strong for the front ahead (seen only now, D-081): back, and remember.
          const enemy = { x: enemyHome.cellX, y: enemyHome.cellY };
          if (frontIds.length > 0 && !endgame) {
            const ahead = groupsOnWay(tooStrong(front), fc, enemy);
            if (ahead.length > 0) {
              remember(front, ahead);
              counterReady = false;
              razing = -1;
              reservesRazing = -1;
              fallBackPast(ahead, fc);
              return;
            }
          }
          // Forts (D-080): those by the front's way first; those on its ground at home, the soldiers
          // waiting there, once clearly stronger.
          // D-081 / A4 (plan.fortStage): forts on the front's way it can take: gathered outside their reach first, then together.
          let stopAt: { x: number; y: number } | undefined;
          let stopRaze: Fort | undefined;
          if (plan.fortStage && !endgame && frontIds.length > 0) {
            const next = fortStopNext(fortStop, mode, tick, groups, forts, (g) => !bySiege(g) && beats(g, front), front.filter((u) => frontIds.includes(u.id)), fc, enemy, view, know.map, rank, razing);
            fortStop = next.stop;
            stopAt = next.gather;
            stopRaze = next.raze;
          }
          const way =
            stopRaze !== undefined
              ? stopRaze
              : frontIds.length > 0
              ? nearestFort(
                  fortsOnTheWay(forts, fc.x, fc.y, enemyHome).filter((o) => {
                    const g = groupOf(o);
                    return g === undefined || beats(g, front);
                  }),
                  fc.x,
                  fc.y,
                )
              : undefined;
          if (way === undefined) razing = -1;
          const waiting = reserves.filter((u) => !marched.has(u.id));
          const homeForts = waiting.length >= FORT_ARMY ? ours : [];
          const mine = homeForts.find((x) => x.id === reservesRazing) ?? nearestFort(homeForts, home.cellX, home.cellY);
          if (mine !== undefined && (mine.id === reservesRazing || enough(waiting, mine))) {
            if (mine.id !== reservesRazing || tick - reservesMove >= FORT_EVERY) {
              hit(waiting.map((u) => u.id), mine);
              reservesMove = tick;
            }
            reservesRazing = mine.id;
          } else reservesRazing = -1;
          // D-089: the front gathers outside first.
          const at = stage;
          if (at !== null && !staged) {
            const by = front.filter((u) => dist2(u.x, u.y, at.x, at.y) <= STAGE_NEAR * STAGE_NEAR).length;
            if (by > 0 && stageFirst < 0) stageFirst = tick;
            if (by * 100 >= STAGE_SHARE * front.length || (stageFirst >= 0 && tick - stageFirst >= STAGE_WAIT) || tick - setOut >= STAGE_MAX) staged = true;
          }
          if (way !== undefined) {
            razeWith(frontIds, way);
          } else if (stopAt !== undefined) {
            if (target.x !== stopAt.x || target.y !== stopAt.y || tick - lastMove >= 400) {
              out.push({ c: "move", u: frontIds, x: stopAt.x, y: stopAt.y });
              lastMove = tick;
              sent = true;
              target = { x: stopAt.x, y: stopAt.y };
            }
          } else if (at !== null && !staged) {
            if (frontIds.length > 0 && (target.x !== at.x || target.y !== at.y || tick - lastMove >= 400)) {
              out.push({ c: "move", u: frontIds, x: at.x, y: at.y });
              lastMove = tick;
              sent = true;
              target = { x: at.x, y: at.y };
            }
          } else if (enemyCity >= 0 && there) {
            if (tick - lastMove >= 100 && frontIds.length > 0) {
              // Defenders first (a move fights what it meets), then the city; those still on the way
              // keep coming.
              const close = atCity.filter((u) => !detached(u.id)).map((u) => u.id);
              const late = frontIds.filter((id) => !close.includes(id));
              // Round 7: a few defenders in sight do not stop an attack on the city that is clearly
              // stronger or nearly done (a move fights them but never hits the city, which is repaired).
              const guards = worth(foesNear(enemyHome.cellX, enemyHome.cellY, 12));
              const pressOn = garrisonOn && close.length > 0 && (cityLow || worth(atCity) >= guards * 3);
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
            (target.x !== enemyHome.cellX || target.y !== enemyHome.cellY || tick - lastMove >= (there ? 100 : 400) || (reserves.length >= 6 && !garrisonOn))
          ) {
            // On the way, or there without the city in sight yet: on to it.
            out.push({ c: "move", u: frontIds, x: enemyHome.cellX, y: enemyHome.cellY });
            lastMove = tick;
            sent = true;
            target = { x: enemyHome.cellX, y: enemyHome.cellY };
          }
          const wait = reserves.filter((u) => !marched.has(u.id) && dist2(u.x, u.y, post.x, post.y) > 9).map((u) => u.id);
          if (wait.length > 0 && tick % 100 === 0 && reservesRazing < 0) out.push({ c: "move", u: wait, x: post.x, y: post.y });
          return;
        }
        // At home: march, go for a town, or wait by the city.
        const popFull = toGo < 0 && cap >= ceiling && pop >= cap - FULL_MARGIN;
        const strong = armyWorth * 100 >= believed * plan.pushRatio;
        // Random maps (D-074): not before it has seen where the enemy is, but for the end of an
        // AI-against-AI game (then the corner across the map, the last resort).
        // D-089 (plan.cityAgain): not again with fewer than broke off last time, but at the end of an AI game.
        const notLess = endgame || plan.cityAgain <= 0 || army.length * 100 >= cityFailed * plan.cityAgain;
        let hardGo =
          (mem.known !== Known.None || endgame || assault) &&
          notLess &&
          (endgame
            ? army.length >= ENDGAME_ARMY
            : assault
              ? army.length >= ASSAULT_ARMY || (latest && army.length >= ENDGAME_ARMY)
              : (counterReady && army.length >= plan.counterArmy && armyWorth >= believed) ||
                (army.length >= pushArmy && strong) ||
                (popFull && army.length >= townArmy + 6));
        // D-086 A3 (plan.peekFirst): no enemy soldier seen for a while: one goes to look (ignoring enemies on the way), the march waits.
        if (hardGo && plan.peekFirst > 0 && !endgame && !assault && !popFull && tick - lastFoeSeen > plan.peekFirst * TICKS_PER_MINUTE) {
          if (peekId >= 0) hardGo = false;
          else if (tick >= peekAgain) {
            const kind = (u: HardUnit) => (u.type === UnitType.Cavalry ? 0 : u.type === UnitType.Spearman ? 1 : 2);
            const pool = army
              .filter((u) => !detached(u.id) && u.type !== UnitType.Mage)
              .sort((a, b) => kind(a) - kind(b) || dist2(a.x, a.y, home.cellX, home.cellY) - dist2(b.x, b.y, home.cellX, home.cellY) || rank(a.fx, a.fy) - rank(b.fx, b.fy));
            if (pool.length > 0) {
              peekId = pool[0].id;
              peekUntil = tick + PEEK_WALK;
              out.push({ c: "retreat", u: [peekId], x: enemyHome.cellX, y: enemyHome.cellY });
              counted.peekSent++;
              const keep = armyIds.filter((id) => id !== peekId);
              armyIds.length = 0;
              armyIds.push(...keep);
              hardGo = false;
            }
          }
        }
        // D-086 B: the network chooses at home (not at the end of a game with a time limit, nor in an assault).
        const netArmy = netChoice === null || endgame || assault || netChoice[HEAD_ARMY] === AS_HARD ? -1 : netChoice[HEAD_ARMY];
        const go = netArmy < 0 ? hardGo : netArmy === ARMY_BASE && mem.known !== Known.None && army.length >= plan.netMarch;
        // Forts on the way too strong for the army (D-081): round them, or not to the base this time.
        const toBase = go ? routeFor({ x: home.cellX, y: home.cellY }, { x: enemyHome.cellX, y: enemyHome.cellY }, army) : null;
        if (go && toBase!.go) {
          labels[HEAD_ARMY] = 2;
          armyAtStart = army.length;
          marchWorth = vsForts(army);
          marched.clear();
          for (const u of army) marched.add(u.id);
          counterReady = false;
          reservesRazing = -1;
          // D-089: to the gathering point first, when there is one.
          stage = stagePoint(view, know.map, forts, ac, enemyHome, rank);
          setOut = tick;
          stageFirst = -1;
          staged = stage === null;
          send(stage?.x ?? enemyHome.cellX, stage?.y ?? enemyHome.cellY, "base");
          return;
        }
        // D-086 B: a town only as hard goes for one (the network's "wait" and a march it could not make stay home).
        if (!assault && netArmy < 0) {
          let pick = -1;
          let pickD = 0;
          for (const [id, t] of towns) {
            if ((t.state === TownState.Ruins && !staleRuin(id, t)) || t.state === TownState.Plundering || (t.owner === player && t.state !== TownState.Neutral)) continue;
            if (tick < (restoreAt.get(id) ?? 0)) continue;
            // D-081: not straight back to a town it fell back from.
            if (tick < (townRest.get(id) ?? 0)) continue;
            // Plundered before (round 7): only worth it when it can pay to govern it.
            if (once && plunderedTown(id) && !affordAll(governCost(t.size))) continue;
            if (army.length < (t.size === TownSize.Small ? townArmy : plan.bigArmy)) continue;
            // Not into a stronger enemy seen there in the last minute.
            let there = 0;
            for (const e of intel.values()) if (tick - e.tick <= TICKS_PER_MINUTE && dist2(e.x, e.y, t.x, t.y) <= 14 * 14) there += WORTH[e.type];
            if (there * 10 > armyWorth * 8) continue;
            // D-096: a governed enemy town's gates shoot (GATE_AI.arrows); nor one it cannot break into (GATE_AI.retreat "b").
            if (GATE_AI.arrows && (there + gateArrowWorth(view, rules, player, t, Math.trunc(there / 10))) * 10 > armyWorth * 8) continue;
            if (GATE_AI.retreat.includes("b") && gateLoss(view, rules, player, t, army) > GATE_LOSS) {
              counted.gateSkipped++;
              continue;
            }
            // D-081: not where forts too strong for it stand on the way or by the town, unless it can go round.
            if (groups.length > 0 && !routeFor({ x: home.cellX, y: home.cellY }, t, army).go) continue;
            // Nor back to one it fell back from because of forts, while it remembers them (ceo 2026-10-10: the straight way
            // from home can miss forts the walk passes by; in 931495929 it went to and fro for 12 minutes).
            if (fortsBar(id)) continue;
            const d = dist2(t.x, t.y, home.cellX, home.cellY);
            if (pick < 0 || d < pickD || (d === pickD && rank(t.x, t.y) < rank(towns.get(pick)!.x, towns.get(pick)!.y))) {
              pick = id;
              pickD = d;
            }
          }
          if (pick >= 0) {
            labels[HEAD_ARMY] = 1;
            targetTown = pick;
            armyAtStart = army.length;
            marchWorth = vsForts(army);
            marched.clear();
            for (const u of army) marched.add(u.id);
            const t = towns.get(pick)!;
            send(t.x, t.y, "town");
            return;
          }
        }
        labels[HEAD_ARMY] = 0;
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
      if (plan.netLog !== undefined && netX.length > 0) plan.netLog(netX, labels);
      return out;
    },
  };
}
