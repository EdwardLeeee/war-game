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
/** A way round a group of forts passes this many cells beyond their reach (D-081). */
const FORT_ROUND = 5;
/** Enemy soldiers this many cells beyond a group's reach count as defending it (D-081). */
const FORT_ARMY_NEAR = 6;
/** After breaking off from a group of forts, the next go at it takes this many times the army (percent, D-081). */
const FORT_FAILED = 150;
/** A waypoint counts as reached this near (cells, D-081)... */
const FORT_VIA_NEAR = 8;
/** ...and as out of reach when the army has not come 2 cells nearer it for this long (ticks): it breaks off. */
const FORT_VIA_STUCK = 400;
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
// an army too weak for a group on its way goes round it, or does not go; a group it broke off from is not
// tried again with as many.

/** What fighters are worth against forts (a spearman is 10): Lanchester's square law, damage per tick times hp, from the live rules. */
export interface FortValues {
  /** A finished arrow tower. */
  tower: number;
  /** A ranged unit or mage hidden in it: it shoots and cannot be hit while the tower stands. */
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
    hidden: Math.round((20 * (ranged.attack / ranged.cooldown)) / (spear.attack / spear.cooldown)),
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
 * A way round `groups` from a to b: a waypoint beside the first of them on the way, FORT_ROUND (or twice
 * that) cells beyond its reach to one side, such that both legs pass clear of every group, on the map, on
 * explored and clear cells; the shorter way, ties in player 0's frame (`rank`). Null if there is none.
 */
export function wayRound(
  groups: FortGroup[],
  a: { x: number; y: number },
  b: { x: number; y: number },
  n: number,
  placement: Uint8Array,
  rank: (x: number, y: number) => number,
): { x: number; y: number } | null {
  const first = groupsOnWay(groups, a, b)[0];
  if (first === undefined) return null;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  let best: { x: number; y: number } | null = null;
  let bestLen = 0;
  for (const extra of [FORT_ROUND, 2 * FORT_ROUND]) {
    for (const side of [1, -1]) {
      const d = first.radius + extra;
      const x = Math.trunc(first.x - (side * dy * d) / len);
      const y = Math.trunc(first.y + (side * dx * d) / len);
      if (x < 2 || y < 2 || x > n - 3 || y > n - 3) continue;
      // Explored and clear, it and the cells round it (an unexplored waypoint was rock in a scratch game, and
      // the army stood stuck by the forts for half an hour).
      let open = true;
      for (let yy = y - 1; yy <= y + 1 && open; yy++) for (let xx = x - 1; xx <= x + 1 && open; xx++) if ((placement[yy * n + xx] & (PlaceBit.Blocked | PlaceBit.Unexplored)) !== 0) open = false;
      if (!open) continue;
      if (groupsOnWay(groups, a, { x, y }).length > 0 || groupsOnWay(groups, { x, y }, b).length > 0) continue;
      const l = Math.sqrt((x - a.x) * (x - a.x) + (y - a.y) * (y - a.y)) + Math.sqrt((b.x - x) * (b.x - x) + (b.y - y) * (b.y - y));
      if (best === null || l < bestLen - 0.5 || (Math.abs(l - bestLen) <= 0.5 && rank(x, y) < rank(best.x, best.y))) {
        best = { x, y };
        bestLen = l;
      }
    }
    if (best !== null) break;
  }
  return best;
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
    think(tick, ours, forts, home, foes, enemyFarmers, soldiers, farmers, out) {
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
  let razeAgain = -100000;
  /** While the army is away: the soldiers trained since, at home, pulling down a fort on its ground. */
  let reservesRazing = -1;
  let reservesMove = -100000;
  /** Since when the army has gathered at home for a fort it is not yet strong enough for (-1: not). */
  let holdFrom = -1;
  /** D-081, as hard: the way round forts on the current march (null: straight), the army (worth against forts) that broke off from each fort. */
  let via: { x: number; y: number } | null = null;
  /** How near the army has come to the waypoint (cells), and when it last came 2 cells nearer. */
  let viaBest = Number.MAX_SAFE_INTEGER;
  let viaSince = 0;
  const failedAt = new Map<number, number>();
  const fv = fortValues(know.rules);
  const rankOf = (x: number, y: number) => {
    const f = frame(x, y);
    return f.v * n + f.u;
  };
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

      // Enemy forts (D-080) on its ground (by the main city or a town it holds): farmers go for an
      // unguarded one while too few soldiers are by it (the army's part comes below).
      const forts = enemyForts(view, player, rules);
      const held = [...towns.values()]
        .filter((t) => t.owner === player && (t.state === TownState.Repairing || t.state === TownState.Governed))
        .map((t) => ({ x: t.x, y: t.y, radius: rules.towns?.[t.size]?.radius ?? 0 }));
      const ours = forts.length === 0 ? [] : fortsOnOurGround(forts, home, held);
      if (!recalled) crew.think(tick, ours, forts, home, foes, enemyFarmers, soldiers, farmers, out);

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
      const stuck = (id: number, t: Town) => once && t.state === TownState.AwaitingChoice && plundered(id) && !affordAll(governCostOf(rules, t.size));
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
      const defendersOf = (g: FortGroup) => {
        const r = g.radius + FORT_ARMY_NEAR;
        return g.worth + 10 * foes.filter((e) => e.order !== Order.Post && dist2(e.x, e.y, g.x, g.y) <= r * r).length;
      };
      const vsForts = (list: { type: number }[]) => list.reduce((a, u) => a + (fv.vs[u.type] ?? 0), 0);
      const beats = (g: FortGroup, list: { type: number }[]) => {
        const w = vsForts(list);
        let failed = 0;
        for (const id of g.ids) failed = Math.max(failed, failedAt.get(id) ?? 0);
        return w * 10 >= defendersOf(g) * 13 && w * 100 >= failed * FORT_FAILED;
      };
      const tooStrong = (list: { type: number }[]) => groups.filter((g) => !bySiege(g) && !beats(g, list));
      const routeFor = (from: { x: number; y: number }, to: { x: number; y: number }, list: { type: number }[]) => {
        const strong = tooStrong(list);
        if (groupsOnWay(strong, from, to).length === 0) return { go: true, via: null };
        const w = wayRound(strong, from, to, n, view.placement, rankOf);
        return { go: w !== null, via: w };
      };
      const remember = (list: { type: number }[], near: FortGroup[]) => {
        const w = vsForts(list);
        for (const g of near) for (const id of g.ids) failedAt.set(id, Math.max(failedAt.get(id) ?? 0, w));
      };
      /** On the way to a waypoint: false once the army has not come nearer it for FORT_VIA_STUCK (it is out of reach). */
      const viaGoing = (x: number, y: number) => {
        if (via === null) return true;
        const d = Math.sqrt(dist2(x, y, via.x, via.y));
        if (viaBest === Number.MAX_SAFE_INTEGER || d <= viaBest - 2) {
          viaBest = d;
          viaSince = tick;
        }
        return tick - viaSince < FORT_VIA_STUCK;
      };
      const setVia = (w: { x: number; y: number } | null) => {
        via = w;
        viaBest = Number.MAX_SAFE_INTEGER;
        viaSince = tick;
      };
      /** What defends a fort: enemy soldiers by it (not its guards) and the group it is in (D-081; D-080 counted 3 soldiers a tower). */
      const defends = (f: Fort) => {
        const c = fortCentre(f);
        const g = groupOf(f);
        return 10 * foes.filter((e) => e.order !== Order.Post && dist2(e.x, e.y, c.x, c.y) <= FORT_GUARDS * FORT_GUARDS).length + (g === undefined ? 0 : g.worth);
      };
      if (mode === "raze" || ((mode === "gather" || mode === "defend") && !endgame && forts.length > 0)) {
        // With farmers going for a fort, the soldiers at home go with them, however few, to the end.
        const withCrew = crew.aim >= 0 ? ours.find((x) => x.id === crew.aim) : undefined;
        if (mode === "raze" && withCrew === undefined && (standing * 5 < armyAtStart * 2 || outnumbered)) {
          // Ground down or outnumbered: back to the rally point, and again a little later.
          out.push({ c: "retreat", u: armyIds, x: rally.x, y: rally.y });
          lastMove = tick;
          mode = "gather";
          target = { x: rally.x, y: rally.y };
          razing = -1;
          razeAgain = tick + FORT_AGAIN;
          return out;
        }
        const f = withCrew ?? ours.find((x) => x.id === razing) ?? nearestFort(ours, cx, cy);
        if (f !== undefined && !endgame && (withCrew !== undefined ? armyIds.length > 0 : tick >= razeAgain && armyIds.length >= FORT_ARMY)) {
          if (mode === "raze" || withCrew !== undefined || vsForts(army) * 10 >= defends(f) * 13) {
            if (mode !== "raze") {
              armyAtStart = army.length;
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
        if (!endgame && !(mode === "base" && cityLow) && (standing * 5 < armyAtStart * 2 || outnumbered || byArmy.length > 0)) {
          // Ground down or outnumbered: break off (retreat ignores enemies) and rebuild.
          if (mode === "base") baseBroken = true;
          remember(army, byArmy);
          out.push({ c: "retreat", u: armyIds, x: rally.x, y: rally.y });
          lastMove = tick;
          mode = "gather";
          target = { x: rally.x, y: rally.y };
          razing = -1;
          via = null;
          return out;
        }
        // Soldiers trained since it set out, at home, go for forts on its ground once clearly stronger.
        const waiting = army.filter((u) => !marched.has(u.id) && u.order !== Order.Garrison && dist2(u.x, u.y, home.cellX, home.cellY) <= FORT_HOME * FORT_HOME);
        const homeForts = waiting.length >= FORT_ARMY ? ours : [];
        const mine = homeForts.find((x) => x.id === reservesRazing) ?? nearestFort(homeForts, home.cellX, home.cellY);
        let reserves = false;
        if (mine !== undefined) {
          const c = fortCentre(mine);
          if (mine.id === reservesRazing || vsForts(waiting) * 10 >= defends(mine) * 13) {
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
        if (via !== null && dist2(cx, cy, via.x, via.y) <= FORT_VIA_NEAR * FORT_VIA_NEAR) setVia(null);
        if (!viaGoing(cx, cy)) {
          // The way round is out of reach: back, and remember.
          if (mode === "base") baseBroken = true;
          if (aim !== undefined) remember(army, groupsOnWay(tooStrong(army), { x: cx, y: cy }, aim));
          setVia(null);
          out.push({ c: "retreat", u: armyIds, x: rally.x, y: rally.y });
          lastMove = tick;
          mode = "gather";
          target = { x: rally.x, y: rally.y };
          razing = -1;
          return out;
        }
        if (via === null && aim !== undefined && armyIds.length > 0 && !endgame) {
          const strong = tooStrong(army);
          const ahead = groupsOnWay(strong, { x: cx, y: cy }, aim);
          if (ahead.length > 0) {
            setVia(wayRound(strong, { x: cx, y: cy }, aim, n, view.placement, rankOf));
            if (via === null) {
              if (mode === "base") baseBroken = true;
              remember(army, ahead);
              out.push({ c: "retreat", u: armyIds, x: rally.x, y: rally.y });
              lastMove = tick;
              mode = "gather";
              target = { x: rally.x, y: rally.y };
              razing = -1;
              return out;
            }
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
          else send((via ?? t).x, (via ?? t).y, "town");
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
            const goal = via ?? { x: enemyHome.cellX, y: enemyHome.cellY };
            send(goal.x, goal.y, "base");
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
          .sort(([a, ta], [b, tb]) => ta.size - tb.size || a - b);
        // Random maps (D-074): not before it has seen where the enemy is, but for the end of an
        // AI-against-AI game (then the corner across the map, the last resort).
        const go =
          (mem.known !== Known.None || endgame || assault) &&
          (endgame
            ? army.length >= ENDGAME_ARMY
            : assault
              ? army.length >= ASSAULT_ARMY || (latest && army.length >= ENDGAME_ARMY)
              : baseTime && strongEnough && (army.length >= baseNeed || (((open.length === 0 && !baseBroken) || popFull) && army.length >= townArmy + 6)));
        // Forts on the way too strong for the army (D-081): round them, or not to the base this time.
        const toBase = go ? routeFor({ x: home.cellX, y: home.cellY }, { x: enemyHome.cellX, y: enemyHome.cellY }, army) : null;
        if (go && toBase!.go) {
          setVia(toBase!.via);
          armyAtStart = army.length;
          marched.clear();
          for (const id of armyIds) marched.add(id);
          const goal = via ?? { x: enemyHome.cellX, y: enemyHome.cellY };
          send(goal.x, goal.y, "base");
        } else if (!assault && townTime && army.length >= townArmy && open.length > 0 && strongEnough) {
          const pick = army.length >= 24 || open.length === 1 ? open[open.length - 1] : open[0];
          targetTown = pick[0];
          armyAtStart = army.length;
          marched.clear();
          for (const id of armyIds) marched.add(id);
          townTrips++;
          setVia(groups.length === 0 ? null : routeFor({ x: home.cellX, y: home.cellY }, pick[1], army).via);
          const goal = via ?? pick[1];
          send(goal.x, goal.y, "town");
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
  /** D-081: after falling back from a town it leaves that town alone this many minutes (0: never). */
  townRest: number;
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
  townRest: 2,
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
  const plan: HardPlan = { ...HARD, ...know.hard };
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
  let razeAgain = -100000;
  /** While the army is away: the soldiers left at home pulling down a fort on its ground, and that fort. */
  let reservesRazing = -1;
  let reservesMove = -100000;
  const crew = createFortCrew(rank);
  /**
   * D-081: the way round forts on the current march (null: straight); the army (worth against forts)
   * that broke off from each fort; towns it fell back from, left alone until this tick.
   */
  let via: { x: number; y: number } | null = null;
  /** How near the army has come to the waypoint (squared cells), and when it last came 2 cells nearer. */
  let viaBest = Number.MAX_SAFE_INTEGER;
  let viaSince = 0;
  const failedAt = new Map<number, number>();
  const townRest = new Map<number, number>();
  const fv = fortValues(know.rules);

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
      mem.observe(view);
      const toGo = know.maxTicks > 0 ? know.maxTicks - tick : -1;
      const res: Cost = { food: h[HeaderField.food], wood: h[HeaderField.wood], gold: h[HeaderField.gold], crystal: h[HeaderField.crystal] };
      const pop = h[HeaderField.population];
      const cap = h[HeaderField.populationCap];
      /** Plundered already this game (TownFlag.Plundered). */
      const plunderedTown = (id: number) => {
        for (let r = 0; r < view.towns.length; r += TOWN_STRIDE) if (view.towns[r + TownField.id] === id) return (view.towns[r + TownField.flags] & TownFlag.Plundered) !== 0;
        return false;
      };
      /**
       * It governs a town it takes only when it was plundered before (round 7); a first capture it
       * plunders (governing first captures won 3% of 120 games on the final round 7 rules).
       */
      const toGovern = (id: number) => once && plunderedTown(id);
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
      const soldiers = scout.id < 0 ? allSoldiers : allSoldiers.filter((u) => u.id !== scout.id);
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
        if (count(BuildingType.Farm) < Math.min(10, 2 + (farmers.length >> 2))) add(BuildingType.Farm, granary ? { x: granary.x + 1, y: granary.y + 1 } : base);
        if (!has(BuildingType.Mine) && farmers.length >= 14) add(BuildingType.Mine, nearestNode(NodeKind.GoldMine));
        if (res.food + res.wood >= 600 && count(BuildingType.Barracks) + count(BuildingType.Range) < plan.production) {
          add(count(BuildingType.Barracks) <= count(BuildingType.Range) ? BuildingType.Barracks : BuildingType.Range, rally);
        }
        for (const p of plans) {
          if (p.at === null) continue;
          // A mine is only worth it by its node.
          const spot = spotNear(view, p.type, p.at.x, p.at.y, 12) ?? (p.type === BuildingType.Mine ? null : spotNear(view, p.type, base.x, base.y, 20));
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


      // Enemy forts (D-080) on its ground (by the main city or a town it holds): farmers go for an
      // unguarded one while too few soldiers are by it (the army's part is in its orders).
      const forts = enemyForts(view, player, rules);
      const held = [...towns.values()]
        .filter((t) => t.owner === player && (t.state === TownState.Repairing || t.state === TownState.Governed))
        .map((t) => ({ x: t.x, y: t.y, radius: rules.towns?.[t.size]?.radius ?? 0 }));
      const ours = forts.length === 0 ? [] : fortsOnOurGround(forts, home, held);
      if (!recalled) crew.think(tick, ours, forts, home, foes, enemyFarmers, soldiers, farmers, out);

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
        /** What defends a group: its forts, and the enemy soldiers it knows of near it, seen in the last minute (posted guards count with the forts). */
        const defendersOf = (g: FortGroup) => {
          let w = g.worth;
          const r = g.radius + FORT_ARMY_NEAR;
          for (const e of intel.values()) if (!e.post && tick - e.tick <= TICKS_PER_MINUTE && dist2(e.x, e.y, g.x, g.y) <= r * r) w += WORTH[e.type];
          return w;
        };
        const vsForts = (list: { type: number }[]) => list.reduce((a, u) => a + (fv.vs[u.type] ?? 0), 0);
        /** Clearly stronger than a group (1.3 x), and than the army that broke off from it before (FORT_FAILED). */
        const beats = (g: FortGroup, list: { type: number }[]) => {
          const w = vsForts(list);
          let failed = 0;
          for (const id of g.ids) failed = Math.max(failed, failedAt.get(id) ?? 0);
          return w * 10 >= defendersOf(g) * 13 && w * 100 >= failed * FORT_FAILED;
        };
        /** The groups too strong for `list` (not the siege's). */
        const tooStrong = (list: { type: number }[]) => groups.filter((g) => !bySiege(g) && !beats(g, list));
        /** A march with `list` from `from` to `to`: straight, round the groups too strong for it, or not at all. */
        const routeFor = (from: { x: number; y: number }, to: { x: number; y: number }, list: { type: number }[]) => {
          const strong = tooStrong(list);
          if (groupsOnWay(strong, from, to).length === 0) return { go: true, via: null };
          const w = wayRound(strong, from, to, n, view.placement, rank);
          return { go: w !== null, via: w };
        };
        /** On the way to a waypoint: false once the army has not come nearer it for FORT_VIA_STUCK (it is out of reach). */
        const viaGoing = (x: number, y: number) => {
          if (via === null) return true;
          const d = Math.sqrt(dist2(x, y, via.x, via.y));
          if (viaBest === Number.MAX_SAFE_INTEGER || d <= viaBest - 2) {
            viaBest = d;
            viaSince = tick;
          }
          return tick - viaSince < FORT_VIA_STUCK;
        };
        const setVia = (w: { x: number; y: number } | null) => {
          via = w;
          viaBest = Number.MAX_SAFE_INTEGER;
          viaSince = tick;
        };
        /** Broke off by these groups: the next go at them takes more (FORT_FAILED). */
        const remember = (list: { type: number }[], near: FortGroup[]) => {
          const w = vsForts(list);
          for (const g of near) for (const id of g.ids) failedAt.set(id, Math.max(failedAt.get(id) ?? 0, w));
        };
        /** What defends a fort: enemy soldiers by it (not its guards) and the group it is in (D-081; D-080 counted 3 soldiers a tower). */
        const defends = (f: Fort) => {
          const c = fortCentre(f);
          const g = groupOf(f);
          return worth(foesNear(c.x, c.y, FORT_GUARDS).filter((e) => e.order !== Order.Post)) + (g === undefined ? 0 : g.worth);
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
            razing = -1;
            razeAgain = tick + FORT_AGAIN;
            fallBack(post.x, post.y);
            return;
          }
          const f = withCrew ?? ours.find((x) => x.id === razing) ?? nearestFort(ours, ac.x, ac.y);
          const able = withCrew !== undefined ? armyIds.length > 0 : tick >= razeAgain && armyIds.length >= FORT_ARMY;
          if (f !== undefined && !endgame && able && (mode === "raze" || withCrew !== undefined || vsForts(army) * 10 >= defends(f) * 13)) {
            if (mode !== "raze") {
              armyAtStart = army.length;
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
        if (mode === "town") {
          const t = towns.get(targetTown);
          // Forts by the army too strong for it (D-081): it breaks off as from a stronger enemy.
          const byArmy = groups.filter((g) => !bySiege(g) && dist2(g.x, g.y, ac.x, ac.y) <= (g.radius + FORT_WAY) * (g.radius + FORT_WAY) && !beats(g, army));
          if (t === undefined || (t.owner === player && t.state !== TownState.Neutral) || t.state === TownState.Ruins) mode = "home";
          else if (standing * 5 < armyAtStart * 2 || local > armyWorth || byArmy.length > 0) {
            razing = -1;
            via = null;
            remember(army, byArmy);
            // D-081: not straight back to the same town (in 03a70878, 13 orders between it and home in 12 s).
            if (plan.townRest > 0) townRest.set(targetTown, tick + plan.townRest * TICKS_PER_MINUTE);
            fallBack(post.x, post.y);
            return;
          } else {
            // On the way round forts too strong for it (D-081), or back if there is none (or the way round is out of reach).
            if (via !== null && dist2(ac.x, ac.y, via.x, via.y) <= FORT_VIA_NEAR * FORT_VIA_NEAR) setVia(null);
            if (!viaGoing(ac.x, ac.y)) {
              razing = -1;
              remember(army, groupsOnWay(tooStrong(army), ac, t));
              setVia(null);
              if (plan.townRest > 0) townRest.set(targetTown, tick + plan.townRest * TICKS_PER_MINUTE);
              fallBack(post.x, post.y);
              return;
            }
            if (via === null) {
              const strong = tooStrong(army);
              const ahead = groupsOnWay(strong, ac, t);
              if (ahead.length > 0) {
                setVia(wayRound(strong, ac, t, n, view.placement, rank));
                if (via === null) {
                  razing = -1;
                  remember(army, ahead);
                  if (plan.townRest > 0) townRest.set(targetTown, tick + plan.townRest * TICKS_PER_MINUTE);
                  fallBack(post.x, post.y);
                  return;
                }
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
            const goal = via ?? t;
            send(goal.x, goal.y, "town");
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
            remember(front, byFront);
            counterReady = false;
            razing = -1;
            reservesRazing = -1;
            via = null;
            fallBack(post.x, post.y);
            return;
          }
          // On the way round forts too strong for the front (D-081), or back if there is none.
          const enemy = { x: enemyHome.cellX, y: enemyHome.cellY };
          if (via !== null && dist2(fc.x, fc.y, via.x, via.y) <= FORT_VIA_NEAR * FORT_VIA_NEAR) setVia(null);
          if (!viaGoing(fc.x, fc.y)) {
            remember(front, groupsOnWay(tooStrong(front), fc, enemy));
            counterReady = false;
            razing = -1;
            reservesRazing = -1;
            setVia(null);
            fallBack(post.x, post.y);
            return;
          }
          if (via === null && frontIds.length > 0 && !endgame) {
            const strong = tooStrong(front);
            const ahead = groupsOnWay(strong, fc, enemy);
            if (ahead.length > 0) {
              setVia(wayRound(strong, fc, enemy, n, view.placement, rank));
              if (via === null) {
                remember(front, ahead);
                counterReady = false;
                razing = -1;
                reservesRazing = -1;
                fallBack(post.x, post.y);
                return;
              }
            }
          }
          const goal = via ?? enemy;
          // Forts (D-080): those by the front's way first; those on its ground at home, the soldiers
          // waiting there, once clearly stronger.
          const way =
            frontIds.length > 0
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
          if (mine !== undefined && (mine.id === reservesRazing || vsForts(waiting) * 10 >= defends(mine) * 13)) {
            if (mine.id !== reservesRazing || tick - reservesMove >= FORT_EVERY) {
              hit(waiting.map((u) => u.id), mine);
              reservesMove = tick;
            }
            reservesRazing = mine.id;
          } else reservesRazing = -1;
          if (way !== undefined) {
            razeWith(frontIds, way);
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
            (target.x !== goal.x || target.y !== goal.y || tick - lastMove >= (there ? 100 : 400) || (reserves.length >= 6 && !garrisonOn))
          ) {
            // On the way (round forts: by the waypoint first), or there without the city in sight yet: on to it.
            out.push({ c: "move", u: frontIds, x: goal.x, y: goal.y });
            lastMove = tick;
            sent = true;
            target = { x: goal.x, y: goal.y };
          }
          const wait = reserves.filter((u) => !marched.has(u.id) && dist2(u.x, u.y, post.x, post.y) > 9).map((u) => u.id);
          if (wait.length > 0 && tick % 100 === 0 && reservesRazing < 0) out.push({ c: "move", u: wait, x: post.x, y: post.y });
          return;
        }
        // At home: march, go for a town, or wait by the city.
        const popFull = toGo < 0 && cap >= rules.maxPopulation && pop >= cap - FULL_MARGIN;
        const strong = armyWorth * 100 >= enemyWorth * plan.pushRatio;
        // Random maps (D-074): not before it has seen where the enemy is, but for the end of an
        // AI-against-AI game (then the corner across the map, the last resort).
        const go =
          (mem.known !== Known.None || endgame || assault) &&
          (endgame
            ? army.length >= ENDGAME_ARMY
            : assault
              ? army.length >= ASSAULT_ARMY || (latest && army.length >= ENDGAME_ARMY)
              : (counterReady && army.length >= plan.counterArmy && armyWorth >= enemyWorth) ||
                (army.length >= pushArmy && strong) ||
                (popFull && army.length >= townArmy + 6));
        // Forts on the way too strong for the army (D-081): round them, or not to the base this time.
        const toBase = go ? routeFor({ x: home.cellX, y: home.cellY }, { x: enemyHome.cellX, y: enemyHome.cellY }, army) : null;
        if (go && toBase!.go) {
          setVia(toBase!.via);
          armyAtStart = army.length;
          marched.clear();
          for (const u of army) marched.add(u.id);
          counterReady = false;
          reservesRazing = -1;
          const goal = via ?? { x: enemyHome.cellX, y: enemyHome.cellY };
          send(goal.x, goal.y, "base");
          return;
        }
        if (!assault) {
          let pick = -1;
          let pickD = 0;
          for (const [id, t] of towns) {
            if (t.state === TownState.Ruins || t.state === TownState.Plundering || (t.owner === player && t.state !== TownState.Neutral)) continue;
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
            // D-081: not where forts too strong for it stand on the way or by the town, unless it can go round.
            if (groups.length > 0 && !routeFor({ x: home.cellX, y: home.cellY }, t, army).go) continue;
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
            setVia(groups.length === 0 ? null : routeFor({ x: home.cellX, y: home.cellY }, t, army).via);
            const goal = via ?? t;
            send(goal.x, goal.y, "town");
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
