// The tutorial (R25; D-150, D-151; the user's boards in war-game-worktrees/ui/design/r25): scenario "tutorial", its own
// 65 x 65 map (tutorial-data.ts, made by src/tutorial-freeze.ts), known whole as the fixed map is. Player 1 never thinks
// (runner.ts): it has its main city and nothing else, and its soldiers come only when the screen asks ("near_home").
// The screen moves the lesson on with `tutorial` commands (PROTOCOL.md 3.12), each putting the outcome of a step in the
// game: so a step can be skipped, and the soldiers step 7 needs come when it begins. They go into the game's log as
// every command does, so a tutorial replays. Player 0 cannot lose: its main city keeps half its hp (units.ts).

import type { Frame } from "../frame.ts";
import { BuildingType, CELL_SHIFT, NEUTRAL, NodeKind, Reject, Resource, Terrain, type TownSize, TUTORIAL_EVENTS, type TutorialEvent, UnitType } from "../protocol.ts";
import { applyCommand, type CommandContext, pushOut } from "./commands.ts";
import type { Fog } from "./fog.ts";
import type { GameMap, NodeSpec, TownSpec } from "./map.ts";
import { BUILDINGS, TUTORIAL_TOWN, UNITS } from "./rules.ts";
import { TUTORIAL } from "./tutorial-data.ts";
import type { World } from "./world.ts";

/** The tutorial's numbers. */
export const TUTORIAL_RULES = {
  /**
   * Player 0's food, wood and gold at the start: a barracks (wood 120), 5 spearmen (food 200, wood 100), the houses
   * 自動蓋民居 puts up, and governing the town (wood 80, gold 80), with some to spare (ui: never stuck waiting to
   * govern). Player 1 has nothing.
   */
  start: { food: 300, wood: 500, gold: 200 },
  /** The town's militia and repair ticks (rules.ts, so that Rules.towns says them too). */
  ...TUTORIAL_TOWN,
  /** Player 0's main city never falls below this many thousandths of its hp. */
  floorPermille: 500,
  /** "spears": spearmen; "near_home": player 1's spearmen (from the map's squad anchor); "engines": siege engines. */
  spears: 5,
  nearHome: { spearmen: 4 },
  engines: 2,
  /** "town": player 0's spearmen it stands inside (the town needs one to stay governed). */
  townGuards: 2,
  /** Ground explored at the start around the town and player 1's main city (cells), besides home's (START_REVEAL). */
  reveal: 8,
};

const TERRAIN: Record<string, number> = { R: Terrain.Blocked, "#": Terrain.Wall, "~": Terrain.Water, K: Terrain.Cliff, f: Terrain.Ford, "|": Terrain.BridgeNS, "=": Terrain.BridgeEW };
const NODE: Record<string, NodeKind> = { T: NodeKind.Tree, G: NodeKind.GoldMine, B: NodeKind.Berries, V: NodeKind.CrystalVein };

/** The tutorial's map from its data; `seed` is the game's (the map is the same whatever it is). */
export function tutorialMap(seed: number): GameMap {
  const d = TUTORIAL;
  const n = d.size;
  const terrain = new Uint8Array(n * n);
  const nodes: NodeSpec[] = [];
  d.rows.forEach((row, y) => {
    for (let x = 0; x < n; x++) {
      const c = row[x];
      const kind = NODE[c];
      if (kind !== undefined) nodes.push({ kind, cellX: x, cellY: y, amount: (d.amounts as Record<string, number>)[c] });
      else if (c !== ".") terrain[y * n + x] = TERRAIN[c];
    }
  });
  const towns: TownSpec[] = d.towns.map(([size, cellX, cellY, radius], id) => ({ id, size: size as TownSize, cellX, cellY, radius }));
  return {
    seed,
    size: n,
    terrain,
    nodes,
    spawns: d.spawns.map(([cellX, cellY], player) => ({ player, cellX, cellY })),
    towns,
    // No big city: the tower is never placed (KEEP: every town has a keep instead).
    tower: { cellX: towns[0].cellX, cellY: towns[0].cellY },
    frames: d.frames as unknown as Frame[],
    mode: "fixed",
    posts: d.posts as [number, number][],
    tutorial: { rally: { ...d.rally }, own: { ...d.anchors.own }, squad: { ...d.anchors.squad } },
  };
}

/** Is this the tutorial's game? */
export function isTutorial(w: World): boolean {
  return w.map.tutorial !== undefined;
}

/** Player 0's main city's least hp in the tutorial (0: anywhere else, or player 1's). */
export function mainCityFloor(w: World, owner: number): number {
  if (!isTutorial(w) || owner !== 0) return 0;
  return Math.trunc((BUILDINGS[BuildingType.MainCity].hp * TUTORIAL_RULES.floorPermille) / 1000);
}

/** Town repair ticks for governing (the tutorial's shorter). */
export function repairTicks(w: World, ticks: number): number {
  return isTutorial(w) ? TUTORIAL_RULES.repairTicks : ticks;
}

/** After the standard start (scenarios.ts): player 1's farmers gone, the town's militia cut, the tutorial's resources. */
export function setupTutorial(w: World): void {
  const u = w.units.col;
  const gone = new Uint8Array(w.units.count);
  let militia = 0;
  for (let s = 0; s < w.units.count; s++) {
    if (u.owner[s] === 1) gone[s] = 1;
    else if (u.owner[s] === NEUTRAL && militia++ >= TUTORIAL_RULES.militia) gone[s] = 1;
  }
  // As never there: no deaths counted.
  for (let s = 0; s < w.units.count; s++) if (gone[s] === 1) w.unitSlot[u.id[s]] = -1;
  w.units.compact(gone, (_from, to) => {
    w.unitSlot[u.id[to]] = to;
  });
  // The militia that stood on the walls before (D-096) left their cells.
  for (let t = 0; t < w.townSize.length; t++) {
    for (const c of w.wallCells[t]) if (w.wallAt[c] >= 0 && w.unit(w.wallAt[c]) < 0) w.wallAt[c] = -1;
  }
  const r = TUTORIAL_RULES.start;
  w.res.fill(0, 0, 8);
  w.res[Resource.Food] = r.food;
  w.res[Resource.Wood] = r.wood;
  w.res[Resource.Gold] = r.gold;
}

/** At the start: player 0 has explored the ground round the town and player 1's main city, and knows its nodes. */
export function revealTutorial(fog: Fog, w: World): void {
  const n = w.size;
  const exp = fog.explored[0];
  const at = [...w.map.towns.map((t) => ({ x: t.cellX, y: t.cellY })), { x: w.homes[1].cellX, y: w.homes[1].cellY }];
  const r = TUTORIAL_RULES.reveal;
  for (const c of at) {
    for (let y = Math.max(0, c.y - r); y <= Math.min(n - 1, c.y + r); y++) {
      for (let x = Math.max(0, c.x - r); x <= Math.min(n - 1, c.x + r); x++) {
        if ((x - c.x) * (x - c.x) + (y - c.y) * (y - c.y) <= r * r) exp[y * n + x] = 1;
      }
    }
  }
  const seen = fog.nodeSeen[0];
  for (let k = 0; k < seen.length; k++) if (exp[w.nodeY[k] * n + w.nodeX[k]] === 1) seen[k] = w.nodeAmount[k];
}

/** The tutorial's one cell rule for fog.ts: each side always sees the other's main city (the screen's step 9; "near_home"'s attack). */
export function alwaysSeen(w: World, p: number, stamp: (x: number, y: number) => void): void {
  if (!isTutorial(w)) return;
  const b = w.buildings.col;
  for (let s = 0; s < w.buildings.count; s++) {
    if (b.type[s] !== BuildingType.MainCity || b.owner[s] === p) continue;
    const size = BUILDINGS[BuildingType.MainCity].size;
    for (let y = b.cellY[s] - 1; y <= b.cellY[s] + size; y++) for (let x = b.cellX[s] - 1; x <= b.cellX[s] + size; x++) stamp(x, y);
  }
}

/** Cells (centre first) from `x`, `y` outward, nearest first, ties by y then x: where the events put things. */
function outward(w: World, x: number, y: number, radius: number): number[] {
  const n = w.size;
  const out: { c: number; d: number }[] = [];
  for (let cy = Math.max(0, y - radius); cy <= Math.min(n - 1, y + radius); cy++) {
    for (let cx = Math.max(0, x - radius); cx <= Math.min(n - 1, x + radius); cx++) out.push({ c: cy * n + cx, d: (cx - x) * (cx - x) + (cy - y) * (cy - y) });
  }
  return out.sort((a, b) => a.d - b.d || a.c - b.c).map((o) => o.c);
}

/** A cell a unit may stand on (open, no building, not a castle's wall). */
function standable(w: World, c: number): boolean {
  return w.grid[c] === 0 && w.buildingAt[c] < 0 && w.map.terrain[c] !== Terrain.Wall;
}

/** `count` units of `type` for `owner` on free cells nearest (x, y); their ids. */
function addUnits(w: World, owner: number, type: UnitType, count: number, x: number, y: number): number[] {
  const n = w.size;
  const ids: number[] = [];
  const taken = new Set<number>();
  for (const c of outward(w, x, y, 12)) {
    if (ids.length === count) break;
    if (!standable(w, c) || taken.has(c)) continue;
    taken.add(c);
    ids.push(w.addUnit(owner, type, ((c % n) << CELL_SHIFT) + 512, (Math.trunc(c / n) << CELL_SHIFT) + 512, UNITS[type].hp));
  }
  return ids;
}

/** A finished building of player 0's at the free spot (a free cell all round it) nearest (x, y); false if none. */
function addBuilt(w: World, type: BuildingType, x: number, y: number): boolean {
  const n = w.size;
  const size = BUILDINGS[type].size;
  const free = (cx: number, cy: number) => {
    for (let yy = cy - 1; yy <= cy + size; yy++) {
      for (let xx = cx - 1; xx <= cx + size; xx++) {
        if (xx < 0 || yy < 0 || xx >= n || yy >= n) return false;
        const c = yy * n + xx;
        if (w.buildingAt[c] >= 0 || w.keepGround[c] === 1 || w.gateLane[c] === 1) return false;
        if (xx >= cx && xx < cx + size && yy >= cy && yy < cy + size && w.grid[c] !== 0) return false;
      }
    }
    return true;
  };
  for (const c of outward(w, x - (size >> 1), y - (size >> 1), 14)) {
    const cx = c % n;
    const cy = Math.trunc(c / n);
    if (!free(cx, cy)) continue;
    w.addBuilding(0, type, cx, cy, BUILDINGS[type].hp, 1000);
    pushOut(w, cx, cy, size);
    return true;
  }
  return false;
}

/**
 * A `tutorial` command (R25; PROTOCOL.md 3.12): 0 if done, else why not. Player 0 in the tutorial's game only; "houses",
 * "spears", "town", "siege" and "engines" once a game, "near_home" not while its last squad lives, "near_home_clear"
 * only while it does.
 */
export function tutorialEvent(ctx: CommandContext, p: number, event: TutorialEvent): number {
  const { w } = ctx;
  if (!isTutorial(w) || p !== 0) return Reject.NotAvailable;
  const bit = TUTORIAL_EVENTS.indexOf(event);
  if (bit < 0) return Reject.InvalidTarget;
  const once = event !== "near_home" && event !== "near_home_clear";
  if (once && (w.tutorialUsed & (1 << bit)) !== 0) return Reject.NotAvailable;
  // Things of player 0's go up on its main city's side toward the map's middle (the map's anchors, tutorial-freeze.ts).
  const by = w.map.tutorial!.own;
  switch (event) {
    case "houses":
      if (!addBuilt(w, BuildingType.Barracks, by.x, by.y) || !addBuilt(w, BuildingType.House, by.x, by.y)) return Reject.BadPlacement;
      break;
    case "spears":
      addUnits(w, 0, UnitType.Spearman, TUTORIAL_RULES.spears, by.x, by.y);
      break;
    case "engines":
      addUnits(w, 0, UnitType.Siege, TUTORIAL_RULES.engines, by.x, by.y);
      break;
    case "siege": {
      if (!addBuilt(w, BuildingType.SiegeWorks, by.x, by.y)) return Reject.BadPlacement;
      const engine = UNITS[UnitType.Siege].cost;
      w.res[Resource.Food] += engine.food * TUTORIAL_RULES.engines;
      w.res[Resource.Wood] += engine.wood * TUTORIAL_RULES.engines;
      w.res[Resource.Gold] += engine.gold * TUTORIAL_RULES.engines;
      break;
    }
    case "town": {
      // The town's militia and keep fall (the ordinary deaths, this tick); player 0's spearmen stand inside; once the
      // town is captured (towns.ts, the next tick), it is governed at once (TownSystem.tutorialTown).
      const t = 0;
      if (w.townOwner[t] === 0) return Reject.NotAvailable;
      const u = w.units.col;
      for (let s = 0; s < w.units.count; s++) if (u.owner[s] === NEUTRAL && u.home[s] === t) u.hp[s] = 0;
      const b = w.buildings.col;
      for (let s = 0; s < w.buildings.count; s++) if (b.type[s] === BuildingType.Keep && b.town[s] === t && b.owner[s] !== 0) b.hp[s] = 0;
      addUnits(w, 0, UnitType.Spearman, TUTORIAL_RULES.townGuards, w.townX[t], w.townY[t] + 2);
      w.tutorialTown = t;
      break;
    }
    case "near_home_clear": {
      // Step 7 skipped (client): near_home's squad falls (the ordinary deaths, this tick).
      const alive = w.tutorialSquad.filter((id) => w.unit(id) >= 0);
      if (alive.length === 0) return Reject.NotAvailable;
      for (const id of alive) w.units.col.hp[w.unit(id)] = 0;
      break;
    }
    case "near_home": {
      if (w.tutorialSquad.some((id) => w.unit(id) >= 0)) return Reject.NotAvailable;
      const from = w.map.tutorial!.squad;
      const ids = addUnits(w, 1, UnitType.Spearman, TUTORIAL_RULES.nearHome.spearmen, from.x, from.y);
      w.tutorialSquad = ids;
      const b = w.buildings.col;
      let city = -1;
      for (let s = 0; s < w.buildings.count; s++) if (b.type[s] === BuildingType.MainCity && b.owner[s] === 0) city = b.id[s];
      if (city >= 0) applyCommand(ctx, { c: "attack", u: ids, target: city, p: 1, t: w.tick, seq: 0 });
      break;
    }
  }
  if (once) w.tutorialUsed |= 1 << bit;
  return 0;
}
